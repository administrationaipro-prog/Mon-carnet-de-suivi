// Généalogie et consanguinité — calculs purs, sans accès base.
//
// Coefficient de consanguinité F d'un animal = coefficient de parenté (kinship) entre son père et sa mère
// (méthode de Wright / tabulaire). Une donnée absente n'est jamais devinée : un parent inconnu est traité
// comme un fondateur non apparenté, donc F n'est qu'un MINIMUM calculé sur la généalogie réellement saisie.
//
// Repères de lecture (apparentements classiques, valeurs exactes) :
//   cousins germains 6,25 % · demi-frère × demi-sœur, oncle × nièce, grand-parent × petit-enfant 12,5 %
//   frère × sœur, parent × descendant 25 %

export type PedNode = { id: string; sire_id: string | null; dam_id: string | null };

const EPS = 1e-9;

export class Pedigree {
  private nodes = new Map<string, PedNode>();
  private depthMemo = new Map<string, number>();
  private kinMemo = new Map<string, number>();

  constructor(nodes: PedNode[]) {
    for (const n of nodes) this.nodes.set(n.id, n);
  }

  has(id: string | null | undefined): id is string { return !!id && this.nodes.has(id); }

  /** Parents connus (présents dans la généalogie) ; null si inconnu. */
  parents(id: string): [string | null, string | null] {
    const n = this.nodes.get(id);
    if (!n) return [null, null];
    return [this.has(n.sire_id) ? n.sire_id : null, this.has(n.dam_id) ? n.dam_id : null];
  }

  /** Nombre de générations connues derrière l'animal (0 = aucun parent connu). Lève 'pedigree_cycle' si la généalogie boucle. */
  depth(id: string, stack: Set<string> = new Set()): number {
    const memo = this.depthMemo.get(id);
    if (memo !== undefined) return memo;
    if (stack.has(id)) throw new Error('pedigree_cycle');
    stack.add(id);
    const [s, d] = this.parents(id);
    const v = s || d ? 1 + Math.max(s ? this.depth(s, stack) : 0, d ? this.depth(d, stack) : 0) : 0;
    stack.delete(id);
    this.depthMemo.set(id, v);
    return v;
  }

  /** Coefficient de parenté φ(a, b) : probabilité que deux allèles tirés au hasard chez a et b soient identiques par descendance. */
  kinship(a: string | null, b: string | null): number {
    if (!a || !b || !this.has(a) || !this.has(b)) return 0;
    if (a === b) return (1 + this.inbreeding(a)) / 2;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const memo = this.kinMemo.get(key);
    if (memo !== undefined) return memo;
    // Le plus « jeune » (profondeur la plus grande) ne peut pas être ancêtre de l'autre : on remonte ses parents.
    const [x, y] = this.depth(a) >= this.depth(b) ? [a, b] : [b, a];
    const [s, d] = this.parents(x);
    const v = s || d ? 0.5 * (this.kinship(s, y) + this.kinship(d, y)) : 0;
    this.kinMemo.set(key, v);
    return v;
  }

  /** Consanguinité F de l'animal (0 si l'un des parents est inconnu). */
  inbreeding(id: string): number {
    const [s, d] = this.parents(id);
    return s && d ? this.kinship(s, d) : 0;
  }

  /** Ancêtres (hors l'animal) avec leur génération minimale : 1 = parent, 2 = grand-parent… */
  ancestors(id: string): Map<string, number> {
    const out = new Map<string, number>();
    let frontier = [id];
    for (let g = 1; frontier.length && g <= 50; g++) {
      const next: string[] = [];
      for (const cur of frontier) for (const p of this.parents(cur)) if (p && !out.has(p)) { out.set(p, g); next.push(p); }
      frontier = next;
    }
    return out;
  }

  /** Part des ancêtres connus sur `gens` générations (positions : père du père, mère du père…). 1 = généalogie complète. */
  completeness(id: string, gens = 3): number {
    const count = (cur: string, g: number): number => {
      if (g === 0) return 0;
      const [s, d] = this.parents(cur);
      return (s ? 1 + count(s, g - 1) : 0) + (d ? 1 + count(d, g - 1) : 0);
    };
    return count(id, gens) / (2 ** (gens + 1) - 2);
  }

  /** Ancêtres communs de deux animaux (un animal est aussi son propre « ancêtre » à la génération 0). */
  commonAncestors(a: string, b: string): { id: string; gen_a: number; gen_b: number }[] {
    const A = this.ancestors(a); A.set(a, 0);
    const B = this.ancestors(b); B.set(b, 0);
    const out: { id: string; gen_a: number; gen_b: number }[] = [];
    for (const [id, ga] of A) { const gb = B.get(id); if (gb !== undefined) out.push({ id, gen_a: ga, gen_b: gb }); }
    return out.sort((x, y) => x.gen_a + x.gen_b - (y.gen_a + y.gen_b));
  }

  /** Coefficient d'apparentement de Wright entre deux animaux (0 à 1). */
  relationship(a: string, b: string): number {
    const fa = this.inbreeding(a), fb = this.inbreeding(b);
    return (2 * this.kinship(a, b)) / Math.sqrt((1 + fa) * (1 + fb));
  }
}

export type InbreedingVerdict = 'ok' | 'warning' | 'refused';

/** Évalue F (fraction 0–1) par rapport aux limites exprimées en pourcentage. Refus strict : F > limite. */
export function inbreedingVerdict(f: number, warnPercent: number, maxPercent: number): InbreedingVerdict {
  const p = f * 100;
  if (p > maxPercent + EPS) return 'refused';
  if (p >= warnPercent - EPS) return 'warning';
  return 'ok';
}

export const toPercent = (f: number) => Math.round(f * 100 * 100) / 100;
