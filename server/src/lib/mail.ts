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
  new_request: {
    fr: (p) => ({ subject: 'Nouvelle demande d’inscription à examiner', body: `Une demande (${p.territory}) vous est affectée. Connectez-vous à l’espace de validation.` }),
    en: (p) => ({ subject: 'New registration request to review', body: `A request (${p.territory}) has been assigned to you. Sign in to the review area.` }),
  },
};

/** Envoi via « boîte d’envoi » en base (à brancher sur un relais SMTP en production). */
export async function sendMail(db: Db, to: string, lang: Lang, template: keyof typeof T, params: any) {
  const { subject, body } = T[template][lang](params);
  await db.query('insert into outbox_emails (to_email, subject, body) values ($1,$2,$3)', [to, subject, body]);
  if (!config.isProd && process.env.VITEST === undefined) console.log(`[courriel → ${to}] ${subject}\n${body}\n`);
}

export async function notify(db: Db, userId: string, kind: string, payload: unknown) {
  await db.query('insert into notifications (user_id, kind, payload) values ($1,$2,$3)', [userId, kind, JSON.stringify(payload)]);
}
