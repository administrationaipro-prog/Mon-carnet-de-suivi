import { Router } from 'express';
import { z } from 'zod';
import { h, parse, requirePlatform, type Ctx } from '../http.js';
import { bad, forbidden, notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sendMail, notify } from '../lib/mail.js';

export const registrationRouter = Router();

const STATUS_LABELS: Record<string, [string, string]> = {
  draft: ['Brouillon', 'Draft'], pending: ['En attente', 'Pending'], info_requested: ['Complément demandé', 'More information requested'],
  approved: ['Approuvée', 'Approved'], rejected: ['Refusée', 'Rejected'], suspended: ['Suspendue', 'Suspended'],
};

const zReq = z.object({
  territory_code: z.string().min(2).max(3),
  farm_name: z.string().trim().min(2).max(150),
  locality: z.string().trim().min(1).max(150),
  production_type: z.enum(['sheep_meat', 'sheep_breeding', 'sheep_mixed', 'goat', 'other']),
  herd_size: z.number().int().min(0).max(100000).nullable().optional(),
  message: z.string().trim().max(2000).nullable().optional(),
  accepted_terms: z.boolean(),
  truthful_declaration: z.boolean(),
});

async function history(c: Ctx, id: string, from: string | null, to: string, reason?: string | null) {
  await c.db.query('insert into registration_history (request_id, actor_id, from_status, to_status, reason) values ($1,$2,$3,$4,$5)',
    [id, c.user.id, from, to, reason ?? null]);
}

/** Affectation automatique : validateur du territoire ayant le moins de dossiers ouverts, sinon un administrateur. */
async function pickReviewer(c: Ctx, territory: string): Promise<string | null> {
  const v = await c.db.query(
    `select u.id from validator_territories vt join users u on u.id = vt.user_id and u.status = 'active' and u.platform_role = 'validator'
      where vt.territory_code = $1
      order by (select count(*) from registration_requests r where r.assigned_to = u.id and r.status in ('pending','info_requested')), u.created_at
      limit 1`, [territory]);
  if (v.rows[0]) return v.rows[0].id;
  const a = await c.db.query(`select id from users where platform_role = 'admin' and status = 'active' order by created_at limit 1`);
  return a.rows[0]?.id ?? null;
}

// ----- Côté demandeur -----
registrationRouter.get('/mine', h(async (c) => {
  const { rows } = await c.db.query('select * from registration_requests where user_id = $1 order by created_at desc limit 1', [c.user.id]);
  if (!rows[0]) return null;
  const hist = await c.db.query('select from_status, to_status, reason, at from registration_history where request_id = $1 order by at', [rows[0].id]);
  const { assigned_to, reviewer_id, ...rest } = rows[0];
  return { ...rest, history: hist.rows };
}));

