import { Router } from 'express';
import { z } from 'zod';
import { h, parse, requirePlatform } from '../http.js';
import { bad, notFound, conflict } from '../lib/errors.js';
import { issueEmailToken } from './auth.js';
import { inbreedingLimits } from '../lib/pedigreeDb.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { sendMail, mailEnabled, notify } from '../lib/mail.js';

export const refRouter = Router();
refRouter.get('/territories', h(async (c) => (await c.db.query('select * from territories order by active desc, name_fr')).rows, { auth: 'none' }));
refRouter.get('/breeds', h(async (c) => (await c.db.query('select * from breeds order by is_cross, label_fr')).rows, { auth: 'none' }));

export const adminRouter = Router();

adminRouter.get('/users', h(async (c) => {
  requirePlatform(c, 'admin');
  const q = typeof c.req.query.q === 'string' ? `%${c.req.query.q}%` : '%';
  const { rows } = await c.db.query(
    `select u.id, u.email, u.first_name, u.last_name, u.lang, u.status, u.platform_role, u.mfa_enabled, u.created_at, (u.email_verified_at is not null) email_verified,
            coalesce((select array_agg(territory_code) from validator_territories v where v.user_id = u.id), '{}') as territories,
            (select count(*)::int from memberships m where m.user_id = u.id and m.status = 'active') as farms,
            r.id as registration_id, r.status as registration_status,
            (select max(o.created_at) from outbox_emails o where o.to_email = u.email and o.subject in ('Vérifiez votre adresse courriel', 'Verify your email address')) as last_verification_sent_at
       from users u
       left join lateral (select id, status from registration_requests rr where rr.user_id = u.id order by rr.created_at desc limit 1) r on true
      where u.status <> 'deleted' and (u.email ilike $1 or u.last_name ilike $1 or u.first_name ilike $1) order by u.created_at desc limit 500`, [q]);
  return rows;
}));

async function loadUnverified(c: Parameters<Parameters<typeof h>[0]>[0], id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const { rows } = await c.db.query(`select id, email, lang, email_verified_at from users where id = $1 and status = 'active'`, [id]);
  if (!rows[0]) throw notFound();
  if (rows[0].email_verified_at) throw conflict('email_already_verified');
  return rows[0];
}

/** Renvoie le lien de vérification d’adresse à un utilisateur qui ne l’a pas encore utilisé. */
adminRouter.post('/users/:id/resend-verification', h(async (c) => {
  requirePlatform(c, 'admin');
  const u = await loadUnverified(c, c.req.params.id as string);
  await issueEmailToken(c, u);
  await audit(c.db, { actor: c.user.id, action: 'admin.verification_resent', resource: 'user', resourceId: u.id, ip: c.ip });
  return { ok: true };
}));

/** Validation manuelle de l’adresse (personne connue, adresse confirmée par un autre moyen) : motif obligatoire, tracée. */
adminRouter.post('/users/:id/verify-email', h(async (c) => {
  requirePlatform(c, 'admin');
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), c.req.body);
  const u = await loadUnverified(c, c.req.params.id as string);
  await c.db.query('update users set email_verified_at = now() where id = $1', [u.id]);
  await c.db.query(`update auth_tokens set used_at = now() where user_id = $1 and kind = 'verify_email' and used_at is null`, [u.id]);
  await audit(c.db, { actor: c.user.id, action: 'admin.email_verified_manually', resource: 'user', resourceId: u.id, details: { reason }, ip: c.ip });
  await notify(c.db, u.id, 'email_verified_by_admin', {});
  return { ok: true };
}));

adminRouter.patch('/users/:id', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({
    platform_role: z.enum(['none', 'admin', 'validator', 'analyst']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    territories: z.array(z.string().min(2).max(3)).optional(),
  }), c.req.body);
  if (c.req.params.id === c.user.id && (b.platform_role && b.platform_role !== 'admin' || b.status === 'suspended')) throw bad('cannot_demote_self');
  const before = await c.db.query('select platform_role, status from users where id = $1', [c.req.params.id]);
  if (!before.rows[0]) throw notFound();
  await c.db.query('update users set platform_role = coalesce($2, platform_role), status = coalesce($3, status) where id = $1', [c.req.params.id, b.platform_role ?? null, b.status ?? null]);
  if (b.status === 'suspended') await c.db.query('delete from sessions where user_id = $1', [c.req.params.id]);
  if (b.platform_role && b.platform_role !== before.rows[0].platform_role) await c.db.query('delete from sessions where user_id = $1', [c.req.params.id]);
  if (b.territories) {
    await c.db.query('delete from validator_territories where user_id = $1', [c.req.params.id]);
    for (const t of b.territories) await c.db.query('insert into validator_territories (user_id, territory_code) values ($1,$2)', [c.req.params.id, t]);
  }
  await audit(c.db, { actor: c.user.id, action: 'admin.user_rights_changed', resource: 'user', resourceId: c.req.params.id as string, details: { before: before.rows[0], after: b }, ip: c.ip });
  return { ok: true };
}));

