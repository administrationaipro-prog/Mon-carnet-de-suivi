/**
 * Aide à la décision parasitaire (traitement ciblé sélectif). Ce n'est jamais une prescription :
 * la décision de traiter, le produit et la dose relèvent du vétérinaire.
 * Références des valeurs par défaut : guides FAMACHA© (UF/IFAS, NC State, Cornell), Five Point Check,
 * INRAE Antilles (chèvre créole), WAAVP 2023 (test de réduction de l'excrétion fécale).
 */
export type Species = 'ovine' | 'caprine';
export type ParasiteSettings = {
  famacha_treat_from: number; famacha_conditional: number;
  cond_young: boolean; cond_pregnant_lactating: boolean; cond_bcs_max: number | null; cond_rising: boolean;
  herd_alert_pct: number; exam_interval_days: number; recheck_days: number;
  famacha_min_age_months: number; young_min_gmq: number | null;
  copro_treat_epg: number | null; dag_flag_from: number; jaw_edema_treat: boolean;
  fecrt_interval_days: number; fecrt_efficacy_pct: number; fecrt_min_animals: number;
};

export const DEFAULT_SETTINGS: ParasiteSettings = {
  famacha_treat_from: 4, famacha_conditional: 3,
  cond_young: true, cond_pregnant_lactating: true, cond_bcs_max: 2.0, cond_rising: true,
  herd_alert_pct: 10, exam_interval_days: 14, recheck_days: 7,
  famacha_min_age_months: 6, young_min_gmq: 100,
  copro_treat_epg: null, dag_flag_from: 2, jaw_edema_treat: true,
  fecrt_interval_days: 14, fecrt_efficacy_pct: 95, fecrt_min_animals: 10,
};

export type ExamInput = { famacha: number | null; bcs: number | null; dag: number | null; jaw_edema: boolean; nasal: boolean };
export type AnimalContext = { age_days: number | null; pregnant_or_lactating: boolean; previous_famacha: number | null; gmq: number | null };
export type Decision = { decision: 'treat' | 'watch' | 'none'; reasons: string[] };

export function decide(e: ExamInput, a: AnimalContext, s: ParasiteSettings, herdAlert = false): Decision {
  const treat: string[] = [], watch: string[] = [];
  const young = a.age_days !== null && a.age_days < s.famacha_min_age_months * 30.4;
  if (e.jaw_edema) (s.jaw_edema_treat ? treat : watch).push('jaw_edema');
  if (e.famacha !== null) {
    if (e.famacha >= s.famacha_treat_from) treat.push('famacha_high');
    else if (e.famacha === s.famacha_conditional) {
      const conds: string[] = [];
      if (s.cond_young && young) conds.push('young');
      if (s.cond_pregnant_lactating && a.pregnant_or_lactating) conds.push('pregnant_lactating');
      if (s.cond_bcs_max !== null && e.bcs !== null && e.bcs <= s.cond_bcs_max) conds.push('low_bcs');
      if (s.cond_rising && a.previous_famacha !== null && e.famacha > a.previous_famacha) conds.push('famacha_rising');
      if (herdAlert) conds.push('herd_alert');
      if (conds.length) treat.push('famacha_conditional', ...conds);
      else watch.push('famacha_conditional');
    }
  }
  if (young && s.young_min_gmq !== null && a.gmq !== null && a.gmq < s.young_min_gmq) watch.push('low_gmq');
  if (e.dag !== null && e.dag >= s.dag_flag_from) watch.push('diarrhea');
  if (e.bcs !== null && s.cond_bcs_max !== null && e.bcs <= s.cond_bcs_max && !treat.includes('low_bcs')) watch.push('low_bcs');
  if (e.nasal) watch.push('nasal');
  if (treat.length) return { decision: 'treat', reasons: [...new Set([...treat, ...watch])] };
  if (watch.length) return { decision: 'watch', reasons: [...new Set(watch)] };
  return { decision: 'none', reasons: [] };
}

/** Réduction de l'excrétion fécale (moyennes arithmétiques sur les animaux présents aux deux prélèvements). */
export function fecrt(pairs: { before: number; after: number }[], s: ParasiteSettings) {
  if (!pairs.length) return null;
  const m0 = pairs.reduce((x, p) => x + p.before, 0) / pairs.length;
  const m1 = pairs.reduce((x, p) => x + p.after, 0) / pairs.length;
  const reduction = m0 > 0 ? Math.round((1 - m1 / m0) * 1000) / 10 : null;
  return {
    n: pairs.length, mean_before: Math.round(m0), mean_after: Math.round(m1), reduction,
    enough_animals: pairs.length >= s.fecrt_min_animals,
    status: reduction === null ? 'not_computable' : reduction >= s.fecrt_efficacy_pct ? 'effective' : 'doubtful',
  };
}

export function mergeSettings(v: unknown): ParasiteSettings {
  return { ...DEFAULT_SETTINGS, ...(v && typeof v === 'object' ? (v as Partial<ParasiteSettings>) : {}) };
}
