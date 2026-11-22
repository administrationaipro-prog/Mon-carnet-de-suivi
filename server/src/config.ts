import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Chargement minimal d'un fichier .env (sans dépendance)
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
    break;
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://carnet_owner:owner_dev@localhost:5432/carnet',
  port: Number(process.env.PORT ?? 3000),
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  sessionDays: 7,
  // Cookie « Secure » dès que l’URL publique est en HTTPS (obligatoire en production réelle)
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : (process.env.PUBLIC_URL ?? '').startsWith('https://'),
};
