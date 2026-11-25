import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { h, parse, farmAccess, zOptText, zUuid, type Ctx } from '../http.js';
import { withTx } from '../db.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify, sendMail } from '../lib/mail.js';
import { inbreedingLimits } from '../lib/pedigreeDb.js';
import { loadFarmData, mergedPedigree, crossInbreeding, performance, lambEstimate, publicAnimal, type FarmData } from '../lib/breeding.js';

/** Lecture des données d'un autre élevage : uniquement par le serveur, dans un contexte dédié. */
const serviceData = (farmId: string) => withTx(null, (db) => loadFarmData(db, farmId), 'breeding_service');
const fid = (c: Ctx) => c.req.params.farmId as string;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = (s: string) => `${s.slice(0, 3)}-${s.slice(3)}`;

async function myFarm(c: Ctx, farmId: string) {
  const role = await farmAccess(c, farmId, 'read');
  if (role === 'vet' || role === 'admin_grant') throw forbidden('breeders_only');
  return role;
}

const farmInfo = async (c: Ctx, id: string) =>
  (await c.db.query('select f.id, f.name, f.locality, f.territory_code from farms f where f.id = $1', [id])).rows[0];

/** Animal partagé : annonce publique active ou code privé valide, jamais dans son propre élevage. */
async function resolveTarget(c: Ctx, mine: string, q: { listing?: string | null; code?: string | null }) {
  if (q.listing) {
    const l = (await c.db.query(
      `select l.* from breeding_listings l join farms f on f.id = l.farm_id
        where l.id = $1 and l.status = 'active' and f.status = 'active' and (l.available_until is null or l.available_until >= current_date)`, [q.listing])).rows[0];
    if (!l) throw notFound('listing_not_found');
    if (l.farm_id === mine) throw bad('own_animal');
    return { listing: l, code: null, farmId: l.farm_id as string, animalId: l.animal_id as string };
  }
  if (q.code) {
    const k = (await c.db.query(
      `select k.* from breeding_codes k join farms f on f.id = k.farm_id where k.code = $1 and k.revoked_at is null and k.expires_at > now() and f.status = 'active'`, [normCode(q.code)])).rows[0];
    if (!k) throw notFound('share_code_invalid');
    if (k.farm_id === mine) throw bad('own_animal');
    const l = (await c.db.query(`select * from breeding_listings where animal_id = $1 and status <> 'withdrawn' limit 1`, [k.animal_id])).rows[0] ?? null;
    return { listing: l, code: k, farmId: k.farm_id as string, animalId: k.animal_id as string };
  }
  throw bad('target_required');
}

const listingPublic = (l: any) => l && ({ id: l.id, status: l.status, available_until: l.available_until, locality: l.locality, modality: l.modality, conditions: l.conditions });

/** Simulation à deux élevages : consanguinité sur les généalogies réunies, performances, estimation de l'agneau. */
async function simulate(c: Ctx, mine: string, myAnimalId: string, t: Awaited<ReturnType<typeof resolveTarget>>) {
  const [myData, otherData] = [await loadFarmData(c.db, mine), await serviceData(t.farmId)];
  const me = myData.byId.get(myAnimalId), other = otherData.byId.get(t.animalId);
  if (!me) throw notFound('animal_not_found');
  if (!other || other.status !== 'active') throw notFound('listing_not_found');
  if (me.sex === other.sex) throw bad('same_sex');
  if ((me.species ?? 'ovine') !== (other.species ?? 'ovine')) throw bad('species_mismatch');
  const inb = await crossInbreeding(c.db, { data: myData, id: me.id }, { data: otherData, id: other.id }).catch((e) => { throw bad(e.message); });
  const pm = await performance(c.db, myData, me.id), po = await performance(c.db, otherData, other.id);
  const [myFarmRow, otherFarm] = [await farmInfo(c, mine), await farmInfo(c, t.farmId)];
  return {
    mine: { farm: { name: myFarmRow.name, locality: myFarmRow.locality }, animal: publicAnimal(me), perf: pm },
    theirs: { farm: { name: otherFarm.name, locality: otherFarm.locality }, animal: publicAnimal(other), perf: po },
    male: me.sex === 'M' ? 'mine' : 'theirs',
    inbreeding: inb,
    lamb: lambEstimate(pm, po, me.sex === 'F' ? 'a' : 'b'),
    listing: listingPublic(t.listing),
    simulated_at: new Date().toISOString(),
    notice: 'estimates_only',
  };
}

