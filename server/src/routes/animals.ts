import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, zDate, zOptText, today, type Ctx } from '../http.js';
import { HttpError, bad, notFound, conflict } from '../lib/errors.js';
import { audit, recordHistory } from '../lib/audit.js';
import { getSetting } from '../db.js';
import { checkWeighing, gmqSeries, weightAtAge, weighingStatus, round } from '../lib/indicators.js';
import { inbreedingVerdict, toPercent } from '../lib/pedigree.js';
import { loadPedigree, inbreedingLimits } from '../lib/pedigreeDb.js';

export const animalsRouter = Router({ mergeParams: true });
const fid = (c: Ctx) => c.req.params.farmId as string;
/** Le client pg n’exécute qu’une requête à la fois : exécution séquentielle explicite. */
async function sequential<T>(fns: (() => Promise<T>)[]): Promise<T[]> { const out: T[] = []; for (const f of fns) out.push(await f()); return out; }
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

async function getAnimal(c: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('animal_not_found');
  const { rows } = await c.db.query('select * from animals where id = $1 and farm_id = $2', [id, fid(c)]);
  if (!rows[0]) throw notFound('animal_not_found');
  return rows[0];
}

const zAnimal = z.object({
  internal_id: z.string().trim().min(1).max(50),
  official_id: zOptText(50),
  name: zOptText(100),
  sex: z.enum(['M', 'F']),
  birth_date: zDate.nullable().optional(),
  breed_code: z.string().max(40).nullable().optional(),
  breed_declared: zOptText(150),
  objective: z.enum(['meat', 'reproduction']).nullable().optional(),
  status: z.enum(['active', 'sold', 'dead', 'culled']).default('active'),
  exit_date: zDate.nullable().optional(),
  exit_reason: zOptText(300),
  sire_id: z.string().uuid().nullable().optional(),
  dam_id: z.string().uuid().nullable().optional(),
  sire_external: zOptText(100),
  dam_external: zOptText(100),
  parentage_source: z.enum(['observed', 'declared', 'dna', 'unknown']).nullable().optional(),
  parentage_certainty: z.enum(['certain', 'probable', 'uncertain']).nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(),
  notes: zOptText(),
  birth: z.object({
    litter_size: z.number().int().min(1).max(6).nullable().optional(),
    birth_weight_kg: z.number().positive().max(15).nullable().optional(),
    vitality: z.enum(['good', 'weak', 'assisted_survival']).nullable().optional(),
    colostrum: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
    assistance: z.enum(['none', 'light', 'heavy', 'vet']).nullable().optional(),
  }).nullable().optional(),
  reason: zOptText(500),
});
type AnimalIn = z.infer<typeof zAnimal>;

async function validateAnimal(c: Ctx, b: AnimalIn, selfId?: string) {
  const t = today();
  if (b.birth_date && b.birth_date > t) throw bad('birth_in_future');
  if (b.status !== 'active' && !b.exit_date) throw bad('exit_date_required');
  if (b.exit_date && b.birth_date && b.exit_date < b.birth_date) throw bad('exit_before_birth');
  for (const [k, sex] of [['sire_id', 'M'], ['dam_id', 'F']] as const) {
    const pid = b[k];
    if (!pid) continue;
    if (pid === selfId) throw bad('self_parent');
    const p = await c.db.query('select sex, birth_date from animals where id = $1 and farm_id = $2', [pid, fid(c)]);
    if (!p.rows[0]) throw bad('parent_not_found');
    if (p.rows[0].sex !== sex) throw bad(k === 'sire_id' ? 'sire_must_be_male' : 'dam_must_be_female');
    if (b.birth_date && p.rows[0].birth_date && p.rows[0].birth_date >= b.birth_date) throw bad('parent_younger_than_child');
  }
  if (b.breed_code) {
    const br = await c.db.query('select 1 from breeds where code = $1', [b.breed_code]);
    if (!br.rowCount) throw bad('unknown_breed');
  }
}

