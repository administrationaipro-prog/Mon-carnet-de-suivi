import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { h, parse, SESSION_COOKIE, type Ctx } from '../http.js';
import { HttpError, bad } from '../lib/errors.js';
import { hashPassword, verifyPassword, randomToken, sha256, newTotpSecret, verifyTotp } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mail.js';

export const authRouter = Router();

const zPassword = z.string().min(10, 'password_too_short').max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'password_too_weak');
const zEmail = z.string().trim().toLowerCase().email().max(254);
const zLang = z.enum(['fr', 'en']);

const MAX_FAILS = 5, WINDOW_MIN = 15;

async function createSession(c: Pick<Ctx, 'db' | 'res' | 'req'>, userId: string, mfaVerified: boolean) {
  const token = randomToken();
  await c.db.query(
    `insert into sessions (user_id, token_hash, mfa_verified, user_agent, expires_at)
     values ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
    [userId, sha256(token), mfaVerified, (c.req.get('user-agent') ?? '').slice(0, 300), String(config.sessionDays)]);
  c.res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionDays * 86_400_000,
  });
}

export async function issueEmailToken(c: Pick<Ctx, 'db'>, user: { id: string; email: string; lang: 'fr' | 'en' }) {
  const token = randomToken();
  await c.db.query(`insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1,'verify_email',$2, now() + interval '48 hours')`, [user.id, sha256(token)]);
  await sendMail(c.db as any, user.email, user.lang, 'verify_email', { token });
  return token;
}

export const publicUser = (u: any) => ({
  id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, lang: u.lang,
  platform_role: u.platform_role, email_verified: !!u.email_verified_at, mfa_enabled: u.mfa_enabled,
});

authRouter.post('/register', h(async (c) => {
  const b = parse(z.object({
    email: zEmail, password: zPassword, first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100), lang: zLang.default('fr'),
  }), c.req.body);
  const exists = await c.db.query('select 1 from users where email = $1', [b.email]);
  if (exists.rowCount) {
    // Réponse identique pour éviter l’énumération des comptes
    await audit(c.db, { action: 'auth.register_duplicate', resource: 'user', ip: c.ip, result: 'ignored' });
    return { ok: true, verification_required: true };
  }
  const { rows } = await c.db.query(
    `insert into users (email, password_hash, first_name, last_name, lang) values ($1,$2,$3,$4,$5) returning *`,
    [b.email, await hashPassword(b.password), b.first_name, b.last_name, b.lang]);
  await issueEmailToken(c, rows[0]);
  await audit(c.db, { actor: rows[0].id, action: 'auth.register', resource: 'user', resourceId: rows[0].id, ip: c.ip });
  await createSession(c, rows[0].id, false);
  return { ok: true, verification_required: true };
}, { auth: 'none' }));

authRouter.post('/verify-email', h(async (c) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), c.req.body);
  const { rows } = await c.db.query(
    `update auth_tokens set used_at = now() where token_hash = $1 and kind = 'verify_email' and used_at is null and expires_at > now() returning user_id`,
    [sha256(token)]);
  if (!rows[0]) throw bad('invalid_or_expired_token');
  await c.db.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [rows[0].user_id]);
  await audit(c.db, { actor: rows[0].user_id, action: 'auth.email_verified', resource: 'user', resourceId: rows[0].user_id, ip: c.ip });
  return { ok: true };
}, { auth: 'none' }));

authRouter.post('/resend-verification', h(async (c) => {
  if (c.user.email_verified_at) return { ok: true };
  const recent = await c.db.query(`select count(*)::int n from auth_tokens where user_id = $1 and kind = 'verify_email' and expires_at > now() + interval '47 hours 55 minutes'`, [c.user.id]);
  if (recent.rows[0].n > 0) throw new HttpError(429, 'too_many_requests');
  await issueEmailToken(c, c.user);
  return { ok: true };
}, { auth: 'user' }));

authRouter.post('/login', h(async (c) => {
  const b = parse(z.object({ email: zEmail, password: z.string().max(200) }), c.req.body);
  const fails = await pool.query(
    `select count(*)::int n from login_attempts where (email = $1 or ip = $2) and success = false and at > now() - ($3 || ' minutes')::interval`,
    [b.email, c.ip, String(WINDOW_MIN)]);
  if (fails.rows[0].n >= MAX_FAILS * 4 || (await pool.query(
    `select count(*)::int n from login_attempts where email = $1 and success = false and at > now() - ($2 || ' minutes')::interval`, [b.email, String(WINDOW_MIN)])).rows[0].n >= MAX_FAILS) {
    await audit(c.db, { action: 'auth.login', resource: 'user', result: 'rate_limited', details: { email: b.email }, ip: c.ip });
    throw new HttpError(429, 'too_many_attempts');
  }
  const { rows } = await c.db.query('select * from users where email = $1', [b.email]);
  const u = rows[0];
  const ok = u ? await verifyPassword(b.password, u.password_hash) : (await hashPassword(b.password), false);
  // tentative journalisée hors transaction pour persister même en cas d’échec
  await pool.query('insert into login_attempts (email, ip, success) values ($1,$2,$3)', [b.email, c.ip, ok && u?.status === 'active']);
  if (!ok || !u) throw new HttpError(401, 'invalid_credentials');
  if (u.status !== 'active') throw new HttpError(403, 'account_suspended');
  await createSession(c, u.id, false);
  await audit(c.db, { actor: u.id, action: 'auth.login', resource: 'user', resourceId: u.id, ip: c.ip });
  return { user: publicUser(u), mfa_required: u.platform_role === 'admin', mfa_setup_required: u.platform_role === 'admin' && !u.mfa_enabled };
}, { auth: 'none' }));

authRouter.post('/logout', h(async (c) => {
  if (c.session) await c.db.query('delete from sessions where id = $1', [c.session.id]);
  c.res.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
}, { auth: 'none' }));

authRouter.post('/logout-all', h(async (c) => {
  await c.db.query('delete from sessions where user_id = $1', [c.user.id]);
  c.res.clearCookie(SESSION_COOKIE, { path: '/' });
  await audit(c.db, { actor: c.user.id, action: 'auth.logout_all', resource: 'user', resourceId: c.user.id, ip: c.ip });
  return { ok: true };
}, { auth: 'user' }));

authRouter.get('/me', h(async (c) => {
  if (!c.user) return { user: null };
  const farms = await c.db.query(
    `select f.id, f.name, f.status, f.territory_code, m.role from memberships m join farms f on f.id = m.farm_id
      where m.user_id = $1 and m.status = 'active' order by f.name`, [c.user.id]);
  const reg = await c.db.query('select id, status from registration_requests where user_id = $1 order by created_at desc limit 1', [c.user.id]);
  const invites = await c.db.query(
    `select i.id, i.role, f.name as farm_name from invitations i join farms f on f.id = i.farm_id
      where lower(i.email) = $1 and i.status = 'pending'`, [c.user.email]);
  const unread = await c.db.query('select count(*)::int n from notifications where user_id = $1 and read_at is null', [c.user.id]);
  return {
    user: publicUser(c.user), mfa_verified: !!c.session?.mfa_verified,
    farms: farms.rows, registration: reg.rows[0] ?? null, invitations: invites.rows, unread_notifications: unread.rows[0].n,
  };
}, { auth: 'none' }));

authRouter.patch('/me', h(async (c) => {
  const b = parse(z.object({ lang: zLang.optional(), first_name: z.string().trim().min(1).max(100).optional(), last_name: z.string().trim().min(1).max(100).optional() }), c.req.body);
  await c.db.query(
    `update users set lang = coalesce($2, lang), first_name = coalesce($3, first_name), last_name = coalesce($4, last_name) where id = $1`,
    [c.user.id, b.lang ?? null, b.first_name ?? null, b.last_name ?? null]);
  return { ok: true };
}, { auth: 'user' }));

authRouter.post('/change-password', h(async (c) => {
  const b = parse(z.object({ current: z.string().max(200), password: zPassword }), c.req.body);
  const { rows } = await c.db.query('select password_hash from users where id = $1', [c.user.id]);
  if (!(await verifyPassword(b.current, rows[0].password_hash))) throw new HttpError(401, 'invalid_credentials');
  await c.db.query('update users set password_hash = $2 where id = $1', [c.user.id, await hashPassword(b.password)]);
  await c.db.query('delete from sessions where user_id = $1 and id <> $2', [c.user.id, c.session.id]);
  await audit(c.db, { actor: c.user.id, action: 'auth.password_changed', resource: 'user', resourceId: c.user.id, ip: c.ip });
  return { ok: true };
}, { auth: 'user' }));

authRouter.post('/forgot-password', h(async (c) => {
  const { email } = parse(z.object({ email: zEmail }), c.req.body);
  const { rows } = await c.db.query(`select id, email, lang from users where email = $1 and status = 'active'`, [email]);
  if (rows[0]) {
    const token = randomToken();
    await c.db.query(`insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1,'reset_password',$2, now() + interval '1 hour')`, [rows[0].id, sha256(token)]);
    await sendMail(c.db, rows[0].email, rows[0].lang, 'reset_password', { token });
    await audit(c.db, { actor: rows[0].id, action: 'auth.reset_requested', resource: 'user', resourceId: rows[0].id, ip: c.ip });
  }
  return { ok: true }; // réponse identique : pas d’énumération
}, { auth: 'none' }));

authRouter.post('/reset-password', h(async (c) => {
  const b = parse(z.object({ token: z.string().min(10).max(200), password: zPassword }), c.req.body);
  const { rows } = await c.db.query(
    `update auth_tokens set used_at = now() where token_hash = $1 and kind = 'reset_password' and used_at is null and expires_at > now() returning user_id`, [sha256(b.token)]);
  if (!rows[0]) throw bad('invalid_or_expired_token');
  await c.db.query('update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1', [rows[0].user_id, await hashPassword(b.password)]);
  await c.db.query('delete from sessions where user_id = $1', [rows[0].user_id]);
  await audit(c.db, { actor: rows[0].user_id, action: 'auth.password_reset', resource: 'user', resourceId: rows[0].user_id, ip: c.ip });
  return { ok: true };
}, { auth: 'none' }));

// ---- MFA (TOTP) ----
authRouter.post('/mfa/setup', h(async (c) => {
  if (c.user.mfa_enabled) throw bad('mfa_already_enabled');
  const secret = newTotpSecret();
  await c.db.query('update users set mfa_secret = $2 where id = $1', [c.user.id, secret]);
  const label = encodeURIComponent(`Carnet de suivi:${c.user.email}`);
  return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=Carnet%20de%20suivi&digits=6&period=30` };
}, { auth: 'user' }));

