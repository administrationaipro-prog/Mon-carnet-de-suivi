import { describe, it, expect } from 'vitest';
import { Pedigree, inbreedingVerdict, toPercent, type PedNode } from '../src/lib/pedigree.js';

const n = (id: string, sire: string | null = null, dam: string | null = null): PedNode => ({ id, sire_id: sire, dam_id: dam });
const F = (nodes: PedNode[], a: string, b: string) => new Pedigree(nodes).kinship(a, b);

describe('Consanguinité — cas classiques (valeurs exactes)', () => {
  // Fondateurs non apparentés : G1 (bélier), G2 (brebis)
  const founders = [n('G1'), n('G2')];

  it('animaux non apparentés : 0 %', () => {
    expect(F([n('A'), n('B')], 'A', 'B')).toBe(0);
  });
  it('frère × sœur (pleins) : 25 %', () => {
    const ped = [...founders, n('S', 'G1', 'G2'), n('D', 'G1', 'G2')];
    expect(F(ped, 'S', 'D')).toBe(0.25);
  });
  it('demi-frères (même père) : 12,5 %', () => {
    const ped = [...founders, n('G3'), n('S', 'G1', 'G2'), n('D', 'G1', 'G3')];
    expect(F(ped, 'S', 'D')).toBe(0.125);
  });
  it('parent × descendant : 25 %', () => {
    const ped = [...founders, n('D', 'G1', 'G2')];
    expect(F(ped, 'G1', 'D')).toBe(0.25);
    expect(F(ped, 'D', 'G2')).toBe(0.25);
  });
  it('cousins germains : 6,25 %', () => {
    // deux frères pleins X, Y ; leurs enfants (avec des conjoints extérieurs) sont cousins germains
    const ped = [...founders, n('E1'), n('E2'), n('X', 'G1', 'G2'), n('Y', 'G1', 'G2'), n('C1', 'X', 'E1'), n('C2', 'E2', 'Y')];
    // C1 (fils de X) × C2 (fille de Y)
    expect(F(ped, 'C1', 'C2')).toBe(0.0625);
  });
  it('grand-parent × petit-enfant : 12,5 %', () => {
    const ped = [...founders, n('E1'), n('P', 'G1', 'G2'), n('K', 'E1', 'P')];
    expect(F(ped, 'G1', 'K')).toBe(0.125);
  });
  it('oncle × nièce : 12,5 %', () => {
    // U et P sont frères pleins ; N est la fille de P
    const ped = [...founders, n('E1'), n('U', 'G1', 'G2'), n('P', 'G1', 'G2'), n('N', 'E1', 'P')];
    expect(F(ped, 'U', 'N')).toBe(0.125);
  });
  it('F d’un animal issu de frère × sœur = 25 %, et ses descendants héritent de la consanguinité', () => {
    const ped = [...founders, n('S', 'G1', 'G2'), n('D', 'G1', 'G2'), n('K', 'S', 'D'), n('E1')];
    const p = new Pedigree(ped);
    expect(p.inbreeding('K')).toBe(0.25);
    expect(p.inbreeding('S')).toBe(0);
    // K × son parent S : kinship = (1 + F_S)/2 ... + effet de F_K ; supérieur à 25 %
    expect(p.kinship('K', 'S')).toBeGreaterThan(0.25);
    expect(p.kinship('K', 'K')).toBe(0.625); // (1 + 0,25) / 2
  });
  it('parent inconnu : F = 0 (jamais deviné) et complétude partielle', () => {
    const p = new Pedigree([...founders, n('A', 'G1', null)]);
    expect(p.inbreeding('A')).toBe(0);
    expect(p.completeness('A', 3)).toBeCloseTo(1 / 14, 10);
    expect(new Pedigree([...founders, n('A', 'G1', 'G2')]).completeness('A', 3)).toBeCloseTo(2 / 14, 10);
  });
  it('références à un animal absent de la généalogie ignorées', () => {
    const p = new Pedigree([n('A', 'ABSENT', 'G2'), n('G2')]);
    expect(p.parents('A')).toEqual([null, 'G2']);
    expect(p.depth('A')).toBe(1);
  });
  it('détecte les boucles de généalogie', () => {
    const p = new Pedigree([n('A', 'B', null), n('B', 'A', null)]);
    expect(() => p.depth('A')).toThrow('pedigree_cycle');
  });
  it('ancêtres communs et coefficient d’apparentement', () => {
    const ped = [...founders, n('S', 'G1', 'G2'), n('D', 'G1', 'G2')];
    const p = new Pedigree(ped);
    expect(p.commonAncestors('S', 'D').map((c) => c.id).sort()).toEqual(['G1', 'G2']);
    expect(p.commonAncestors('S', 'D')[0]).toMatchObject({ gen_a: 1, gen_b: 1 });
    expect(p.relationship('S', 'D')).toBe(0.5); // frères pleins : r = 50 %
    // parent × enfant : le parent est lui-même ancêtre commun à la génération 0
    expect(new Pedigree(ped).commonAncestors('G1', 'S').find((c) => c.id === 'G1')).toMatchObject({ gen_a: 0, gen_b: 1 });
  });
  it('généalogie profonde (30 générations) sans dépassement', () => {
    const nodes: PedNode[] = [n('R0'), n('Q0')];
    for (let i = 1; i <= 30; i++) nodes.push(n(`R${i}`, `R${i - 1}`, `Q${i - 1}`), n(`Q${i}`, `R${i - 1}`, `Q${i - 1}`));
    const p = new Pedigree(nodes);
    expect(p.depth('R30')).toBe(30);
    expect(p.kinship('R30', 'Q30')).toBeGreaterThan(0.99);
  });
});

describe('Verdict selon les limites', () => {
  it('refus strict au-delà de la limite, alerte dès le seuil', () => {
    expect(inbreedingVerdict(0, 6.25, 12.5)).toBe('ok');
    expect(inbreedingVerdict(0.03, 6.25, 12.5)).toBe('ok');
    expect(inbreedingVerdict(0.0625, 6.25, 12.5)).toBe('warning');
    expect(inbreedingVerdict(0.125, 6.25, 12.5)).toBe('warning'); // pile à la limite : non refusé
    expect(inbreedingVerdict(0.1251, 6.25, 12.5)).toBe('refused');
    expect(inbreedingVerdict(0.25, 6.25, 12.5)).toBe('refused');
    expect(inbreedingVerdict(0.125, 6.25, 6.25)).toBe('refused');
  });
  it('conversion en pourcentage arrondie à 2 décimales', () => {
    expect(toPercent(0.0625)).toBe(6.25);
    expect(toPercent(0.123456)).toBe(12.35);
  });
});