adminRouter.get('/farms', h(async (c) => {
  requirePlatform(c, 'admin');
  // Métadonnées uniquement : aucune donnée de cheptel
  const { rows } = await c.db.query(
    `select f.id, f.name, f.territory_code, f.locality, f.status, f.created_at,
            (select string_agg(u.first_name || ' ' || u.last_name, ', ') from memberships m join users u on u.id = m.user_id where m.farm_id = f.id and m.role = 'owner' and m.status = 'active') as owners,
            exists (select 1 from consents c where c.farm_id = f.id and c.revoked_at is null) as sharing
       from farms f order by f.created_at desc`);
  return rows;
}));

adminRouter.post('/farms/:id/status', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(1000) }), c.req.body);
  const { rowCount } = await c.db.query('update farms set status = $2 where id = $1', [c.req.params.id, b.status]);
  if (!rowCount) throw notFound();
  await c.db.query(`update registration_requests set status = $2, updated_at = now() where farm_id = $1`, [c.req.params.id, b.status === 'active' ? 'approved' : 'suspended']);
  await audit(c.db, { actor: c.user.id, action: `admin.farm_${b.status}`, resource: 'farm', resourceId: c.req.params.id as string, farmId: c.req.params.id as string, details: { reason: b.reason }, ip: c.ip });
  return { ok: true };
}));

/** Accès administrateur aux données métier : uniquement justifié, limité dans le temps et tracé. */
adminRouter.post('/farms/:id/access', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ justification: z.string().trim().min(15).max(1000), hours: z.number().int().min(1).max(24).default(1) }), c.req.body);
  const f = await c.db.query('select id from farms where id = $1', [c.req.params.id]);
  if (!f.rowCount) throw notFound();
  const { rows } = await c.db.query(
    `insert into admin_access_grants (admin_id, farm_id, justification, expires_at) values ($1,$2,$3, now() + ($4 || ' hours')::interval) returning *`,
    [c.user.id, c.req.params.id, b.justification, String(b.hours)]);
  await audit(c.db, { actor: c.user.id, action: 'admin.farm_access_granted', resource: 'farm', resourceId: c.req.params.id as string, farmId: c.req.params.id as string, details: { justification: b.justification, hours: b.hours }, ip: c.ip });
  return rows[0];
}));

adminRouter.get('/audit', h(async (c) => {
  requirePlatform(c, 'admin');
  const params: unknown[] = [];
  let where = 'true';
  if (typeof c.req.query.action === 'string' && c.req.query.action) { params.push(`${c.req.query.action}%`); where += ` and l.action like $${params.length}`; }
  const { rows } = await c.db.query(
    `select l.*, u.email as actor_email from audit_logs l left join users u on u.id = l.actor_id where ${where} order by l.at desc limit 500`, params);
  return rows;
}));

adminRouter.get('/settings', h(async (c) => {
  requirePlatform(c, 'admin');
  return Object.fromEntries((await c.db.query('select key, value from settings')).rows.map((r) => [r.key, r.value]));
}));

const zSettings = z.object({
  aggregation_min_farms: z.number().int().min(3).max(50).optional(),
  consent_policy_version: z.string().min(1).max(40).optional(),
  weighing_protocol_days: z.array(z.number().int().min(0).max(730)).min(1).max(30).optional(),
  weighing_tolerance_days: z.number().int().min(0).max(15).optional(),
  interpolation_max_gap_days: z.number().int().min(7).max(90).optional(),
  inbreeding_warn_percent: z.number().min(1).max(25).optional(),
  inbreeding_max_percent: z.number().min(3).max(25).optional(),
});
adminRouter.put('/settings', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(zSettings, c.req.body);
  if (b.inbreeding_warn_percent !== undefined || b.inbreeding_max_percent !== undefined) {
    const cur = await inbreedingLimits(c.db);
    if ((b.inbreeding_warn_percent ?? cur.warn) >= (b.inbreeding_max_percent ?? cur.max)) throw bad('inbreeding_limits_inconsistent');
  }
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    await c.db.query('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [k, JSON.stringify(v)]);
  }
  await audit(c.db, { actor: c.user.id, action: 'admin.settings_changed', resource: 'settings', details: b, ip: c.ip });
  return { ok: true };
}));

adminRouter.put('/territories/:code', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ name_fr: z.string().min(1), name_en: z.string().min(1), timezone: z.string().min(3), language: z.enum(['fr', 'en']), active: z.boolean() }), c.req.body);
  const code = String(c.req.params.code).toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code)) throw bad('invalid_code');
  try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { throw bad('invalid_timezone'); }
  await c.db.query(
    `insert into territories (code, name_fr, name_en, timezone, language, active) values ($1,$2,$3,$4,$5,$6)
     on conflict (code) do update set name_fr = excluded.name_fr, name_en = excluded.name_en, timezone = excluded.timezone, language = excluded.language, active = excluded.active`,
    [code, b.name_fr, b.name_en, b.timezone, b.language, b.active]);
  await audit(c.db, { actor: c.user.id, action: 'admin.territory_saved', resource: 'territory', resourceId: code, details: b, ip: c.ip });
  return { ok: true };
}));