// ======================= Catalogue (tous les éleveurs) =======================
export const breedingRouter = Router();

breedingRouter.get('/catalog', h(async (c) => {
  const mine = String(c.req.query.farm ?? '');
  await myFarm(c, mine);
  const q = parse(z.object({
    species: z.enum(['ovine', 'caprine']).optional(), sex: z.enum(['M', 'F']).optional(), breed: z.string().max(40).optional(),
    territory: z.string().max(3).optional(), q: z.string().max(60).optional(), compatible: z.enum(['1']).optional(),
  }), c.req.query);
  const listings = (await c.db.query(
    `select l.*, f.name as farm_name, f.locality as farm_locality, f.territory_code as farm_territory from breeding_listings l join farms f on f.id = l.farm_id
      where l.status = 'active' and f.status = 'active' and (l.available_until is null or l.available_until >= current_date) and l.farm_id <> $1
        and ($2::text is null or coalesce(l.territory_code, f.territory_code) = $2)
      order by l.created_at desc limit 200`, [mine, q.territory ?? null])).rows;
  const myData = await loadFarmData(c.db, mine);
  const lim = await inbreedingLimits(c.db);
  const cache = new Map<string, FarmData>();
  const out = [];
  for (const l of listings) {
    if (!cache.has(l.farm_id)) cache.set(l.farm_id, await serviceData(l.farm_id));
    const d = cache.get(l.farm_id)!;
    const a = d.byId.get(l.animal_id);
    if (!a || a.status !== 'active') continue;
    if (q.species && (a.species ?? 'ovine') !== q.species) continue;
    if (q.sex && a.sex !== q.sex) continue;
    if (q.breed && a.breed_code !== q.breed) continue;
    if (q.q && !`${a.name ?? ''} ${a.internal_id} ${a.official_id ?? ''} ${l.farm_name} ${l.locality ?? ''} ${l.farm_locality ?? ''}`.toLowerCase().includes(q.q.toLowerCase())) continue;
    const mates = myData.animals.filter((m) => m.status === 'active' && m.sex !== a.sex && (m.species ?? 'ovine') === (a.species ?? 'ovine'));
    const merged = mergedPedigree([myData, d]);
    const compat = { ok: 0, warning: 0, refused: 0, total: mates.length };
    for (const m of mates) {
      try { const r = await crossInbreeding(c.db, { data: myData, id: m.id }, { data: d, id: a.id }, merged, lim); compat[r.level]++; } catch { /* même animal ou boucle : ignoré */ }
    }
    if (q.compatible && compat.ok + compat.warning === 0) continue;
    const p = await performance(c.db, d, a.id);
    out.push({
      ...listingPublic(l), farm: { name: l.farm_name, locality: l.locality ?? l.farm_locality, territory: l.territory_code ?? l.farm_territory },
      animal: publicAnimal(a), perf: { gmq: p.gmq, weight_j90: p.weight_j90, progeny_n: p.progeny.n, progeny_gmq_mean: p.progeny.gmq_mean, success_rate: p.success.rate, success_n: p.success.n, litter_mean: p.litter.mean },
      compat,
    });
  }
  return out;
}));

breedingRouter.get('/listings/:id', h(async (c) => {
  const mine = String(c.req.query.farm ?? '');
  await myFarm(c, mine);
  const t = await resolveTarget(c, mine, { listing: c.req.params.id as string });
  const d = await serviceData(t.farmId);
  const a = d.byId.get(t.animalId);
  if (!a || a.status !== 'active') throw notFound('listing_not_found');
  const myData = await loadFarmData(c.db, mine);
  const lim = await inbreedingLimits(c.db);
  const merged = mergedPedigree([myData, d]);
  const mates = [];
  for (const m of myData.animals.filter((m) => m.status === 'active' && m.sex !== a.sex && (m.species ?? 'ovine') === (a.species ?? 'ovine'))) {
    try { const r = await crossInbreeding(c.db, { data: myData, id: m.id }, { data: d, id: a.id }, merged, lim); mates.push({ id: m.id, name: m.name, internal_id: m.internal_id, breed_code: m.breed_code, coefficient_percent: r.coefficient_percent, level: r.level }); }
    catch { /* ignoré */ }
  }
  await c.db.query('update breeding_listings set views = views + 1 where id = $1', [t.listing.id]);
  const farm = await farmInfo(c, t.farmId);
  return { ...listingPublic(t.listing), farm: { name: farm.name, locality: t.listing.locality ?? farm.locality }, animal: publicAnimal(a), perf: await performance(c.db, d, a.id),
    mates: mates.sort((x, y) => x.coefficient_percent - y.coefficient_percent), limits: lim };
}));

