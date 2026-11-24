// Calculs métier purs — testés unitairement. Aucune valeur n'est inventée :
// lorsqu'une donnée manque, le résultat est null.

export type Weighing = { date: string; weight_kg: number };

const DAY = 86_400_000;
export function parseIsoDate(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`invalid_date:${d}`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const back = new Date(t);
  if (back.getUTCFullYear() !== +m[1] || back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) throw new Error(`invalid_date:${d}`);
  return t;
}
export const daysBetween = (a: string, b: string) => Math.round((parseIsoDate(b) - parseIsoDate(a)) / DAY);
export const addDays = (d: string, n: number) => new Date(parseIsoDate(d) + n * DAY).toISOString().slice(0, 10);

export const sortWeighings = <T extends Weighing>(ws: T[]) =>
  [...ws].sort((a, b) => a.date.localeCompare(b.date));

/** GMQ (g/j) = (poids final − poids initial) × 1000 / jours réels ; null si dates identiques. */
export function gmq(initial: Weighing, final: Weighing): number | null {
  const d = daysBetween(initial.date, final.date);
  if (d <= 0) return null;
  return ((final.weight_kg - initial.weight_kg) * 1000) / d;
}

export function gmqSeries(ws: Weighing[]) {
  const s = sortWeighings(ws);
  const periods: { from: string; to: string; days: number; gmq: number }[] = [];
  for (let i = 1; i < s.length; i++) {
    const g = gmq(s[i - 1], s[i]);
    if (g !== null) periods.push({ from: s[i - 1].date, to: s[i].date, days: daysBetween(s[i - 1].date, s[i].date), gmq: round(g, 1) });
  }
  const overall = s.length >= 2 ? gmq(s[0], s[s.length - 1]) : null;
  return { count: s.length, periods, overall: overall === null ? null : round(overall, 1),
    first: s[0] ?? null, last: s[s.length - 1] ?? null };
}

/**
 * Poids à âge standard : interpolation linéaire uniquement si une pesée encadre
 * l'âge cible de chaque côté, avec un écart total ≤ maxGapDays. Pesée exacte acceptée.
 */
export function weightAtAge(birthDate: string | null, ws: Weighing[], ageDays: number, maxGapDays = 30): number | null {
  if (!birthDate) return null;
  const target = addDays(birthDate, ageDays);
  const s = sortWeighings(ws);
  const exact = s.find((w) => w.date === target);
  if (exact) return exact.weight_kg;
  let before: Weighing | undefined, after: Weighing | undefined;
  for (const w of s) {
    if (w.date < target) before = w;
    else if (w.date > target) { after = w; break; }
  }
  if (!before || !after) return null;
  const gap = daysBetween(before.date, after.date);
  if (gap > maxGapDays) return null;
  const k = daysBetween(before.date, target) / gap;
  return round(before.weight_kg + k * (after.weight_kg - before.weight_kg), 2);
}

export type WeighingCheck = { errors: string[]; warnings: string[] };
/** Règles de gestion §9 : refus des dates avant naissance / poids non positifs ; signalement doublons et atypiques. */
export function checkWeighing(input: { date: string; weight_kg: number; id?: string }, birthDate: string | null, existing: (Weighing & { id: string })[], today: string): WeighingCheck {
  const errors: string[] = [], warnings: string[] = [];
  try { parseIsoDate(input.date); } catch { errors.push('invalid_date'); return { errors, warnings }; }
  if (!(input.weight_kg > 0) || !Number.isFinite(input.weight_kg)) errors.push('weight_not_positive');
  if (birthDate && input.date < birthDate) errors.push('date_before_birth');
  if (input.date > today) errors.push('date_in_future');
  if (errors.length) return { errors, warnings };
  const others = existing.filter((w) => w.id !== input.id);
  if (others.some((w) => w.date === input.date)) warnings.push('duplicate_date');
  if (input.weight_kg > 200) warnings.push('weight_atypical');
  const s = sortWeighings(others);
  const prev = [...s].reverse().find((w) => w.date < input.date);
  const next = s.find((w) => w.date > input.date);
  for (const [a, b] of [[prev, input], [input, next]] as const) {
    if (!a || !b) continue;
    const g = gmq(a, b);
    if (g !== null && (g > 600 || g < -300)) { warnings.push('gmq_atypical'); break; }
  }
  if (prev && input.weight_kg < prev.weight_kg * 0.85) warnings.push('weight_drop');
  return { errors, warnings: [...new Set(warnings)] };
}

/** Calendrier de pesées (§7) : jours du protocole puis mensuel après J120. */
export function protocolDueDates(birthDate: string, protocolDays: number[], until: string): { day: number; date: string }[] {
  const out = protocolDays.map((d) => ({ day: d, date: addDays(birthDate, d) }));
  let d = Math.max(...protocolDays);
  while (true) {
    d += 30;
    const date = addDays(birthDate, d);
    if (date > addDays(until, 30)) break;
    out.push({ day: d, date });
  }
  return out.filter((x) => x.date <= addDays(until, 30));
}

/** Prochaine pesée attendue et retard éventuel. */
export function weighingStatus(birthDate: string | null, ws: Weighing[], protocolDays: number[], tolerance: number, today: string) {
  if (!birthDate) return { next: null, overdue: [] as { day: number; date: string }[] };
  const dues = protocolDueDates(birthDate, protocolDays, today);
  const dates = ws.map((w) => w.date);
  const done = (due: string) => dates.some((d) => Math.abs(daysBetween(due, d)) <= tolerance);
  const overdue = dues.filter((x) => addDays(x.date, tolerance) < today && !done(x.date));
  const next = dues.find((x) => addDays(x.date, tolerance) >= today && !done(x.date)) ?? null;
  // seules les échéances récentes (60 j) sont considérées comme « en retard » actionnable
  return { next, overdue: overdue.filter((x) => daysBetween(x.date, today) <= 60) };
}

/** Intervalle de confiance de Wilson à 95 % pour une proportion k/n (à afficher avec n : peu de données = intervalle large). */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: round((c - m) / d, 3), high: round((c + m) / d, 3) };
}

export const ratio = (num: number, den: number) => (den > 0 ? round(num / den, 4) : null);
export function round(x: number, d = 2) { const f = 10 ** d; return Math.round(x * f) / f; }
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Export CSV RFC 4180 (séparateur ; pour Excel FR, BOM UTF-8). */
export function toCsv(headers: string[], rows: unknown[][], sep = ';'): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('|') : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`; // anti-injection de formules
    return /[";\n\r,]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(sep)).join('\r\n') + '\r\n';
}
