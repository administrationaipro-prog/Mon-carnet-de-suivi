import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { h, parse, farmAccess, requirePlatform, zOptText } from '../http.js';
import { pool } from '../db.js';
import { HttpError, bad, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sha256 } from '../lib/crypto.js';
import { notify, sendMail } from '../lib/mail.js';

export const VET_SCOPES = ['herd', 'health', 'repro', 'feeding'] as const;
const zScopes = z.array(z.enum(VET_SCOPES)).min(1).max(4).transform((a) => [...new Set(a)]);
const zHours = z.number().int().refine((h) => [24, 168, 720].includes(h), 'duration');
const fmtUntil = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

// ---------- Côté vétérinaire ----------
export const vetRouter = Router();

vetRouter.get('/profile', h(async (c) => {
  return (await c.db.query('select * from vet_profiles where user_id = $1', [c.user.id])).rows[0] ?? null;
}));

vetRouter.post('/profile', h(async (c) => {
  const b = parse(z.object({
    ordinal_number: z.string().trim().min(3).max(20).regex(/^[0-9A-Za-z .-]+$/, 'ordinal_format'),
    clinic: z.string().trim().min(2).max(150), territory_code: z.string().min(2).max(3).nullable().optional(),
    phone: z.string().trim().max(30).regex(/^[0-9+ ().-]*$/, 'phone_format').optional().nullable(),
  }), c.req.body);
  if (c.user.platform_role !== 'none') throw forbidden('vet_profile_not_allowed');
  const cur = (await c.db.query('select * from vet_profiles where user_id = $1 for update', [c.user.id])).rows[0];
  // Changer de numéro ordinal ou de structure impose une nouvelle vérification
  const reverify = !cur || cur.ordinal_number !== b.ordinal_number || cur.status === 'rejected';
  const { rows } = await c.db.query(
    `insert into vet_profiles (user_id, ordinal_number, clinic, territory_code, phone, status) values ($1,$2,$3,$4,$5,'pending')
     on conflict (user_id) do update set ordinal_number = excluded.ordinal_number, clinic = excluded.clinic,
       territory_code = excluded.territory_code, phone = excluded.phone,
       status = case when $6 then 'pending' else vet_profiles.status end,
       decided_at = case when $6 then null else vet_profiles.decided_at end
     returning *`, [c.user.id, b.ordinal_number, b.clinic, b.territory_code ?? null, b.phone || null, reverify]);
  if (reverify) {
    const admins = await c.db.query(`select id, email, lang from users where platform_role = 'admin' and status = 'active'`);
    for (const a of admins.rows) {
      await notify(c.db, a.id, 'vet_profile_submitted', { name: `${c.user.first_name} ${c.user.last_name}`, ordinal: b.ordinal_number });
      await sendMail(c.db, a.email, a.lang, 'vet_profile_submitted', { name: `${c.user.first_name} ${c.user.last_name}`, ordinal: b.ordinal_number, clinic: b.clinic });
    }
  }
  await audit(c.db, { actor: c.user.id, action: 'vet.profile_submitted', resource: 'user', resourceId: c.user.id, ip: c.ip, details: { ordinal: b.ordinal_number } });
  return rows[0];
}));

/** Recherche d'un vétérinaire vérifié par un éleveur (nom, clinique ou n° ordinal). */
vetRouter.get('/search', h(async (c) => {
  const q = typeof c.req.query.q === 'string' ? c.req.query.q.trim().slice(0, 60) : '';
  const { rows } = await c.db.query(
    `select u.id, u.first_name, u.last_name, vp.clinic, vp.ordinal_number, vp.territory_code
       from vet_profiles vp join users u on u.id = vp.user_id
      where vp.status = 'verified' and u.status = 'active'
        and ($1 = '' or (u.first_name || ' ' || u.last_name || ' ' || vp.clinic || ' ' || vp.ordinal_number) ilike '%' || $1 || '%')
      order by u.last_name limit 20`, [q]);
  return rows;
}));

