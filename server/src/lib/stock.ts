// Estimation des stocks — calcul pur, testé.
//
// Stock estimé = dernier inventaire (« count ») + entrées − sorties enregistrées depuis
//                − consommation théorique depuis l'inventaire (rythme saisi : X unités tous les N jours).
// Sans rythme de consommation, le stock n'est pas extrapolé (pas de date de rupture inventée).

import { addDays, daysBetween, round } from './indicators.js';

export type Movement = { type: 'count' | 'in' | 'out'; quantity: number; date: string; created_at?: string | Date };
export type StockParams = { consumption_qty: number | null; consumption_days: number | null; alert_units: number; lead_days: number };
export type StockStatus = 'ok' | 'order' | 'empty' | 'unknown';
export type StockEstimate = {
  base_date: string | null; base_quantity: number | null; estimated: number | null; rate_per_day: number | null;
  days_left: number | null; rupture_date: string | null; order_by: string | null; status: StockStatus;
};

const ts = (m: Movement) => (m.created_at ? new Date(m.created_at).getTime() : 0);

export function estimateStock(p: StockParams, movements: Movement[], today: string): StockEstimate {
  const sorted = [...movements].filter((m) => m.date <= today).sort((a, b) => a.date.localeCompare(b.date) || ts(a) - ts(b));
  const empty: StockEstimate = { base_date: null, base_quantity: null, estimated: null, rate_per_day: null, days_left: null, rupture_date: null, order_by: null, status: 'unknown' };
  if (!sorted.length) return empty;
  // point de départ : le dernier inventaire ; à défaut, zéro au premier mouvement
  let start = -1;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].type === 'count') { start = i; break; }
  const baseDate = start >= 0 ? sorted[start].date : sorted[0].date;
  let qty = start >= 0 ? sorted[start].quantity : 0;
  for (const m of sorted.slice(start + 1)) qty += m.type === 'in' ? m.quantity : m.type === 'out' ? -m.quantity : 0;
  const rate = p.consumption_qty && p.consumption_days ? p.consumption_qty / p.consumption_days : null;
  const elapsed = Math.max(0, daysBetween(baseDate, today));
  const estimated = Math.max(0, round(qty - (rate ?? 0) * elapsed, 2));
  const daysLeft = rate ? round(estimated / rate, 1) : null;
  const rupture = daysLeft !== null ? addDays(today, Math.floor(daysLeft)) : null;
  const orderBy = rupture ? addDays(rupture, -p.lead_days) : null;
  let status: StockStatus = 'ok';
  if (estimated <= 0) status = 'empty';
  else if (estimated <= p.alert_units + 1e-9 || (daysLeft !== null && daysLeft <= p.lead_days)) status = 'order';
  return { base_date: baseDate, base_quantity: start >= 0 ? sorted[start].quantity : null, estimated, rate_per_day: rate === null ? null : round(rate, 4), days_left: daysLeft, rupture_date: rupture, order_by: orderBy, status };
}
