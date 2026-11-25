import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, requireVet, activeVetGrant, zDate, zOptText, today, type Ctx } from '../http.js';
import { config } from '../config.js';
import { bad, forbidden, notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createHash } from 'node:crypto';
import { sha256 } from '../lib/crypto.js';
import { notify, sendMail } from '../lib/mail.js';
import { DEFAULT_SETTINGS, decide, fecrt, mergeSettings, type ParasiteSettings, type Species } from '../lib/parasite.js';
import { issueSignCode, consumeSignCode } from '../lib/signcode.js';
import { extractLabReport, extractorAvailable, matchAnimal } from '../lib/labExtract.js';
import { buildCoproPdf } from '../lib/coproPdf.js';

export const parasiteRouter = Router({ mergeParams: true });
const fid = (c: Ctx) => c.req.params.farmId as string;
const zSpecies = z.enum(['ovine', 'caprine']);

/** Éleveur (écriture) ou vétérinaire en consultation (portée santé). */
async function editor(c: Ctx): Promise<'farmer' | 'vet'> {
  const v = await activeVetGrant(c.db, fid(c), c.user.id);
  if (v) { if (!v.scopes.includes('health')) throw forbidden('vet_scope_denied'); return 'vet'; }
  await farmAccess(c, fid(c), 'write');
  return 'farmer';
}

async function settingsFor(c: Ctx, species: Species): Promise<ParasiteSettings> {
  const r = (await c.db.query('select vals from parasite_settings where farm_id = $1 and species = $2', [fid(c), species])).rows[0];
  return mergeSettings(r?.vals);
}

// ---------- Seuils : lecture par tous, avis signé par le vétérinaire uniquement ----------
parasiteRouter.get('/parasite/settings', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query('select species, vals, comment, vet_name, vet_ordinal, validated_at, version from parasite_settings where farm_id = $1', [fid(c)]);
  return (['ovine', 'caprine'] as const).map((sp) => {
    const r = rows.find((x) => x.species === sp);
    return { species: sp, vals: mergeSettings(r?.vals), validated: !!r?.validated_at, comment: r?.comment ?? null, vet_name: r?.vet_name ?? null,
      vet_ordinal: r?.vet_ordinal ?? null, validated_at: r?.validated_at ?? null, version: r?.version ?? 0 };
  }).concat([]).reduce((o, x) => ({ ...o, [x.species]: x }), { defaults: DEFAULT_SETTINGS } as Record<string, unknown>);
}));

parasiteRouter.get('/parasite/settings/history', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  return (await c.db.query('select * from parasite_settings_history where farm_id = $1 order by validated_at desc limit 50', [fid(c)])).rows;
}));

const zNum = (min: number, max: number) => z.number().min(min).max(max);
const zSettings = z.object({
  famacha_treat_from: z.number().int().min(2).max(5), famacha_conditional: z.number().int().min(1).max(5),
  cond_young: z.boolean(), cond_pregnant_lactating: z.boolean(), cond_bcs_max: zNum(1, 5).nullable(), cond_rising: z.boolean(),
  herd_alert_pct: zNum(1, 100), exam_interval_days: z.number().int().min(3).max(90), recheck_days: z.number().int().min(1).max(60),
  famacha_min_age_months: zNum(0, 24), young_min_gmq: zNum(0, 1000).nullable(),
  copro_treat_epg: z.number().int().min(0).max(100000).nullable(), dag_flag_from: z.number().int().min(1).max(3), jaw_edema_treat: z.boolean(),
  fecrt_interval_days: z.number().int().min(7).max(28), fecrt_efficacy_pct: zNum(50, 100), fecrt_min_animals: z.number().int().min(1).max(100),
}).refine((s) => s.famacha_conditional < s.famacha_treat_from, 'conditional_below_treat');
const zPng = z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'signature_png');

parasiteRouter.post('/parasite/settings/:species/sign-code', h(async (c) => {
  const sp = zSpecies.parse(c.req.params.species);
  const { profile } = await requireVet(c, fid(c), 'health');
  return issueSignCode(c, 'parasite_settings', `${fid(c)}:${sp}`, 'votre avis sur le protocole parasitaire', profile.phone);
}));

