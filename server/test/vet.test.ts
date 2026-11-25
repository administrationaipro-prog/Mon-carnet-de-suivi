import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, withTx } from '../src/db.js';
import { setup, registerVerified, makeAdmin, approvedFarmer, post, put, del } from './helpers.js';
import { setExtractor } from '../src/lib/labExtract.js';
import { decide, DEFAULT_SETTINGS, fecrt } from '../src/lib/parasite.js';

let app: any, admin: any, F: any, vet: any, other: any;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const today = () => new Date().toISOString().slice(0, 10);
async function lastCode(email: string) {
  const { rows } = await pool.query(`select body from outbox_emails where to_email = $1 and subject like 'Code de signature%' order by id desc limit 1`, [email]);
  return /: (\d{6})\n/.exec(rows[0]?.body ?? '')?.[1] ?? '';
}

beforeAll(async () => {
  app = await setup(); admin = await makeAdmin(app);
  F = await approvedFarmer(app, admin, 'eleveur-veto@farm.org');
  vet = await registerVerified(app, 'dr.laurent@vet.org', 'Marie', 'Laurent');
  other = await registerVerified(app, 'dr.autre@vet.org', 'Paul', 'Autre');
});
afterAll(async () => { setExtractor(null); await pool.end(); });

describe('Aide à la décision parasitaire', () => {
  const base = { age_days: 900, pregnant_or_lactating: false, previous_famacha: null, gmq: null };
  const ex = (o: any) => ({ famacha: null, bcs: null, dag: null, jaw_edema: false, nasal: false, ...o });
  it('FAMACHA 4–5 : à traiter ; 1–2 : sans traitement', () => {
    expect(decide(ex({ famacha: 4 }), base, DEFAULT_SETTINGS).decision).toBe('treat');
    expect(decide(ex({ famacha: 5 }), base, DEFAULT_SETTINGS).decision).toBe('treat');
    expect(decide(ex({ famacha: 2, bcs: 3 }), base, DEFAULT_SETTINGS).decision).toBe('none');
  });
  it('FAMACHA 3 conditionnelle : traitée si allaitante, jeune, maigre, en hausse ou alerte troupeau ; sinon à surveiller', () => {
    expect(decide(ex({ famacha: 3, bcs: 3 }), base, DEFAULT_SETTINGS)).toEqual({ decision: 'watch', reasons: ['famacha_conditional'] });
    expect(decide(ex({ famacha: 3, bcs: 3 }), { ...base, pregnant_or_lactating: true }, DEFAULT_SETTINGS).reasons).toContain('pregnant_lactating');
    expect(decide(ex({ famacha: 3, bcs: 2 }), base, DEFAULT_SETTINGS).decision).toBe('treat');
    expect(decide(ex({ famacha: 3, bcs: 3 }), { ...base, age_days: 100 }, DEFAULT_SETTINGS).reasons).toContain('young');
    expect(decide(ex({ famacha: 3, bcs: 3 }), { ...base, previous_famacha: 2 }, DEFAULT_SETTINGS).reasons).toContain('famacha_rising');
    expect(decide(ex({ famacha: 3, bcs: 3 }), base, DEFAULT_SETTINGS, true).reasons).toContain('herd_alert');
    // seuils réglés par le vétérinaire
    expect(decide(ex({ famacha: 3, bcs: 2.5 }), base, { ...DEFAULT_SETTINGS, cond_bcs_max: 2.5 }).decision).toBe('treat');
  });
  it('œdème de la mâchoire, diarrhée, croissance faible des jeunes', () => {
    expect(decide(ex({ jaw_edema: true }), base, DEFAULT_SETTINGS).decision).toBe('treat');
    expect(decide(ex({ dag: 2 }), base, DEFAULT_SETTINGS).reasons).toEqual(['diarrhea']);
    expect(decide(ex({ famacha: 2 }), { ...base, age_days: 90, gmq: 60 }, DEFAULT_SETTINGS).reasons).toEqual(['low_gmq']);
  });
  it('FECRT : réduction moyenne et statut', () => {
    const r = fecrt([{ before: 1000, after: 50 }, { before: 1500, after: 100 }], DEFAULT_SETTINGS)!;
    expect(r.reduction).toBe(94); expect(r.status).toBe('doubtful'); expect(r.enough_animals).toBe(false);
    expect(fecrt([{ before: 1000, after: 0 }], DEFAULT_SETTINGS)!.status).toBe('effective');
  });
});