// ======================= Côté élevage =======================
export const farmBreedingRouter = Router({ mergeParams: true });

farmBreedingRouter.get('/breeding/mine', h(async (c) => {
  await myFarm(c, fid(c));
  const listings = (await c.db.query(
    `select l.*, a.name, a.internal_id, a.sex, a.species,
            (select count(*)::int from breeding_proposals p where p.listing_id = l.id) as proposals
       from breeding_listings l join animals a on a.id = l.animal_id where l.farm_id = $1 and l.status <> 'withdrawn' order by l.created_at desc`, [fid(c)])).rows;
  const codes = (await c.db.query(
    `select k.id, k.code, k.expires_at, a.name, a.internal_id from breeding_codes k join animals a on a.id = k.animal_id
      where k.farm_id = $1 and k.revoked_at is null and k.expires_at > now() order by k.created_at desc`, [fid(c)])).rows.map((k) => ({ ...k, code: fmtCode(k.code) }));
  const props = (await c.db.query(
    `select p.id, p.status, p.created_at, p.responded_at, p.message, p.response_message, p.from_farm_id, p.to_farm_id, p.snapshot,
            ff.name as from_farm, tf.name as to_farm
       from breeding_proposals p join farms ff on ff.id = p.from_farm_id join farms tf on tf.id = p.to_farm_id
      where p.from_farm_id = $1 or p.to_farm_id = $1 order by p.created_at desc limit 100`, [fid(c)])).rows;
  const slim = (p: any) => ({ id: p.id, status: p.status, created_at: p.created_at, responded_at: p.responded_at, message: p.message, response_message: p.response_message,
    from_farm: p.from_farm, to_farm: p.to_farm, mine: p.snapshot.mine.animal, theirs: p.snapshot.theirs.animal, coefficient_percent: p.snapshot.inbreeding.coefficient_percent, level: p.snapshot.inbreeding.level });
  return {
    listings, codes,
    received: props.filter((p) => p.to_farm_id === fid(c)).map((p) => ({ ...slim(p), mine: p.snapshot.theirs.animal, theirs: p.snapshot.mine.animal })),
    sent: props.filter((p) => p.from_farm_id === fid(c)).map(slim),
  };
}));

farmBreedingRouter.get('/breeding/animal/:animalId', h(async (c) => {
  await myFarm(c, fid(c));
  const listing = (await c.db.query(`select * from breeding_listings where farm_id = $1 and animal_id = $2 and status <> 'withdrawn' limit 1`, [fid(c), c.req.params.animalId])).rows[0] ?? null;
  const codes = (await c.db.query(`select id, code, expires_at from breeding_codes where farm_id = $1 and animal_id = $2 and revoked_at is null and expires_at > now() order by created_at desc`, [fid(c), c.req.params.animalId])).rows
    .map((k) => ({ ...k, code: fmtCode(k.code) }));
  return { listing, codes };
}));

const zListing = z.object({
  animal_id: zUuid, months: z.union([z.literal(1), z.literal(3), z.literal(6), z.null()]), locality: zOptText(120),
  modality: z.enum(['onsite', 'travel', 'both']).default('onsite'), conditions: zOptText(1000),
});

