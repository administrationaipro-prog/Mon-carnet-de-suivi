import type pg from 'pg';
import { hashPassword } from './lib/crypto.js';
import { config } from './config.js';

/** Crée l’administrateur initial (ADMIN_EMAIL / ADMIN_PASSWORD) s’il n’existe aucun administrateur. */
export async function ensureAdmin(p: pg.Pool) {
  const { rows } = await p.query(`select 1 from users where platform_role = 'admin' and status = 'active' limit 1`);
  if (rows.length) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn('[bootstrap] Aucun administrateur : définissez ADMIN_EMAIL et ADMIN_PASSWORD puis redémarrez.');
    return;
  }
  await p.query(
    `insert into users (email, password_hash, first_name, last_name, platform_role, email_verified_at)
     values ($1,$2,'Administrateur','Plateforme','admin', now())
     on conflict (email) do update set platform_role = 'admin'`,
    [config.adminEmail.toLowerCase(), await hashPassword(config.adminPassword)]);
  console.log(`[bootstrap] Administrateur initial créé : ${config.adminEmail} (activation MFA demandée à la première connexion)`);
}