describe('Compte vétérinaire et accès de consultation', () => {
  it('profil vétérinaire vérifié par l’administrateur avant tout accès', async () => {
    const p = await post(vet, '/api/vet/profile', { ordinal_number: '27345', clinic: 'Clinique du Lamentin', territory_code: 'MQ', phone: '0696 00 00 12' });
    expect(p.body.status).toBe('pending');
    await post(other, '/api/vet/profile', { ordinal_number: '11111', clinic: 'Autre clinique' });
    const n = await pool.query(`select count(*)::int n from outbox_emails where to_email = 'admin@test.org' and subject = 'Compte vétérinaire à vérifier'`);
    expect(n.rows[0].n).toBe(2);
    expect((await F.get('/api/vet/search?q=Laurent')).body).toHaveLength(0); // pas encore vérifié
    expect((await post(F, '/api/vet/profile', { ordinal_number: '1', clinic: 'x' })).status).toBe(400);
    expect((await post(vet, `/api/admin/vets/${vet.id}/decision`, { status: 'verified' })).status).toBe(403);
    expect((await post(admin, `/api/admin/vets/${other.id}/decision`, { status: 'rejected' })).body.error).toBe('reason_required');
    expect((await post(admin, `/api/admin/vets/${vet.id}/decision`, { status: 'verified' })).body.status).toBe('verified');
    expect((await F.get('/api/vet/search?q=27345')).body[0]).toMatchObject({ id: vet.id, clinic: 'Clinique du Lamentin' });
  });
  it('code à 6 chiffres : l’éleveur le génère, le vétérinaire vérifié l’utilise une seule fois', async () => {
    expect((await post(vet, `/api/farms/${F.farmId}/vet-access/code`, { scopes: ['health'], hours: 168 })).status).toBe(404);
    const k = await post(F, `/api/farms/${F.farmId}/vet-access/code`, { scopes: ['herd', 'health'], hours: 168 });
    expect(k.body.code).toMatch(/^\d{6}$/);
    expect((await post(other, '/api/vet/redeem', { code: k.body.code })).body.error).toBe('vet_not_verified');
    expect((await post(vet, '/api/vet/redeem', { code: '000000' === k.body.code ? '111111' : '000000' })).body.error).toBe('code_invalid');
    const r = await post(vet, '/api/vet/redeem', { code: k.body.code });
    expect(r.body).toMatchObject({ farm_id: F.farmId, scopes: ['herd', 'health'] });
    expect((await post(vet, '/api/vet/redeem', { code: k.body.code })).body.error).toBe('code_invalid'); // usage unique
    const me = (await vet.get('/api/auth/me')).body;
    expect(me.vet.status).toBe('verified');
    expect(me.farms.find((f: any) => f.id === F.farmId)).toMatchObject({ role: 'vet' });
  });
  it('portées respectées : lecture du troupeau et de la santé, pas des stocks ni des membres ; aucune écriture hors parasitisme', async () => {
    await post(F, `/api/farms/${F.farmId}/animals`, { internal_id: 'NALA', name: 'Nala', official_id: 'FR 4012 2201', sex: 'F', birth_date: '2023-03-01', breed_code: 'BLACKBELLY' });
    await post(F, `/api/farms/${F.farmId}/animals`, { internal_id: 'OPALE', name: 'Opale', official_id: 'FR 4012 2210', sex: 'F', birth_date: '2023-04-01', breed_code: 'BLACKBELLY' });
    await post(F, `/api/farms/${F.farmId}/animals`, { internal_id: 'B14', name: 'Brebis 14', official_id: 'FR 4012 2214', sex: 'F', birth_date: '2022-04-01', breed_code: 'BLACKBELLY' });
    expect((await vet.get(`/api/farms/${F.farmId}/animals`)).body).toHaveLength(3);
    expect((await vet.get(`/api/farms/${F.farmId}/stock`)).body.error).toBe('vet_scope_denied');
    expect((await vet.get(`/api/farms/${F.farmId}/members`)).body.error).toBe('vet_scope_denied');
    expect((await vet.get(`/api/farms/${F.farmId}/export/animals.csv`)).status).toBe(403);
    expect((await post(vet, `/api/farms/${F.farmId}/animals`, { internal_id: 'X', sex: 'M' })).body.error).toBe('read_only');
    expect((await other.get(`/api/farms/${F.farmId}/animals`)).status).toBe(404);
  });
});

