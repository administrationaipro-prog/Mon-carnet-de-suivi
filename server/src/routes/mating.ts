import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, zDate, zUuid, today, type Ctx } from '../http.js';
import { bad, notFound } from '../lib/errors.js';
import { Pedigree, inbreedingVerdict, toPercent } from '../lib/pedigree.js';
import { inbreedingLimits } from '../lib/pedigreeDb.js';
import { gmqSeries, weightAtAge, addDays, mean, round, wilson } from '../lib/indicators.js';
import { getSetting } from '../db.js';

export const matingRouter = Router({ mergeParams: true });
const fid = (c: Ctx) => c.req.params.farmId as string;

const MIN_N = 3; // en dessous, on n'affiche pas de probabilité : trop peu de saillies observées
const GESTATION_DAYS = 150;

/**
 * Simulateur de saillie : lecture seule, aucune donnée n'est enregistrée.
 * - consanguinité attendue de l'agneau (= parenté bélier × brebis), ancêtres communs, verdict vs limites ;
 * - performances OBSERVÉES (parents, descendants) — descriptives : l'héritabilité n'est pas appliquée ;
 * - taux de réussite historique des saillies (saillies suivies d'une mise bas 100–200 j plus tard), avec intervalle et effectif.
 */
matingRouter.get('/mating-simulator', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const q = parse(z.object({ ram: zUuid, ewe: zUuid, date: zDate.optional() }), c.req.query);
  const f = fid(c);

  const animals = (await c.db.query('select id, internal_id, name, sex, birth_date, status, sire_id, dam_id, breed_code from animals where farm_id = $1', [f])).rows;
  const byId = new Map(animals.map((a) => [a.id, a]));
  const ram = byId.get(q.ram), ewe = byId.get(q.ewe);
  if (!ram || !ewe) throw notFound('animal_not_found');
  if (ram.sex !== 'M') throw bad('sire_must_be_male');
  if (ewe.sex !== 'F') throw bad('dam_must_be_female');
  const label = (a: any) => a.name ?? a.internal_id;

  // ---- Consanguinité ----
  const ped = new Pedigree(animals);
  let kin: number, rel: number, common: { id: string; gen_a: number; gen_b: number }[];
  try { kin = ped.kinship(ram.id, ewe.id); rel = ped.relationship(ram.id, ewe.id); common = ped.commonAncestors(ram.id, ewe.id); }
  catch { throw bad('pedigree_cycle'); }
  const lim = await inbreedingLimits(c.db);
  const verdict = inbreedingVerdict(kin, lim.warn, lim.max);

  // ---- Performances observées ----
  const maxGap = await getSetting<number>(c.db, 'interpolation_max_gap_days', 30);
  const ws = (await c.db.query('select animal_id, date, weight_kg from weighings where farm_id = $1 order by date', [f])).rows;
  const wsBy = new Map<string, { date: string; weight_kg: number }[]>();
  for (const w of ws) { if (!wsBy.has(w.animal_id)) wsBy.set(w.animal_id, []); wsBy.get(w.animal_id)!.push({ date: w.date, weight_kg: w.weight_kg }); }
  const births = new Map((await c.db.query('select animal_id, birth_weight_kg from births where farm_id = $1 and birth_weight_kg is not null', [f])).rows.map((r) => [r.animal_id, r.birth_weight_kg as number]));
  const own = (a: any) => { const w = wsBy.get(a.id) ?? []; return { weighings: w.length, gmq: gmqSeries(w).overall, weight_j90: weightAtAge(a.birth_date, w, 90, maxGap) }; };
  const stats = (kids: any[]) => {
    const g = kids.map((k) => gmqSeries(wsBy.get(k.id) ?? []).overall).filter((x): x is number => x !== null);
    const b = kids.map((k) => births.get(k.id)).filter((x): x is number => x !== undefined);
    return { n: kids.length, gmq_n: g.length, gmq_mean: g.length ? round(mean(g)!, 0) : null, birth_weight_n: b.length, birth_weight_mean: b.length ? round(mean(b)!, 2) : null };
  };
  const ramOwn = own(ram), eweOwn = own(ewe);
  const midparent = ramOwn.gmq !== null && eweOwn.gmq !== null ? round((ramOwn.gmq + eweOwn.gmq) / 2, 0) : null;

  // ---- Reproduction : taux de réussite historique ----
  const repro = (await c.db.query('select ewe_id, ram_id, type, date, born_alive from repro_events where farm_id = $1', [f])).rows;
  const t = today();
  const lambings = repro.filter((r) => r.type === 'lambing');
  const outcome = (matings: any[]) => {
    let n = 0, k = 0;
    for (const m of matings) {
      if (addDays(m.date, 200) > t) continue; // issue pas encore connue : non comptée
      n++;
      if (lambings.some((l) => l.ewe_id === m.ewe_id && l.date >= addDays(m.date, 100) && l.date <= addDays(m.date, 200))) k++;
    }
    return { n, k, rate: n ? round(k / n, 3) : null, ci: wilson(k, n) };
  };
  const matings = repro.filter((r) => r.type === 'mating');
  const eweOut = outcome(matings.filter((m) => m.ewe_id === ewe.id)), ramOut = outcome(matings.filter((m) => m.ram_id === ram.id)), farmOut = outcome(matings);
  const basis = eweOut.n >= MIN_N ? 'ewe' : farmOut.n >= MIN_N ? 'farm' : null;
  const chosen = basis === 'ewe' ? eweOut : basis === 'farm' ? farmOut : null;
  const litter = (rows: any[]) => { const v = rows.map((l) => l.born_alive).filter((x) => x !== null); return { n: v.length, mean: v.length ? round(mean(v)!, 2) : null }; };

  return {
    ram: { id: ram.id, internal_id: ram.internal_id, name: ram.name, breed_code: ram.breed_code, status: ram.status },
    ewe: { id: ewe.id, internal_id: ewe.internal_id, name: ewe.name, breed_code: ewe.breed_code, status: ewe.status },
    inbreeding: {
      coefficient_percent: toPercent(kin), level: verdict, would_be_refused: verdict === 'refused', limit_percent: lim.max, warn_percent: lim.warn,
      relationship_percent: toPercent(rel),
      common_ancestors: common.slice(0, 12).map((x) => ({ id: x.id, label: label(byId.get(x.id)), sex: byId.get(x.id)?.sex, gen_ram: x.gen_a, gen_ewe: x.gen_b })),
      pedigree: { ram_generations: ped.depth(ram.id), ewe_generations: ped.depth(ewe.id), ram_completeness: round(ped.completeness(ram.id, 3), 2), ewe_completeness: round(ped.completeness(ewe.id, 3), 2) },
    },
    performance: {
      ram: { ...ramOwn, progeny: stats(animals.filter((a) => a.sire_id === ram.id)) },
      ewe: { ...eweOwn, progeny: stats(animals.filter((a) => a.dam_id === ewe.id)) },
      pair_progeny: stats(animals.filter((a) => a.sire_id === ram.id && a.dam_id === ewe.id)),
      midparent_gmq: midparent,
    },
    reproduction: {
      mating_date: q.date ?? t, expected_lambing_date: addDays(q.date ?? t, GESTATION_DAYS), min_n: MIN_N,
      success: { basis, rate: chosen?.rate ?? null, k: chosen?.k ?? 0, n: chosen?.n ?? 0, ci: chosen?.ci ?? null, ewe: eweOut, ram: ramOut, farm: farmOut },
      litter: { ewe: litter(lambings.filter((l) => l.ewe_id === ewe.id)), farm: litter(lambings) },
    },
    notice: 'estimates_only',
  };
}));
