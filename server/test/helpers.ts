import request from 'supertest';
import pg from 'pg';
import { setPool, migrate, pool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { totp } from '../src/lib/crypto.js';
import { hashPassword } from '../src/lib/crypto.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://carnet_owner:owner_dev@localhost:5432/carnet_test';

export async function setup() {
  const admin = new pg.Pool({ connectionString: TEST_DB });
  await admin.query('drop schema public cascade; create schema public;');
  await admin.end();
  const p = setPool(TEST_DB);
  await migrate(p);
  return createApp();
}

export type Agent = ReturnType<typeof request.agent> & { email: string; id?: string };
export const H = { 'x-requested-with': 'carnet' };

export function agent(app: any, email: string): Agent {
  const a = request.agent(app) as Agent; a.email = email; return a;
}

export const post = (a: any, url: string, body?: any) => a.post(url).set(H).send(body ?? {});
export const put = (a: any, url: string, body?: any) => a.put(url).set(H).send(body ?? {});
export const patch = (a: any, url: string, body?: any) => a.patch(url).set(H).send(body ?? {});
export const del = (a: any, url: string) => a.delete(url).set(H);

export async function lastToken(email: string): Promise<string> {
  const { rows } = await pool.query('select body from outbox_emails where to_email = $1 order by id desc limit 1', [email]);
  const m = /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.body ?? '');
  if (!m) throw new Error('no token for ' + email);
  return m[1];
}

export async function registerVerified(app: any, email: string, first = 'Test', last = 'User') {
  const a = agent(app, email);
  const r = await post(a, '/api/auth/register', { email, password: 'motdepasse-solide-1', first_name: first, last_name: last, lang: 'fr' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const v = await post(a, '/api/auth/verify-email', { token: await lastToken(email) });
  if (v.status !== 200) throw new Error(JSON.stringify(v.body));
  const me = await a.get('/api/auth/me');
  a.id = me.body.user.id;
  return a;
}

export async function makeAdmin(app: any, email = 'admin@test.org') {
  await pool.query(`insert into users (email, password_hash, first_name, last_name, platform_role, email_verified_at) values ($1,$2,'Ad','Min','admin',now())`,
    [email, await hashPassword('admin-password-1')]);
  const a = agent(app, email);
  await post(a, '/api/auth/login', { email, password: 'admin-password-1' });
  const s = await post(a, '/api/auth/mfa/setup');
  const en = await post(a, '/api/auth/mfa/enable', { code: totp(s.body.secret) });
  if (en.status !== 200) throw new Error('mfa ' + JSON.stringify(en.body));
  return a;
}

export const reqBody = (over: any = {}) => ({
  territory_code: 'MQ', farm_name: 'Ferme test', locality: 'Le Lamentin', production_type: 'sheep_meat',
  herd_size: 20, message: null, accepted_terms: true, truthful_declaration: true, ...over,
});

/** Crée un éleveur approuvé avec son exploitation. */
export async function approvedFarmer(app: any, admin: any, email: string, farmName = 'Ferme ' + email) {
  const a = await registerVerified(app, email);
  const s = await put(a, '/api/registration/mine?submit=1', reqBody({ farm_name: farmName }));
  if (s.status !== 200) throw new Error(JSON.stringify(s.body));
  const d = await post(admin, `/api/registration/review/${s.body.id}/decision`, { action: 'approve' });
  if (d.status !== 200) throw new Error(JSON.stringify(d.body));
  return Object.assign(a, { farmId: d.body.farm_id as string });
}