describe('Seuils parasitaires : avis signé par le vétérinaire uniquement', () => {
  it('valeurs par défaut non validées, puis avis signé avec code', async () => {
    const s0 = (await F.get(`/api/farms/${F.farmId}/parasite/settings`)).body;
    expect(s0.ovine.validated).toBe(false);
    expect(s0.ovine.vals.famacha_treat_from).toBe(4);
    const vals = { ...s0.ovine.vals, cond_bcs_max: 2.5, copro_treat_epg: 800, young_min_gmq: 120 };
    expect((await post(F, `/api/farms/${F.farmId}/parasite/settings/ovine/sign-code`)).body.error).toBe('vet_access_required');
    expect((await post(F, `/api/farms/${F.farmId}/parasite/settings/ovine`, { vals, signature_png: PNG, code: '123456' })).status).toBe(403);
    const sc = await post(vet, `/api/farms/${F.farmId}/parasite/settings/ovine/sign-code`);
    expect(sc.body.channel).toBe('email');
    const bad = await post(vet, `/api/farms/${F.farmId}/parasite/settings/ovine`, { vals, comment: 'Saison des pluies', signature_png: PNG, code: '999999' });
    expect(bad.body.error).toBe('sign_code_invalid');
    const ok = await post(vet, `/api/farms/${F.farmId}/parasite/settings/ovine`, { vals, comment: 'Saison des pluies', signature_png: PNG, code: await lastCode('dr.laurent@vet.org') });
    expect(ok.status).toBe(200);
    const s1 = (await F.get(`/api/farms/${F.farmId}/parasite/settings`)).body;
    expect(s1.ovine).toMatchObject({ validated: true, vet_name: 'Dr Marie Laurent', vet_ordinal: '27345', comment: 'Saison des pluies' });
    expect(s1.ovine.vals.copro_treat_epg).toBe(800);
    expect((await F.get(`/api/farms/${F.farmId}/parasite/settings/history`)).body).toHaveLength(1);
    const mail = await pool.query(`select count(*)::int n from outbox_emails where to_email = 'eleveur-veto@farm.org' and subject = 'Avis vétérinaire sur le protocole parasitaire'`);
    expect(mail.rows[0].n).toBe(1);
  });
  it('tournée d’examen : décision calculée avec les seuils validés, alerte troupeau dans le bilan', async () => {
    const animals = (await F.get(`/api/farms/${F.farmId}/animals`)).body;
    const id = (k: string) => animals.find((a: any) => a.internal_id === k).id;
    const e1 = await post(F, `/api/farms/${F.farmId}/parasite/exams`, { animal_id: id('NALA'), date: today(), famacha: 3, bcs: 2.5, dag: 0 });
    expect(e1.body).toMatchObject({ decision: 'treat' }); // NEC ≤ 2,5 (avis vétérinaire)
    await post(vet, `/api/farms/${F.farmId}/parasite/exams`, { animal_id: id('OPALE'), date: today(), famacha: 4, bcs: 1.5, dag: 2 });
    await post(F, `/api/farms/${F.farmId}/parasite/exams`, { animal_id: id('B14'), date: today(), famacha: 3, bcs: 3, dag: 0 });
    expect((await post(F, `/api/farms/${F.farmId}/parasite/exams`, { animal_id: id('B14'), date: today(), famacha: null, bcs: null, dag: null })).body.error).toBe('exam_empty');
    const sum = (await F.get(`/api/farms/${F.farmId}/parasite/summary`)).body;
    expect(sum.exams).toHaveLength(3);
    expect(sum.herd.ovine.pct).toBeCloseTo(33.3, 0);
    expect(sum.herd.ovine.alert).toBe(true); // > 10 % en FAMACHA ≥ 4 → la note 3 de B14 devient « à traiter »
    expect(sum.counts).toEqual({ treat: 3, watch: 0, none: 0 });
  });
});

