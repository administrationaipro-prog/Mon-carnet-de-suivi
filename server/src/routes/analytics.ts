import { Router } from 'express';
import { z } from 'zod';
import { h, farmAccess, parse, zDate, today, type Ctx } from '../http.js';
import { forbidden, bad } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { getSetting } from '../db.js';
import { gmqSeries, weightAtAge, mean, median, ratio, round, daysBetween, sortWeighings, toCsv, addDays } from '../lib/indicators.js';

export const analyticsRouter = Router({ mergeParams: true });
const fid = (c: Ctx) => c.req.params.farmId as string;

const zPeriod = z.object({ from: zDate.optional(), to: zDate.optional() });

function stat(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return { n: v.length, missing: values.length - v.length, mean: v.length ? round(mean(v)!, 1) : null, median: v.length ? round(median(v)!, 1) : null,
    min: v.length ? round(Math.min(...v), 1) : null, max: v.length ? round(Math.max(...v), 1) : null };
}

/** Indicateurs de l’exploitation (§8) — effectifs et données manquantes toujours affichés. */
analyticsRouter.get('/analytics', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const p = parse(zPeriod, c.req.query);
  const to = p.to ?? today();
  const from = p.from ?? addDays(to, -365);
  if (from > to) throw bad('invalid_period');
  const maxGap = await getSetting<number>(c.db, 'interpolation_max_gap_days', 30);
  const animals = (await c.db.query(
    `select a.*, b.label_fr, b.label_en,
            coalesce(json_agg(json_build_object('date', w.date, 'weight_kg', w.weight_kg) order by w.date) filter (where w.id is not null), '[]') as ws
       from animals a left join breeds b on b.code = a.breed_code left join weighings w on w.animal_id = a.id
      where a.farm_id = $1 group by a.id, b.code`, [fid(c)])).rows;

  // Population exposée sur la période : présente au moins un jour
  const exposed = animals.filter((a) => (!a.birth_date || a.birth_date <= to) && (!a.exit_date || a.exit_date >= from) && (a.birth_date || a.created_at.toISOString().slice(0, 10) <= to));
  const deaths = exposed.filter((a) => a.status === 'dead' && a.exit_date && a.exit_date >= from && a.exit_date <= to);
  const health = (await c.db.query(
    `select distinct animal_id from health_events where farm_id = $1 and date between $2 and $3 and (diagnosis_status <> 'none' or type = 'treatment' or symptoms is not null)`,
    [fid(c), from, to])).rows.map((r) => r.animal_id);
  const repro = (await c.db.query('select * from repro_events where farm_id = $1 and date between $2 and $3', [fid(c), from, to])).rows;
  const bornAlive = repro.filter((r) => r.type === 'lambing').reduce((s, r) => s + (r.born_alive ?? 0), 0);
  const weaned = repro.filter((r) => r.type === 'weaning').reduce((s, r) => s + (r.weaned ?? 0), 0);
  const ewesMated = new Set(repro.filter((r) => r.type === 'mating').map((r) => r.ewe_id)).size;
  const feed = (await c.db.query(
    `select coalesce(sum(cost_eur),0)::float cost, count(*)::int n, count(*) filter (where cost_eur is null)::int missing_cost
       from feeding_events where farm_id = $1 and start_date between $2 and $3`, [fid(c), from, to])).rows[0];

  // Gain vif mesuré dans la période (première → dernière pesée de la période)
  let gain = 0, gainAnimals = 0;
  for (const a of exposed) {
    const ws = sortWeighings(a.ws.filter((w: any) => w.date >= from && w.date <= to));
    if (ws.length >= 2) { gain += ws[ws.length - 1].weight_kg - ws[0].weight_kg; gainAnimals++; }
  }

  // Croissance par race/croisement
  const groups = new Map<string, any[]>();
  for (const a of exposed) {
    const k = a.breed_code ?? 'UNKNOWN';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  const byBreed = [...groups.entries()].map(([code, list]) => ({
    breed_code: code, label_fr: list[0].label_fr ?? 'Non renseignée', label_en: list[0].label_en ?? 'Not specified', animals: list.length,
    gmq: stat(list.map((a) => gmqSeries(a.ws).overall)),
    weight_j30: stat(list.map((a) => weightAtAge(a.birth_date, a.ws, 30, maxGap))),
    weight_j60: stat(list.map((a) => weightAtAge(a.birth_date, a.ws, 60, maxGap))),
    weight_j90: stat(list.map((a) => weightAtAge(a.birth_date, a.ws, 90, maxGap))),
  })).sort((a, b) => b.animals - a.animals);

  // Complétude : champs attendus renseignés / total attendu
  const fields = ['official_id', 'birth_date', 'breed_code', 'sex'];
  let filled = 0, expected = 0;
  for (const a of exposed) {
    for (const f of fields) { expected++; if (a[f]) filled++; }
    expected += 2; if (a.sire_id || a.sire_external) filled++; if (a.dam_id || a.dam_external) filled++;
    expected++; if (a.ws.length) filled++;
  }

  const curves = exposed.filter((a) => a.ws.length && a.birth_date).map((a) => ({
    id: a.id, label: a.name ?? a.internal_id, breed_code: a.breed_code,
    points: a.ws.map((w: any) => ({ age: daysBetween(a.birth_date, w.date), weight: w.weight_kg, date: w.date })),
  }));

  return {
    period: { from, to },
    population: { exposed: exposed.length, active: exposed.filter((a) => a.status === 'active').length },
    indicators: {
      mortality: { value: ratio(deaths.length, exposed.length), num: deaths.length, den: exposed.length },
      morbidity: { value: ratio(health.length, exposed.length), num: health.length, den: exposed.length },
      weaning_rate: { value: ratio(weaned, bornAlive), num: weaned, den: bornAlive },
      maternal_productivity: { value: ratio(weaned, ewesMated), num: weaned, den: ewesMated },
      feed_cost_per_kg: { value: gain > 0 && feed.n > 0 ? round(feed.cost / gain, 2) : null, cost: round(feed.cost, 2), gain_kg: round(gain, 2),
        animals_with_gain: gainAnimals, feeding_records: feed.n, records_without_cost: feed.missing_cost },
      completeness: { value: ratio(filled, expected), num: filled, den: expected },
    },
    growth_by_breed: byBreed,
    curves,
    notice: 'descriptive_only',
  };
}));