adminRouter.put('/breeds/:code', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ label_fr: z.string().min(1).max(100), label_en: z.string().min(1).max(100), synonyms: z.array(z.string().max(100)).max(20).default([]), is_cross: z.boolean() }), c.req.body);
  const code = String(c.req.params.code).toUpperCase();
  if (!/^[A-Z0-9_]{2,40}$/.test(code)) throw bad('invalid_code');
  await c.db.query(
    `insert into breeds (code, label_fr, label_en, synonyms, is_cross) values ($1,$2,$3,$4,$5)
     on conflict (code) do update set label_fr = excluded.label_fr, label_en = excluded.label_en, synonyms = excluded.synonyms, is_cross = excluded.is_cross`,
    [code, b.label_fr, b.label_en, b.synonyms, b.is_cross]);
  await audit(c.db, { actor: c.user.id, action: 'admin.breed_saved', resource: 'breed', resourceId: code, ip: c.ip });
  return { ok: true };
}));

/**
 * L’administrateur crée sa propre exploitation (il en devient responsable).
 * Tracé comme une demande d’inscription approuvée, avec motif explicite, pour garder une piste d’audit homogène.
 */
adminRouter.post('/my-farm', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({
    territory_code: z.string().min(2).max(3),
    name: z.string().trim().min(2).max(150),
    locality: z.string().trim().min(1).max(150),
    objective: z.enum(['meat', 'reproduction', 'mixed']).default('mixed'),
  }), c.req.body);
  const terr = await c.db.query('select active from territories where code = $1', [b.territory_code]);
  if (!terr.rows[0]) throw bad('unknown_territory');
  if (!terr.rows[0].active) throw bad('territory_not_open');
  const f = await c.db.query(`insert into farms (territory_code, name, locality, objective) values ($1,$2,$3,$4) returning id`, [b.territory_code, b.name, b.locality, b.objective]);
  const farmId = f.rows[0].id;
  await c.db.query(`insert into memberships (user_id, farm_id, role) values ($1,$2,'owner')`, [c.user.id, farmId]);
  const productionType = b.objective === 'meat' ? 'sheep_meat' : b.objective === 'reproduction' ? 'sheep_breeding' : 'sheep_mixed';
  const reason = 'Création directe par un administrateur pour sa propre exploitation';
  const r = await c.db.query(
    `insert into registration_requests (user_id, status, territory_code, farm_name, locality, production_type, accepted_terms, truthful_declaration,
       reviewer_id, decision_reason, farm_id, submitted_at, decided_at)
     values ($1,'approved',$2,$3,$4,$5,true,true,$1,$6,$7,now(),now()) returning id`,
    [c.user.id, b.territory_code, b.name, b.locality, productionType, reason, farmId]);
  await c.db.query(`insert into registration_history (request_id, actor_id, from_status, to_status, reason) values ($1,$2,null,'approved',$3)`, [r.rows[0].id, c.user.id, reason]);
  await audit(c.db, { actor: c.user.id, action: 'admin.own_farm_created', resource: 'farm', resourceId: farmId, farmId, details: { name: b.name }, ip: c.ip });
  return { farm_id: farmId };
}));

adminRouter.post('/test-email', h(async (c) => {
  requirePlatform(c, 'admin');
  await sendMail(c.db, c.user.email, c.user.lang, 'test_email', {});
  await audit(c.db, { actor: c.user.id, action: 'admin.test_email', resource: 'email', ip: c.ip });
  return { ok: true, mail_enabled: mailEnabled() };
}));

adminRouter.post('/outbox/:id/retry', h(async (c) => {
  requirePlatform(c, 'admin');
  const { rowCount } = await c.db.query(
    `update outbox_emails set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where id = $1 and status in ('failed','logged')`, [c.req.params.id]);
  if (!rowCount) throw notFound();
  if (!mailEnabled()) throw bad('mail_not_configured');
  return { ok: true };
}));

adminRouter.get('/outbox', h(async (c) => {
  requirePlatform(c, 'admin');
  return (await c.db.query('select * from outbox_emails order by created_at desc limit 100')).rows;
}));

adminRouter.get('/stats', h(async (c) => {
  requirePlatform(c, 'admin');
  const r = await c.db.query(
    `select (select count(*)::int from users where status = 'active') users,
            (select count(*)::int from farms where status = 'active') farms,
            (select count(*)::int from registration_requests where status in ('pending','info_requested')) pending_requests,
            (select count(*)::int from consents where revoked_at is null) active_consents`);
  return { ...r.rows[0], env: config.env, mail_enabled: mailEnabled(), mail_from: config.mailFromEmail };
}));
