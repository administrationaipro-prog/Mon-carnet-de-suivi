import type { Db } from '../db.js';
import { getSetting } from '../db.js';
import { Pedigree, inbreedingVerdict, toPercent, type PedNode } from './pedigree.js';
import { inbreedingLimits } from './pedigreeDb.js';
import { gmqSeries, weightAtAge, addDays, mean, round, wilson } from './indicators.js';

/**
 * Saillie entre deux élevages : généalogies réunies et performances observées.
 * Les données de l'autre élevage ne sont lues que par le serveur (contexte « breeding_service »)
 * et seuls des résultats agrégés sortent : identité et généalogie de l'animal partagé, performances,
 * pourcentages. La santé n'est jamais lue.
 */
export type FarmData = {
  farmId: string;
  animals: any[];
  byId: Map<string, any>;
  wsBy: Map<string, { date: string; weight_kg: number }[]>;
  births: Map<string, number>;
  repro: any[];
};

export async function loadFarmData(db: Db, farmId: string): Promise<FarmData> {
  const animals = (await db.query(
    `select id, farm_id, internal_id, official_id, name, sex, species, birth_date, status, sire_id, dam_id, sire_external, dam_external, breed_code
       from animals where farm_id = $1`, [farmId])).rows;
  const ws = (await db.query('select animal_id, date, weight_kg from weighings where farm_id = $1 order by date', [farmId])).rows;
  const wsBy = new Map<string, { date: string; weight_kg: number }[]>();
  for (const w of ws) { if (!wsBy.has(w.animal_id)) wsBy.set(w.animal_id, []); wsBy.get(w.animal_id)!.push({ date: w.date, weight_kg: Number(w.weight_kg) }); }
  const births = new Map<string, number>((await db.query('select animal_id, birth_weight_kg from births where farm_id = $1 and birth_weight_kg is not null', [farmId])).rows.map((r) => [r.animal_id, Number(r.birth_weight_kg)]));
  const repro = (await db.query('select ewe_id, ram_id, type, date, born_alive from repro_events where farm_id = $1', [farmId])).rows;
  return { farmId, animals, byId: new Map(animals.map((a) => [a.id, a])), wsBy, births, repro };
}