/**
 * Refuse l'enregistrement d'un animal dont la consanguinité (parenté père × mère) dépasse la limite fixée.
 * Contrôle aussi qu'on ne crée pas de boucle dans la généalogie. Ne s'applique en modification que si les parents changent.
 */
async function enforceInbreeding(c: Ctx, b: AnimalIn, selfId?: string, before?: { sire_id: string | null; dam_id: string | null }) {
  if (!b.sire_id || !b.dam_id) return;
  if (before && before.sire_id === b.sire_id && before.dam_id === b.dam_id) return;
  const ped = await loadPedigree(c.db, fid(c));
  try {
    if (selfId) for (const p of [b.sire_id, b.dam_id]) if (ped.ancestors(p).has(selfId)) throw bad('pedigree_cycle');
    const f = ped.kinship(b.sire_id, b.dam_id);
    const { warn, max } = await inbreedingLimits(c.db);
    if (inbreedingVerdict(f, warn, max) === 'refused') throw new HttpError(400, 'inbreeding_limit_exceeded', { inbreeding_percent: toPercent(f), limit_percent: max });
  } catch (e: any) {
    if (e?.message === 'pedigree_cycle') throw bad('pedigree_cycle');
    throw e;
  }
}

async function saveBirth(c: Ctx, animalId: string, birth: AnimalIn['birth']) {
  if (!birth) return;
  await c.db.query(
    `insert into births (animal_id, farm_id, litter_size, birth_weight_kg, vitality, colostrum, assistance) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (animal_id) do update set litter_size=excluded.litter_size, birth_weight_kg=excluded.birth_weight_kg, vitality=excluded.vitality,
       colostrum=excluded.colostrum, assistance=excluded.assistance`,
    [animalId, fid(c), birth.litter_size ?? null, birth.birth_weight_kg ?? null, birth.vitality ?? null, birth.colostrum ?? null, birth.assistance ?? null]);
}

const animalCols = (b: AnimalIn) => [b.internal_id, b.official_id, b.name, b.sex, b.birth_date ?? null, b.breed_code ?? null, b.breed_declared,
  b.objective ?? null, b.status, b.exit_date ?? null, b.exit_reason, b.sire_id ?? null, b.dam_id ?? null, b.sire_external, b.dam_external,
  b.parentage_source ?? null, b.parentage_certainty ?? null, b.lot_id ?? null, b.notes];

animalsRouter.get('/animals', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const q = c.req.query;
  const params: unknown[] = [fid(c)];
  let where = 'a.farm_id = $1';
  const add = (cond: string, v: unknown) => { params.push(v); where += ` and ${cond.replace('?', `$${params.length}`)}`; };
  if (typeof q.q === 'string' && q.q.trim()) add(`(a.internal_id ilike ? or a.official_id ilike $${params.length + 1} or a.name ilike $${params.length + 1})`, `%${q.q.trim()}%`);
  if (typeof q.status === 'string' && q.status !== 'all') add('a.status = ?', q.status);
  else if (!q.status) where += ` and a.status = 'active'`;
  if (q.sex === 'M' || q.sex === 'F') add('a.sex = ?', q.sex);
  if (typeof q.breed === 'string' && q.breed) add('a.breed_code = ?', q.breed);
  if (typeof q.lot === 'string' && isUuid(q.lot)) add('a.lot_id = ?', q.lot);
  const { rows } = await c.db.query(
    `select a.*, b.label_fr as breed_fr, b.label_en as breed_en, l.name as lot_name,
            coalesce(json_agg(json_build_object('date', w.date, 'weight_kg', w.weight_kg) order by w.date) filter (where w.id is not null), '[]') as ws
       from animals a left join breeds b on b.code = a.breed_code left join lots l on l.id = a.lot_id
       left join weighings w on w.animal_id = a.id
      where ${where} group by a.id, b.code, l.id order by a.internal_id`, params);
  return rows.map(({ ws, ...a }) => {
    const s = gmqSeries(ws);
    return { ...a, weighings_count: s.count, last_weight: s.last?.weight_kg ?? null, last_weighing: s.last?.date ?? null, gmq_overall: s.overall };
  });
}));

