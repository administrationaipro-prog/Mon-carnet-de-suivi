import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { setup, makeAdmin, approvedFarmer, post, put } from './helpers.js';

let app: any, admin: any, A: any, B: any, C: any;
const ids: Record<string, string> = {};
const mk = async (f: any, o: any) => {
  const r = await post(f, `/api/farms/${f.farmId}/animals`, { breed_code: 'BLACKBELLY', birth_date: '2023-01-10', ...o });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body.id as string;
};

beforeAll(async () => {
  app = await setup(); admin = await makeAdmin(app);
  A = await approvedFarmer(app, admin, 'saillie-a@farm.org', 'Élevage Cabit');
  B = await approvedFarmer(app, admin, 'saillie-b@farm.org', 'Élevage Sainte-Rose');
  C = await approvedFarmer(app, admin, 'saillie-c@farm.org', 'Élevage Joseph');
  // Élevage A : Tonnerre (FR 4012 0031) est le père de Sean
  ids.tonnerreA = await mk(A, { internal_id: 'TONNERRE', name: 'Tonnerre', official_id: 'FR 4012 0031', sex: 'M', birth_date: '2018-01-01' });
  ids.sean = await mk(A, { internal_id: 'SEAN', name: 'Sean', official_id: 'FR 4012 1188', sex: 'M', sire_id: ids.tonnerreA });
  ids.douceA = await mk(A, { internal_id: 'DOUCE', name: 'Douce', sex: 'F' });
  // Élevage B : le même Tonnerre (même n° officiel) est le grand-père de Perle
  ids.tonnerreB = await mk(B, { internal_id: 'T-31', name: 'Tonnerre', official_id: 'FR40120031', sex: 'M', birth_date: '2018-01-01' });
  ids.mereB = await mk(B, { internal_id: 'MERE', name: 'Mère de Perle', sex: 'F', birth_date: '2020-01-01', sire_id: ids.tonnerreB });
  ids.perle = await mk(B, { internal_id: 'PERLE', name: 'Perle', official_id: 'FR 9721 0456', sex: 'F', dam_id: ids.mereB });
  ids.nala = await mk(B, { internal_id: 'NALA', name: 'Nala', sex: 'F' });
  ids.belierB = await mk(B, { internal_id: 'TITAN', name: 'Titan', sex: 'M' });
  ids.douceC = await mk(C, { internal_id: 'CALINE', name: 'Câline', sex: 'F' });
  // quelques pesées pour les performances
  for (const [f, id, w] of [[A, ids.sean, [['2023-01-10', 4], ['2023-04-10', 22]]], [B, ids.perle, [['2023-01-10', 3.5], ['2023-04-10', 17]]]] as const) {
    for (const [d, kg] of w) await post(f, `/api/farms/${f.farmId}/animals/${id}/weighings`, { date: d, weight_kg: kg, confirm: true });
  }
});
afterAll(async () => { await pool.end(); });