parasiteRouter.post('/parasite/settings/:species', h(async (c) => {
  const sp = zSpecies.parse(c.req.params.species);
  const { profile } = await requireVet(c, fid(c), 'health');
  const b = parse(z.object({ vals: zSettings, comment: zOptText(2000), signature_png: zPng, code: z.string().trim().min(6).max(6) }), c.req.body);
  const channel = await consumeSignCode(c, 'parasite_settings', `${fid(c)}:${sp}`, b.code);
  const name = `Dr ${c.user.first_name} ${c.user.last_name}`;
  const { rows } = await c.db.query(
    `insert into parasite_settings (farm_id, species, vals, comment, vet_id, vet_name, vet_ordinal, signature_png, validated_at, version)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now(), 1)
     on conflict (farm_id, species) do update set vals = excluded.vals, comment = excluded.comment, vet_id = excluded.vet_id, vet_name = excluded.vet_name,
       vet_ordinal = excluded.vet_ordinal, signature_png = excluded.signature_png, validated_at = now(), version = parasite_settings.version + 1
     returning *`, [fid(c), sp, JSON.stringify(b.vals), b.comment, c.user.id, name, profile.ordinal_number, b.signature_png]);
  const s = rows[0];
  await c.db.query(`insert into parasite_settings_history (farm_id, species, vals, comment, vet_id, vet_name, vet_ordinal, validated_at, version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [fid(c), sp, JSON.stringify(b.vals), b.comment, c.user.id, name, profile.ordinal_number, s.validated_at, s.version]);
  await audit(c.db, { actor: c.user.id, action: 'parasite.settings_signed', resource: 'parasite_settings', resourceId: `${fid(c)}:${sp}`, farmId: fid(c), ip: c.ip, details: { version: s.version, channel, vals: b.vals } });
  const farm = (await c.db.query('select name from farms where id = $1', [fid(c)])).rows[0];
  const owners = await c.db.query(`select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and m.role = 'owner' and m.status = 'active'`, [fid(c)]);
  for (const o of owners.rows) {
    await notify(c.db, o.id, 'settings_signed', { vet: name, species: sp });
    await sendMail(c.db, o.email, o.lang, 'settings_signed', { vet: name, farm: farm.name, species: sp === 'caprine' ? 'caprins' : 'ovins' });
  }
  return { ...s, signature_png: undefined };
}));

// ---------- Contexte des animaux (âge, gestation/allaitement, dernière note, GMQ) ----------
async function animalContexts(c: Ctx, ids?: string[]) {
  const { rows } = await c.db.query(
    `select a.id, a.internal_id, a.official_id, a.name, a.sex, a.species, a.birth_date::text as birth_date, l.name as lot_name,
            (current_date - a.birth_date) as age_days,
            (select e.famacha from parasite_exams e where e.animal_id = a.id and e.famacha is not null order by e.date desc, e.created_at desc limit 1) as previous_famacha,
            (select e.date from parasite_exams e where e.animal_id = a.id order by e.date desc limit 1) as last_exam,
            exists (select 1 from repro_events r where r.ewe_id = a.id and r.type = 'lambing' and r.date > current_date - 90) as lactating,
            exists (select 1 from repro_events r where r.ewe_id = a.id and r.type = 'pregnancy_check' and r.date > current_date - 150
                      and coalesce(lower(r.result), '') in ('positive','positif','pleine','gestante','oui','+')
                      and not exists (select 1 from repro_events r2 where r2.ewe_id = a.id and r2.type in ('lambing','abortion') and r2.date >= r.date)) as pregnant,
            (select round(((l.weight_kg - f.weight_kg) * 1000 / nullif(l.date - f.date, 0))::numeric, 0)
               from (select weight_kg, date from weighings where animal_id = a.id order by date asc, created_at asc limit 1) f,
                    (select weight_kg, date from weighings where animal_id = a.id order by date desc, created_at desc limit 1) l) as gmq
       from animals a left join lots l on l.id = a.lot_id
      where a.farm_id = $1 and a.status = 'active' ${ids ? 'and a.id = any($2)' : ''}
      order by a.internal_id`, ids ? [fid(c), ids] : [fid(c)]);
  return rows.map((r) => ({ ...r, gmq: r.gmq === null ? null : Number(r.gmq), age_days: r.age_days === null ? null : Number(r.age_days), pregnant_or_lactating: r.sex === 'F' && (r.lactating || r.pregnant) }));
}

/** % d'animaux en FAMACHA ≥ seuil parmi les examens de la date (alerte troupeau). */
async function herdAlert(c: Ctx, date: string, s: Record<Species, ParasiteSettings>) {
  const { rows } = await c.db.query(
    `select a.species, e.famacha from parasite_exams e join animals a on a.id = e.animal_id where e.farm_id = $1 and e.date = $2 and e.famacha is not null`, [fid(c), date]);
  const out: Record<string, { pct: number | null; n: number; alert: boolean }> = {};
  for (const sp of ['ovine', 'caprine'] as const) {
    const xs = rows.filter((r) => r.species === sp);
    const hi = xs.filter((r) => r.famacha >= s[sp].famacha_treat_from).length;
    const pct = xs.length ? Math.round((hi / xs.length) * 1000) / 10 : null;
    out[sp] = { pct, n: xs.length, alert: pct !== null && pct > s[sp].herd_alert_pct };
  }
  return out;
}

parasiteRouter.get('/parasite/context', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const s = { ovine: await settingsFor(c, 'ovine'), caprine: await settingsFor(c, 'caprine') };
  return { animals: await animalContexts(c), settings: s, herd: await herdAlert(c, today(), s) };
}));

// ---------- Examens « 5 points » ----------
const zExam = z.object({
  animal_id: z.string().uuid(), date: zDate, famacha: z.number().int().min(1).max(5).nullable(), bcs: z.number().min(1).max(5).multipleOf(0.5).nullable(),
  dag: z.number().int().min(0).max(3).nullable(), jaw_edema: z.boolean().default(false), nasal: z.boolean().default(false), note: zOptText(500),
});

parasiteRouter.post('/parasite/exams', h(async (c) => {
  await editor(c);
  const b = parse(zExam, c.req.body);
  if (b.date > today()) throw bad('date_in_future');
  if (b.famacha === null && b.bcs === null && b.dag === null && !b.jaw_edema && !b.nasal) throw bad('exam_empty');
  const [a] = await animalContexts(c, [b.animal_id]);
  if (!a) throw notFound('animal_not_found');
  if (a.birth_date && b.date < a.birth_date) throw bad('date_before_birth');
  const s = await settingsFor(c, a.species);
  const d = decide(b, a, s, (await herdAlert(c, b.date, { ovine: s, caprine: s }))[a.species]?.alert ?? false);
  // un seul examen par animal et par jour : le nouvel examen remplace le précédent
  await c.db.query('delete from parasite_exams where farm_id = $1 and animal_id = $2 and date = $3', [fid(c), b.animal_id, b.date]);
  const { rows } = await c.db.query(
    `insert into parasite_exams (farm_id, animal_id, date, famacha, bcs, dag, jaw_edema, nasal, decision, reasons, note, author_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [fid(c), b.animal_id, b.date, b.famacha, b.bcs, b.dag, b.jaw_edema, b.nasal, d.decision, d.reasons, b.note, c.user.id]);
  return rows[0];
}));

parasiteRouter.delete('/parasite/exams/:id', h(async (c) => {
  await editor(c);
  const { rowCount } = await c.db.query('delete from parasite_exams where id = $1 and farm_id = $2', [c.req.params.id, fid(c)]);
  if (!rowCount) throw notFound();
  return { ok: true };
}));

/** Bilan d'une tournée : décisions recalculées avec l'alerte troupeau de la journée. */
parasiteRouter.get('/parasite/summary', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const dates = (await c.db.query(`select date::text, count(*)::int n from parasite_exams where farm_id = $1 group by date order by date desc limit 12`, [fid(c)])).rows;
  const date = typeof c.req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.req.query.date) ? c.req.query.date : dates[0]?.date ?? null;
  const s = { ovine: await settingsFor(c, 'ovine'), caprine: await settingsFor(c, 'caprine') };
  if (!date) return { date: null, dates, exams: [], herd: null, counts: { treat: 0, watch: 0, none: 0 }, next_date: null };
  const herd = await herdAlert(c, date, s);
  const { rows } = await c.db.query(
    `select e.*, e.date::text as date, a.internal_id, a.official_id, a.name, a.species from parasite_exams e join animals a on a.id = e.animal_id
      where e.farm_id = $1 and e.date = $2 order by a.internal_id`, [fid(c), date]);
  const ctx = new Map((await animalContexts(c, rows.map((r) => r.animal_id))).map((a) => [a.id, a]));
  const exams = rows.map((e) => {
    const a = ctx.get(e.animal_id);
    const d = a ? decide({ ...e, bcs: e.bcs === null ? null : Number(e.bcs) }, { ...a, previous_famacha: null }, s[e.species as Species], herd[e.species].alert) : { decision: e.decision, reasons: e.reasons };
    return { ...e, bcs: e.bcs === null ? null : Number(e.bcs), decision: d.decision, reasons: d.reasons };
  });
  const counts = { treat: 0, watch: 0, none: 0 } as Record<string, number>;
  for (const e of exams) counts[e.decision]++;
  const anyAlert = herd.ovine.alert || herd.caprine.alert;
  const interval = Math.min(s.ovine.exam_interval_days, s.caprine.exam_interval_days);
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + (anyAlert ? Math.min(s.ovine.recheck_days, s.caprine.recheck_days) : interval));
  return { date, dates, exams, herd, counts, next_date: next.toISOString().slice(0, 10) };
}));