animalsRouter.post('/animals', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zAnimal, c.req.body);
  await validateAnimal(c, b);
  const dup = await c.db.query('select 1 from animals where farm_id = $1 and internal_id = $2', [fid(c), b.internal_id]);
  if (dup.rowCount) throw conflict('internal_id_taken');
  await enforceInbreeding(c, b);
  const { rows } = await c.db.query(
    `insert into animals (farm_id, internal_id, official_id, name, sex, birth_date, breed_code, breed_declared, objective, status, exit_date, exit_reason,
       sire_id, dam_id, sire_external, dam_external, parentage_source, parentage_certainty, lot_id, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`, [fid(c), ...animalCols(b)]);
  await saveBirth(c, rows[0].id, b.birth);
  await audit(c.db, { actor: c.user.id, action: 'animal.created', resource: 'animal', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

animalsRouter.get('/animals/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const a = await getAnimal(c, c.req.params.id as string);
  const [breed, birth, ws, parents, offspring, health, feeding, repro, lot] = await sequential([
    () => c.db.query('select * from breeds where code = $1', [a.breed_code]),
    () => c.db.query('select * from births where animal_id = $1', [a.id]),
    () => c.db.query(`select w.*, u.first_name || ' ' || u.last_name as operator_name from weighings w left join users u on u.id = w.operator_id where w.animal_id = $1 order by w.date, w.created_at`, [a.id]),
    () => c.db.query('select id, internal_id, name, sex, birth_date, breed_code, sire_id, dam_id from animals where id = any($1::uuid[])', [[a.sire_id, a.dam_id].filter(Boolean)]),
    () => c.db.query('select id, internal_id, name, sex, birth_date, status from animals where (sire_id = $1 or dam_id = $1) order by birth_date', [a.id]),
    () => c.db.query(`select h.*, u.first_name || ' ' || u.last_name as author_name from health_events h left join users u on u.id = h.author_id where h.animal_id = $1 order by h.date desc`, [a.id]),
    () => c.db.query('select * from feeding_events where animal_id = $1 or (lot_id is not null and lot_id = $2) order by start_date desc', [a.id, a.lot_id]),
    () => c.db.query('select r.*, ram.internal_id as ram_internal_id from repro_events r left join animals ram on ram.id = r.ram_id where r.ewe_id = $1 or r.ram_id = $1 order by r.date desc', [a.id]),
    () => c.db.query('select id, name from lots where id = $1', [a.lot_id]),
  ]);
  // grands-parents (généalogie sur 2 générations)
  const gpIds = parents.rows.flatMap((p) => [p.sire_id, p.dam_id]).filter(Boolean);
  const gp = gpIds.length ? await c.db.query('select id, internal_id, name, sex from animals where id = any($1::uuid[])', [gpIds]) : { rows: [] };
  const maxGap = await getSetting<number>(c.db, 'interpolation_max_gap_days', 30);
  const protocol = await getSetting<number[]>(c.db, 'weighing_protocol_days', [0, 7, 14, 21, 30, 45, 60, 90, 120]);
  const tol = await getSetting<number>(c.db, 'weighing_tolerance_days', 3);
  const series = gmqSeries(ws.rows);
  const std = Object.fromEntries([30, 60, 90, 120].map((d) => [`j${d}`, weightAtAge(a.birth_date, ws.rows, d, maxGap)]));
  if (birth.rows[0]?.birth_weight_kg && std.j0 === undefined) (std as any).j0 = birth.rows[0].birth_weight_kg;
  const expected = ['official_id', 'birth_date', 'breed_code', 'sire_id|sire_external', 'dam_id|dam_external'];
  const filled = expected.filter((k) => k.split('|').some((f) => a[f] !== null && a[f] !== '')).length + (ws.rows.length > 0 ? 1 : 0) + (birth.rows[0] ? 1 : 0);
  // Consanguinité : calculable seulement si père ET mère sont connus dans le cheptel ; jamais « devinée »
  let inbreeding: any = null;
  try {
    const ped = await loadPedigree(c.db, fid(c));
    const lim = await inbreedingLimits(c.db);
    const computable = !!(a.sire_id && a.dam_id);
    const fv = computable ? ped.inbreeding(a.id) : null;
    inbreeding = {
      computable, coefficient_percent: fv === null ? null : toPercent(fv), level: fv === null ? null : inbreedingVerdict(fv, lim.warn, lim.max),
      limit_percent: lim.max, warn_percent: lim.warn, generations_known: ped.depth(a.id), completeness: round(ped.completeness(a.id, 3), 2),
    };
  } catch { inbreeding = null; }
  return {
    ...a, inbreeding, breed: breed.rows[0] ?? null, birth: birth.rows[0] ?? null, lot: lot.rows[0] ?? null,
    sire: parents.rows.find((p) => p.id === a.sire_id) ?? null, dam: parents.rows.find((p) => p.id === a.dam_id) ?? null,
    grandparents: gp.rows, offspring: offspring.rows,
    weighings: ws.rows, growth: { ...series, standard_weights: std, schedule: weighingStatus(a.birth_date,
      // le poids de naissance vaut pesée J0 pour le calendrier (pas pour le GMQ)
      birth.rows[0]?.birth_weight_kg && a.birth_date ? [...ws.rows, { date: a.birth_date, weight_kg: birth.rows[0].birth_weight_kg }] : ws.rows,
      protocol, tol, today()) },
    completeness: round(filled / (expected.length + 2), 2),
    health: health.rows, feeding: feeding.rows, repro: repro.rows,
  };
}));