/** Numéro officiel normalisé (lettres et chiffres, au moins 6 chiffres), sinon null. */
export function normOfficial(v: string | null | undefined): string | null {
  const s = (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (s.match(/\d/g)?.length ?? 0) >= 6 ? s : null;
}

/**
 * Généalogie réunie : un même animal présent dans les deux élevages (ou cité comme parent externe)
 * est reconnu par son numéro officiel ; sinon chaque fiche reste distincte.
 */
export function mergedPedigree(sets: FarmData[]) {
  const key = (d: FarmData, a: any) => { const o = normOfficial(a.official_id); return o ? `O:${o}` : `I:${d.farmId}:${a.id}`; };
  const nodes = new Map<string, PedNode>();
  const labels = new Map<string, { label: string; official: string | null; sex: string | null }>();
  const keyOf = new Map<string, string>();
  for (const d of sets) for (const a of d.animals) keyOf.set(a.id, key(d, a));
  const put = (k: string, sire: string | null, dam: string | null) => {
    const cur = nodes.get(k);
    nodes.set(k, { id: k, sire_id: cur?.sire_id ?? sire, dam_id: cur?.dam_id ?? dam });
  };
  for (const d of sets) for (const a of d.animals) {
    const k = keyOf.get(a.id)!;
    const ext = (v: string | null) => { const o = normOfficial(v); if (!o) return null; const ek = `O:${o}`; if (!nodes.has(ek)) put(ek, null, null); if (!labels.has(ek)) labels.set(ek, { label: v!, official: v, sex: null }); return ek; };
    const sire = a.sire_id ? keyOf.get(a.sire_id) ?? null : ext(a.sire_external);
    const dam = a.dam_id ? keyOf.get(a.dam_id) ?? null : ext(a.dam_external);
    put(k, sire, dam);
    if (!labels.has(k) || labels.get(k)!.label === labels.get(k)!.official) labels.set(k, { label: a.name ?? a.internal_id, official: a.official_id, sex: a.sex });
  }
  return { ped: new Pedigree([...nodes.values()]), keyOf, labels };
}

export async function crossInbreeding(db: Db, a: { data: FarmData; id: string }, b: { data: FarmData; id: string }, merged?: ReturnType<typeof mergedPedigree>, limits?: { warn: number; max: number }) {
  const sets = a.data.farmId === b.data.farmId ? [a.data] : [a.data, b.data];
  const { ped, keyOf, labels } = merged ?? mergedPedigree(sets);
  const ka = keyOf.get(a.id)!, kb = keyOf.get(b.id)!;
  if (ka === kb) throw new Error('same_animal');
  let kin: number, rel: number, common: { id: string; gen_a: number; gen_b: number }[];
  try { kin = ped.kinship(ka, kb); rel = ped.relationship(ka, kb); common = ped.commonAncestors(ka, kb); }
  catch { throw new Error('pedigree_cycle'); }
  const lim = limits ?? await inbreedingLimits(db);
  const level = inbreedingVerdict(kin, lim.warn, lim.max);
  return {
    coefficient_percent: toPercent(kin), level, would_be_refused: level === 'refused', limit_percent: lim.max, warn_percent: lim.warn,
    relationship_percent: toPercent(rel),
    common_ancestors: common.slice(0, 8).map((x) => ({ label: labels.get(x.id)?.label ?? '—', official: labels.get(x.id)?.official ?? null, gen_a: x.gen_a, gen_b: x.gen_b })),
    pedigree: { a_generations: ped.depth(ka), b_generations: ped.depth(kb), a_completeness: round(ped.completeness(ka, 3), 2), b_completeness: round(ped.completeness(kb, 3), 2) },
  };
}

/** Performances observées d'un reproducteur dans son élevage (descriptives, sans héritabilité). */
export async function performance(db: Db, d: FarmData, id: string) {
  const a = d.byId.get(id);
  const maxGap = await getSetting<number>(db, 'interpolation_max_gap_days', 30);
  const w = d.wsBy.get(id) ?? [];
  const kids = d.animals.filter((k) => (a.sex === 'M' ? k.sire_id === id : k.dam_id === id));
  const kg = kids.map((k) => gmqSeries(d.wsBy.get(k.id) ?? []).overall).filter((x): x is number => x !== null);
  const kb = kids.map((k) => d.births.get(k.id)).filter((x): x is number => x !== undefined);
  const today = new Date().toISOString().slice(0, 10);
  const lambings = d.repro.filter((r) => r.type === 'lambing');
  const matings = d.repro.filter((r) => r.type === 'mating' && (a.sex === 'M' ? r.ram_id === id : r.ewe_id === id));
  let n = 0, k = 0;
  for (const m of matings) {
    if (addDays(m.date, 200) > today) continue;
    n++;
    if (lambings.some((l) => l.ewe_id === m.ewe_id && l.date >= addDays(m.date, 100) && l.date <= addDays(m.date, 200))) k++;
  }
  const litters = a.sex === 'F' ? lambings.filter((l) => l.ewe_id === id).map((l) => l.born_alive).filter((x) => x !== null) : [];
  return {
    weighings: w.length, gmq: gmqSeries(w).overall,
    weight_j30: weightAtAge(a.birth_date, w, 30, maxGap), weight_j90: weightAtAge(a.birth_date, w, 90, maxGap),
    progeny: { n: kids.length, gmq_n: kg.length, gmq_mean: kg.length ? round(mean(kg)!, 0) : null, gmq_min: kg.length ? Math.min(...kg) : null, gmq_max: kg.length ? Math.max(...kg) : null,
      birth_weight_mean: kb.length ? round(mean(kb)!, 2) : null },
    success: { n, k, rate: n >= 3 ? round(k / n, 3) : null, ci: wilson(k, n) },
    litter: { n: litters.length, mean: litters.length ? round(mean(litters)!, 2) : null },
  };
}

/** Estimation indicative de l'agneau : moyenne des deux parents, recoupée avec leurs descendants. */
export function lambEstimate(pa: Awaited<ReturnType<typeof performance>>, pb: Awaited<ReturnType<typeof performance>>, female: 'a' | 'b') {
  const avg = (x: number | null, y: number | null, dg = 0) => (x !== null && y !== null ? round((x + y) / 2, dg) : x ?? y ?? null);
  const progenyGmq = [pa.progeny.gmq_mean, pb.progeny.gmq_mean].filter((x): x is number => x !== null);
  const parentGmq = avg(pa.gmq, pb.gmq);
  const gmq = progenyGmq.length && parentGmq !== null ? round((parentGmq + mean(progenyGmq)!) / 2, 0) : parentGmq ?? (progenyGmq.length ? round(mean(progenyGmq)!, 0) : null);
  const lows = [pa.progeny.gmq_min, pb.progeny.gmq_min].filter((x): x is number => x !== null);
  const highs = [pa.progeny.gmq_max, pb.progeny.gmq_max].filter((x): x is number => x !== null);
  const nKids = pa.progeny.gmq_n + pb.progeny.gmq_n;
  return {
    gmq, weight_j30: avg(pa.weight_j30, pb.weight_j30, 1), weight_j90: avg(pa.weight_j90, pb.weight_j90, 1),
    gmq_range: lows.length ? { low: Math.round(Math.min(...lows)), high: Math.round(Math.max(...highs)) } : null,
    litter: (female === 'a' ? pa : pb).litter.mean,
    reliability: nKids >= 15 ? 'good' : nKids >= 5 ? 'medium' : 'low', progeny_weighed: nKids,
  };
}

/** Résumé public d'un animal partagé (jamais de santé, d'adresse ni de téléphone). */
export function publicAnimal(a: any) {
  const age = a.birth_date ? Math.floor((Date.now() - Date.parse(a.birth_date + 'T12:00:00Z')) / 86400000) : null;
  return { id: a.id, name: a.name, internal_id: a.internal_id, official_id: a.official_id, sex: a.sex, species: a.species, breed_code: a.breed_code, birth_date: a.birth_date, age_days: age };
}
