import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, withTx } from '../src/db.js';
import { setup, agent, registerVerified, makeAdmin, approvedFarmer, post, put, patch, del, reqBody, lastToken, H } from './helpers.js';
import { totp } from '../src/lib/crypto.js';

let app: any, admin: any;
beforeAll(async () => { app = await setup(); admin = await makeAdmin(app); });
afterAll(async () => { await pool.end(); });

const animal = (o: any = {}) => ({ internal_id: 'A' + Math.random().toString(36).slice(2, 8), sex: 'M', birth_date: '2026-09-19', breed_code: 'BB_X_IDF', ...o });

describe('Sécurité de base', () => {
  it('santé de l’API', async () => {
    const r = await agent(app, 'x').get('/api/health');
    expect(r.status).toBe(200);
  });
  it('refuse les requêtes modifiantes sans en-tête anti-CSRF', async () => {
    const r = await agent(app, 'x').post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('csrf');
  });
  it('politique de mot de passe', async () => {
    const r = await post(agent(app, 'w'), '/api/auth/register', { email: 'weak@test.org', password: 'court', first_name: 'a', last_name: 'b' });
    expect(r.status).toBe(400);
  });
  it('limite les tentatives de connexion', async () => {
    await registerVerified(app, 'brute@test.org');
    const a = agent(app, 'brute');
    for (let i = 0; i < 5; i++) expect((await post(a, '/api/auth/login', { email: 'brute@test.org', password: 'mauvais-mdp-1' })).status).toBe(401);
    const r = await post(a, '/api/auth/login', { email: 'brute@test.org', password: 'motdepasse-solide-1' });
    expect(r.status).toBe(429);
  });
  it('un administrateur sans MFA validée est bloqué', async () => {
    const a = agent(app, 'admin@test.org');
    const l = await post(a, '/api/auth/login', { email: 'admin@test.org', password: 'admin-password-1' });
    expect(l.body.mfa_required).toBe(true);
    expect((await a.get('/api/admin/users')).body.error).toBe('mfa_required');
    const s = await pool.query(`select mfa_secret from users where email = 'admin@test.org'`);
    expect((await post(a, '/api/auth/mfa/verify', { code: '000000' })).status).toBe(400);
    expect((await post(a, '/api/auth/mfa/verify', { code: totp(s.rows[0].mfa_secret) })).status).toBe(200);
    expect((await a.get('/api/admin/users')).status).toBe(200);
  });
  it('réinitialisation du mot de passe', async () => {
    await registerVerified(app, 'reset@test.org');
    const a = agent(app, 'r');
    await post(a, '/api/auth/forgot-password', { email: 'reset@test.org' });
    const tok = await lastToken('reset@test.org');
    expect((await post(a, '/api/auth/reset-password', { token: tok, password: 'nouveau-mdp-2026' })).status).toBe(200);
    expect((await post(a, '/api/auth/reset-password', { token: tok, password: 'nouveau-mdp-2026' })).status).toBe(400); // usage unique
    expect((await post(a, '/api/auth/login', { email: 'reset@test.org', password: 'nouveau-mdp-2026' })).status).toBe(200);
  });
});

