import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, zDate, zOptText, today, type Ctx } from '../http.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sendMail, notify } from '../lib/mail.js';
import { getSetting } from '../db.js';
import { weighingStatus, gmqSeries, addDays } from '../lib/indicators.js';

export const farmsRouter = Router();
const fid = (c: Ctx) => c.req.params.farmId as string;

farmsRouter.get('/', h(async (c) => {
  const { rows } = await c.db.query(
    `select f.*, m.role from memberships m join farms f on f.id = m.farm_id where m.user_id = $1 and m.status = 'active' order by f.name`, [c.user.id]);
  return rows;
}));

farmsRouter.get('/:farmId', h(async (c) => {
  const role = await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select f.*, t.name_fr as territory_fr, t.name_en as territory_en, t.timezone from farms f join territories t on t.code = f.territory_code where f.id = $1`, [fid(c)]);
  if (role === 'admin_grant') await audit(c.db, { actor: c.user.id, action: 'admin.farm_data_access', resource: 'farm', resourceId: fid(c), farmId: fid(c), ip: c.ip });
  return { ...rows[0], role };
}));

farmsRouter.patch('/:farmId', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({
    name: z.string().trim().min(2).max(150).optional(), locality: zOptText(150),
    objective: z.enum(['meat', 'reproduction', 'mixed']).optional(), conduct_system: zOptText(300),
  }), c.req.body);
  const { rows } = await c.db.query(
    `update farms set name = coalesce($2, name), locality = coalesce($3, locality), objective = coalesce($4, objective), conduct_system = $5 where id = $1 returning *`,
    [fid(c), b.name ?? null, b.locality, b.objective ?? null, b.conduct_system]);
  await audit(c.db, { actor: c.user.id, action: 'farm.updated', resource: 'farm', resourceId: fid(c), farmId: fid(c), ip: c.ip });
  return rows[0];
}));

// ---------- Tableau de bord & alertes ----------
farmsRouter.get('/:farmId/dashboard', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const f = fid(c);
  const counts = await c.db.query(
    `select count(*) filter (where status = 'active')::int as active,
            count(*) filter (where status = 'active' and sex = 'F')::int as females,
            count(*) filter (where status = 'active' and sex = 'M')::int as males,
            count(*)::int as total from animals where farm_id = $1`, [f]);
  const w = await c.db.query(`select count(*)::int n, max(date) last from weighings where farm_id = $1`, [f]);
  const w30 = await c.db.query(`select count(*)::int n from weighings where farm_id = $1 and date >= current_date - 30`, [f]);
  const recent = await c.db.query(
    `(select 'weighing' as kind, w.date, a.id as animal_id, coalesce(a.name, a.internal_id) as animal, w.weight_kg::text as value
        from weighings w join animals a on a.id = w.animal_id where w.farm_id = $1 order by w.date desc, w.created_at desc limit 8)
     union all
     (select 'health' as kind, h.date, a.id, coalesce(a.name, a.internal_id), h.type from health_events h join animals a on a.id = h.animal_id
       where h.farm_id = $1 order by h.date desc limit 5)
     order by date desc limit 10`, [f]);
  return { animals: counts.rows[0], weighings: { total: w.rows[0].n, last_date: w.rows[0].last, last_30_days: w30.rows[0].n },
    growth: await growthSummary(c, f), recent: recent.rows, alerts: await alerts(c, f) };
}));

/**
 * GMQ du troupeau : moyenne des GMQ par période (pesées consécutives) des animaux présents.
 * Série hebdomadaire sur 8 semaines (semaine = date de fin de période) et tendance 30 j vs 30 j précédents.
 * Aucune valeur n’est inventée : une semaine sans période mesurée vaut null.
 */
async function growthSummary(c: Ctx, farmId: string) {
  const { rows } = await c.db.query(
    `select coalesce(json_agg(json_build_object('date', w.date, 'weight_kg', w.weight_kg) order by w.date) filter (where w.id is not null), '[]') as ws
       from animals a left join weighings w on w.animal_id = a.id where a.farm_id = $1 and a.status = 'active' group by a.id`, [farmId]);
  const t = today();
  const periods = rows.flatMap((r) => gmqSeries(r.ws).periods);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const inRange = (from: string, to: string) => periods.filter((p) => p.to > from && p.to <= to).map((p) => p.gmq);
  const weekly: { week_end: string; gmq: number | null; n: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = addDays(t, -7 * i), start = addDays(end, -7);
    const xs = inRange(start, end);
    weekly.push({ week_end: end, gmq: avg(xs), n: xs.length });
  }
  const last30 = inRange(addDays(t, -30), t), prev30 = inRange(addDays(t, -60), addDays(t, -30));
  const overall = rows.map((r) => gmqSeries(r.ws).overall).filter((x): x is number => x !== null);
  const cur = avg(last30), prev = avg(prev30);
  return {
    mean_overall: avg(overall), animals_measured: overall.length,
    last_30: cur, last_30_n: last30.length, trend: cur !== null && prev !== null ? cur - prev : null, weekly,
  };
}

async function alerts(c: Ctx, farmId: string) {
  const protocol = await getSetting<number[]>(c.db, 'weighing_protocol_days', [0, 7, 14, 21, 30, 45, 60, 90, 120]);
  const tol = await getSetting<number>(c.db, 'weighing_tolerance_days', 3);
  const t = today();
  const animals = await c.db.query(
    `select a.id, a.internal_id, a.name, a.birth_date,
            coalesce(json_agg(json_build_object('date', w.date, 'weight_kg', w.weight_kg)) filter (where w.id is not null), '[]') as ws,
            (select b.birth_weight_kg from births b where b.animal_id = a.id) as bw
       from animals a left join weighings w on w.animal_id = a.id
      where a.farm_id = $1 and a.status = 'active' group by a.id`, [farmId]);
  const out: any[] = [];
  for (const a of animals.rows) {
    // Le protocole de pesées s’applique aux jeunes (≤ 1 an)
    if (!a.birth_date || a.birth_date < addDays(t, -365)) continue;
    const st = weighingStatus(a.birth_date, a.bw ? [...a.ws, { date: a.birth_date, weight_kg: a.bw }] : a.ws, protocol, tol, t);
    for (const o of st.overdue) out.push({ type: 'weighing_overdue', animal_id: a.id, animal: a.name ?? a.internal_id, day: o.day, due_date: o.date });
    if (st.next && st.next.date <= addDays(t, 3)) out.push({ type: 'weighing_due', animal_id: a.id, animal: a.name ?? a.internal_id, day: st.next.day, due_date: st.next.date });
  }
  const follow = await c.db.query(
    `select h.id, h.animal_id, coalesce(a.name, a.internal_id) animal, h.followup_date, h.type from health_events h join animals a on a.id = h.animal_id
      where h.farm_id = $1 and h.followup_date is not null and h.followup_date <= current_date + 7
        and not exists (select 1 from health_events h2 where h2.animal_id = h.animal_id and h2.date >= h.followup_date and h2.id <> h.id)
      order by h.followup_date`, [farmId]);
  for (const r of follow.rows) out.push({ type: 'health_followup', animal_id: r.animal_id, animal: r.animal, due_date: r.followup_date });
  const withdrawal = await c.db.query(
    `select h.animal_id, coalesce(a.name, a.internal_id) animal, h.product, h.date + h.withdrawal_days as until from health_events h join animals a on a.id = h.animal_id
      where h.farm_id = $1 and h.withdrawal_days > 0 and h.date + h.withdrawal_days >= current_date`, [farmId]);
  for (const r of withdrawal.rows) out.push({ type: 'withdrawal_period', animal_id: r.animal_id, animal: r.animal, product: r.product, due_date: r.until });
  const lambing = await c.db.query(
    `select r.ewe_id animal_id, coalesce(a.name, a.internal_id) animal, (r.date + 150) as due from repro_events r join animals a on a.id = r.ewe_id
      where r.farm_id = $1 and r.type = 'mating' and r.date + 150 between current_date - 5 and current_date + 21
        and not exists (select 1 from repro_events x where x.ewe_id = r.ewe_id and x.type in ('lambing','abortion') and x.date > r.date)`, [farmId]);
  for (const r of lambing.rows) out.push({ type: 'lambing_expected', animal_id: r.animal_id, animal: r.animal, due_date: r.due });
  return out.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

farmsRouter.get('/:farmId/alerts', h(async (c) => { await farmAccess(c, fid(c), 'read'); return alerts(c, fid(c)); }));

// ---------- Membres & invitations ----------
farmsRouter.get('/:farmId/members', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const m = await c.db.query(
    `select u.id as user_id, u.first_name, u.last_name, u.email, m.role, m.status, m.created_at from memberships m join users u on u.id = m.user_id
      where m.farm_id = $1 order by m.status, m.role, u.last_name`, [fid(c)]);
  const i = await c.db.query(`select id, email, role, status, created_at from invitations where farm_id = $1 and status = 'pending'`, [fid(c)]);
  return { members: m.rows, invitations: i.rows };
}));

farmsRouter.post('/:farmId/invitations', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['collaborator', 'referent']) }), c.req.body);
  const already = await c.db.query(`select 1 from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and u.email = $2 and m.status = 'active'`, [fid(c), b.email]);
  if (already.rowCount) throw conflict('already_member');
  const { rows } = await c.db.query(`insert into invitations (farm_id, email, role, invited_by) values ($1,$2,$3,$4) returning id`, [fid(c), b.email, b.role, c.user.id]);
  const farm = await c.db.query('select name from farms where id = $1', [fid(c)]);
  const target = await c.db.query('select id, lang from users where email = $1', [b.email]);
  const lang = target.rows[0]?.lang ?? c.user.lang;
  await sendMail(c.db, b.email, lang, 'invitation', { farm: farm.rows[0].name, role: b.role === 'collaborator' ? (lang === 'fr' ? 'collaborateur' : 'collaborator') : (lang === 'fr' ? 'référent technique' : 'technical referent') });
  if (target.rows[0]) await notify(c.db, target.rows[0].id, 'invitation', { farm: farm.rows[0].name, role: b.role });
  await audit(c.db, { actor: c.user.id, action: 'farm.member_invited', resource: 'invitation', resourceId: rows[0].id, farmId: fid(c), details: { role: b.role }, ip: c.ip });
  return { id: rows[0].id };
}));

farmsRouter.delete('/:farmId/invitations/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  await c.db.query(`update invitations set status = 'cancelled' where id = $1 and farm_id = $2`, [c.req.params.id, fid(c)]);
}));

farmsRouter.patch('/:farmId/members/:userId', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({ role: z.enum(['owner', 'collaborator', 'referent']).optional(), status: z.enum(['active', 'revoked']).optional() }), c.req.body);
  if (c.req.params.userId === c.user.id) throw bad('cannot_change_self');
  const { rowCount } = await c.db.query(
    `update memberships set role = coalesce($3, role), status = coalesce($4, status), revoked_at = case when $4 = 'revoked' then now() else revoked_at end
      where farm_id = $1 and user_id = $2`, [fid(c), c.req.params.userId, b.role ?? null, b.status ?? null]);
  if (!rowCount) throw notFound();
  await audit(c.db, { actor: c.user.id, action: 'farm.member_rights_changed', resource: 'membership', resourceId: c.req.params.userId as string, farmId: fid(c), details: b, ip: c.ip });
  return { ok: true };
}));

// Acceptation d’une invitation (par l’utilisateur invité)
export const invitationsRouter = Router();
invitationsRouter.post('/:id/accept', h(async (c) => {
  const { rows } = await c.db.query(`select * from invitations where id = $1 and status = 'pending' and lower(email) = $2`, [c.req.params.id, c.user.email]);
  if (!rows[0]) throw notFound();
  await c.db.query(
    `insert into memberships (user_id, farm_id, role) values ($1,$2,$3)
     on conflict (user_id, farm_id) do update set role = excluded.role, status = 'active', revoked_at = null`, [c.user.id, rows[0].farm_id, rows[0].role]);
  await c.db.query(`update invitations set status = 'accepted' where id = $1`, [rows[0].id]);
  await audit(c.db, { actor: c.user.id, action: 'farm.invitation_accepted', resource: 'invitation', resourceId: rows[0].id, farmId: rows[0].farm_id, ip: c.ip });
  return { farm_id: rows[0].farm_id };
}));
invitationsRouter.post('/:id/decline', h(async (c) => {
  await c.db.query(`update invitations set status = 'cancelled' where id = $1 and lower(email) = $2`, [c.req.params.id, c.user.email]);
}));

// ---------- Lots & parcelles ----------
farmsRouter.get('/:farmId/lots', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select l.*, (select count(*)::int from animals a where a.lot_id = l.id and a.status = 'active') as animals from lots l where l.farm_id = $1 order by l.name`, [fid(c)]);
  return rows;
}));
farmsRouter.post('/:farmId/lots', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ name: z.string().trim().min(1).max(100), conduct_system: zOptText(300) }), c.req.body);
  const { rows } = await c.db.query('insert into lots (farm_id, name, conduct_system) values ($1,$2,$3) returning *', [fid(c), b.name, b.conduct_system]);
  return rows[0];
}));
farmsRouter.delete('/:farmId/lots/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  await c.db.query('update animals set lot_id = null where lot_id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  await c.db.query('update parcels set lot_id = null where lot_id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  await c.db.query('delete from lots where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
}));