// ---------- Rapports de coproscopie ----------
const reportBase = `select r.*, r.sample_date::text as sample_date, r.received_date::text as received_date,
  u.first_name || ' ' || u.last_name as vet_display, sf.name as source_name, sf.sha256 as source_sha256, sf.mime as source_mime, sf.size as source_size, pf.sha256 as pdf_sha256
  from copro_reports r left join users u on u.id = r.vet_id left join files sf on sf.id = r.source_file_id left join files pf on pf.id = r.pdf_file_id`;

parasiteRouter.get('/copro', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select r.id, r.number, r.phase, r.parent_id, r.species, r.sample_date::text as sample_date, r.status, r.signed_at, r.signed_vet_name, r.farmer_ack_at,
            (select count(*)::int from copro_results x where x.report_id = r.id) as n,
            (select round(avg(x.strongyles_epg))::int from copro_results x where x.report_id = r.id) as mean_epg
       from copro_reports r where r.farm_id = $1 order by r.created_at desc limit 100`, [fid(c)]);
  return rows;
}));

parasiteRouter.post('/copro', h(async (c) => {
  await editor(c);
  const b = parse(z.object({
    phase: z.enum(['J0', 'J14', 'other']).default('J0'), parent_id: z.string().uuid().nullable().optional(), species: zSpecies.default('ovine'),
    sample_date: zDate, sample_mode: zOptText(100), reason: zOptText(300), animal_ids: z.array(z.string().uuid()).max(200).default([]),
  }), c.req.body);
  if (b.sample_date > today()) throw bad('date_in_future');
  let ids = b.animal_ids;
  if (b.parent_id) {
    const p = (await c.db.query('select id from copro_reports where id = $1 and farm_id = $2', [b.parent_id, fid(c)])).rows[0];
    if (!p) throw notFound('report_not_found');
    if (!ids.length) ids = (await c.db.query('select animal_id from copro_results where report_id = $1 and animal_id is not null order by position', [b.parent_id])).rows.map((r) => r.animal_id);
  }
  const seq = (await c.db.query(`select nextval('copro_number_seq') as n`)).rows[0].n;
  const number = `CP-${new Date().getUTCFullYear()}-${String(seq).padStart(4, '0')}`;
  const r = (await c.db.query(
    `insert into copro_reports (farm_id, number, phase, parent_id, species, sample_date, sample_mode, reason, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [fid(c), number, b.phase, b.parent_id ?? null, b.species, b.sample_date, b.sample_mode ?? 'individuel, rectal', b.reason, c.user.id])).rows[0];
  // Pré-remplissage : animaux, identifiants et derniers examens (FAMACHA, état corporel)
  const animals = ids.length ? (await c.db.query(
    `select a.id, (select e.famacha from parasite_exams e where e.animal_id = a.id and e.date <= $3 order by e.date desc limit 1) as famacha,
            (select e.bcs from parasite_exams e where e.animal_id = a.id and e.date <= $3 order by e.date desc limit 1) as bcs
       from animals a where a.farm_id = $1 and a.id = any($2) order by a.internal_id`, [fid(c), ids, b.sample_date])).rows : [];
  let i = 0;
  for (const a of animals) {
    await c.db.query('insert into copro_results (report_id, farm_id, animal_id, famacha, bcs, position) values ($1,$2,$3,$4,$5,$6)', [r.id, fid(c), a.id, a.famacha, a.bcs, i++]);
  }
  await audit(c.db, { actor: c.user.id, action: 'copro.created', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip, details: { number } });
  return getReport(c, r.id);
}));