/** Enregistre le brouillon ou soumet (submit=true). Possible en brouillon, complément demandé ou réexamen après refus. */
registrationRouter.put('/mine', h(async (c) => {
  const submit = c.req.query.submit === '1' || c.req.body?.submit === true;
  const b = parse(zReq, c.req.body);
  const terr = await c.db.query('select code, active from territories where code = $1', [b.territory_code]);
  if (!terr.rows[0]) throw bad('unknown_territory');
  if (!terr.rows[0].active) throw bad('territory_not_open');
  if (submit && (!b.accepted_terms || !b.truthful_declaration)) throw bad('declarations_required');
  const cur = await c.db.query('select * from registration_requests where user_id = $1 order by created_at desc limit 1', [c.user.id]);
  let r = cur.rows[0];
  if (r && ['pending', 'approved', 'suspended'].includes(r.status)) throw conflict('request_not_editable');
  const values = [b.territory_code, b.farm_name, b.locality, b.production_type, b.herd_size ?? null, b.message ?? null, b.accepted_terms, b.truthful_declaration];
  if (!r || r.status === 'rejected') {
    // nouvelle demande (y compris demande de réexamen après refus)
    const ins = await c.db.query(
      `insert into registration_requests (user_id, territory_code, farm_name, locality, production_type, herd_size, message, accepted_terms, truthful_declaration)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [c.user.id, ...values]);
    r = ins.rows[0];
    await history(c, r.id, null, 'draft', cur.rows[0]?.status === 'rejected' ? 'reexamination' : null);
  } else {
    const up = await c.db.query(
      `update registration_requests set territory_code=$2, farm_name=$3, locality=$4, production_type=$5, herd_size=$6, message=$7,
         accepted_terms=$8, truthful_declaration=$9, updated_at = now() where id = $1 returning *`, [r.id, ...values]);
    r = up.rows[0];
  }
  if (submit) {
    const reviewer = r.assigned_to && r.status === 'info_requested' ? r.assigned_to : await pickReviewer(c, r.territory_code);
    await c.db.query(`update registration_requests set status = 'pending', submitted_at = now(), assigned_to = $2 where id = $1`, [r.id, reviewer]);
    await history(c, r.id, r.status, 'pending');
    await audit(c.db, { actor: c.user.id, action: 'registration.submitted', resource: 'registration_request', resourceId: r.id, ip: c.ip });
    await notify(c.db, c.user.id, 'registration_received', { request_id: r.id });
    if (reviewer) {
      const rv = await c.db.query('select email, lang from users where id = $1', [reviewer]);
      await notify(c.db, reviewer, 'registration_assigned', { request_id: r.id, territory: r.territory_code });
      await sendMail(c.db, rv.rows[0].email, rv.rows[0].lang, 'new_request', { territory: r.territory_code });
    }
  }
  return { id: r.id, status: submit ? 'pending' : r.status };
}));

// ----- Côté validation -----
async function loadForReview(c: Ctx, id: string) {
  requirePlatform(c, 'admin', 'validator');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const { rows } = await c.db.query('select * from registration_requests where id = $1', [id]);
  const r = rows[0];
  if (!r) throw notFound();
  // Un validateur territorial ne voit que les demandes qui lui sont affectées
  if (c.user.platform_role === 'validator' && r.assigned_to !== c.user.id) throw notFound();
  return r;
}

registrationRouter.get('/review', h(async (c) => {
  requirePlatform(c, 'admin', 'validator');
  const status = typeof c.req.query.status === 'string' ? c.req.query.status : null;
  const params: unknown[] = [];
  let where = 'r.status <> \'draft\'';
  if (c.user.platform_role === 'validator') { params.push(c.user.id); where += ` and r.assigned_to = $${params.length}`; }
  if (status) { params.push(status); where += ` and r.status = $${params.length}`; }
  const { rows } = await c.db.query(
    `select r.id, r.status, r.territory_code, r.farm_name, r.locality, r.production_type, r.herd_size, r.submitted_at, r.decided_at,
            u.first_name, u.last_name, u.email, (u.email_verified_at is not null) as email_verified,
            a.first_name || ' ' || a.last_name as assigned_name, r.assigned_to
       from registration_requests r join users u on u.id = r.user_id left join users a on a.id = r.assigned_to
      where ${where} order by r.submitted_at desc nulls last limit 500`, params);
  return rows;
}));

registrationRouter.get('/review/:id', h(async (c) => {
  const r = await loadForReview(c, c.req.params.id as string);
  const u = await c.db.query('select id, first_name, last_name, email, email_verified_at, lang, created_at from users where id = $1', [r.user_id]);
  const hist = await c.db.query(
    `select h.from_status, h.to_status, h.reason, h.at, a.first_name || ' ' || a.last_name as actor
       from registration_history h left join users a on a.id = h.actor_id where request_id = $1 order by at`, [r.id]);
  await audit(c.db, { actor: c.user.id, action: 'registration.viewed', resource: 'registration_request', resourceId: r.id, ip: c.ip });
  return { ...r, applicant: u.rows[0], history: hist.rows };
}));

const TRANSITIONS: Record<string, string[]> = {
  approve: ['pending'], reject: ['pending', 'info_requested'], request_info: ['pending'], suspend: ['approved'], reinstate: ['suspended'],
};
const TARGET: Record<string, string> = { approve: 'approved', reject: 'rejected', request_info: 'info_requested', suspend: 'suspended', reinstate: 'approved' };

registrationRouter.post('/review/:id/decision', h(async (c) => {
  const b = parse(z.object({
    action: z.enum(['approve', 'reject', 'request_info', 'suspend', 'reinstate']),
    reason: z.string().trim().max(2000).optional(),
  }), c.req.body);
  const r = await loadForReview(c, c.req.params.id as string);
  if (['reject', 'request_info', 'suspend'].includes(b.action) && !b.reason) throw bad('reason_required');
  if (!TRANSITIONS[b.action].includes(r.status)) throw conflict('invalid_transition', { from: r.status, action: b.action });
  if (b.action === 'approve') {
    const u = await c.db.query('select email_verified_at from users where id = $1', [r.user_id]);
    if (!u.rows[0].email_verified_at) throw conflict('applicant_email_not_verified');
  }
  const to = TARGET[b.action];
  let farmId = r.farm_id;
  if (b.action === 'approve') {
    const objective = r.production_type === 'sheep_meat' ? 'meat' : r.production_type === 'sheep_breeding' ? 'reproduction' : 'mixed';
    const f = await c.db.query(
      `insert into farms (territory_code, name, locality, objective) values ($1,$2,$3,$4) returning id`,
      [r.territory_code, r.farm_name, r.locality, objective]);
    farmId = f.rows[0].id;
    await c.db.query(`insert into memberships (user_id, farm_id, role) values ($1,$2,'owner')`, [r.user_id, farmId]);
  }
  if (b.action === 'suspend' && farmId) await c.db.query(`update farms set status = 'suspended' where id = $1`, [farmId]);
  if (b.action === 'reinstate' && farmId) await c.db.query(`update farms set status = 'active' where id = $1`, [farmId]);
  await c.db.query(
    `update registration_requests set status = $2, reviewer_id = $3, decision_reason = $4, decided_at = now(), farm_id = $5, updated_at = now() where id = $1`,
    [r.id, to, c.user.id, b.reason ?? null, farmId]);
  await history(c, r.id, r.status, to, b.reason);
  await audit(c.db, { actor: c.user.id, action: `registration.${b.action}`, resource: 'registration_request', resourceId: r.id, farmId, details: { reason: b.reason ?? null }, ip: c.ip });
  // Notification au demandeur : statut + motif uniquement, aucune donnée de tiers
  const app = await c.db.query('select email, lang from users where id = $1', [r.user_id]);
  await notify(c.db, r.user_id, 'registration_status', { status: to, reason: b.reason ?? null });
  await sendMail(c.db, app.rows[0].email, app.rows[0].lang, 'registration_status',
    { statusLabelFr: STATUS_LABELS[to][0], statusLabelEn: STATUS_LABELS[to][1], reason: b.reason });
  return { id: r.id, status: to, farm_id: farmId };
}));

registrationRouter.post('/review/:id/assign', h(async (c) => {
  requirePlatform(c, 'admin');
  const { user_id } = parse(z.object({ user_id: z.string().uuid() }), c.req.body);
  const v = await c.db.query(`select id from users where id = $1 and platform_role in ('validator','admin') and status = 'active'`, [user_id]);
  if (!v.rowCount) throw bad('not_a_reviewer');
  const r = await loadForReview(c, c.req.params.id as string);
  await c.db.query('update registration_requests set assigned_to = $2 where id = $1', [r.id, user_id]);
  await audit(c.db, { actor: c.user.id, action: 'registration.assigned', resource: 'registration_request', resourceId: r.id, details: { to: user_id }, ip: c.ip });
  await notify(c.db, user_id, 'registration_assigned', { request_id: r.id, territory: r.territory_code });
  return { ok: true };
}));

export { forbidden };