animalsRouter.put('/animals/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const before = await getAnimal(c, c.req.params.id as string);
  const b = parse(zAnimal, c.req.body);
  await validateAnimal(c, b, before.id);
  await enforceInbreeding(c, b, before.id, before);
  const firstW = await c.db.query('select min(date) d from weighings where animal_id = $1', [before.id]);
  if (b.birth_date && firstW.rows[0].d && firstW.rows[0].d < b.birth_date) throw bad('weighing_before_birth');
  const { rows } = await c.db.query(
    `update animals set internal_id=$3, official_id=$4, name=$5, sex=$6, birth_date=$7, breed_code=$8, breed_declared=$9, objective=$10, status=$11,
       exit_date=$12, exit_reason=$13, sire_id=$14, dam_id=$15, sire_external=$16, dam_external=$17, parentage_source=$18, parentage_certainty=$19,
       lot_id=$20, notes=$21, updated_at = now() where id = $1 and farm_id = $2 returning *`, [before.id, fid(c), ...animalCols(b)]);
  await saveBirth(c, before.id, b.birth);
  await recordHistory(c.db, { farmId: fid(c), table: 'animals', recordId: before.id, actor: c.user.id, action: 'update', before, after: rows[0], reason: b.reason });
  await audit(c.db, { actor: c.user.id, action: 'animal.updated', resource: 'animal', resourceId: before.id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

animalsRouter.delete('/animals/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'manage');
  const a = await getAnimal(c, c.req.params.id as string);
  const kids = await c.db.query('select count(*)::int n from animals where sire_id = $1 or dam_id = $1', [a.id]);
  if (kids.rows[0].n) throw conflict('animal_has_offspring');
  await recordHistory(c.db, { farmId: fid(c), table: 'animals', recordId: a.id, actor: c.user.id, action: 'delete', before: a, reason: (c.req.query.reason as string) ?? null });
  await c.db.query('delete from animals where id = $1 and farm_id = $2', [a.id, fid(c)]);
  await audit(c.db, { actor: c.user.id, action: 'animal.deleted', resource: 'animal', resourceId: a.id, farmId: fid(c), ip: c.ip });
}));

// ---------- Pesées / mesures ----------
const zWeighing = z.object({
  date: zDate, weight_kg: z.number(), height_cm: z.number().positive().max(300).nullable().optional(),
  length_cm: z.number().positive().max(300).nullable().optional(), note: zOptText(500),
  confirm: z.boolean().optional(), client_uuid: z.string().uuid().optional(), reason: zOptText(500),
  source: z.enum(['manual', 'offline_sync']).optional(),
});

async function runChecks(c: Ctx, animal: any, b: z.infer<typeof zWeighing>, selfId?: string) {
  const ex = await c.db.query('select id, date, weight_kg from weighings where animal_id = $1', [animal.id]);
  const res = checkWeighing({ date: b.date, weight_kg: b.weight_kg, id: selfId }, animal.birth_date, ex.rows, today());
  if (res.errors.length) throw new HttpError(400, res.errors[0], { errors: res.errors });
  if (res.warnings.length && !b.confirm) throw new HttpError(422, 'confirmation_required', { warnings: res.warnings });
  return res.warnings;
}

animalsRouter.post('/animals/:id/weighings', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const a = await getAnimal(c, c.req.params.id as string);
  const b = parse(zWeighing, c.req.body);
  if (b.client_uuid) {
    // Synchronisation idempotente : un envoi répété ne crée pas de doublon
    const prev = await c.db.query('select * from weighings where client_uuid = $1', [b.client_uuid]);
    if (prev.rows[0]) {
      if (prev.rows[0].animal_id !== a.id) throw conflict('client_uuid_conflict');
      return { ...prev.rows[0], replayed: true };
    }
  }
  const warnings = await runChecks(c, a, b);
  const { rows } = await c.db.query(
    `insert into weighings (farm_id, animal_id, date, weight_kg, height_cm, length_cm, operator_id, source, client_uuid, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [fid(c), a.id, b.date, b.weight_kg, b.height_cm ?? null, b.length_cm ?? null, c.user.id, b.source ?? 'manual', b.client_uuid ?? null, b.note]);
  await audit(c.db, { actor: c.user.id, action: 'weighing.created', resource: 'weighing', resourceId: rows[0].id, farmId: fid(c), details: warnings.length ? { confirmed_warnings: warnings } : undefined, ip: c.ip });
  return { ...rows[0], warnings };
}));

animalsRouter.put('/weighings/:wid', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.wid)) throw notFound();
  const cur = await c.db.query('select * from weighings where id = $1 and farm_id = $2', [c.req.params.wid, fid(c)]);
  if (!cur.rows[0]) throw notFound();
  const b = parse(zWeighing, c.req.body);
  if (!b.reason) throw bad('reason_required');
  const a = await getAnimal(c, cur.rows[0].animal_id);
  await runChecks(c, a, b, cur.rows[0].id);
  const { rows } = await c.db.query(
    `update weighings set date=$3, weight_kg=$4, height_cm=$5, length_cm=$6, note=$7, updated_at = now() where id = $1 and farm_id = $2 returning *`,
    [cur.rows[0].id, fid(c), b.date, b.weight_kg, b.height_cm ?? null, b.length_cm ?? null, b.note]);
  await recordHistory(c.db, { farmId: fid(c), table: 'weighings', recordId: cur.rows[0].id, actor: c.user.id, action: 'update', before: cur.rows[0], after: rows[0], reason: b.reason });
  await audit(c.db, { actor: c.user.id, action: 'weighing.corrected', resource: 'weighing', resourceId: cur.rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

animalsRouter.delete('/weighings/:wid', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.wid)) throw notFound();
  const reason = typeof c.req.query.reason === 'string' ? c.req.query.reason : null;
  if (!reason) throw bad('reason_required');
  const cur = await c.db.query('select * from weighings where id = $1 and farm_id = $2', [c.req.params.wid, fid(c)]);
  if (!cur.rows[0]) throw notFound();
  await recordHistory(c.db, { farmId: fid(c), table: 'weighings', recordId: cur.rows[0].id, actor: c.user.id, action: 'delete', before: cur.rows[0], reason });
  await c.db.query('delete from weighings where id = $1', [cur.rows[0].id]);
  await audit(c.db, { actor: c.user.id, action: 'weighing.deleted', resource: 'weighing', resourceId: cur.rows[0].id, farmId: fid(c), ip: c.ip });
}));

// Pesée rapide multi-animaux (saisie au parc)
animalsRouter.get('/weighings', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select w.*, a.internal_id, a.name from weighings w join animals a on a.id = w.animal_id where w.farm_id = $1 order by w.date desc, w.created_at desc limit 500`, [fid(c)]);
  return rows;
}));