// ---------- Exports CSV (réservés à l’exploitation) ----------
const H: Record<string, Record<'fr' | 'en', string[]>> = {
  animals: {
    fr: ['identifiant_interne', 'identification_officielle', 'nom', 'sexe', 'date_naissance', 'race_code', 'race_declaree', 'objectif', 'statut', 'date_sortie', 'motif_sortie', 'pere', 'mere', 'pere_externe', 'mere_externe', 'source_filiation', 'certitude_filiation', 'lot', 'poids_naissance_kg', 'taille_portee'],
    en: ['internal_id', 'official_id', 'name', 'sex', 'birth_date', 'breed_code', 'declared_breed', 'objective', 'status', 'exit_date', 'exit_reason', 'sire', 'dam', 'external_sire', 'external_dam', 'parentage_source', 'parentage_certainty', 'lot', 'birth_weight_kg', 'litter_size'],
  },
  weighings: {
    fr: ['identifiant_interne', 'date', 'poids_kg', 'hauteur_cm', 'longueur_cm', 'operateur', 'provenance', 'note', 'cree_le'],
    en: ['internal_id', 'date', 'weight_kg', 'height_cm', 'length_cm', 'operator', 'source', 'note', 'created_at'],
  },
  feeding: {
    fr: ['animal', 'lot', 'aliment', 'quantite_kg', 'base', 'type', 'frequence', 'eau', 'debut', 'fin', 'cout_eur', 'note'],
    en: ['animal', 'lot', 'feed', 'quantity_kg', 'basis', 'kind', 'frequency', 'water', 'start', 'end', 'cost_eur', 'note'],
  },
  health: {
    fr: ['animal', 'date', 'type', 'symptomes', 'statut_diagnostic', 'diagnostic', 'analyse', 'resultat', 'famacha', 'etat_corporel', 'traitement', 'produit', 'dose', 'delai_attente_j', 'suivi_le', 'note'],
    en: ['animal', 'date', 'type', 'symptoms', 'diagnosis_status', 'diagnosis', 'analysis', 'result', 'famacha', 'body_condition', 'treatment', 'product', 'dose', 'withdrawal_days', 'followup_date', 'note'],
  },
  repro: {
    fr: ['brebis', 'type', 'date', 'belier', 'resultat', 'nes_vivants', 'nes_morts', 'sevres', 'note'],
    en: ['ewe', 'type', 'date', 'ram', 'result', 'born_alive', 'born_dead', 'weaned', 'note'],
  },
};

