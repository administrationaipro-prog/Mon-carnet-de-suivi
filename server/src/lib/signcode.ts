import { randomInt } from 'node:crypto';
import type { Ctx } from '../http.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { sha256 } from './crypto.js';
import { HttpError, bad } from './errors.js';
import { sendMail } from './mail.js';

/** Envoie un SMS via Brevo. Renvoie false si non configuré ou en échec (le code part alors par courriel). */
async function sendSms(phone: string, content: string): Promise<boolean> {
  if (!config.smsSender || !config.brevoApiKey || process.env.VITEST) return false;
  try {
    const r = await fetch(config.brevoSmsUrl, {
      method: 'POST',
      headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: config.smsSender, recipient: phone.replace(/[^\d+]/g, ''), content, type: 'transactional' }),
    });
    return r.ok;
  } catch { return false; }
}

const mask = (s: string) => (s.includes('@') ? s.replace(/^(.).*(@.*)$/, '$1•••$2') : s.replace(/\d(?=\d{2})/g, '•'));

/** Code à 6 chiffres, valable 10 minutes, lié à une action précise (ex. signature d'un rapport). */
export async function issueSignCode(c: Ctx, purpose: string, targetId: string, what: string, phone?: string | null) {
  const recent = await c.db.query(`select count(*)::int n from sign_codes where user_id = $1 and created_at > now() - interval '10 minutes'`, [c.user.id]);
  if (recent.rows[0].n >= 5) throw new HttpError(429, 'too_many_requests');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  let channel = 'email';
  if (phone && (await sendSms(phone, `Carnet de suivi : code de signature ${code} (${what}). Valable 10 min.`))) channel = 'sms';
  else await sendMail(c.db, c.user.email, c.user.lang, 'sign_code', { code, what });
  await c.db.query(
    `insert into sign_codes (user_id, purpose, target_id, code_hash, channel, expires_at) values ($1,$2,$3,$4,$5, now() + interval '10 minutes')`,
    [c.user.id, purpose, targetId, sha256(`${purpose}:${targetId}:${code}`), channel]);
  return { channel, to: channel === 'sms' ? mask(phone!) : mask(c.user.email) };
}

export async function consumeSignCode(c: Ctx, purpose: string, targetId: string, code: string) {
  const { rows } = await c.db.query(
    `select * from sign_codes where user_id = $1 and purpose = $2 and target_id = $3 and used_at is null and expires_at > now()
      order by created_at desc limit 1`, [c.user.id, purpose, targetId]);
  const r = rows[0];
  if (!r) throw bad('sign_code_expired');
  if (r.attempts >= 5) throw bad('sign_code_locked');
  if (r.code_hash !== sha256(`${purpose}:${targetId}:${code.trim()}`)) {
    // hors transaction : l'échec doit être compté même si la requête est annulée
    await pool.query('update sign_codes set attempts = attempts + 1 where id = $1', [r.id]);
    throw bad('sign_code_invalid');
  }
  await c.db.query('update sign_codes set used_at = now() where id = $1', [r.id]);
  return r.channel as string;
}