describe('Rapport de coproscopie : import IA, vérification, signature, preuve', () => {
  let rep: any;
  it('pré-rempli à la création (animaux, FAMACHA, état corporel)', async () => {
    const animals = (await F.get(`/api/farms/${F.farmId}/animals`)).body;
    rep = (await post(F, `/api/farms/${F.farmId}/copro`, { phase: 'J0', species: 'ovine', sample_date: today(), reason: 'Tournée parasitaire', animal_ids: animals.map((a: any) => a.id) })).body;
    expect(rep.number).toMatch(/^CP-\d{4}-\d{4}$/);
    expect(rep.results).toHaveLength(3);
    expect(rep.results.find((x: any) => x.internal_id === 'OPALE')).toMatchObject({ famacha: 4, bcs: 1.5 });
    expect((await put(F, `/api/farms/${F.farmId}/copro/${rep.id}`, { results: [] })).body.error).toBe('vet_access_required');
  });
  it('import : PDF conservé, valeurs lues et rapprochées des animaux, identifiant inconnu à confirmer', async () => {
    setExtractor(async ({ candidates }) => {
      expect(candidates.map((x) => x.internal_id).sort()).toEqual(['B14', 'NALA', 'OPALE']);
      return {
        lab_name: 'LVD 972', lab_ref: '26-11-0871', received_date: today(), method: 'McMaster modifiée (NaCl)', detection_limit_epg: 50,
        lab_comment: 'Infestation hétérogène.', warnings: ['Ligne B-14 : identifiant à confirmer'],
        results: [
          { label: 'FR40122201', matched_internal_id: null, strongyles_epg: 1450, nematodirus_epg: 0, coccidia: '+', confidence: 'high' },
          { label: 'FR 4012 2210', matched_internal_id: 'OPALE', strongyles_epg: 2300, nematodirus_epg: 0, coccidia: '0', confidence: 'high' },
          { label: 'B-I4 ?', matched_internal_id: null, strongyles_epg: 400, nematodirus_epg: 0, coccidia: '0', confidence: 'medium' },
        ],
      };
    });
    const pdf = Buffer.from('%PDF-1.4\n% compte rendu de test\n').toString('base64');
    expect((await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/import`, { name: 'cr.pdf', mime: 'application/pdf', data_base64: Buffer.from('pas un pdf').toString('base64') })).body.error).toBe('file_type_mismatch');
    const r = await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/import`, { name: 'LVD972_CR_2611.pdf', mime: 'application/pdf', data_base64: pdf });
    expect(r.status).toBe(200);
    expect(r.body.import_summary).toMatchObject({ results: 3, matched: 2, unmatched: 1 });
    expect(r.body).toMatchObject({ lab_name: 'LVD 972', method: 'McMaster modifiée (NaCl)', detection_limit: 50, source_name: 'LVD972_CR_2611.pdf' });
    const nala = r.body.results.find((x: any) => x.internal_id === 'NALA');
    expect(nala).toMatchObject({ strongyles_epg: 1450, confidence: 'high', famacha: 3 });
    const orphan = r.body.results.find((x: any) => x.raw_label === 'B-I4 ?' && !x.animal_id);
    expect(orphan).toMatchObject({ strongyles_epg: 400, confidence: 'medium' });
    // la source reste téléchargeable, intacte
    const f = await F.get(`/api/farms/${F.farmId}/copro/${rep.id}/files/${r.body.source_file_id}`);
    expect(f.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(f.body).toString()).toContain('compte rendu de test');
    rep = r.body;
  });
  it('signature refusée tant qu’un résultat n’est pas rattaché ou sans interprétation', async () => {
    await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/sign-code`);
    expect((await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/sign`, { signature_png: PNG, code: await lastCode('dr.laurent@vet.org') })).body.error).toBe('interpretation_required');
  });
  it('le vétérinaire corrige, interprète et signe : PDF scellé, rapport figé, vérification publique', async () => {
    const b14 = rep.results.find((x: any) => x.internal_id === 'B14');
    const orphan = rep.results.find((x: any) => !x.animal_id);
    const results = rep.results.filter((x: any) => x.id !== b14.id && x.id !== orphan.id).map((x: any) => ({ ...x }));
    results.push({ id: b14.id, animal_id: b14.animal_id, raw_label: orphan.raw_label, strongyles_epg: 400, nematodirus_epg: 0, coccidia: '0', confidence: 'high', corrected: true });
    const u = await put(vet, `/api/farms/${F.farmId}/copro/${rep.id}`, { ...rep, interpretation: 'Infestation forte chez 2 animaux sur 3. Traitement ciblé selon ordonnance.', results });
    expect(u.status).toBe(200);
    expect(u.body.results).toHaveLength(3);
    expect(u.body.results.find((x: any) => x.internal_id === 'B14')).toMatchObject({ strongyles_epg: 400, corrected: true });
    await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/sign-code`);
    const s = await post(vet, `/api/farms/${F.farmId}/copro/${rep.id}/sign`, { signature_png: PNG, code: await lastCode('dr.laurent@vet.org') });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: 'signed', signed_vet_name: 'Dr Marie Laurent', signed_vet_ordinal: '27345' });
    expect(s.body.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await F.get(`/api/farms/${F.farmId}/copro/${rep.id}/files/${s.body.pdf_file_id}`).buffer(true).parse((res: any, cb: any) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.body.length).toBeGreaterThan(3000);
    // figé : plus aucune modification, ni par l'API ni directement en base
    expect((await put(vet, `/api/farms/${F.farmId}/copro/${rep.id}`, { results: [] })).body.error).toBe('report_signed');
    expect((await del(F, `/api/farms/${F.farmId}/copro/${rep.id}`)).body.error).toBe('report_signed');
    await expect(withTx(F.id, (db) => db.query(`update copro_reports set interpretation = 'falsifié' where id = $1`, [rep.id]))).rejects.toThrow(/report_signed/);
    await expect(withTx(F.id, (db) => db.query(`update copro_results set strongyles_epg = 0 where report_id = $1`, [rep.id]))).rejects.toThrow(/report_signed/);
    // l'éleveur est prévenu et accuse réception
    const m = await pool.query(`select body from outbox_emails where to_email = 'eleveur-veto@farm.org' and subject like 'Rapport de coproscopie signé%'`);
    expect(m.rows[0].body).toContain(`/verifier/${rep.number}`);
    expect((await post(F, `/api/farms/${F.farmId}/copro/${rep.id}/ack`)).body.farmer_ack_at).toBeTruthy();
    // vérification publique, sans compte
    const v = await app.request ? null : null; void v;
    const pub = await (await import('supertest')).default(app).get(`/api/public/verify/${rep.number}`);
    expect(pub.body).toMatchObject({ valid: true, number: rep.number, signed_vet_ordinal: '27345', content_hash: s.body.content_hash });
    expect((await (await import('supertest')).default(app).get('/api/public/verify/CP-2000-9999')).body.valid).toBe(false);
  });
  it('contrôle J14 : FECRT calculé sur les animaux du J0', async () => {
    const j14 = (await post(F, `/api/farms/${F.farmId}/copro`, { phase: 'J14', parent_id: rep.id, species: 'ovine', sample_date: today() })).body;
    expect(j14.results).toHaveLength(3);
    const results = j14.results.map((x: any) => ({ id: x.id, animal_id: x.animal_id, raw_label: null, strongyles_epg: x.internal_id === 'OPALE' ? 200 : 50, nematodirus_epg: 0, coccidia: '0' }));
    const u = await put(vet, `/api/farms/${F.farmId}/copro/${j14.id}`, { interpretation: 'Contrôle', results });
    expect(u.body.fecrt).toMatchObject({ n: 3, mean_before: 1383, mean_after: 100, status: 'doubtful' });
    expect(u.body.fecrt.reduction).toBeCloseTo(92.8, 1);
  });
  it('accès révoqué : le vétérinaire ne voit plus rien', async () => {
    const list = (await F.get(`/api/farms/${F.farmId}/vet-access`)).body;
    expect(list[0]).toMatchObject({ vet_id: vet.id, active: true });
    await post(F, `/api/farms/${F.farmId}/vet-access/${list[0].id}/revoke`);
    expect((await vet.get(`/api/farms/${F.farmId}/animals`)).status).toBe(404);
    expect((await post(vet, `/api/farms/${F.farmId}/parasite/exams`, {})).status).toBe(404);
    // accès direct par recherche (sans code)
    const g = await post(F, `/api/farms/${F.farmId}/vet-access`, { vet_id: vet.id, scopes: ['health'], hours: 24 });
    expect(g.status).toBe(200);
    expect((await vet.get(`/api/farms/${F.farmId}/copro`)).status).toBe(200);
    expect((await vet.get(`/api/farms/${F.farmId}/animals`)).body.error).toBe('vet_scope_denied');
    expect((await post(F, `/api/farms/${F.farmId}/vet-access`, { vet_id: other.id, scopes: ['health'], hours: 24 })).body.error).toBe('vet_not_found');
  });
});