authRouter.post('/mfa/enable', h(async (c) => {
  const { code } = parse(z.object({ code: z.string().max(10) }), c.req.body);
  const { rows } = await c.db.query('select mfa_secret from users where id = $1', [c.user.id]);
  if (!rows[0]?.mfa_secret || !verifyTotp(rows[0].mfa_secret, code)) throw bad('invalid_mfa_code');
  await c.db.query('update users set mfa_enabled = true where id = $1', [c.user.id]);
  await c.db.query('update sessions set mfa_verified = true where id = $1', [c.session.id]);
  await audit(c.db, { actor: c.user.id, action: 'auth.mfa_enabled', resource: 'user', resourceId: c.user.id, ip: c.ip });
  return { ok: true };
}, { auth: 'user' }));

authRouter.post('/mfa/verify', h(async (c) => {
  const { code } = parse(z.object({ code: z.string().max(10) }), c.req.body);
  const fails = await pool.query(`select count(*)::int n from login_attempts where email = $1 and success = false and at > now() - interval '15 minutes'`, [`mfa:${c.user.email}`]);
  if (fails.rows[0].n >= MAX_FAILS) throw new HttpError(429, 'too_many_attempts');
  const { rows } = await c.db.query('select mfa_secret, mfa_enabled from users where id = $1', [c.user.id]);
  const ok = rows[0]?.mfa_enabled && verifyTotp(rows[0].mfa_secret, code);
  await pool.query('insert into login_attempts (email, ip, success) values ($1,$2,$3)', [`mfa:${c.user.email}`, c.ip, !!ok]);
  if (!ok) throw bad('invalid_mfa_code');
  await c.db.query('update sessions set mfa_verified = true where id = $1', [c.session.id]);
  await audit(c.db, { actor: c.user.id, action: 'auth.mfa_verified', resource: 'user', resourceId: c.user.id, ip: c.ip });
  return { ok: true };
}, { auth: 'user' }));