// ---------- Alimentation ----------
const zFeeding = z.object({
  animal_id: z.string().uuid().nullable().optional(), lot_id: z.string().uuid().nullable().optional(),
  feed: z.string().trim().min(1).max(150), quantity_kg: z.number().min(0).max(1e6),
  basis: z.enum(['fresh', 'dm']).default('fresh'), kind: z.enum(['distributed', 'consumed']).default('distributed'),
  frequency: zOptText(100), water: zOptText(200), start_date: zDate, end_date: zDate.nullable().optional(),
  cost_eur: z.number().min(0).max(1e7).nullable().optional(), note: zOptText(500),
}).refine((v) => !!v.animal_id !== !!v.lot_id, { message: 'animal_or_lot_required', path: ['animal_id'] })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { message: 'end_before_start', path: ['end_date'] });

animalsRouter.get('/feeding', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select f.*, a.internal_id, a.name as animal_name, l.name as lot_name from feeding_events f left join animals a on a.id = f.animal_id
       left join lots l on l.id = f.lot_id where f.farm_id = $1 order by f.start_date desc, f.created_at desc limit 500`, [fid(c)]);
  return rows;
}));
animalsRouter.post('/feeding', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zFeeding, c.req.body);
  const { rows } = await c.db.query(
    `insert into feeding_events (farm_id, animal_id, lot_id, feed, quantity_kg, basis, kind, frequency, water, start_date, end_date, cost_eur, note, author_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [fid(c), b.animal_id ?? null, b.lot_id ?? null, b.feed, b.quantity_kg, b.basis, b.kind, b.frequency, b.water, b.start_date, b.end_date ?? null, b.cost_eur ?? null, b.note, c.user.id]);
  return rows[0];
}));
animalsRouter.delete('/feeding/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.id)) throw notFound();
  const cur = await c.db.query('select * from feeding_events where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  if (!cur.rows[0]) throw notFound();
  await recordHistory(c.db, { farmId: fid(c), table: 'feeding_events', recordId: cur.rows[0].id, actor: c.user.id, action: 'delete', before: cur.rows[0] });
  await c.db.query('delete from feeding_events where id = $1', [cur.rows[0].id]);
}));