analyticsRouter.get('/export/:kind.csv', h(async (c) => {
  const role = await farmAccess(c, fid(c), 'read');
  if (role === 'admin_grant') throw forbidden('export_reserved_to_farm');
  const kind = c.req.params.kind as string;
  const lang = c.req.query.lang === 'en' ? 'en' : c.req.query.lang === 'fr' ? 'fr' : c.user.lang;
  if (!H[kind]) throw bad('unknown_export');
  const f = fid(c);
  let rows: unknown[][] = [];
  if (kind === 'animals') {
    rows = (await c.db.query(
      `select a.internal_id, a.official_id, a.name, a.sex, a.birth_date, a.breed_code, a.breed_declared, a.objective, a.status, a.exit_date, a.exit_reason,
              s.internal_id, d.internal_id, a.sire_external, a.dam_external, a.parentage_source, a.parentage_certainty, l.name, b.birth_weight_kg, b.litter_size
         from animals a left join animals s on s.id = a.sire_id left join animals d on d.id = a.dam_id left join lots l on l.id = a.lot_id
         left join births b on b.animal_id = a.id where a.farm_id = $1 order by a.internal_id`, [f])).rows.map(Object.values);
  } else if (kind === 'weighings') {
    rows = (await c.db.query(
      `select a.internal_id, w.date, w.weight_kg, w.height_cm, w.length_cm, u.first_name || ' ' || u.last_name, w.source, w.note, w.created_at
         from weighings w join animals a on a.id = w.animal_id left join users u on u.id = w.operator_id where w.farm_id = $1 order by a.internal_id, w.date`, [f])).rows.map(Object.values);
  } else if (kind === 'feeding') {
    rows = (await c.db.query(
      `select a.internal_id, l.name, fe.feed, fe.quantity_kg, fe.basis, fe.kind, fe.frequency, fe.water, fe.start_date, fe.end_date, fe.cost_eur, fe.note
         from feeding_events fe left join animals a on a.id = fe.animal_id left join lots l on l.id = fe.lot_id where fe.farm_id = $1 order by fe.start_date`, [f])).rows.map(Object.values);
  } else if (kind === 'health') {
    rows = (await c.db.query(
      `select a.internal_id, h.date, h.type, h.symptoms, h.diagnosis_status, h.diagnosis, h.analysis_type, h.analysis_result, h.famacha, h.body_condition,
              h.treatment, h.product, h.dose, h.withdrawal_days, h.followup_date, h.note
         from health_events h join animals a on a.id = h.animal_id where h.farm_id = $1 order by h.date`, [f])).rows.map(Object.values);
  } else {
    rows = (await c.db.query(
      `select e.internal_id, r.type, r.date, ram.internal_id, r.result, r.born_alive, r.born_dead, r.weaned, r.note
         from repro_events r join animals e on e.id = r.ewe_id left join animals ram on ram.id = r.ram_id where r.farm_id = $1 order by r.date`, [f])).rows.map(Object.values);
  }
  await audit(c.db, { actor: c.user.id, action: 'export.csv', resource: kind, farmId: f, details: { rows: rows.length }, ip: c.ip });
  c.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  c.res.setHeader('Content-Disposition', `attachment; filename="${kind}-${today()}.csv"`);
  c.res.send(toCsv(H[kind][lang], rows));
}));

// ---------- Statistiques collectives (agrégats consentis) ----------
export const collectiveRouter = Router();

async function canSeeCollective(c: Ctx) {
  if (['admin', 'analyst'].includes(c.user.platform_role)) return;
  const m = await c.db.query(`select 1 from memberships m join farms f on f.id = m.farm_id where m.user_id = $1 and m.status = 'active' and f.status = 'active'`, [c.user.id]);
  if (!m.rowCount) throw forbidden('collective_access_denied');
}