async function getReport(c: Ctx, id: string) {
  const r = (await c.db.query(`${reportBase} where r.id = $1 and r.farm_id = $2`, [id, fid(c)])).rows[0];
  if (!r) throw notFound('report_not_found');
  const results = (await c.db.query(
    `select x.*, a.internal_id, a.official_id, a.name, a.sex, (current_date - a.birth_date) as age_days
       from copro_results x left join animals a on a.id = x.animal_id where x.report_id = $1 order by x.position, x.raw_label`, [id])).rows
    .map((x) => ({ ...x, bcs: x.bcs === null ? null : Number(x.bcs) }));
  const s = await settingsFor(c, r.species);
  let fec = null;
  if (r.parent_id) {
    const before = (await c.db.query('select animal_id, strongyles_epg from copro_results where report_id = $1 and animal_id is not null and strongyles_epg is not null', [r.parent_id])).rows;
    const m = new Map(before.map((x) => [x.animal_id, x.strongyles_epg]));
    const pairs = results.filter((x) => x.animal_id && x.strongyles_epg !== null && m.has(x.animal_id)).map((x) => ({ before: m.get(x.animal_id) as number, after: x.strongyles_epg as number }));
    fec = fecrt(pairs, s);
    const p = (await c.db.query('select number from copro_reports where id = $1', [r.parent_id])).rows[0];
    r.parent_number = p?.number;
  }
  const g = await activeVetGrant(c.db, fid(c), c.user.id);
  return { ...r, signature_png: r.status === 'signed' ? r.signature_png : undefined, results, fecrt: fec, settings: s,
    can_edit_as_vet: !!g?.scopes.includes('health') && r.status === 'draft', ai_available: extractorAvailable() };
}