// ---------- Santé ----------
const zHealth = z.object({
  animal_id: z.string().uuid(), date: zDate, type: z.enum(['observation', 'analysis', 'treatment', 'followup']),
  symptoms: zOptText(), diagnosis_status: z.enum(['none', 'suspected', 'confirmed']).default('none'), diagnosis: zOptText(300),
  analysis_type: zOptText(100), analysis_result: zOptText(300), famacha: z.number().int().min(1).max(5).nullable().optional(),
  body_condition: z.number().min(1).max(5).nullable().optional(), treatment: zOptText(300), product: zOptText(150), dose: zOptText(100),
  withdrawal_days: z.number().int().min(0).max(365).nullable().optional(), followup_date: zDate.nullable().optional(), note: zOptText(),
}).refine((v) => v.diagnosis_status === 'none' || !!v.diagnosis, { message: 'diagnosis_required', path: ['diagnosis'] })
  .refine((v) => !v.followup_date || v.followup_date >= v.date, { message: 'followup_before_date', path: ['followup_date'] });

animalsRouter.get('/health', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select h.*, a.internal_id, a.name as animal_name, u.first_name || ' ' || u.last_name as author_name from health_events h join animals a on a.id = h.animal_id
       left join users u on u.id = h.author_id where h.farm_id = $1 order by h.date desc, h.created_at desc limit 500`, [fid(c)]);
  return rows;
}));
animalsRouter.post('/health', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zHealth, c.req.body);
  const a = await getAnimal(c, b.animal_id);
  if (a.birth_date && b.date < a.birth_date) throw bad('date_before_birth');
  if (b.date > today()) throw bad('date_in_future');
  const { rows } = await c.db.query(
    `insert into health_events (farm_id, animal_id, date, type, symptoms, diagnosis_status, diagnosis, analysis_type, analysis_result, famacha, body_condition,
       treatment, product, dose, withdrawal_days, followup_date, note, author_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
    [fid(c), a.id, b.date, b.type, b.symptoms, b.diagnosis_status, b.diagnosis, b.analysis_type, b.analysis_result, b.famacha ?? null, b.body_condition ?? null,
     b.treatment, b.product, b.dose, b.withdrawal_days ?? null, b.followup_date ?? null, b.note, c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'health.created', resource: 'health_event', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));
animalsRouter.delete('/health/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.id)) throw notFound();
  const cur = await c.db.query('select * from health_events where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  if (!cur.rows[0]) throw notFound();
  await recordHistory(c.db, { farmId: fid(c), table: 'health_events', recordId: cur.rows[0].id, actor: c.user.id, action: 'delete', before: cur.rows[0] });
  await c.db.query('delete from health_events where id = $1', [cur.rows[0].id]);
}));