/** Le vétérinaire saisit le code montré par l'éleveur : l'accès est créé. */
vetRouter.post('/redeem', h(async (c) => {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'code_format') }), c.req.body);
  const vp = (await c.db.query('select status from vet_profiles where user_id = $1', [c.user.id])).rows[0];
  if (vp?.status !== 'verified') throw forbidden('vet_not_verified');
  const fails = await pool.query(`select count(*)::int n from audit_logs where actor_id = $1 and action = 'vet.code_failed' and at > now() - interval '15 minutes'`, [c.user.id]);
  if (fails.rows[0].n >= 5) throw new HttpError(429, 'too_many_requests');
  const { rows } = await c.db.query(
    `select * from vet_access_codes where code_hash = $1 and used_at is null and expires_at > now() for update`, [sha256(code)]);
  const k = rows[0];
  if (!k) {
    // hors transaction : la tentative ratée doit rester comptée
    await pool.query(`insert into audit_logs (actor_id, action, resource, result, ip) values ($1,'vet.code_failed','vet_access','denied',$2)`, [c.user.id, c.ip]);
    throw bad('code_invalid');
  }
  await c.db.query('update vet_access_codes set used_at = now(), used_by = $2 where id = $1', [k.id, c.user.id]);
  const g = (await c.db.query(
    `insert into vet_access (farm_id, vet_id, scopes, expires_at, granted_by) values ($1,$2,$3, now() + ($4 || ' hours')::interval, $5) returning *`,
    [k.farm_id, c.user.id, k.scopes, String(k.duration_hours), k.created_by])).rows[0];
  await audit(c.db, { actor: c.user.id, action: 'vet.access_redeemed', resource: 'vet_access', resourceId: g.id, farmId: k.farm_id, ip: c.ip, details: { scopes: k.scopes } });
  const farm = (await c.db.query('select name from farms where id = $1', [k.farm_id])).rows[0];
  return { ...g, farm_name: farm?.name };
}));

vetRouter.get('/clients', h(async (c) => {
  const { rows } = await c.db.query(
    `select va.id, va.farm_id, f.name as farm_name, f.territory_code, va.scopes, va.expires_at, va.created_at,
            u.first_name || ' ' || u.last_name as owner_name,
            (select count(*)::int from copro_reports r where r.farm_id = va.farm_id and r.status = 'draft') as drafts
       from vet_access va join farms f on f.id = va.farm_id left join users u on u.id = va.granted_by
      where va.vet_id = $1 and va.revoked_at is null and va.expires_at > now() and f.status = 'active'
      order by va.expires_at desc`, [c.user.id]);
  return rows;
}));

/** Rapports signés par ce vétérinaire (toutes exploitations, y compris accès expirés). */
vetRouter.get('/reports', h(async (c) => {
  const { rows } = await pool.query(
    `select r.id, r.number, r.phase, r.signed_at, r.farm_id, f.name as farm_name from copro_reports r join farms f on f.id = r.farm_id
      where r.vet_id = $1 and r.status = 'signed' order by r.signed_at desc limit 200`, [c.user.id]);
  return rows;
}));

// ---------- Côté éleveur : gestion des accès ----------
export const farmVetRouter = Router({ mergeParams: true });
const fid = (c: { req: { params: any } }) => c.req.params.farmId as string;

farmVetRouter.get('/vet-access', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const { rows } = await c.db.query(
    `select va.id, va.scopes, va.expires_at, va.revoked_at, va.created_at, u.id as vet_id, u.first_name, u.last_name, vp.clinic, vp.ordinal_number,
            (va.revoked_at is null and va.expires_at > now()) as active
       from vet_access va join users u on u.id = va.vet_id left join vet_profiles vp on vp.user_id = u.id
      where va.farm_id = $1 order by active desc, va.created_at desc limit 50`, [fid(c)]);
  return rows;
}));

farmVetRouter.post('/vet-access', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({ vet_id: z.string().uuid(), scopes: zScopes, hours: zHours }), c.req.body);
  const vet = (await c.db.query(
    `select u.id, u.email, u.lang, u.first_name, u.last_name from vet_profiles vp join users u on u.id = vp.user_id
      where vp.user_id = $1 and vp.status = 'verified' and u.status = 'active'`, [b.vet_id])).rows[0];
  if (!vet) throw notFound('vet_not_found');
  const g = (await c.db.query(
    `insert into vet_access (farm_id, vet_id, scopes, expires_at, granted_by) values ($1,$2,$3, now() + ($4 || ' hours')::interval, $5) returning *`,
    [fid(c), b.vet_id, b.scopes, String(b.hours), c.user.id])).rows[0];
  const farm = (await c.db.query('select name from farms where id = $1', [fid(c)])).rows[0];
  await notify(c.db, vet.id, 'vet_access_granted', { farm: farm.name, until: g.expires_at });
  await sendMail(c.db, vet.email, vet.lang, 'vet_access_granted', { farm: farm.name, by: `${c.user.first_name} ${c.user.last_name}`, until: fmtUntil(new Date(g.expires_at)) });
  await audit(c.db, { actor: c.user.id, action: 'vet.access_granted', resource: 'vet_access', resourceId: g.id, farmId: fid(c), ip: c.ip, details: { vet: b.vet_id, scopes: b.scopes, hours: b.hours } });
  return g;
}));