async function computeCollective(c: Ctx, territory: string | null) {
  const minFarms = await getSetting<number>(c.db, 'aggregation_min_farms', 5);
  const maxGap = await getSetting<number>(c.db, 'interpolation_max_gap_days', 30);
  // Double filtrage : la RLS (contexte « aggregate ») ET la jointure explicite sur les consentements actifs couvrant la catégorie « growth ».
  const params: unknown[] = [];
  let terr = `and c.scope = 'all'`;
  if (territory) { params.push(territory); terr = `and f.territory_code = $1`; }
  const { rows } = await c.db.query(
    `select a.farm_id, a.breed_code, a.birth_date, b.label_fr, b.label_en,
            coalesce(json_agg(json_build_object('date', w.date, 'weight_kg', w.weight_kg) order by w.date) filter (where w.id is not null), '[]') as ws
       from animals a
       join farms f on f.id = a.farm_id and f.status = 'active'
       join consents c on c.farm_id = a.farm_id and c.purpose = 'collective_stats' and c.revoked_at is null
            and (c.expires_at is null or c.expires_at > now()) and 'growth' = any(c.categories) ${terr}
       left join breeds b on b.code = a.breed_code
       left join weighings w on w.animal_id = a.id
      group by a.id, b.code`, params);
  const groups = new Map<string, any[]>();
  for (const r of rows) { const k = r.breed_code ?? 'UNKNOWN'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const participating = new Set(rows.map((r) => r.farm_id)).size;
  const out = [...groups.entries()].map(([code, list]) => {
    const farms = new Set(list.map((r) => r.farm_id)).size;
    const base = { breed_code: code, label_fr: list[0].label_fr ?? 'Non renseignée', label_en: list[0].label_en ?? 'Not specified' };
    if (farms < minFarms) return { ...base, suppressed: true, reason: 'below_threshold' }; // aucune valeur, même pas l’effectif exact
    const g = list.map((r) => gmqSeries(r.ws).overall);
    const j30 = list.map((r) => weightAtAge(r.birth_date, r.ws, 30, maxGap));
    const j60 = list.map((r) => weightAtAge(r.birth_date, r.ws, 60, maxGap));
    return { ...base, suppressed: false, farms, animals: list.length, gmq: stat(g), weight_j30: stat(j30), weight_j60: stat(j60) };
  });
  return { territory, min_farms: minFarms, participating_farms: participating >= minFarms ? participating : null, groups: out, notice: 'no_causal_inference' };
}

collectiveRouter.get('/stats', h(async (c) => {
  await canSeeCollective(c);
  const territory = typeof c.req.query.territory === 'string' && c.req.query.territory ? c.req.query.territory : null;
  const r = await computeCollective(c, territory);
  await audit(c.db, { actor: c.user.id, action: 'collective.viewed', resource: 'collective_stats', details: { territory }, ip: c.ip });
  return r;
}, { ctx: 'aggregate' }));

collectiveRouter.get('/stats.csv', h(async (c) => {
  await canSeeCollective(c);
  const territory = typeof c.req.query.territory === 'string' && c.req.query.territory ? c.req.query.territory : null;
  const r = await computeCollective(c, territory);
  const en = c.user.lang === 'en';
  const head = en ? ['breed', 'farms', 'animals', 'gmq_n', 'gmq_mean_g_d', 'gmq_median', 'gmq_missing', 'w30_n', 'w30_mean_kg', 'w60_n', 'w60_mean_kg']
    : ['race', 'exploitations', 'animaux', 'gmq_n', 'gmq_moyen_g_j', 'gmq_median', 'gmq_manquants', 'p30_n', 'p30_moyen_kg', 'p60_n', 'p60_moyen_kg'];
  const rows = r.groups.filter((g: any) => !g.suppressed).map((g: any) => [en ? g.label_en : g.label_fr, g.farms, g.animals, g.gmq.n, g.gmq.mean, g.gmq.median, g.gmq.missing, g.weight_j30.n, g.weight_j30.mean, g.weight_j60.n, g.weight_j60.mean]);
  await audit(c.db, { actor: c.user.id, action: 'export.collective_csv', resource: 'collective_stats', details: { territory }, ip: c.ip });
  c.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  c.res.setHeader('Content-Disposition', `attachment; filename="statistiques-collectives-${today()}.csv"`);
  c.res.send(toCsv(head, rows));
}, { ctx: 'aggregate' }));
