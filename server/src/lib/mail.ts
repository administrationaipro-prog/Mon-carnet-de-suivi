import type { Db } from '../db.js';
import { config } from '../config.js';

type Lang = 'fr' | 'en';
const fmtFr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso);
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
  stock_low: {
    fr: (p) => ({ subject: `Il faut passer commande : ${p.item}`, body: `Bonjour,\n\nStock « ${p.item} » (${p.farm}) : il reste environ ${p.qty} ${p.unit}.${p.date ? `\nRupture estimée vers le ${fmtFr(p.date)}.` : ''}\n\nIl faut passer commande. Vous pouvez commander dans la boutique de l’application : ${config.publicUrl}/boutique\nPour mettre à jour le stock : ${config.publicUrl}/stock` }),
    en: (p) => ({ subject: `Time to reorder: ${p.item}`, body: `Hello,\n\nStock “${p.item}” (${p.farm}): about ${p.qty} ${p.unit} left.${p.date ? `\nEstimated run-out around ${p.date}.` : ''}\n\nPlease place an order. You can order from the app shop: ${config.publicUrl}/boutique\nTo update the stock: ${config.publicUrl}/stock` }),
  },
  new_order: {
    fr: (p) => ({ subject: `Nouvelle commande : ${p.quantity} × ${p.product}`, body: `L’exploitation « ${p.farm} » a commandé ${p.quantity} × ${p.product} (${p.supplier}).\nÀ traiter dans Administration → Boutique : ${config.publicUrl}/admin` }),
    en: (p) => ({ subject: `New order: ${p.quantity} × ${p.product}`, body: `Farm “${p.farm}” ordered ${p.quantity} × ${p.product} (${p.supplier}).\nTo process in Administration → Shop: ${config.publicUrl}/admin` }),
  },
  order_status: {
    fr: (p) => ({ subject: `Votre commande : ${p.statusFr}`, body: `Commande de ${p.quantity} × ${p.product} : ${p.statusFr}.${p.delivery_date ? `\nLivraison : ${fmtFr(p.delivery_date)}.` : ''}${p.note ? `\nMessage : ${p.note}` : ''}\n\nSuivi dans la boutique : ${config.publicUrl}/boutique` }),
    en: (p) => ({ subject: `Your order: ${p.statusEn}`, body: `Order of ${p.quantity} × ${p.product}: ${p.statusEn}.${p.delivery_date ? `\nDelivery: ${p.delivery_date}.` : ''}${p.note ? `\nMessage: ${p.note}` : ''}\n\nTrack it in the shop: ${config.publicUrl}/boutique` }),
  },
  vet_profile_submitted: {
    fr: (p) => ({ subject: 'Compte vétérinaire à vérifier', body: `${p.name} demande un compte vétérinaire (n° d’inscription à l’Ordre : ${p.ordinal}, ${p.clinic}).\nVérifiez son inscription dans l’annuaire de l’Ordre puis décidez dans Administration → Vétérinaires : ${config.publicUrl}/admin` }),
    en: (p) => ({ subject: 'Veterinarian account to verify', body: `${p.name} requests a veterinarian account (registration no. ${p.ordinal}, ${p.clinic}).\nCheck the registration then decide in Administration → Veterinarians: ${config.publicUrl}/admin` }),
  },
  vet_decision: {
    fr: (p) => ({ subject: p.status === 'verified' ? 'Votre compte vétérinaire est vérifié' : 'Votre compte vétérinaire', body: p.status === 'verified' ? `Votre inscription a été vérifiée. Vous pouvez désormais consulter les exploitations qui vous donnent accès, donner votre avis et signer les rapports : ${config.publicUrl}/veto` : `Statut de votre compte vétérinaire : ${p.status}.${p.note ? `\nMotif : ${p.note}` : ''}` }),
    en: (p) => ({ subject: 'Your veterinarian account', body: p.status === 'verified' ? `Your registration has been verified. You can now access the farms that grant you access, give your opinion and sign reports: ${config.publicUrl}/veto` : `Your veterinarian account status: ${p.status}.${p.note ? `\nReason: ${p.note}` : ''}` }),
  },
  vet_access_granted: {
    fr: (p) => ({ subject: `Accès de consultation : ${p.farm}`, body: `${p.by} vous donne accès à l’exploitation « ${p.farm} » jusqu’au ${p.until}.\nOuvrir l’espace vétérinaire : ${config.publicUrl}/veto` }),
    en: (p) => ({ subject: `Consultation access: ${p.farm}`, body: `${p.by} gives you access to the farm “${p.farm}” until ${p.until}.\nOpen the veterinarian area: ${config.publicUrl}/veto` }),
  },
  sign_code: {
    fr: (p) => ({ subject: `Code de signature : ${p.code}`, body: `Votre code de confirmation pour signer ${p.what} : ${p.code}\nValable 10 minutes. Ne le communiquez à personne.` }),
    en: (p) => ({ subject: `Signing code: ${p.code}`, body: `Your confirmation code to sign ${p.what}: ${p.code}\nValid for 10 minutes. Do not share it.` }),
  },
  copro_signed: {
    fr: (p) => ({ subject: `Rapport de coproscopie signé : ${p.number}`, body: `${p.vet} a signé le rapport de coproscopie ${p.number} (${p.farm}).\nConsulter et télécharger le PDF : ${config.publicUrl}/parasitisme/copro/${p.id}\nVérifier l’authenticité : ${config.publicUrl}/verifier/${p.number}` }),
    en: (p) => ({ subject: `Faecal egg count report signed: ${p.number}`, body: `${p.vet} signed the report ${p.number} (${p.farm}).\nView and download the PDF: ${config.publicUrl}/parasitisme/copro/${p.id}\nCheck authenticity: ${config.publicUrl}/verifier/${p.number}` }),
  },
  settings_signed: {
    fr: (p) => ({ subject: 'Avis vétérinaire sur le protocole parasitaire', body: `${p.vet} a validé les seuils parasitaires (${p.species}) de « ${p.farm} ».\nConsulter : ${config.publicUrl}/parasitisme` }),
    en: (p) => ({ subject: 'Veterinary opinion on the parasite protocol', body: `${p.vet} validated the parasite thresholds (${p.species}) of “${p.farm}”.\nView: ${config.publicUrl}/parasitisme` }),
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