const zParcel = z.object({
  name: z.string().trim().min(1).max(100), area_ha: z.number().positive().max(100000).nullable().optional(),
  occupation: z.enum(['free', 'occupied', 'rest']).default('free'), rest_since: zDate.nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(), notes: zOptText(),
});
farmsRouter.get('/:farmId/parcels', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select p.*, l.name as lot_name, case when p.rest_since is not null then current_date - p.rest_since end as rest_days
       from parcels p left join lots l on l.id = p.lot_id where p.farm_id = $1 order by p.name`, [fid(c)]);
  return rows;
}));
farmsRouter.post('/:farmId/parcels', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zParcel, c.req.body);
  const { rows } = await c.db.query(
    `insert into parcels (farm_id, name, area_ha, occupation, rest_since, lot_id, notes) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [fid(c), b.name, b.area_ha ?? null, b.occupation, b.rest_since ?? null, b.lot_id ?? null, b.notes]);
  return rows[0];
}));
farmsRouter.put('/:farmId/parcels/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zParcel, c.req.body);
  const { rows } = await c.db.query(
    `update parcels set name=$3, area_ha=$4, occupation=$5, rest_since=$6, lot_id=$7, notes=$8 where id=$1 and farm_id=$2 returning *`,
    [c.req.params.id, fid(c), b.name, b.area_ha ?? null, b.occupation, b.rest_since ?? null, b.lot_id ?? null, b.notes]);
  if (!rows[0]) throw notFound();
  return rows[0];
}));
farmsRouter.delete('/:farmId/parcels/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  await c.db.query('delete from parcels where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
}));