parasiteRouter.get('/copro/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  return getReport(c, c.req.params.id as string);
}));

async function draftForVet(c: Ctx) {
  const v = await requireVet(c, fid(c), 'health');
  const r = (await c.db.query('select * from copro_reports where id = $1 and farm_id = $2 for update', [c.req.params.id, fid(c)])).rows[0];
  if (!r) throw notFound('report_not_found');
  if (r.status !== 'draft') throw conflict('report_signed');
  return { r, ...v };
}

const zResult = z.object({
  id: z.string().uuid().nullable().optional(), animal_id: z.string().uuid().nullable(), raw_label: zOptText(60),
  strongyles_epg: z.number().int().min(0).max(1_000_000).nullable(), nematodirus_epg: z.number().int().min(0).max(1_000_000).nullable(),
  coccidia: zOptText(20), confidence: z.enum(['high', 'medium', 'low']).nullable().optional(), corrected: z.boolean().optional(),
});

/** Le vétérinaire complète le rapport (méthode, résultats, interprétation). */
parasiteRouter.put('/copro/:id', h(async (c) => {
  const { r } = await draftForVet(c);
  const b = parse(z.object({
    lab_name: zOptText(150), lab_ref: zOptText(60), received_date: zDate.nullable().optional(), method: zOptText(200),
    detection_limit: z.number().int().min(0).max(10000).nullable().optional(), lab_comment: zOptText(2000), interpretation: zOptText(4000),
    results: z.array(zResult).max(300),
  }), c.req.body);
  await c.db.query(
    `update copro_reports set lab_name=$2, lab_ref=$3, received_date=$4, method=$5, detection_limit=$6, lab_comment=$7, interpretation=$8, vet_id=$9, updated_at=now() where id=$1`,
    [r.id, b.lab_name, b.lab_ref, b.received_date ?? null, b.method, b.detection_limit ?? null, b.lab_comment, b.interpretation, c.user.id]);
  const keep: string[] = [];
  let pos = 0;
  for (const x of b.results) {
    if (x.animal_id) {
      const ok = await c.db.query('select 1 from animals where id = $1 and farm_id = $2', [x.animal_id, fid(c)]);
      if (!ok.rowCount) throw bad('animal_not_found');
    }
    if (x.id) {
      const u = await c.db.query(
        `update copro_results set animal_id=$3, raw_label=$4, strongyles_epg=$5, nematodirus_epg=$6, coccidia=$7, confidence=coalesce($8, confidence), corrected=corrected or $9, position=$10
          where id=$1 and report_id=$2 returning id`,
        [x.id, r.id, x.animal_id, x.raw_label, x.strongyles_epg, x.nematodirus_epg, x.coccidia, x.confidence ?? null, !!x.corrected, pos++]);
      if (u.rows[0]) keep.push(u.rows[0].id);
    } else {
      const ins = await c.db.query(
        `insert into copro_results (report_id, farm_id, animal_id, raw_label, strongyles_epg, nematodirus_epg, coccidia, confidence, corrected, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [r.id, fid(c), x.animal_id, x.raw_label, x.strongyles_epg, x.nematodirus_epg, x.coccidia, x.confidence ?? null, !!x.corrected, pos++]);
      keep.push(ins.rows[0].id);
    }
  }
  await c.db.query('delete from copro_results where report_id = $1 and not (id = any($2))', [r.id, keep]);
  await audit(c.db, { actor: c.user.id, action: 'copro.updated', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip });
  return getReport(c, r.id);
}));

const sha256Buf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Dépôt du compte rendu du laboratoire : conservé tel quel, lu automatiquement, fiche pré-remplie. */
parasiteRouter.post('/copro/:id/import', h(async (c) => {
  const { r } = await draftForVet(c);
  const b = parse(z.object({ name: z.string().trim().min(1).max(150), mime: z.enum(MIMES as [string, ...string[]]), data_base64: z.string().min(10).max(28_000_000) }), c.req.body);
  const data = Buffer.from(b.data_base64, 'base64');
  if (data.length > 20 * 1024 * 1024) throw bad('file_too_large');
  const magic = data.subarray(0, 4).toString('hex');
  const okMagic = b.mime === 'application/pdf' ? data.subarray(0, 4).toString() === '%PDF' : b.mime === 'image/png' ? magic === '89504e47' : b.mime === 'image/jpeg' ? magic.startsWith('ffd8ff') : data.subarray(8, 12).toString() === 'WEBP';
  if (!okMagic) throw bad('file_type_mismatch');
  const hash = sha256Buf(data);
  const f = (await c.db.query(
    `insert into files (farm_id, kind, name, mime, size, sha256, data, uploaded_by) values ($1,'copro_source',$2,$3,$4,$5,$6,$7) returning id`,
    [fid(c), b.name, b.mime, data.length, hash, data, c.user.id])).rows[0];
  await c.db.query('update copro_reports set source_file_id = $2, vet_id = $3, updated_at = now() where id = $1', [r.id, f.id, c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'copro.source_uploaded', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip, details: { name: b.name, sha256: hash, size: data.length } });

  const animals = (await c.db.query(`select id, internal_id, official_id, name from animals where farm_id = $1 and status = 'active' order by internal_id`, [fid(c)])).rows;
  const ex = await extractLabReport({ data, mime: b.mime, candidates: animals.map((a) => ({ internal_id: a.internal_id, official_id: a.official_id, name: a.name })) });
  const existing = (await c.db.query('select * from copro_results where report_id = $1 order by position', [r.id])).rows;
  const used = new Set<string>();
  let pos = existing.length;
  let matched = 0, unmatched = 0;
  for (const x of ex.results) {
    const a = matchAnimal(x.label, x.matched_internal_id, animals);
    const conf = a ? x.confidence : 'medium';
    if (a) matched++; else unmatched++;
    const row = a ? existing.find((e) => e.animal_id === a.id && !used.has(e.id)) : null;
    if (row) {
      used.add(row.id);
      await c.db.query(`update copro_results set raw_label=$2, strongyles_epg=$3, nematodirus_epg=$4, coccidia=$5, confidence=$6 where id=$1`,
        [row.id, x.label, x.strongyles_epg, x.nematodirus_epg, x.coccidia, conf]);
    } else {
      await c.db.query(
        `insert into copro_results (report_id, farm_id, animal_id, raw_label, strongyles_epg, nematodirus_epg, coccidia, confidence, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.id, fid(c), a?.id ?? null, x.label, x.strongyles_epg, x.nematodirus_epg, x.coccidia, a ? conf : 'medium', pos++]);
    }
  }
  const recv = ex.received_date && /^\d{4}-\d{2}-\d{2}$/.test(ex.received_date) ? ex.received_date : null;
  await c.db.query(
    `update copro_reports set lab_name = coalesce($2, lab_name), lab_ref = coalesce($3, lab_ref), received_date = coalesce($4::date, received_date),
       method = coalesce($5, method), detection_limit = coalesce($6, detection_limit), lab_comment = coalesce($7, lab_comment), ai_extraction = $8, updated_at = now() where id = $1`,
    [r.id, ex.lab_name, ex.lab_ref, recv, ex.method, ex.detection_limit_epg, ex.lab_comment, JSON.stringify({ ...ex, at: new Date().toISOString(), model: config.anthropicApiKey ? config.aiModel : 'demo' })]);
  await audit(c.db, { actor: c.user.id, action: 'copro.ai_extracted', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip, details: { results: ex.results.length, matched, unmatched } });
  return { ...(await getReport(c, r.id)), import_summary: { results: ex.results.length, matched, unmatched, warnings: ex.warnings } };
}));