authRouter.get('/sessions', h(async (c) => {
  const { rows } = await c.db.query('select id, user_agent, created_at, last_seen_at, expires_at from sessions where user_id = $1 order by last_seen_at desc', [c.user.id]);
  return rows.map((r) => ({ ...r, current: r.id === c.session.id }));
}, { auth: 'user' }));

authRouter.delete('/sessions/:id', h(async (c) => {
  await c.db.query('delete from sessions where id = $1 and user_id = $2', [c.req.params.id, c.user.id]);
}, { auth: 'user' }));

// ---- Droits RGPD : export des données personnelles, suppression du compte ----
authRouter.get('/me/export', h(async (c) => {
  const u = await c.db.query('select id, email, first_name, last_name, lang, platform_role, created_at, email_verified_at from users where id = $1', [c.user.id]);
  const m = await c.db.query('select farm_id, role, status, created_at, revoked_at from memberships where user_id = $1', [c.user.id]);
  const r = await c.db.query('select * from registration_requests where user_id = $1', [c.user.id]);
  const n = await c.db.query('select kind, payload, created_at, read_at from notifications where user_id = $1', [c.user.id]);
  const a = await c.db.query('select action, resource, resource_id, result, at from audit_logs where actor_id = $1 order by at desc limit 1000', [c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'rgpd.personal_export', resource: 'user', resourceId: c.user.id, ip: c.ip });
  c.res.setHeader('Content-Disposition', 'attachment; filename="mes-donnees-personnelles.json"');
  return { exported_at: new Date().toISOString(), user: u.rows[0], memberships: m.rows, registration_requests: r.rows, notifications: n.rows, activity: a.rows };
}, { auth: 'user' }));