farmBreedingRouter.post('/breeding/listings', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zListing, c.req.body);
  const a = (await c.db.query(`select id, status from animals where id = $1 and farm_id = $2`, [b.animal_id, fid(c)])).rows[0];
  if (!a) throw notFound('animal_not_found');
  if (a.status !== 'active') throw bad('animal_not_active');
  const farm = await farmInfo(c, fid(c));
  const until = b.months ? new Date(Date.now() + b.months * 30.44 * 86400000).toISOString().slice(0, 10) : null;
  const cur = (await c.db.query(`select id from breeding_listings where animal_id = $1 and status <> 'withdrawn'`, [b.animal_id])).rows[0];
  const { rows } = cur
    ? await c.db.query(`update breeding_listings set status = 'active', available_until = $2, locality = $3, modality = $4, conditions = $5, territory_code = $6, updated_at = now() where id = $1 returning *`,
      [cur.id, until, b.locality ?? farm.locality, b.modality, b.conditions, farm.territory_code])
    : await c.db.query(`insert into breeding_listings (farm_id, animal_id, available_until, locality, modality, conditions, territory_code, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [fid(c), b.animal_id, until, b.locality ?? farm.locality, b.modality, b.conditions, farm.territory_code, c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'breeding.listing_published', resource: 'breeding_listing', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

farmBreedingRouter.patch('/breeding/listings/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ status: z.enum(['active', 'paused', 'withdrawn']) }), c.req.body);
  const { rows } = await c.db.query(`update breeding_listings set status = $3, updated_at = now() where id = $1 and farm_id = $2 and status <> 'withdrawn' returning *`, [c.req.params.id, fid(c), b.status]);
  if (!rows[0]) throw notFound();
  await audit(c.db, { actor: c.user.id, action: `breeding.listing_${b.status}`, resource: 'breeding_listing', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return rows[0];
}));

/** Code privé (7 jours, réutilisable pendant sa validité) pour un éleveur précis. */
farmBreedingRouter.post('/breeding/codes', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ animal_id: zUuid }), c.req.body);
  const a = (await c.db.query(`select id, status from animals where id = $1 and farm_id = $2`, [b.animal_id, fid(c)])).rows[0];
  if (!a) throw notFound('animal_not_found');
  if (a.status !== 'active') throw bad('animal_not_active');
  let code = '';
  for (let i = 0; i < 8; i++) {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join('');
    if (!(await c.db.query('select 1 from breeding_codes where code = $1', [code])).rowCount) break;
  }
  const { rows } = await c.db.query(`insert into breeding_codes (farm_id, animal_id, code, expires_at, created_by) values ($1,$2,$3, now() + interval '7 days', $4) returning id, code, expires_at`,
    [fid(c), b.animal_id, code, c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'breeding.code_created', resource: 'breeding_code', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  return { ...rows[0], code: fmtCode(rows[0].code) };
}));

farmBreedingRouter.post('/breeding/codes/:id/revoke', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const { rowCount } = await c.db.query('update breeding_codes set revoked_at = now() where id = $1 and farm_id = $2 and revoked_at is null', [c.req.params.id, fid(c)]);
  if (!rowCount) throw notFound();
  return { ok: true };
}));

/** Aperçu de l'animal partagé par code (avant de choisir sa propre femelle ou son mâle). */
farmBreedingRouter.get('/breeding/resolve', h(async (c) => {
  await myFarm(c, fid(c));
  const t = await resolveTarget(c, fid(c), { code: String(c.req.query.code ?? ''), listing: (c.req.query.listing as string) || null });
  const d = await serviceData(t.farmId);
  const a = d.byId.get(t.animalId);
  if (!a || a.status !== 'active') throw notFound('listing_not_found');
  const farm = await farmInfo(c, t.farmId);
  return { animal: publicAnimal(a), farm: { name: farm.name, locality: t.listing?.locality ?? farm.locality }, listing: listingPublic(t.listing), listing_id: t.listing?.status === 'active' ? t.listing.id : null };
}));

farmBreedingRouter.get('/breeding/simulate', h(async (c) => {
  await myFarm(c, fid(c));
  const q = parse(z.object({ my: zUuid, listing: zUuid.optional(), code: z.string().max(12).optional() }), c.req.query);
  const t = await resolveTarget(c, fid(c), q);
  const r = await simulate(c, fid(c), q.my, t);
  if (t.listing) await c.db.query('update breeding_listings set simulations = simulations + 1 where id = $1', [t.listing.id]);
  return r;
}));

farmBreedingRouter.post('/breeding/proposals', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ my_animal_id: zUuid, listing_id: zUuid.optional().nullable(), code: z.string().max(12).optional().nullable(), message: zOptText(1000) }), c.req.body);
  const t = await resolveTarget(c, fid(c), { listing: b.listing_id, code: b.code });
  const dup = await c.db.query(`select 1 from breeding_proposals where from_animal_id = $1 and to_animal_id = $2 and status = 'pending'`, [b.my_animal_id, t.animalId]);
  if (dup.rowCount) throw conflict('proposal_pending');
  const snap = await simulate(c, fid(c), b.my_animal_id, t);
  const { rows } = await c.db.query(
    `insert into breeding_proposals (listing_id, code_id, from_farm_id, from_animal_id, to_farm_id, to_animal_id, message, snapshot, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [t.listing?.id ?? null, t.code?.id ?? null, fid(c), b.my_animal_id, t.farmId, t.animalId, b.message, JSON.stringify(snap), c.user.id]);
  const to = await c.db.query(`select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and m.role in ('owner','collaborator') and m.status = 'active'`, [t.farmId]);
  const label = (a: any) => a.name ?? a.internal_id;
  for (const u of to.rows) {
    await notify(c.db, u.id, 'breeding_proposal', { from: snap.mine.farm.name, mine: label(snap.theirs.animal), theirs: label(snap.mine.animal), id: rows[0].id });
    await sendMail(c.db, u.email, u.lang, 'breeding_proposal', { from: snap.mine.farm.name, animal: label(snap.theirs.animal), other: label(snap.mine.animal), pct: snap.inbreeding.coefficient_percent, id: rows[0].id, message: b.message });
  }
  await audit(c.db, { actor: c.user.id, action: 'breeding.proposal_sent', resource: 'breeding_proposal', resourceId: rows[0].id, farmId: fid(c), ip: c.ip, details: { to_farm: t.farmId } });
  return { id: rows[0].id };
}));