describe('Cycle de vie d’une inscription (§20, §27)', () => {
  it('parcours complet avec complément, refus, réexamen et approbation', async () => {
    const a = agent(app, 'new@test.org');
    await post(a, '/api/auth/register', { email: 'new@test.org', password: 'motdepasse-solide-1', first_name: 'Nou', last_name: 'Veau', lang: 'fr' });
    // compte créé mais email non vérifié : aucune fonction métier
    expect((await a.get('/api/farms')).body.error).toBe('email_not_verified');
    await post(a, '/api/auth/verify-email', { token: await lastToken('new@test.org') });
    // brouillon
    const d = await put(a, '/api/registration/mine', reqBody({ accepted_terms: false }));
    expect(d.body.status).toBe('draft');
    expect((await put(a, '/api/registration/mine?submit=1', reqBody({ accepted_terms: false }))).body.error).toBe('declarations_required');
    const s = await put(a, '/api/registration/mine?submit=1', reqBody({ farm_name: 'Habitation Nouveau' }));
    expect(s.body.status).toBe('pending');
    // en attente : toujours aucun accès métier
    expect((await a.get('/api/farms')).body).toEqual([]);
    expect((await put(a, '/api/registration/mine', reqBody())).status).toBe(409);
    // motif obligatoire
    expect((await post(admin, `/api/registration/review/${s.body.id}/decision`, { action: 'request_info' })).body.error).toBe('reason_required');
    expect((await post(admin, `/api/registration/review/${s.body.id}/decision`, { action: 'request_info', reason: 'Préciser la commune' })).body.status).toBe('info_requested');
    expect((await put(a, '/api/registration/mine?submit=1', reqBody({ farm_name: 'Habitation Nouveau', locality: 'Ducos' }))).body.status).toBe('pending');
    expect((await post(admin, `/api/registration/review/${s.body.id}/decision`, { action: 'reject', reason: 'Activité non confirmée' })).body.status).toBe('rejected');
    const mine = await a.get('/api/registration/mine');
    expect(mine.body.status).toBe('rejected');
    expect(mine.body.decision_reason).toBe('Activité non confirmée');
    expect(mine.body.assigned_to).toBeUndefined();
    // réexamen : nouvelle demande
    const s2 = await put(a, '/api/registration/mine?submit=1', reqBody({ farm_name: 'Habitation Nouveau', message: 'Justificatif : n° EDE' }));
    expect(s2.body.id).not.toBe(s.body.id);
    const ap = await post(admin, `/api/registration/review/${s2.body.id}/decision`, { action: 'approve' });
    expect(ap.body.status).toBe('approved');
    const farms = await a.get('/api/farms');
    expect(farms.body).toHaveLength(1);
    expect(farms.body[0].role).toBe('owner');
    // transition invalide
    expect((await post(admin, `/api/registration/review/${s2.body.id}/decision`, { action: 'approve' })).status).toBe(409);
    // notifications sans donnée de tiers
    const n = await a.get('/api/auth/notifications');
    expect(n.body.some((x: any) => x.payload.status === 'approved')).toBe(true);
    const audit = await pool.query(`select count(*)::int n from audit_logs where resource_id = $1 and action like 'registration.%'`, [s2.body.id]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('un validateur territorial ne voit que les demandes qui lui sont affectées', async () => {
    const vMQ = await registerVerified(app, 'val-mq@test.org');
    const vGP = await registerVerified(app, 'val-gp@test.org');
    expect((await patch(admin, `/api/admin/users/${vMQ.id}`, { platform_role: 'validator', territories: ['MQ'] })).status).toBe(200);
    await patch(admin, `/api/admin/users/${vGP.id}`, { platform_role: 'validator', territories: ['GP'] });
    // les sessions ont été invalidées lors du changement de rôle : reconnexion
    for (const v of [vMQ, vGP]) await post(v, '/api/auth/login', { email: v.email, password: 'motdepasse-solide-1' });
    const c1 = await registerVerified(app, 'cand-gp@test.org');
    const r1 = await put(c1, '/api/registration/mine?submit=1', reqBody({ territory_code: 'GP', farm_name: 'Ferme GP' }));
    const listMQ = await vMQ.get('/api/registration/review');
    const listGP = await vGP.get('/api/registration/review');
    expect(listMQ.body.map((x: any) => x.id)).not.toContain(r1.body.id);
    expect(listGP.body.map((x: any) => x.id)).toContain(r1.body.id);
    expect((await vMQ.get(`/api/registration/review/${r1.body.id}`)).status).toBe(404);
    expect((await post(vMQ, `/api/registration/review/${r1.body.id}/decision`, { action: 'approve' })).status).toBe(404);
    expect((await post(vGP, `/api/registration/review/${r1.body.id}/decision`, { action: 'approve' })).status).toBe(200);
    // aucun accès par défaut aux cheptels pour le validateur
    const farmId = (await c1.get('/api/farms')).body[0].id;
    expect((await vGP.get(`/api/farms/${farmId}/animals`)).status).toBe(404);
    // territoire non ouvert
    expect((await put(c1, '/api/registration/mine', reqBody({ territory_code: 'BB' }))).status).toBeGreaterThanOrEqual(400);
  });
});

describe('Isolation des exploitations (§10, §21, §27)', () => {
  let A: any, B: any;
  beforeAll(async () => {
    A = await approvedFarmer(app, admin, 'a@farm.org');
    B = await approvedFarmer(app, admin, 'b@farm.org');
  });

  it('un éleveur n’accède jamais aux animaux d’une autre exploitation', async () => {
    const an = await post(A, `/api/farms/${A.farmId}/animals`, animal({ internal_id: 'SECRET-1' }));
    expect(an.status).toBe(200);
    expect((await B.get(`/api/farms/${A.farmId}/animals`)).status).toBe(404);
    expect((await B.get(`/api/farms/${A.farmId}/animals/${an.body.id}`)).status).toBe(404);
    expect((await post(B, `/api/farms/${A.farmId}/animals`, animal())).status).toBe(404);
    expect((await post(B, `/api/farms/${A.farmId}/animals/${an.body.id}/weighings`, { date: '2026-10-01', weight_kg: 5 })).status).toBe(404);
    expect((await B.get(`/api/farms/${A.farmId}/export/animals.csv`)).status).toBe(404);
    // B ne peut pas viser l’animal de A via sa propre exploitation
    expect((await B.get(`/api/farms/${B.farmId}/animals/${an.body.id}`)).status).toBe(404);
    expect((await post(B, `/api/farms/${B.farmId}/animals/${an.body.id}/weighings`, { date: '2026-10-01', weight_kg: 5 })).status).toBe(404);
    // ni l’utiliser comme parent
    expect((await post(B, `/api/farms/${B.farmId}/animals`, animal({ sire_id: an.body.id }))).body.error).toBe('parent_not_found');
    // ni dans un événement de santé
    expect((await post(B, `/api/farms/${B.farmId}/health`, { animal_id: an.body.id, date: '2026-10-01', type: 'observation' })).status).toBe(404);
  });

  it('la base de données (RLS) bloque aussi l’accès inter-exploitations', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.user_id', $1, true)`, [B.id]);
      const r = await c.query('select count(*)::int n from animals where farm_id = $1', [A.farmId]);
      expect(r.rows[0].n).toBe(0);
      await expect(c.query(`insert into animals (farm_id, internal_id, sex) values ($1,'HACK','M')`, [A.farmId])).rejects.toThrow(/row-level security/);
      await c.query('rollback');
      // sans contexte utilisateur : aucune ligne
      await c.query('begin');
      const r2 = await c.query('select count(*)::int n from animals');
      expect(r2.rows[0].n).toBe(0);
      await c.query('rollback');
    } finally { c.release(); }
  });

  it('administrateur : pas d’accès aux cheptels sans justification tracée', async () => {
    expect((await admin.get(`/api/farms/${A.farmId}/animals`)).status).toBe(404);
    expect((await post(admin, `/api/admin/farms/${A.farmId}/access`, { justification: 'court' })).status).toBe(400);
    expect((await post(admin, `/api/admin/farms/${A.farmId}/access`, { justification: 'Support demandé par l’éleveur, ticket 42', hours: 1 })).status).toBe(200);
    const r = await admin.get(`/api/farms/${A.farmId}/animals`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect((await post(admin, `/api/farms/${A.farmId}/animals`, animal())).status).toBe(403); // lecture seule
    expect((await admin.get(`/api/farms/${A.farmId}/export/animals.csv`)).status).toBe(403);
    const log = await pool.query(`select 1 from audit_logs where action = 'admin.farm_access_granted' and farm_id = $1`, [A.farmId]);
    expect(log.rowCount).toBe(1);
  });

  it('collaborateur (saisie) et référent technique (lecture seule)', async () => {
    const col = await registerVerified(app, 'collab@test.org');
    const ref = await registerVerified(app, 'referent@test.org');
    expect((await post(A, `/api/farms/${A.farmId}/invitations`, { email: 'collab@test.org', role: 'collaborator' })).status).toBe(200);
    expect((await post(A, `/api/farms/${A.farmId}/invitations`, { email: 'referent@test.org', role: 'referent' })).status).toBe(200);
    // B ne peut pas inviter dans la ferme de A
    expect((await post(B, `/api/farms/${A.farmId}/invitations`, { email: 'x@test.org', role: 'collaborator' })).status).toBe(404);
    for (const u of [col, ref]) {
      const me = await u.get('/api/auth/me');
      expect(me.body.invitations).toHaveLength(1);
      expect((await post(u, `/api/invitations/${me.body.invitations[0].id}/accept`)).status).toBe(200);
    }
    expect((await post(col, `/api/farms/${A.farmId}/animals`, animal())).status).toBe(200);
    expect((await post(col, `/api/farms/${A.farmId}/invitations`, { email: 'z@test.org', role: 'referent' })).body.error).toBe('owner_only');
    expect((await ref.get(`/api/farms/${A.farmId}/animals`)).status).toBe(200);
    expect((await post(ref, `/api/farms/${A.farmId}/animals`, animal())).body.error).toBe('read_only');
    // la RLS refuse aussi l’écriture au référent
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.user_id', $1, true)`, [ref.id]);
      await expect(c.query(`insert into animals (farm_id, internal_id, sex) values ($1,'REF','M')`, [A.farmId])).rejects.toThrow(/row-level security/);
      await c.query('rollback');
    } finally { c.release(); }
    // révocation des droits
    expect((await patch(A, `/api/farms/${A.farmId}/members/${col.id}`, { status: 'revoked' })).status).toBe(200);
    expect((await col.get(`/api/farms/${A.farmId}/animals`)).status).toBe(404);
  });

  it('suspension : accès métier interrompu, puis rétabli', async () => {
    const S = await approvedFarmer(app, admin, 'susp@farm.org');
    const reqId = (await S.get('/api/registration/mine')).body.id;
    expect((await post(admin, `/api/registration/review/${reqId}/decision`, { action: 'suspend', reason: 'Contrôle' })).status).toBe(200);
    expect((await S.get(`/api/farms/${S.farmId}/animals`)).body.error).toBe('farm_suspended');
    expect((await post(admin, `/api/registration/review/${reqId}/decision`, { action: 'reinstate' })).status).toBe(200);
    expect((await S.get(`/api/farms/${S.farmId}/animals`)).status).toBe(200);
  });
});

describe('Animaux, pesées et GMQ (§9, §15)', () => {
  let F: any, ram: any;
  beforeAll(async () => {
    F = await approvedFarmer(app, admin, 'gmq@farm.org');
    ram = (await post(F, `/api/farms/${F.farmId}/animals`, animal({ internal_id: 'BELIER-1', name: 'Bélier 1', birth_date: '2026-09-19' }))).body;
  });
  const W = (b: any) => post(F, `/api/farms/${F.farmId}/animals/${ram.id}/weighings`, b);

  it('identifiant unique par exploitation', async () => {
    expect((await post(F, `/api/farms/${F.farmId}/animals`, animal({ internal_id: 'BELIER-1' }))).body.error).toBe('internal_id_taken');
  });
  it('rejette les saisies incohérentes', async () => {
    expect((await W({ date: '2026-09-01', weight_kg: 4 })).body.error).toBe('date_before_birth');
    expect((await W({ date: '2026-10-01', weight_kg: 0 })).body.error).toBe('weight_not_positive');
    expect((await W({ date: '2026-10-01', weight_kg: -3 })).body.error).toBe('weight_not_positive');
    expect((await W({ date: '2099-10-01', weight_kg: 3 })).body.error).toBe('date_in_future');
    expect((await W({ date: '2026-13-01', weight_kg: 3 })).status).toBe(400);
  });
  it('historique ordonné et GMQ exact (données de démonstration)', async () => {
    for (const [date, w] of [['2026-11-14', 13.29], ['2026-10-31', 11.3], ['2026-11-07', 12.81]] as const)
      expect((await W({ date, weight_kg: w })).status).toBe(200);
    const r = await F.get(`/api/farms/${F.farmId}/animals/${ram.id}`);
    expect(r.body.weighings.map((w: any) => w.date)).toEqual(['2026-10-31', '2026-11-07', '2026-11-14']);
    expect(r.body.growth.periods[0].gmq).toBeCloseTo(215.7, 1);
    expect(r.body.growth.periods[1].gmq).toBeCloseTo(68.6, 1);
    expect(r.body.growth.overall).toBeCloseTo(142.1, 1);
    // aucune valeur inventée : J30 (19/10) non encadré → null
    expect(r.body.growth.standard_weights.j30).toBeNull();
  });
  it('doublon et valeur atypique : confirmation demandée', async () => {
    const d = await W({ date: '2026-11-14', weight_kg: 13.3 });
    expect(d.status).toBe(422);
    expect(d.body.details.warnings).toContain('duplicate_date');
    const a = await W({ date: '2026-11-15', weight_kg: 25 });
    expect(a.body.details.warnings).toContain('gmq_atypical');
    expect((await W({ date: '2026-11-15', weight_kg: 13.4, note: 'ok' })).status).toBe(200);
  });
  it('correction avec motif et historique d’audit', async () => {
    const r = await F.get(`/api/farms/${F.farmId}/animals/${ram.id}`);
    const w = r.body.weighings.find((x: any) => x.date === '2026-11-15');
    expect((await put(F, `/api/farms/${F.farmId}/weighings/${w.id}`, { date: '2026-11-15', weight_kg: 13.45 })).body.error).toBe('reason_required');
    expect((await put(F, `/api/farms/${F.farmId}/weighings/${w.id}`, { date: '2026-11-15', weight_kg: 13.45, reason: 'erreur de lecture' })).status).toBe(200);
    expect((await del(F, `/api/farms/${F.farmId}/weighings/${w.id}?reason=doublon`)).status).toBe(204);
    const h = await F.get(`/api/farms/${F.farmId}/history?record=${w.id}`);
    expect(h.body.map((x: any) => x.action).sort()).toEqual(['delete', 'update']);
    expect(h.body.find((x: any) => x.action === 'update').before.weight_kg).toBe(13.4);
  });
  it('synchronisation hors connexion idempotente', async () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    const b = { date: '2026-11-20', weight_kg: 13.6, client_uuid: uuid, source: 'offline_sync' };
    const r1 = await W(b); const r2 = await W(b);
    expect(r1.status).toBe(200); expect(r2.body.replayed).toBe(true);
    expect(r2.body.id).toBe(r1.body.id);
  });
  it('filiation contrôlée', async () => {
    const ewe = (await post(F, `/api/farms/${F.farmId}/animals`, animal({ internal_id: 'BREBIS-1', sex: 'F', birth_date: '2024-01-01' }))).body;
    expect((await post(F, `/api/farms/${F.farmId}/animals`, animal({ sire_id: ewe.id }))).body.error).toBe('sire_must_be_male');
    expect((await post(F, `/api/farms/${F.farmId}/animals`, animal({ dam_id: ram.id }))).body.error).toBe('dam_must_be_female');
    const lamb = await post(F, `/api/farms/${F.farmId}/animals`, animal({ internal_id: 'AGN-1', dam_id: ewe.id, birth_date: '2026-10-01', parentage_source: 'observed', parentage_certainty: 'certain', birth: { litter_size: 2, birth_weight_kg: 3.2, vitality: 'good', colostrum: 'yes', assistance: 'none' } }));
    expect(lamb.status).toBe(200);
    const d = await F.get(`/api/farms/${F.farmId}/animals/${lamb.body.id}`);
    expect(d.body.dam.internal_id).toBe('BREBIS-1');
    expect(d.body.birth.birth_weight_kg).toBe(3.2);
    expect((await post(F, `/api/farms/${F.farmId}/animals`, animal({ internal_id: 'X', dam_id: lamb.body.id, sex: 'M', birth_date: '2026-09-01' }))).body.error).toBe('dam_must_be_female');
  });
  it('alimentation, santé, reproduction et indicateurs', async () => {
    const lot = (await post(F, `/api/farms/${F.farmId}/lots`, { name: 'Engraissement' })).body;
    expect((await post(F, `/api/farms/${F.farmId}/feeding`, { lot_id: lot.id, feed: 'Granulé', quantity_kg: 10, start_date: '2026-11-01', cost_eur: 12.5 })).status).toBe(200);
    expect((await post(F, `/api/farms/${F.farmId}/feeding`, { feed: 'Foin', quantity_kg: 10, start_date: '2026-11-01' })).status).toBe(400);
    expect((await post(F, `/api/farms/${F.farmId}/health`, { animal_id: ram.id, date: '2026-11-10', type: 'analysis', analysis_type: 'coproscopie', analysis_result: '1200 OPG', diagnosis_status: 'suspected' })).status).toBe(400);
    expect((await post(F, `/api/farms/${F.farmId}/health`, { animal_id: ram.id, date: '2026-11-10', type: 'treatment', diagnosis_status: 'suspected', diagnosis: 'Strongylose', product: 'X', withdrawal_days: 28, famacha: 3 })).status).toBe(200);
    const ewe = (await F.get(`/api/farms/${F.farmId}/animals?q=BREBIS`)).body[0];
    expect((await post(F, `/api/farms/${F.farmId}/repro`, { ewe_id: ewe.id, type: 'mating', date: '2026-06-01', ram_id: ram.id })).status).toBe(200);
    expect((await post(F, `/api/farms/${F.farmId}/repro`, { ewe_id: ewe.id, type: 'lambing', date: '2026-10-01', born_alive: 2, born_dead: 0 })).status).toBe(200);
    expect((await post(F, `/api/farms/${F.farmId}/repro`, { ewe_id: ram.id, type: 'mating', date: '2026-06-01' })).body.error).toBe('dam_must_be_female');
    const an = await F.get(`/api/farms/${F.farmId}/analytics?from=2026-01-01&to=2026-11-22`);
    expect(an.status).toBe(200);
    expect(an.body.indicators.morbidity.num).toBe(1);
    expect(an.body.indicators.weaning_rate.value).toBe(0); // 0 sevré / 2 nés vivants
    expect(an.body.indicators.maternal_productivity.den).toBe(1);
    expect(an.body.indicators.feed_cost_per_kg.cost).toBe(12.5);
    const dash = await F.get(`/api/farms/${F.farmId}/dashboard`);
    expect(dash.body.animals.active).toBeGreaterThan(0);
    expect(dash.body.alerts.some((x: any) => x.type === 'withdrawal_period')).toBe(true);
    // GMQ du troupeau : animaux avec au moins 2 pesées seulement, série de 8 semaines sans valeur inventée
    expect(dash.body.growth.animals_measured).toBe(1);
    expect(dash.body.growth.weekly).toHaveLength(8);
    expect(dash.body.growth.weekly.every((w: any) => w.gmq === null ? w.n === 0 : w.n > 0)).toBe(true);
  });
  it('export CSV fidèle aux données enregistrées', async () => {
    const r = await F.get(`/api/farms/${F.farmId}/export/weighings.csv?lang=fr`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    const lines = r.text.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('identifiant_interne;date;poids_kg;hauteur_cm;longueur_cm;operateur;provenance;note;cree_le');
    const db = await withTx(F.id, (c) => c.query('select count(*)::int n from weighings where farm_id = $1', [F.farmId]));
    expect(lines.length - 1).toBe(db.rows[0].n);
    expect(lines.some((l) => l.startsWith('BELIER-1;2026-10-31;11.3;'))).toBe(true);
    const en = await F.get(`/api/farms/${F.farmId}/export/animals.csv?lang=en`);
    expect(en.text).toContain('internal_id;official_id');
  });
});

describe('Partage collectif consenti (§24, §27)', () => {
  it('seuil de 5 exploitations, catégories et retrait du consentement', async () => {
    const farmers: any[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await approvedFarmer(app, admin, `coll${i}@farm.org`);
      const a = (await post(f, `/api/farms/${f.farmId}/animals`, animal({ internal_id: `C${i}`, breed_code: 'BLACKBELLY', birth_date: '2026-08-01' }))).body;
      await post(f, `/api/farms/${f.farmId}/animals/${a.id}/weighings`, { date: '2026-09-01', weight_kg: 8 + i });
      await post(f, `/api/farms/${f.farmId}/animals/${a.id}/weighings`, { date: '2026-10-01', weight_kg: 12 + i });
      farmers.push(f);
    }
    const viewer = farmers[0];
    // aucune inscription ne vaut consentement : rien de publié
    let s = await viewer.get('/api/collective/stats?territory=MQ');
    expect(s.body.groups.find((g: any) => g.breed_code === 'BLACKBELLY')).toBeUndefined();
    expect((await post(farmers[1], `/api/farms/${farmers[1].farmId}/consents`, { purpose: 'collective_stats', categories: ['growth'] })).status).toBe(400); // acquittement requis
    for (const f of farmers.slice(0, 4)) expect((await post(f, `/api/farms/${f.farmId}/consents`, { purpose: 'collective_stats', categories: ['growth'], acknowledged: true })).status).toBe(200);
    s = await viewer.get('/api/collective/stats?territory=MQ');
    const g4 = s.body.groups.find((g: any) => g.breed_code === 'BLACKBELLY');
    expect(g4.suppressed).toBe(true);
    expect(g4.animals).toBeUndefined();
    const c5 = await post(farmers[4], `/api/farms/${farmers[4].farmId}/consents`, { purpose: 'collective_stats', categories: ['growth'], acknowledged: true });
    s = await viewer.get('/api/collective/stats?territory=MQ');
    const g5 = s.body.groups.find((g: any) => g.breed_code === 'BLACKBELLY');
    expect(g5.suppressed).toBe(false);
    expect(g5.farms).toBe(5);
    expect(g5.gmq.n).toBe(5);
    expect(g5.gmq.mean).toBeCloseTo(133.3, 1);
    // aucune ligne individuelle exposée
    expect(JSON.stringify(s.body)).not.toContain('C0');
    // portée « territoire » : non incluse dans les statistiques toutes zones
    const all = await viewer.get('/api/collective/stats');
    expect(all.body.groups.find((g: any) => g.breed_code === 'BLACKBELLY')).toBeUndefined();
    // retrait : usage collectif ultérieur empêché
    expect((await post(farmers[4], `/api/farms/${farmers[4].farmId}/consents/${c5.body.id}/revoke`)).status).toBe(200);
    s = await viewer.get('/api/collective/stats?territory=MQ');
    expect(s.body.groups.find((g: any) => g.breed_code === 'BLACKBELLY').suppressed).toBe(true);
    // un utilisateur sans exploitation ne voit pas les agrégats
    const nobody = await registerVerified(app, 'nobody@test.org');
    expect((await nobody.get('/api/collective/stats')).status).toBe(403);
    const csv = await viewer.get('/api/collective/stats.csv?territory=MQ');
    expect(csv.status).toBe(200);
  });
});

describe('Exploitation propre de l’administrateur', () => {
  it('l’administrateur crée son exploitation, réservé aux administrateurs, isolée des autres', async () => {
    const body = { territory_code: 'MQ', name: 'Ferme de l’admin', locality: 'Sainte-Anne', objective: 'meat' };
    expect((await post(admin, '/api/admin/my-farm', { ...body, territory_code: 'BB' })).body.error).toBe('territory_not_open');
    const r = await post(admin, '/api/admin/my-farm', body);
    expect(r.status).toBe(200);
    const farms = (await admin.get('/api/farms')).body;
    expect(farms.find((f: any) => f.id === r.body.farm_id).role).toBe('owner');
    const an = await post(admin, `/api/farms/${r.body.farm_id}/animals`, animal({ internal_id: 'ADM-1' }));
    expect(an.status).toBe(200);
    // un éleveur ordinaire ne peut ni utiliser la route ni voir cette exploitation
    const other = await approvedFarmer(app, admin, 'notadmin@farm.org');
    expect((await post(other, '/api/admin/my-farm', body)).status).toBe(403);
    expect((await other.get(`/api/farms/${r.body.farm_id}/animals`)).status).toBe(404);
    const log = await pool.query(`select 1 from audit_logs where action = 'admin.own_farm_created' and farm_id = $1`, [r.body.farm_id]);
    expect(log.rowCount).toBe(1);
  });
});

describe('Administration : suivi des inscriptions', () => {
  it('état d’inscription, renvoi du lien et validation manuelle de l’adresse', async () => {
    const u = agent(app, 'unverified@test.org');
    await post(u, '/api/auth/register', { email: 'unverified@test.org', password: 'motdepasse-solide-1', first_name: 'Non', last_name: 'Verifie' });
    const list = await admin.get('/api/admin/users?q=unverified');
    const row = list.body.find((x: any) => x.email === 'unverified@test.org');
    expect(row.email_verified).toBe(false);
    expect(row.registration_status).toBeNull();
    expect(row.last_verification_sent_at).not.toBeNull();
    // renvoi du lien : nouveau jeton utilisable
    const before = await lastToken('unverified@test.org');
    expect((await post(admin, `/api/admin/users/${row.id}/resend-verification`)).status).toBe(200);
    expect(await lastToken('unverified@test.org')).not.toBe(before);
    // réservé aux administrateurs
    const other = await registerVerified(app, 'notadmin2@test.org');
    expect((await post(other, `/api/admin/users/${row.id}/verify-email`, { reason: 'test test' })).status).toBe(403);
    // motif obligatoire
    expect((await post(admin, `/api/admin/users/${row.id}/verify-email`, {})).status).toBe(400);
    expect((await post(admin, `/api/admin/users/${row.id}/verify-email`, { reason: 'Confirmé par téléphone' })).status).toBe(200);
    expect((await post(admin, `/api/admin/users/${row.id}/verify-email`, { reason: 'Confirmé par téléphone' })).body.error).toBe('email_already_verified');
    // l’utilisateur peut désormais soumettre son dossier
    expect((await u.get('/api/farms')).status).toBe(200);
    const s = await put(u, '/api/registration/mine?submit=1', reqBody({ farm_name: 'Ferme vérifiée' }));
    expect(s.body.status).toBe('pending');
    const after = (await admin.get('/api/admin/users?q=unverified')).body[0];
    expect(after.registration_status).toBe('pending');
    expect(after.registration_id).toBe(s.body.id);
    const log = await pool.query(`select details from audit_logs where action = 'admin.email_verified_manually' and resource_id = $1`, [row.id]);
    expect(log.rows[0].details.reason).toBe('Confirmé par téléphone');
  });
});

describe('Droits RGPD', () => {
  it('export des données personnelles et suppression du compte', async () => {
    const u = await registerVerified(app, 'rgpd@test.org');
    const e = await u.get('/api/auth/me/export');
    expect(e.body.user.email).toBe('rgpd@test.org');
    expect((await post(u, '/api/auth/me/delete', { password: 'motdepasse-solide-1' })).status).toBe(200);
    const r = await pool.query(`select email, status from users where id = $1`, [u.id]);
    expect(r.rows[0].status).toBe('deleted');
    expect(r.rows[0].email).not.toContain('rgpd');
    expect((await u.get('/api/farms')).status).toBe(401);
  });
  it('le seul responsable d’une exploitation ne peut pas supprimer son compte sans transfert', async () => {
    const f = await approvedFarmer(app, admin, 'owner-del@farm.org');
    expect((await post(f, '/api/auth/me/delete', { password: 'motdepasse-solide-1' })).body.error).toBe('sole_owner_of_farm');
  });
});