authRouter.post('/me/delete', h(async (c) => {
  const { password } = parse(z.object({ password: z.string().max(200) }), c.req.body);
  const { rows } = await c.db.query('select password_hash from users where id = $1', [c.user.id]);
  if (!(await verifyPassword(password, rows[0].password_hash))) throw new HttpError(401, 'invalid_credentials');
  const owned = await c.db.query(
    `select f.id from memberships m join farms f on f.id = m.farm_id where m.user_id = $1 and m.role = 'owner' and m.status = 'active'
       and not exists (select 1 from memberships m2 where m2.farm_id = f.id and m2.role = 'owner' and m2.status = 'active' and m2.user_id <> $1)`, [c.user.id]);
  if (owned.rowCount) throw new HttpError(409, 'sole_owner_of_farm', { farms: owned.rows.map((r) => r.id) });
  // Pseudonymisation : les traces d’audit restent cohérentes sans données personnelles
  await c.db.query(
    `update users set status = 'deleted', email = 'deleted+' || id || '@invalid', first_name = '—', last_name = '—',
       password_hash = 'deleted', mfa_secret = null, mfa_enabled = false where id = $1`, [c.user.id]);
  await c.db.query(`update memberships set status = 'revoked', revoked_at = now() where user_id = $1`, [c.user.id]);
  await c.db.query('delete from sessions where user_id = $1', [c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'rgpd.account_deleted', resource: 'user', resourceId: c.user.id, ip: c.ip });
  c.res.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
}, { auth: 'user' }));

// ---- Notifications ----
authRouter.get('/notifications', h(async (c) => {
  const { rows } = await c.db.query('select id, kind, payload, read_at, created_at from notifications where user_id = $1 order by created_at desc limit 100', [c.user.id]);
  return rows;
}, { auth: 'user' }));
authRouter.post('/notifications/read', h(async (c) => {
  await c.db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [c.user.id]);
}, { auth: 'user' }));