/** Code à 6 chiffres à montrer au vétérinaire sur place (15 minutes, usage unique). */
farmVetRouter.post('/vet-access/code', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({ scopes: zScopes, hours: zHours }), c.req.body);
  // un seul code actif à la fois par exploitation
  await c.db.query(`update vet_access_codes set expires_at = now() where farm_id = $1 and used_at is null and expires_at > now()`, [fid(c)]);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const clash = await c.db.query('select 1 from vet_access_codes where code_hash = $1 and used_at is null and expires_at > now()', [sha256(code)]);
    if (!clash.rowCount) break;
  }
  const r = (await c.db.query(
    `insert into vet_access_codes (farm_id, code_hash, scopes, duration_hours, created_by, expires_at) values ($1,$2,$3,$4,$5, now() + interval '15 minutes') returning expires_at`,
    [fid(c), sha256(code), b.scopes, b.hours, c.user.id])).rows[0];
  await audit(c.db, { actor: c.user.id, action: 'vet.code_created', resource: 'vet_access', farmId: fid(c), ip: c.ip, details: { scopes: b.scopes, hours: b.hours } });
  return { code, expires_at: r.expires_at };
}));

farmVetRouter.post('/vet-access/:id/revoke', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const { rows } = await c.db.query(`update vet_access set revoked_at = now() where id = $1 and farm_id = $2 and revoked_at is null returning *`, [c.req.params.id, fid(c)]);
  if (!rows[0]) throw notFound();
  await audit(c.db, { actor: c.user.id, action: 'vet.access_revoked', resource: 'vet_access', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

// ---------- Administration : vérification des vétérinaires ----------
export const adminVetRouter = Router();

adminVetRouter.get('/', h(async (c) => {
  requirePlatform(c, 'admin');
  const { rows } = await c.db.query(
    `select vp.*, u.first_name, u.last_name, u.email, u.email_verified_at,
            (select count(*)::int from vet_access va where va.vet_id = vp.user_id and va.revoked_at is null and va.expires_at > now()) as active_clients
       from vet_profiles vp join users u on u.id = vp.user_id
      order by (vp.status = 'pending') desc, vp.created_at desc`);
  return rows;
}));

adminVetRouter.post('/:userId/decision', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ status: z.enum(['verified', 'rejected', 'suspended']), note: zOptText(500) }), c.req.body);
  if (b.status !== 'verified' && !b.note) throw bad('reason_required');
  const { rows } = await c.db.query(
    `update vet_profiles set status = $2, decision_note = $3, decided_by = $4, decided_at = now() where user_id = $1 returning *`,
    [c.req.params.userId, b.status, b.note, c.user.id]);
  if (!rows[0]) throw notFound();
  const u = (await c.db.query('select email, lang from users where id = $1', [c.req.params.userId])).rows[0];
  await notify(c.db, c.req.params.userId as string, 'vet_decision', { status: b.status, note: b.note });
  await sendMail(c.db, u.email, u.lang, 'vet_decision', { status: b.status, note: b.note });
  await audit(c.db, { actor: c.user.id, action: `vet.${b.status}`, resource: 'user', resourceId: c.req.params.userId as string, ip: c.ip, details: { ordinal: rows[0].ordinal_number, note: b.note } });
  return rows[0];
}));

// ---------- Vérification publique d'un rapport signé ----------
export const publicVerifyRouter = Router();

publicVerifyRouter.get('/verify/:number', h(async (c) => {
  const number = String(c.req.params.number).toUpperCase().slice(0, 30);
  const { rows } = await c.db.query(
    `select r.number, r.phase, r.sample_date, r.signed_at, r.signed_vet_name, r.signed_vet_ordinal, r.signed_clinic, r.content_hash, f.name as farm_name
       from copro_reports r join farms f on f.id = r.farm_id where r.number = $1 and r.status = 'signed'`, [number]);
  if (!rows[0]) return { valid: false, number };
  return { valid: true, ...rows[0] };
}, { auth: 'none', ctx: 'verify' }));
