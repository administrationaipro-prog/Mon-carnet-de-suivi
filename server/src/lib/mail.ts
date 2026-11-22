import type { Db } from '../db.js';
import { config } from '../config.js';

type Lang = 'fr' | 'en';
const T: Record<string, Record<Lang, (p: any) => { subject: string; body: string }>> = {
  verify_email: {
    fr: (p) => ({ subject: 'Vérifiez votre adresse courriel', body: `Bonjour,\n\nPour vérifier votre adresse, ouvrez : ${config.publicUrl}/verify-email?token=${p.token}\n\nCe lien expire dans 48 heures.` }),
    en: (p) => ({ subject: 'Verify your email address', body: `Hello,\n\nTo verify your address, open: ${config.publicUrl}/verify-email?token=${p.token}\n\nThis link expires in 48 hours.` }),
  },
  reset_password: {
    fr: (p) => ({ subject: 'Réinitialisation du mot de passe', body: `Pour choisir un nouveau mot de passe : ${config.publicUrl}/reset-password?token=${p.token}\nLien valable 1 heure. Ignorez ce message si vous n'êtes pas à l'origine de la demande.` }),
    en: (p) => ({ subject: 'Password reset', body: `To choose a new password: ${config.publicUrl}/reset-password?token=${p.token}\nLink valid for 1 hour. Ignore this message if you did not request it.` }),
  },
  registration_status: {
    fr: (p) => ({ subject: 'Votre demande d’inscription a évolué', body: `Le statut de votre demande est désormais : ${p.statusLabelFr}.${p.reason ? `\nMotif : ${p.reason}` : ''}\nConnectez-vous pour plus de détails.` }),
    en: (p) => ({ subject: 'Your registration request was updated', body: `Your request status is now: ${p.statusLabelEn}.${p.reason ? `\nReason: ${p.reason}` : ''}\nSign in for details.` }),
  },
  invitation: {
    fr: (p) => ({ subject: 'Invitation à rejoindre une exploitation', body: `Vous avez été invité(e) à rejoindre l’exploitation « ${p.farm} » en tant que ${p.role}. Connectez-vous ou créez un compte avec cette adresse pour accepter.` }),
    en: (p) => ({ subject: 'Invitation to join a farm', body: `You have been invited to join the farm "${p.farm}" as ${p.role}. Sign in or create an account with this address to accept.` }),
  },
  test_email: {
    fr: () => ({ subject: 'Test d’envoi — Carnet de suivi', body: `Ce courriel confirme que l’envoi depuis ${config.publicUrl} fonctionne.` }),
    en: () => ({ subject: 'Sending test — Farm Logbook', body: `This email confirms that sending from ${config.publicUrl} works.` }),
  },
  new_request: {
    fr: (p) => ({ subject: 'Nouvelle demande d’inscription à examiner', body: `Une demande (${p.territory}) vous est affectée. Connectez-vous à l’espace de validation.` }),
    en: (p) => ({ subject: 'New registration request to review', body: `A request (${p.territory}) has been assigned to you. Sign in to the review area.` }),
  },
};

export const mailEnabled = () => !!(config.brevoApiKey && config.mailFromEmail);

/**
 * Met le courriel en file d’envoi dans la même transaction que l’opération métier :
 * il ne part que si l’opération est validée (pas de courriel pour une action annulée).
 */
export async function sendMail(db: Db, to: string, lang: Lang, template: keyof typeof T, params: any) {
  const { subject, body } = T[template][lang](params);
  await db.query('insert into outbox_emails (to_email, subject, body, status) values ($1,$2,$3,$4)',
    [to, subject, body, mailEnabled() ? 'pending' : 'logged']);
  if (!config.isProd && process.env.VITEST === undefined) console.log(`[courriel → ${to}] ${subject}\n${body}\n`);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toHtml(text: string) {
  const linked = esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2420">${linked.replace(/\n/g, '<br>')}</div>`;
}

/** Appel à l’API transactionnelle Brevo. Renvoie l’identifiant du message. */
export async function brevoSend(m: { to: string; subject: string; body: string }): Promise<string | null> {
  const res = await fetch(config.brevoApiUrl, {
    method: 'POST',
    headers: { 'api-key': config.brevoApiKey!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: config.mailFromName, email: config.mailFromEmail },
      to: [{ email: m.to }],
      subject: m.subject,
      textContent: m.body,
      htmlContent: toHtml(m.body),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = `${j.code ?? res.status}: ${j.message ?? text}`.slice(0, 300); } catch { /* texte brut */ }
    const err = new Error(`brevo_${res.status} ${msg}`) as Error & { permanent?: boolean };
    // 400 = requête invalide (adresse, expéditeur non validé…) : inutile de réessayer
    err.permanent = res.status === 400;
    throw err;
  }
  try { return JSON.parse(text).messageId ?? null; } catch { return null; }
}

const MAX_ATTEMPTS = 6;
let running = false;
/** Envoie les courriels en attente (verrou « skip locked » : plusieurs instances possibles). */
export async function dispatchOutbox(pool: { connect: () => Promise<any> }): Promise<number> {
  if (!mailEnabled() || running) return 0;
  running = true;
  let sent = 0;
  try {
    while (true) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const { rows } = await c.query(
          `select id, to_email, subject, body, attempts from outbox_emails
            where status = 'pending' and next_attempt_at <= now() order by id limit 1 for update skip locked`);
        const m = rows[0];
        if (!m) { await c.query('commit'); break; }
        try {
          const pid = await brevoSend({ to: m.to_email, subject: m.subject, body: m.body });
          await c.query(`update outbox_emails set status = 'sent', sent_at = now(), attempts = attempts + 1, provider_id = $2, last_error = null where id = $1`, [m.id, pid]);
          sent++;
        } catch (e: any) {
          const attempts = m.attempts + 1;
          const failed = e?.permanent || attempts >= MAX_ATTEMPTS;
          // nouvel essai avec délai croissant : 1, 4, 9, 16, 25 minutes
          await c.query(
            `update outbox_emails set attempts = $2, last_error = $3, status = $4, next_attempt_at = now() + ($5 || ' minutes')::interval where id = $1`,
            [m.id, attempts, String(e?.message ?? e).slice(0, 500), failed ? 'failed' : 'pending', String(attempts * attempts)]);
          console.error(`[courriel] échec d’envoi #${m.id} (tentative ${attempts}) : ${e?.message ?? e}`);
        }
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally { c.release(); }
    }
  } finally { running = false; }
  return sent;
}

export async function notify(db: Db, userId: string, kind: string, payload: unknown) {
  await db.query('insert into notifications (user_id, kind, payload) values ($1,$2,$3)', [userId, kind, JSON.stringify(payload)]);
}