async function proposalFor(c: Ctx, id: string) {
  const p = (await c.db.query(
    `select p.*, ff.name as from_farm, tf.name as to_farm from breeding_proposals p join farms ff on ff.id = p.from_farm_id join farms tf on tf.id = p.to_farm_id
      where p.id = $1 and (p.from_farm_id = $2 or p.to_farm_id = $2)`, [id, fid(c)])).rows[0];
  if (!p) throw notFound();
  return p;
}
const viewOf = (c: Ctx, p: any) => {
  const incoming = p.to_farm_id === fid(c);
  const s = p.snapshot;
  // Toujours présenté du point de vue de l'élevage qui consulte : « mine » = mon animal
  const view = incoming ? { ...s, mine: s.theirs, theirs: s.mine, male: s.male === 'mine' ? 'theirs' : 'mine' } : s;
  return { id: p.id, status: p.status, incoming, created_at: p.created_at, responded_at: p.responded_at, message: p.message, response_message: p.response_message,
    from_farm: p.from_farm, to_farm: p.to_farm, result: view };
};

farmBreedingRouter.get('/breeding/proposals/:id', h(async (c) => {
  await myFarm(c, fid(c));
  return viewOf(c, await proposalFor(c, c.req.params.id as string));
}));

farmBreedingRouter.post('/breeding/proposals/:id/respond', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ accept: z.boolean(), message: zOptText(1000) }), c.req.body);
  const p = await proposalFor(c, c.req.params.id as string);
  if (p.to_farm_id !== fid(c)) throw forbidden('not_recipient');
  if (p.status !== 'pending') throw conflict('proposal_closed');
  const status = b.accept ? 'accepted' : 'declined';
  await c.db.query(`update breeding_proposals set status = $2, response_message = $3, responded_by = $4, responded_at = now() where id = $1`, [p.id, status, b.message, c.user.id]);
  const to = await c.db.query(`select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and m.role in ('owner','collaborator') and m.status = 'active'`, [p.from_farm_id]);
  for (const u of to.rows) {
    await notify(c.db, u.id, 'breeding_response', { farm: p.to_farm, status, id: p.id });
    await sendMail(c.db, u.email, u.lang, 'breeding_response', { farm: p.to_farm, accepted: b.accept, message: b.message, id: p.id });
  }
  await audit(c.db, { actor: c.user.id, action: `breeding.proposal_${status}`, resource: 'breeding_proposal', resourceId: p.id, farmId: fid(c), ip: c.ip });
  return viewOf(c, await proposalFor(c, p.id));
}));

farmBreedingRouter.post('/breeding/proposals/:id/cancel', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const p = await proposalFor(c, c.req.params.id as string);
  if (p.from_farm_id !== fid(c)) throw forbidden('not_sender');
  if (p.status !== 'pending') throw conflict('proposal_closed');
  await c.db.query(`update breeding_proposals set status = 'cancelled', responded_at = now() where id = $1`, [p.id]);
  return viewOf(c, await proposalFor(c, p.id));
}));