// ---------- Reproduction ----------
const zRepro = z.object({
  ewe_id: z.string().uuid(), type: z.enum(['mating', 'pregnancy_check', 'lambing', 'weaning', 'abortion']), date: zDate,
  ram_id: z.string().uuid().nullable().optional(), result: zOptText(100),
  born_alive: z.number().int().min(0).max(8).nullable().optional(), born_dead: z.number().int().min(0).max(8).nullable().optional(),
  weaned: z.number().int().min(0).max(8).nullable().optional(), note: zOptText(),
});
animalsRouter.get('/repro', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select r.*, e.internal_id as ewe_internal_id, e.name as ewe_name, ram.internal_id as ram_internal_id from repro_events r
       join animals e on e.id = r.ewe_id left join animals ram on ram.id = r.ram_id where r.farm_id = $1 order by r.date desc limit 500`, [fid(c)]);
  return rows;
}));
animalsRouter.post('/repro', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zRepro, c.req.body);
  const ewe = await getAnimal(c, b.ewe_id);
  if (ewe.sex !== 'F') throw bad('dam_must_be_female');
  if (b.ram_id) { const ram = await getAnimal(c, b.ram_id); if (ram.sex !== 'M') throw bad('sire_must_be_male'); }
  if (b.date > today()) throw bad('date_in_future');
  if (b.type === 'lambing' && (b.born_alive ?? null) === null) throw bad('born_alive_required');
  if (b.type === 'weaning' && (b.weaned ?? null) === null) throw bad('weaned_required');
  const { rows } = await c.db.query(
    `insert into repro_events (farm_id, ewe_id, type, date, ram_id, result, born_alive, born_dead, weaned, note, author_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [fid(c), ewe.id, b.type, b.date, b.ram_id ?? null, b.result, b.born_alive ?? null, b.born_dead ?? null, b.weaned ?? null, b.note, c.user.id]);
  return rows[0];
}));
animalsRouter.delete('/repro/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.id)) throw notFound();
  const cur = await c.db.query('select * from repro_events where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  if (!cur.rows[0]) throw notFound();
  await recordHistory(c.db, { farmId: fid(c), table: 'repro_events', recordId: cur.rows[0].id, actor: c.user.id, action: 'delete', before: cur.rows[0] });
  await c.db.query('delete from repro_events where id = $1', [cur.rows[0].id]);
}));
