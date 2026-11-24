import { describe, it, expect } from 'vitest';
import { estimateStock } from '../src/lib/stock.js';

const hay = { consumption_qty: 1, consumption_days: 7, alert_units: 1, lead_days: 7 }; // 1 botte par semaine

describe('Estimation des stocks', () => {
  it('exemple : 3 bottes, 1 botte par semaine → alerte quand il reste 1 botte, rupture à 3 semaines', () => {
    const mv = [{ type: 'count' as const, quantity: 3, date: '2026-11-01' }];
    const j0 = estimateStock(hay, mv, '2026-11-01');
    expect(j0).toMatchObject({ estimated: 3, days_left: 21, rupture_date: '2026-11-22', status: 'ok' });
    expect(estimateStock(hay, mv, '2026-11-08')).toMatchObject({ estimated: 2, days_left: 14, status: 'ok' });
    const j14 = estimateStock(hay, mv, '2026-11-15');
    expect(j14).toMatchObject({ estimated: 1, days_left: 7, rupture_date: '2026-11-22', order_by: '2026-11-15', status: 'order' });
    expect(estimateStock(hay, mv, '2026-11-22')).toMatchObject({ estimated: 0, status: 'empty' });
    expect(estimateStock(hay, mv, '2026-12-30').estimated).toBe(0); // jamais négatif
  });
  it('alerte anticipée si la rupture tombe avant le délai de livraison', () => {
    const slow = { ...hay, alert_units: 0, lead_days: 10 };
    expect(estimateStock(slow, [{ type: 'count', quantity: 2, date: '2026-11-01' }], '2026-11-01')).toMatchObject({ days_left: 14, status: 'ok' });
    expect(estimateStock(slow, [{ type: 'count', quantity: 2, date: '2026-11-01' }], '2026-11-05')).toMatchObject({ status: 'order' });
  });
  it('entrées et sorties après le dernier inventaire ; mouvements antérieurs ignorés', () => {
    const mv = [
      { type: 'in' as const, quantity: 10, date: '2026-10-01' },
      { type: 'count' as const, quantity: 2, date: '2026-11-01' },
      { type: 'in' as const, quantity: 5, date: '2026-11-03' },
      { type: 'out' as const, quantity: 1, date: '2026-11-04', note: 'botte mouillée' } as any,
    ];
    // 2 + 5 − 1 − 7 jours × 1/7 = 5
    expect(estimateStock(hay, mv, '2026-11-08')).toMatchObject({ base_date: '2026-11-01', estimated: 5 });
  });
  it('sans inventaire : départ à zéro au premier mouvement', () => {
    expect(estimateStock(hay, [{ type: 'in', quantity: 4, date: '2026-11-01' }], '2026-11-08')).toMatchObject({ estimated: 3 });
  });
  it('même date : l’ordre de saisie départage inventaire et livraison', () => {
    const mv = [
      { type: 'count' as const, quantity: 1, date: '2026-11-01', created_at: '2026-11-01T08:00:00Z' },
      { type: 'in' as const, quantity: 4, date: '2026-11-01', created_at: '2026-11-01T10:00:00Z' },
    ];
    expect(estimateStock(hay, mv, '2026-11-01').estimated).toBe(5);
    const recount = [...mv, { type: 'count' as const, quantity: 6, date: '2026-11-01', created_at: '2026-11-01T12:00:00Z' }];
    expect(estimateStock(hay, recount, '2026-11-01').estimated).toBe(6);
  });
  it('sans rythme de consommation : pas de date de rupture inventée', () => {
    const r = estimateStock({ consumption_qty: null, consumption_days: null, alert_units: 1, lead_days: 7 }, [{ type: 'count', quantity: 5, date: '2026-01-01' }], '2026-11-01');
    expect(r).toMatchObject({ estimated: 5, days_left: null, rupture_date: null, status: 'ok' });
  });
  it('aucun mouvement : inconnu ; mouvements futurs ignorés', () => {
    expect(estimateStock(hay, [], '2026-11-01').status).toBe('unknown');
    expect(estimateStock(hay, [{ type: 'count', quantity: 9, date: '2026-12-01' }], '2026-11-01').status).toBe('unknown');
  });
});
