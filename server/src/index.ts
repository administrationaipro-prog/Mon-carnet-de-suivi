import { createApp } from './app.js';
import { migrate, pool } from './db.js';
import { ensureAdmin } from './bootstrap.js';
import { config } from './config.js';
import { dispatchOutbox, mailEnabled } from './lib/mail.js';
import { runStockAlerts } from './lib/stockAlerts.js';

await migrate();
await ensureAdmin(pool);
// Purge périodique des sessions expirées et tentatives anciennes
setInterval(() => {
  pool.query(`delete from sessions where expires_at < now(); delete from login_attempts where at < now() - interval '30 days';`).catch(() => {});
}, 3_600_000).unref();

// Envoi des courriels en file (Brevo)
if (mailEnabled()) {
  console.log(`[courriel] Envoi via Brevo activé (expéditeur : ${config.mailFromEmail})`);
  setInterval(() => { dispatchOutbox(pool).catch((e) => console.error('[courriel]', e)); }, 3000).unref();
} else {
  console.warn('[courriel] BREVO_API_KEY / MAIL_FROM_EMAIL absents : courriels enregistrés en base sans envoi (Administration → Courriels envoyés).');
}

// Alertes de stock : vérification toutes les heures (la consommation estimée avance chaque jour)
const stockJob = () => runStockAlerts().then((n) => { if (n) console.log(`[stock] ${n} alerte(s) « il faut passer commande » envoyée(s)`); }).catch((e) => console.error('[stock]', e));
setTimeout(stockJob, 60_000).unref();
setInterval(stockJob, 3_600_000).unref();

createApp().listen(config.port, () => console.log(`Carnet de suivi — http://localhost:${config.port} (${config.env})`));