describe('Catalogue des saillies entre élevages', () => {
  let listing: any;
  it('un élevage reste privé tant que rien n’est publié', async () => {
    expect((await B.get(`/api/breeding/catalog?farm=${B.farmId}`)).body).toEqual([]);
    expect((await B.get(`/api/farms/${A.farmId}/animals`)).status).toBe(404);
    expect((await B.get(`/api/breeding/catalog?farm=${A.farmId}`)).status).toBe(404); // catalogue lu au nom de sa propre exploitation
  });
  it('publication d’un mâle et d’une femelle ; le catalogue n’affiche que les autres élevages', async () => {
    listing = (await post(A, `/api/farms/${A.farmId}/breeding/listings`, { animal_id: ids.sean, months: 3, locality: 'Le Lamentin', modality: 'onsite', conditions: 'Lutte libre 30 jours' })).body;
    expect(listing).toMatchObject({ status: 'active', modality: 'onsite' });
    await post(B, `/api/farms/${B.farmId}/breeding/listings`, { animal_id: ids.nala, months: null, modality: 'travel' });
    expect((await post(B, `/api/farms/${B.farmId}/breeding/listings`, { animal_id: ids.sean, months: 1 })).status).toBe(404); // animal d'un autre élevage
    const cat = (await B.get(`/api/breeding/catalog?farm=${B.farmId}`)).body;
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ animal: { name: 'Sean', official_id: 'FR 4012 1188', sex: 'M' }, farm: { name: 'Élevage Cabit', locality: 'Le Lamentin' }, conditions: 'Lutte libre 30 jours' });
    expect(cat[0].perf.gmq).toBeGreaterThan(150);
    // compatibilité avec les femelles de B : Nala (0 %), Perle (6,25 % : alerte), Mère de Perle (demi-sœur de Sean : 12,5 % : alerte, à la limite)
    expect(cat[0].compat).toEqual({ ok: 1, warning: 2, refused: 0, total: 3 });
    expect(JSON.stringify(cat[0])).not.toMatch(/health|treatment/);
    // filtres
    expect((await B.get(`/api/breeding/catalog?farm=${B.farmId}&sex=F`)).body).toHaveLength(0);
    expect((await C.get(`/api/breeding/catalog?farm=${C.farmId}&sex=F`)).body.map((x: any) => x.animal.name)).toEqual(['Nala']);
    expect((await C.get(`/api/breeding/catalog?farm=${C.farmId}&q=cabit`)).body.map((x: any) => x.animal.name)).toEqual(['Sean']);
  });
  it('fiche d’annonce : consanguinité avec chaque femelle, ancêtre commun reconnu par son n° officiel', async () => {
    const r = (await B.get(`/api/breeding/listings/${listing.id}?farm=${B.farmId}`)).body;
    expect(r.mates.map((m: any) => [m.name, m.coefficient_percent, m.level])).toEqual([['Nala', 0, 'ok'], ['Perle', 6.25, 'warning'], ['Mère de Perle', 12.5, 'warning']]);
    const sim = (await B.get(`/api/farms/${B.farmId}/breeding/simulate?my=${ids.perle}&listing=${listing.id}`)).body;
    expect(sim.inbreeding.coefficient_percent).toBe(6.25);
    expect(sim.inbreeding.common_ancestors[0]).toMatchObject({ label: 'Tonnerre', gen_a: 2, gen_b: 1 });
    expect(sim).toMatchObject({ male: 'theirs', mine: { farm: { name: 'Élevage Sainte-Rose' }, animal: { name: 'Perle' } }, theirs: { animal: { name: 'Sean' } } });
    expect(sim.lamb.gmq).toBeGreaterThan(150);
    expect(sim.lamb.reliability).toBe('low');
    expect((await B.get(`/api/farms/${B.farmId}/breeding/simulate?my=${ids.belierB}&listing=${listing.id}`)).body.error).toBe('same_sex');
    expect((await A.get(`/api/farms/${A.farmId}/breeding/simulate?my=${ids.douceA}&listing=${listing.id}`)).body.error).toBe('own_animal');
    const l = await pool.query('select views, simulations from breeding_listings where id = $1', [listing.id]);
    expect(l.rows[0]).toEqual({ views: 1, simulations: 1 });
  });
  it('mise en pause : l’annonce disparaît du catalogue', async () => {
    await (await import('./helpers.js')).patch(A, `/api/farms/${A.farmId}/breeding/listings/${listing.id}`, { status: 'paused' });
    expect((await B.get(`/api/breeding/catalog?farm=${B.farmId}`)).body).toHaveLength(0);
    expect((await B.get(`/api/farms/${B.farmId}/breeding/simulate?my=${ids.perle}&listing=${listing.id}`)).body.error).toBe('listing_not_found');
    await (await import('./helpers.js')).patch(A, `/api/farms/${A.farmId}/breeding/listings/${listing.id}`, { status: 'active' });
  });
  it('code privé : utilisable par un éleveur précis, révocable', async () => {
    const k = (await post(A, `/api/farms/${A.farmId}/breeding/codes`, { animal_id: ids.sean })).body;
    expect(k.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const r = (await C.get(`/api/farms/${C.farmId}/breeding/resolve?code=${k.code.toLowerCase()}`)).body;
    expect(r).toMatchObject({ animal: { name: 'Sean' }, farm: { name: 'Élevage Cabit' } });
    expect((await C.get(`/api/farms/${C.farmId}/breeding/simulate?my=${ids.douceC}&code=${k.code}`)).body.inbreeding.coefficient_percent).toBe(0);
    await post(A, `/api/farms/${A.farmId}/breeding/codes/${k.id}/revoke`);
    expect((await C.get(`/api/farms/${C.farmId}/breeding/resolve?code=${k.code}`)).body.error).toBe('share_code_invalid');
  });
  it('proposition : envoyée, reçue avec la même simulation, acceptée', async () => {
    const p = await post(B, `/api/farms/${B.farmId}/breeding/proposals`, { my_animal_id: ids.perle, listing_id: listing.id, message: 'Saillie en janvier ?' });
    expect(p.status).toBe(200);
    expect((await post(B, `/api/farms/${B.farmId}/breeding/proposals`, { my_animal_id: ids.perle, listing_id: listing.id })).body.error).toBe('proposal_pending');
    const mineA = (await A.get(`/api/farms/${A.farmId}/breeding/mine`)).body;
    expect(mineA.received[0]).toMatchObject({ status: 'pending', from_farm: 'Élevage Sainte-Rose', mine: { name: 'Sean' }, theirs: { name: 'Perle' }, coefficient_percent: 6.25 });
    expect(mineA.listings[0]).toMatchObject({ name: 'Sean', proposals: 1 });
    const viewA = (await A.get(`/api/farms/${A.farmId}/breeding/proposals/${p.body.id}`)).body;
    expect(viewA).toMatchObject({ incoming: true, message: 'Saillie en janvier ?', result: { male: 'mine', mine: { animal: { name: 'Sean' } }, theirs: { animal: { name: 'Perle' } } } });
    expect((await C.get(`/api/farms/${C.farmId}/breeding/proposals/${p.body.id}`)).status).toBe(404);
    expect((await post(B, `/api/farms/${B.farmId}/breeding/proposals/${p.body.id}/respond`, { accept: true })).body.error).toBe('not_recipient');
    const acc = await post(A, `/api/farms/${A.farmId}/breeding/proposals/${p.body.id}/respond`, { accept: true, message: 'D’accord, appelez-moi.' });
    expect(acc.body.status).toBe('accepted');
    expect((await B.get(`/api/farms/${B.farmId}/breeding/mine`)).body.sent[0]).toMatchObject({ status: 'accepted', response_message: 'D’accord, appelez-moi.' });
    const mails = await pool.query(`select to_email, subject from outbox_emails where subject like 'Proposition de saillie%' order by id`);
    expect(mails.rows.map((m) => m.to_email)).toEqual(['saillie-a@farm.org', 'saillie-b@farm.org']);
  });
});
void put;
