import { describe, it, expect } from 'vitest';
import { gmq, gmqSeries, weightAtAge, checkWeighing, weighingStatus, toCsv, daysBetween, protocolDueDates } from '../src/lib/indicators.js';

describe('GMQ', () => {
  it('calcule le GMQ exact avec les jours réels (données de démonstration Bélier 1)', () => {
    // 31/10 : 11,30 kg ; 07/11 : 12,81 kg ; 14/11 : 13,29 kg
    expect(gmq({ date: '2026-10-31', weight_kg: 11.3 }, { date: '2026-11-07', weight_kg: 12.81 })).toBeCloseTo(215.714, 2);
    const s = gmqSeries([{ date: '2026-11-14', weight_kg: 13.29 }, { date: '2026-10-31', weight_kg: 11.3 }, { date: '2026-11-07', weight_kg: 12.81 }]);
    expect(s.periods.map((p) => p.from)).toEqual(['2026-10-31', '2026-11-07']); // ordonné
    expect(s.overall).toBeCloseTo((13.29 - 11.3) * 1000 / 14, 1);
  });
  it('Bélier 2 : GMQ global', () => {
    const s = gmqSeries([{ date: '2026-10-31', weight_kg: 9.8 }, { date: '2026-11-07', weight_kg: 11.67 }, { date: '2026-11-14', weight_kg: 12.32 }]);
    expect(s.overall).toBe(180);
  });
  it('null si dates identiques ou une seule pesée', () => {
    expect(gmq({ date: '2026-01-01', weight_kg: 3 }, { date: '2026-01-01', weight_kg: 4 })).toBeNull();
    expect(gmqSeries([{ date: '2026-01-01', weight_kg: 3 }]).overall).toBeNull();
  });
  it('gère les années bissextiles et changements de mois', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-11-02')).toBe(9);
  });
});

describe('Poids à âge standard', () => {
  const ws = [{ date: '2026-01-21', weight_kg: 10 }, { date: '2026-02-10', weight_kg: 14 }];
  it('interpole seulement si encadré', () => {
    expect(weightAtAge('2026-01-01', ws, 30)).toBe(12); // J30 = 31/01, milieu
    expect(weightAtAge('2026-01-01', ws, 60)).toBeNull();
    expect(weightAtAge(null, ws, 30)).toBeNull();
  });
  it('refuse si écart trop grand', () => {
    expect(weightAtAge('2026-01-01', [{ date: '2026-01-02', weight_kg: 4 }, { date: '2026-03-15', weight_kg: 20 }], 30, 30)).toBeNull();
  });
});

describe('Contrôles de saisie', () => {
  const today = '2026-11-20';
  it('refuse date antérieure à la naissance et poids non positif', () => {
    expect(checkWeighing({ date: '2026-01-01', weight_kg: 5 }, '2026-02-01', [], today).errors).toContain('date_before_birth');
    expect(checkWeighing({ date: '2026-03-01', weight_kg: 0 }, '2026-02-01', [], today).errors).toContain('weight_not_positive');
    expect(checkWeighing({ date: '2026-03-01', weight_kg: -2 }, '2026-02-01', [], today).errors).toContain('weight_not_positive');
    expect(checkWeighing({ date: '2026-02-30', weight_kg: 3 }, null, [], today).errors).toContain('invalid_date');
    expect(checkWeighing({ date: '2027-01-01', weight_kg: 3 }, null, [], today).errors).toContain('date_in_future');
  });
  it('signale doublons et valeurs atypiques', () => {
    const ex = [{ id: 'a', date: '2026-03-01', weight_kg: 10 }];
    expect(checkWeighing({ date: '2026-03-01', weight_kg: 10.5 }, null, ex, today).warnings).toContain('duplicate_date');
    expect(checkWeighing({ date: '2026-03-08', weight_kg: 20 }, null, ex, today).warnings).toContain('gmq_atypical');
    expect(checkWeighing({ date: '2026-03-08', weight_kg: 11 }, null, ex, today).warnings).toEqual([]);
  });
});

describe('Calendrier de pesées', () => {
  it('liste le protocole puis mensuel', () => {
    const d = protocolDueDates('2026-01-01', [0, 7, 14, 21, 30, 45, 60, 90, 120], '2026-07-01');
    expect(d.slice(0, 3).map((x) => x.day)).toEqual([0, 7, 14]);
    expect(d.some((x) => x.day === 150)).toBe(true);
  });
  it('détecte les pesées en retard', () => {
    const st = weighingStatus('2026-11-01', [{ date: '2026-11-01', weight_kg: 4 }], [0, 7, 14, 21, 30], 3, '2026-11-20');
    expect(st.overdue.map((o) => o.day)).toEqual([7, 14]);
    expect(st.next?.day).toBe(21);
  });
});

describe('CSV', () => {
  it('échappe et neutralise les formules', () => {
    const c = toCsv(['a', 'b'], [['x;y', '=CMD()'], [null, 3]]);
    expect(c).toContain('"x;y"');
    expect(c).toContain("'=CMD()");
    expect(c.startsWith('﻿')).toBe(true);
  });
});