parasiteRouter.get('/copro/:id/files/:fileId', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const f = (await c.db.query(
    `select f.* from files f join copro_reports r on (r.source_file_id = f.id or r.pdf_file_id = f.id) where f.id = $1 and r.id = $2 and r.farm_id = $3`,
    [c.req.params.fileId, c.req.params.id, fid(c)])).rows[0];
  if (!f) throw notFound();
  c.res.setHeader('Content-Type', f.mime);
  c.res.setHeader('Content-Disposition', `${c.req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
  c.res.setHeader('X-Content-SHA256', f.sha256);
  c.res.send(f.data);
}));

parasiteRouter.post('/copro/:id/sign-code', h(async (c) => {
  const { r, profile } = await draftForVet(c);
  return issueSignCode(c, 'copro_sign', r.id, `le rapport ${r.number}`, profile.phone);
}));

/** Signature : rapport figé, PDF généré et scellé (empreinte), éleveur notifié. */
parasiteRouter.post('/copro/:id/sign', h(async (c) => {
  const { r, profile } = await draftForVet(c);
  const b = parse(z.object({ signature_png: zPng, code: z.string().trim().min(6).max(6) }), c.req.body);
  const full = await getReport(c, r.id);
  if (!full.interpretation?.trim()) throw bad('interpretation_required');
  if (!full.results.some((x: any) => x.strongyles_epg !== null)) throw bad('results_required');
  if (full.results.some((x: any) => !x.animal_id && x.strongyles_epg !== null)) throw bad('unmatched_results');
  const channel = await consumeSignCode(c, 'copro_sign', r.id, b.code);
  const signedAt = new Date().toISOString();
  const vetName = `Dr ${c.user.first_name} ${c.user.last_name}`;
  const farm = (await c.db.query(
    `select f.name, f.locality, f.ede_number, f.territory_code, (select count(*)::int from animals a where a.farm_id = f.id and a.status = 'active' and a.species = $2) as herd,
            (select u.first_name || ' ' || u.last_name from memberships m join users u on u.id = m.user_id where m.farm_id = f.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1) as owner
       from farms f where f.id = $1`, [fid(c), r.species])).rows[0];
  const catOf = (x: any) => {
    const young = x.age_days !== null && Number(x.age_days) < 183;
    return x.sex === 'F' ? (young ? (r.species === 'caprine' ? 'Chevrette' : 'Agnelle') : r.species === 'caprine' ? 'Chèvre' : 'Brebis') : (young ? (r.species === 'caprine' ? 'Chevreau' : 'Agneau') : r.species === 'caprine' ? 'Bouc' : 'Bélier');
  };
  const results = full.results.map((x: any) => ({
    animal: x.name ?? x.internal_id ?? x.raw_label ?? '-', ident: x.official_id ?? x.internal_id ?? '-', category: x.animal_id ? catOf(x) : '-',
    famacha: x.famacha, bcs: x.bcs, strongyles: x.strongyles_epg, nematodirus: x.nematodirus_epg, coccidia: x.coccidia,
  }));
  // Empreinte du contenu signé (données canoniques, indépendantes de la mise en page)
  const canonical = JSON.stringify({ number: r.number, farm: fid(c), species: r.species, sample_date: full.sample_date, vet: { id: c.user.id, ordinal: profile.ordinal_number },
    lab: { name: full.lab_name, ref: full.lab_ref, method: full.method, limit: full.detection_limit }, results, interpretation: full.interpretation, source: full.source_sha256 ?? null, signed_at: signedAt });
  const contentHash = sha256(canonical);
  const verifyUrl = `${config.publicUrl}/verifier/${r.number}`;
  const pdf = Buffer.from(await buildCoproPdf({
    number: r.number, phase: r.phase, species: r.species, sample_date: full.sample_date, sample_mode: full.sample_mode, reason: full.reason,
    farm: { name: farm.name, locality: farm.locality, ede: farm.ede_number, owner: farm.owner, territory: farm.territory_code, herd: farm.herd },
    vet: { name: vetName, ordinal: profile.ordinal_number, clinic: profile.clinic },
    lab: { name: full.lab_name, ref: full.lab_ref, received: full.received_date, method: full.method, limit: full.detection_limit, comment: full.lab_comment },
    results, fecrt: full.fecrt ? { ...full.fecrt, threshold: full.settings.fecrt_efficacy_pct } : null, threshold_epg: full.settings.copro_treat_epg,
    interpretation: full.interpretation, signature_png: b.signature_png, signed_at: signedAt, channel,
    content_hash: contentHash, verify_url: verifyUrl, source_name: full.source_name ?? null, source_sha256: full.source_sha256 ?? null,
  }));
  const pf = (await c.db.query(
    `insert into files (farm_id, kind, name, mime, size, sha256, data, uploaded_by) values ($1,'copro_signed',$2,'application/pdf',$3,$4,$5,$6) returning id`,
    [fid(c), `${r.number}.pdf`, pdf.length, sha256Buf(pdf), pdf, c.user.id])).rows[0];
  await c.db.query(
    `update copro_reports set status='signed', vet_id=$2, signature_png=$3, signed_at=$4, signed_vet_name=$5, signed_vet_ordinal=$6, signed_clinic=$7,
       pdf_file_id=$8, content_hash=$9, updated_at=now() where id=$1`,
    [r.id, c.user.id, b.signature_png, signedAt, vetName, profile.ordinal_number, profile.clinic, pf.id, contentHash]);
  await audit(c.db, { actor: c.user.id, action: 'copro.signed', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip, details: { number: r.number, hash: contentHash, channel } });
  const owners = await c.db.query(`select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and m.role in ('owner','collaborator') and m.status = 'active'`, [fid(c)]);
  for (const o of owners.rows) {
    await notify(c.db, o.id, 'copro_signed', { number: r.number, id: r.id, vet: vetName });
    await sendMail(c.db, o.email, o.lang, 'copro_signed', { number: r.number, id: r.id, vet: vetName, farm: farm.name });
  }
  return getReport(c, r.id);
}));

parasiteRouter.post('/copro/:id/ack', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const { rows } = await c.db.query(`update copro_reports set farmer_ack_at = coalesce(farmer_ack_at, now()), farmer_ack_by = coalesce(farmer_ack_by, $3)
    where id = $1 and farm_id = $2 and status = 'signed' returning id`, [c.req.params.id, fid(c), c.user.id]);
  if (!rows[0]) throw notFound();
  await audit(c.db, { actor: c.user.id, action: 'copro.acknowledged', resource: 'copro_report', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return getReport(c, rows[0].id);
}));

parasiteRouter.delete('/copro/:id', h(async (c) => {
  await editor(c);
  const r = (await c.db.query('select * from copro_reports where id = $1 and farm_id = $2 for update', [c.req.params.id, fid(c)])).rows[0];
  if (!r) throw notFound();
  if (r.status !== 'draft') throw conflict('report_signed');
  if ((await c.db.query('select 1 from copro_reports where parent_id = $1', [r.id])).rowCount) throw conflict('report_has_followup');
  await c.db.query('delete from copro_reports where id = $1', [r.id]);
  if (r.source_file_id) await c.db.query('delete from files where id = $1', [r.source_file_id]);
  await audit(c.db, { actor: c.user.id, action: 'copro.deleted', resource: 'copro_report', resourceId: r.id, farmId: fid(c), ip: c.ip, details: { number: r.number } });
  return { ok: true };
}));