// ---------- Consentements ----------
farmsRouter.get('/:farmId/consents', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select c.*, u.first_name || ' ' || u.last_name as granted_by_name from consents c join users u on u.id = c.granted_by where c.farm_id = $1 order by c.granted_at desc`, [fid(c)]);
  return { consents: rows, policy_version: await getSetting(c.db, 'consent_policy_version', 'v1'), min_farms: await getSetting(c.db, 'aggregation_min_farms', 5) };
}));
farmsRouter.post('/:farmId/consents', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const b = parse(z.object({
    purpose: z.literal('collective_stats'),
    categories: z.array(z.enum(['growth', 'health', 'feeding', 'reproduction'])).min(1),
    scope: z.enum(['territory', 'all']).default('territory'),
    duration_months: z.number().int().min(1).max(60).nullable().optional(),
    acknowledged: z.literal(true),
  }), c.req.body);
  const active = await c.db.query(`select 1 from consents where farm_id = $1 and purpose = $2 and revoked_at is null and (expires_at is null or expires_at > now())`, [fid(c), b.purpose]);
  if (active.rowCount) throw conflict('consent_already_active');
  const version = await getSetting(c.db, 'consent_policy_version', 'v1');
  const { rows } = await c.db.query(
    `insert into consents (farm_id, purpose, categories, scope, policy_version, granted_by, expires_at)
     values ($1,$2,$3,$4,$5,$6, case when $7::int is null then null else now() + ($7::int || ' months')::interval end) returning *`,
    [fid(c), b.purpose, b.categories, b.scope, version, c.user.id, b.duration_months ?? null]);
  await audit(c.db, { actor: c.user.id, action: 'consent.granted', resource: 'consent', resourceId: rows[0].id, farmId: fid(c), details: { categories: b.categories, scope: b.scope }, ip: c.ip });
  return rows[0];
}));
farmsRouter.post('/:farmId/consents/:id/revoke', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const { rows } = await c.db.query(`update consents set revoked_at = now(), revoked_by = $3 where id = $1 and farm_id = $2 and revoked_at is null returning id`, [c.req.params.id, fid(c), c.user.id]);
  if (!rows[0]) throw notFound();
  await audit(c.db, { actor: c.user.id, action: 'consent.revoked', resource: 'consent', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return { ok: true };
}));

// ---------- Historique des corrections ----------
farmsRouter.get('/:farmId/history', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select h.*, u.first_name || ' ' || u.last_name as actor_name from record_history h left join users u on u.id = h.actor_id
      where h.farm_id = $1 ${c.req.query.record ? 'and h.record_id = $2' : ''} order by h.at desc limit 300`,
    c.req.query.record ? [fid(c), c.req.query.record] : [fid(c)]);
  return rows;
}));

export { gmqSeries };
