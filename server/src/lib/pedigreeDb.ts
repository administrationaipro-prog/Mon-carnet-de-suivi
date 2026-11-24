import type { Db } from '../db.js';
import { getSetting } from '../db.js';
import { Pedigree } from './pedigree.js';

/** Généalogie complète d'une exploitation (les parents sont toujours de la même exploitation : clés étrangères composites). */
export async function loadPedigree(db: Db, farmId: string): Promise<Pedigree> {
  const { rows } = await db.query('select id, sire_id, dam_id from animals where farm_id = $1', [farmId]);
  return new Pedigree(rows);
}

/** Seuils de consanguinité en % : alerte à partir de `warn`, refus d'enregistrement au-delà de `max`. */
export async function inbreedingLimits(db: Db): Promise<{ warn: number; max: number }> {
  return {
    warn: Number(await getSetting<number>(db, 'inbreeding_warn_percent', 6.25)),
    max: Number(await getSetting<number>(db, 'inbreeding_max_percent', 12.5)),
  };
}
