// Test de bout en bout dans un vrai navigateur (Chromium/Playwright).
// Prérequis : serveur démarré (npm start) sur BASE_URL, base accessible via DATABASE_URL.
// Usage : node scripts/e2e.mjs   (variables : BASE_URL, DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, SCREENS=dossier)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = createRequire(new URL('../server/package.json', import.meta.url))('pg');
const { totp } = await import('../server/dist/lib/crypto.js');

if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const SCREENS = process.env.SCREENS ?? 'e2e-screens';
mkdirSync(SCREENS, { recursive: true });
const RUN = Date.now().toString(36);
const FARMER = { email: `eleveur-${RUN}@example.org`, password: 'Brebis-Martinique-2026' };

let step = 0; const errors = [];
const log = (m) => console.log(`✔ ${String(++step).padStart(2, '0')} ${m}`);
async function token(email) {
  const r = await db.query('select body from outbox_emails where to_email = $1 order by id desc limit 1', [email]);
  return /token=([A-Za-z0-9_-]+)/.exec(r.rows[0]?.body ?? '')?.[1];
}
function watch(page, who) {
  page.on('pageerror', (e) => errors.push(`[${who}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|status of 4\d\d/.test(m.text())) errors.push(`[${who}] console: ${m.text()}`); });
}
const expectText = async (page, text, timeout = 8000) => { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); };
async function selectByText(sel, text) {
  const v = await sel.evaluate((el, t) => [...el.options].find((o) => o.textContent.startsWith(t))?.value, text);
  if (!v) throw new Error('option introuvable : ' + text);
  await sel.selectOption(v);
}
/** Requête exécutée dans le contexte RLS d’un utilisateur (comme le fait l’API). */
async function asUser(email, sql, params = []) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', (select id::text from users where email = $1), true)", [email]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } finally { c.release(); }
}
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
try {
  // ---------- Administrateur : connexion + MFA ----------
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const admin = await adminCtx.newPage(); watch(admin, 'admin');
  await admin.goto(BASE);
  await admin.getByLabel('Adresse courriel').fill(ADMIN.email);
  await admin.getByLabel('Mot de passe').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Se connecter' }).click();
  await expectText(admin, 'Double authentification');
  const mfaEnabled = (await db.query('select mfa_enabled, mfa_secret from users where email = $1', [ADMIN.email])).rows[0];
  if (!mfaEnabled.mfa_enabled) {
    await admin.getByRole('button', { name: 'Générer la clé' }).click();
    const secret = (await admin.getByTestId('mfa-secret').innerText()).trim();
    await admin.getByLabel('Code à 6 chiffres').fill(totp(secret));
  } else {
    await admin.getByLabel('Code à 6 chiffres').fill(totp(mfaEnabled.mfa_secret));
  }
  await admin.getByRole('button', { name: 'Confirmer' }).click();
  await admin.getByRole('link', { name: /Administration/ }).first().waitFor();
  log('Administrateur connecté avec double authentification (TOTP)');

  // ---------- Nouvel éleveur : choix langue → compte → vérification → dossier ----------
  const farmerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const farmer = await farmerCtx.newPage(); watch(farmer, 'éleveur');
  await farmer.goto(`${BASE}/register`);
  await farmer.getByRole('button', { name: 'FR', exact: true }).click();
  await farmer.getByLabel('Prénom').fill('Marie');
  await farmer.getByLabel(/^Nom/).fill('Sainte-Rose');
  await farmer.getByLabel('Adresse courriel').fill(FARMER.email);
  await farmer.getByLabel('Mot de passe').fill(FARMER.password);
  await farmer.getByRole('button', { name: 'Créer un compte' }).click();
  await expectText(farmer, 'Vérifiez votre adresse courriel');
  await farmer.goto(`${BASE}/herd`);
  await expectText(farmer, 'Vérifiez votre adresse courriel');
  log('Compte créé ; fonctions bloquées tant que l’adresse n’est pas vérifiée');
  await farmer.goto(`${BASE}/verify-email?token=${await token(FARMER.email)}`);
  await farmer.getByRole('button', { name: 'Confirmer' }).click();
  await expectText(farmer, 'Adresse vérifiée');
  await farmer.goto(BASE);
  await expectText(farmer, 'Dossier d’inscription éleveur');
  await farmer.getByLabel('Nom ou référence de l’exploitation').fill(`Habitation Bellevue ${RUN}`);
  await farmer.getByLabel('Localité / commune').fill('Le François');
  // Changement de langue : la saisie en cours est conservée
  await farmer.getByRole('button', { name: 'EN', exact: true }).click();
  await expectText(farmer, 'Farmer registration file');
  if (await farmer.getByLabel('Farm name or reference').inputValue() !== `Habitation Bellevue ${RUN}`) throw new Error('Saisie perdue au changement de langue');
  await farmer.getByRole('button', { name: 'FR', exact: true }).click();
  log('Changement de langue FR→EN→FR sans perte de la saisie en cours');
  await farmer.getByLabel('J’accepte les conditions').check();
  await farmer.getByLabel('Je déclare sur l’honneur').check();
  await farmer.getByRole('button', { name: 'Soumettre la demande' }).click();
  await expectText(farmer, 'Votre demande a été reçue');
  await shot(farmer, '01-demande-en-attente-mobile');
  log('Dossier d’inscription soumis (état « En attente »)');

  // ---------- Validation par l’administrateur ----------
  await admin.getByRole('link', { name: /Demandes/ }).first().click();
  await admin.getByRole('link', { name: 'Marie Sainte-Rose' }).first().click();
  await expectText(admin, `Habitation Bellevue ${RUN}`);
  await shot(admin, '02-examen-demande');
  await admin.getByRole('button', { name: 'Approuver' }).click();
  await expectText(admin, 'Approuvée');
  log('Demande approuvée : exploitation créée, décision tracée');

  // ---------- Éleveur approuvé : animaux, pesées, GMQ ----------
  await farmer.goto(BASE);
  await expectText(farmer, `Habitation Bellevue ${RUN}`);
  await expectText(farmer, 'À faire aujourd’hui');
  for (const a of [
    { id: 'B1', name: 'Bélier 1', birth: '2026-09-19', breed: 'Black Belly × Île-de-France', w: [['2026-10-31', '11.30'], ['2026-11-07', '12.81'], ['2026-11-14', '13.29']] },
    { id: 'B2', name: 'Bélier 2', birth: '2026-09-29', breed: 'Saint-Martin × Île-de-France', w: [['2026-10-31', '9.80'], ['2026-11-07', '11.67'], ['2026-11-14', '12.32']] },
  ]) {
    await farmer.goto(`${BASE}/herd/new`);
    await farmer.getByLabel('Identifiant interne').fill(a.id);
    await farmer.getByLabel('Nom / surnom').fill(a.name);
    await farmer.getByLabel('Sexe').selectOption('M');
    await farmer.getByLabel('Date de naissance').fill(a.birth);
    await farmer.getByLabel('Race / croisement').selectOption({ label: a.breed });
    await farmer.getByLabel('Poids de naissance (kg)').fill('3.4');
    await farmer.getByRole('button', { name: 'Enregistrer' }).click();
    await expectText(farmer, 'Courbe de croissance');
    for (const [date, kg] of a.w) {
      await farmer.getByRole('button', { name: /Nouvelle pesée/ }).click();
      const dlg = farmer.getByRole('dialog');
      await dlg.getByLabel(/^Date( \*)?$/).fill(date);
      await dlg.getByLabel('Poids (kg)').fill(kg);
      await dlg.getByRole('button', { name: 'Enregistrer' }).click();
      await dlg.getByText('Pesée enregistrée').waitFor();
      await dlg.getByRole('button', { name: 'Fermer' }).click();
    }
  }
  await expectText(farmer, '180'); // GMQ global Bélier 2 = 180 g/j
  await shot(farmer, '03-fiche-animale-mobile');
  log('Animaux de démonstration créés ; pesées saisies ; GMQ global de Bélier 2 = 180 g/j');

  // Règles de gestion : poids non positif, date avant naissance, doublon → confirmation
  await farmer.goto(`${BASE}/weigh`);
  await selectByText(farmer.getByLabel('Choisir un animal'), 'B1 — Bélier 1');
  await farmer.getByLabel(/^Date( \*)?$/).fill('2026-11-14');
  await farmer.getByLabel('Poids (kg)').fill('13.3');
  await farmer.getByRole('button', { name: 'Enregistrer' }).click();
  await expectText(farmer, 'une pesée existe déjà à cette date');
  await farmer.getByRole('button', { name: 'Annuler' }).first().click();
  log('Doublon de pesée signalé avec demande de confirmation');

  // ---------- Hors connexion : file d’attente puis synchronisation ----------
  await farmer.getByLabel(/^Date( \*)?$/).fill('2026-11-21');
  await farmer.getByLabel('Poids (kg)').fill('13.9');
  await farmerCtx.setOffline(true);
  await farmer.evaluate(() => window.dispatchEvent(new Event('offline')));
  await farmer.getByRole('button', { name: 'Enregistrer' }).click();
  await expectText(farmer, 'pesée mise en file d’attente');
  await expectText(farmer, '1 saisie(s) en attente');
  await shot(farmer, '04-hors-connexion');
  await farmerCtx.setOffline(false);
  await farmer.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 20; i++) { if (!(await farmer.getByText('en attente de synchronisation').count())) break; await farmer.waitForTimeout(250); }
  const synced = await asUser(FARMER.email, `select count(*)::int n from weighings w join animals a on a.id = w.animal_id where w.date = '2026-11-21' and w.source = 'offline_sync' and a.internal_id = 'B1'`);
  if (synced.rows[0].n !== 1) throw new Error('Synchronisation hors connexion non effectuée');
  log('Pesée saisie hors connexion puis synchronisée une seule fois au retour du réseau');

  // ---------- Santé, alimentation, analyses, export ----------
  await farmer.goto(`${BASE}/health`);
  await expectText(farmer, 'n’établit aucun diagnostic');
  await selectByText(farmer.getByLabel('Choisir un animal'), 'B2 — Bélier 2');
  await farmer.getByLabel(/^Type/).selectOption('analysis');
  await farmer.getByLabel('Analyse (ex. coproscopie)').fill('Coproscopie');
  await farmer.getByLabel(/^Résultat/).fill('850 OPG');
  await farmer.getByLabel('Score FAMACHA (1–5)').fill('3');
  await farmer.getByRole('button', { name: 'Ajouter' }).click();
  await expectText(farmer, '850 OPG');
  log('Événement sanitaire (coproscopie, FAMACHA) enregistré');

  await farmer.goto(`${BASE}/parcels`);
  await farmer.getByPlaceholder('Nom du lot').fill('Engraissement');
  await farmer.getByRole('button', { name: 'Ajouter' }).first().click();
  await expectText(farmer, 'Engraissement');
  await farmer.goto(`${BASE}/feeding`);
  await farmer.getByLabel(/^Lot/).selectOption({ label: 'Engraissement' });
  await farmer.getByLabel('Aliment').fill('Granulé');
  await farmer.getByLabel('Quantité (kg)').fill('25');
  await farmer.getByLabel('Coût (€)').fill('18.50');
  await farmer.getByLabel('Début').fill('2026-11-01');
  await farmer.getByRole('button', { name: 'Ajouter' }).click();
  await expectText(farmer, 'Granulé');
  log('Lot créé et ration enregistrée (distribuée, base brute, coût)');

  await farmerCtx.close();
  // Analyses sur grand écran
  const deskCtx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const desk = await deskCtx.newPage(); watch(desk, 'éleveur-bureau');
  await desk.goto(BASE);
  await desk.getByLabel('Adresse courriel').fill(FARMER.email);
  await desk.getByLabel('Mot de passe').fill(FARMER.password);
  await desk.getByRole('button', { name: 'Se connecter' }).click();
  await expectText(desk, 'À faire aujourd’hui');
  await shot(desk, '05-accueil-bureau');
  await desk.getByRole('link', { name: /Analyses/ }).first().click();
  await expectText(desk, 'Croissance par race / croisement');
  await expectText(desk, 'Aucune relation causale');
  await desk.waitForTimeout(400);
  await shot(desk, '06-analyses');
  await desk.getByText('Exporter les données (CSV)').click();
  const [dl] = await Promise.all([desk.waitForEvent('download'), desk.getByRole('button', { name: 'CSV weighings' }).click()]);
  const csv = readFileSync(await dl.path(), 'utf8');
  if (!csv.includes('B2;2026-11-14;12.32')) throw new Error('CSV inattendu : ' + csv.slice(0, 300));
  log('Analyses affichées avec effectifs et avertissement ; export CSV fidèle');

  await desk.goto(`${BASE}/collective`);
  await expectText(desk, 'Participation volontaire');
  await desk.getByLabel('J’ai lu ces informations').check();
  await desk.getByRole('button', { name: 'Donner mon accord' }).click();
  await expectText(desk, 'Accord actif');
  await expectText(desk, 'Exploitations participantes');
  // la cellule n’est publiée qu’au-delà du seuil : masquée tant que < 5 exploitations consentent
  const consenting = (await db.query(`select count(distinct farm_id)::int n from consents where revoked_at is null`)).rows[0].n;
  if (consenting < 5) await expectText(desk, 'Masqué (moins de 5 exploitations)');
  await shot(desk, '07-collectif');
  log('Consentement explicite enregistré ; cellule < 5 exploitations masquée');

  // ---------- Consanguinité : refus d’enregistrement, fiche et simulateur ----------
  const post = (path, body) => desk.evaluate(async ([p, b]) => {
    const r = await fetch('/api' + p, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'carnet' }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [path, body]);
  const farmId = await desk.evaluate(async () => (await (await fetch('/api/farms', { credentials: 'same-origin' })).json())[0].id);
  const mk = (id, sex, extra = {}) => post(`/farms/${farmId}/animals`, { internal_id: id, sex, birth_date: '2024-01-01', breed_code: 'BLACKBELLY', ...extra });
  const pere = (await mk('PERE-X', 'M')).body, mere = (await mk('MERE-X', 'F')).body;
  const frere = (await mk('FRERE-X', 'M', { sire_id: pere.id, dam_id: mere.id, birth_date: '2025-01-01' })).body;
  const soeur = (await mk('SOEUR-X', 'F', { sire_id: pere.id, dam_id: mere.id, birth_date: '2025-01-01' })).body;
  const refus = await mk('AGNEAU-X', 'M', { sire_id: frere.id, dam_id: soeur.id, birth_date: '2026-01-01' });
  if (refus.status !== 400 || refus.body.error !== 'inbreeding_limit_exceeded') throw new Error('frère × sœur aurait dû être refusé : ' + JSON.stringify(refus));
  // formulaire : aperçu et blocage de l’enregistrement
  await desk.goto(`${BASE}/herd/new`);
  await desk.getByLabel('Identifiant interne').fill('AGNEAU-Y');
  const selFor = (txt) => desk.locator('select', { has: desk.locator('option', { hasText: txt }) }).first();
  await selectByText(selFor('FRERE-X'), 'FRERE-X');
  await selectByText(selFor('SOEUR-X'), 'SOEUR-X');
  await expectText(desk, 'Consanguinité de cet agneau : 25 %');
  await expectText(desk, 'Enregistrement impossible');
  if (!(await desk.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('le bouton Enregistrer aurait dû être bloqué');
  // fiche : taux calculé automatiquement
  await desk.goto(`${BASE}/herd/${frere.id}`);
  await desk.getByRole('tab', { name: 'Famille' }).click();
  await expectText(desk, 'Coefficient de consanguinité (F)');
  await expectText(desk, '0 %');
  // simulateur
  await desk.goto(`${BASE}/simulateur?ram=${frere.id}&ewe=${soeur.id}`);
  await expectText(desk, 'Saillie déconseillée');
  await expectText(desk, '25 %');
  await expectText(desk, 'Ancêtres communs');
  await expectText(desk, 'Performances observées');
  await shot(desk, '08-simulateur');
  log('Consanguinité : frère × sœur refusé (25 %), taux sur la fiche, simulateur de saillie');

  // V3 : bouton « Saisir » → feuille d’actions ; tournée de pesée enchaînée
  await desk.goto(`${BASE}/`);
  await desk.getByRole('button', { name: 'Saisir' }).first().click();
  await expectText(desk, 'Que voulez-vous noter ?');
  await desk.getByRole('dialog').getByRole('link', { name: 'Pesée' }).click();
  await desk.waitForURL(/\/weigh$/);
  await desk.goto(`${BASE}/weigh?tour=1`);
  await desk.getByRole('progressbar').waitFor();
  const before = await desk.getByRole('progressbar').getAttribute('aria-valuenow');
  await desk.getByRole('button', { name: /Passer cet animal/ }).click().catch(() => {});
  log(`Bouton « Saisir » (feuille d’actions) et tournée de pesée (progression ${before} → suivante)`);

  // ---------- Correction d’une pesée sur téléphone : suppression d’un doublon ----------
  const b1 = await desk.evaluate(async (fId) => (await (await fetch(`/api/farms/${fId}/animals?q=B1`, { credentials: 'same-origin' })).json())[0], farmId);
  const dup = await post(`/farms/${farmId}/animals/${b1.id}/weighings`, { date: '2026-11-14', weight_kg: 12.81, confirm: true });
  if (dup.status !== 200) throw new Error('doublon non créé : ' + JSON.stringify(dup));
  await desk.setViewportSize({ width: 390, height: 844 });
  await desk.goto(`${BASE}/herd/${b1.id}`);
  const ligne = desk.locator('tr', { hasText: '14/11/2026' }).filter({ hasText: '12,81' });
  await ligne.getByRole('button', { name: /^Corriger/ }).click();
  const dlg = desk.getByRole('dialog');
  if (!(await dlg.getByRole('button', { name: 'Supprimer' }).isDisabled())) throw new Error('Supprimer devrait être grisé sans motif');
  await dlg.getByRole('button', { name: 'Doublon' }).click();
  await dlg.getByRole('button', { name: 'Supprimer' }).click();
  await ligne.waitFor({ state: 'detached' });
  await expectText(desk, '13,29');
  await shot(desk, '08b-pesee-supprimee-mobile');
  await desk.setViewportSize({ width: 1366, height: 900 });
  log('Pesée en doublon supprimée depuis un téléphone (crayon visible, motif rapide)');

  // ---------- Stocks et boutique : alerte « il faut passer commande », commande, livraison ----------
  const adminPost = (path, body) => admin.evaluate(async ([p, b]) => {
    const r = await fetch('/api' + p, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'carnet' }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [path, body]);
  const sup = (await adminPost('/admin/shop/suppliers', { name: `Coop fourrages ${RUN}`, territory_code: 'MQ' })).body;
  const prod = await adminPost('/admin/shop/products', { supplier_id: sup.id, name: `Foin pangola ${RUN}`, category: 'hay', unit: 'botte', unit_weight_kg: 20, price_eur: 9.5, reserved_quantity: 20, delivery_days: 5, territory_code: 'MQ' });
  if (prod.status !== 200) throw new Error('produit non créé : ' + JSON.stringify(prod));
  const ago14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  await desk.goto(`${BASE}/stock`);
  await desk.getByRole('button', { name: 'Ajouter un article' }).click();
  await desk.getByLabel(/^Article/).fill('Foin');
  await desk.getByLabel(/^Unité/).fill('botte');
  await desk.getByLabel(/^Quantité en stock/).fill('3');
  await desk.getByLabel(/^Date du comptage/).fill(ago14);
  await desk.getByLabel(/^Quantité consommée/).fill('1');
  await desk.getByLabel(/^Tous les/).fill('7');
  await desk.getByRole('button', { name: 'Enregistrer' }).click();
  await expectText(desk, 'Il faut passer commande');
  await expectText(desk, '≈ 7 jours restants');
  const alertN = await db.query(`select count(*)::int n from notifications n join users u on u.id = n.user_id where u.email = $1 and n.kind = 'stock_low'`, [FARMER.email]);
  if (alertN.rows[0].n !== 1) throw new Error('alerte de stock attendue : ' + alertN.rows[0].n);
  await shot(desk, '08c-stocks');
  // commande depuis la carte de stock → boutique
  await desk.getByRole('link', { name: 'Commander' }).first().click();
  const card = desk.locator('.card', { hasText: `Foin pangola ${RUN}` });
  await card.waitFor();
  await card.getByLabel('Quantité').fill('4');
  await card.getByRole('button', { name: 'Commander' }).click();
  await expectText(desk, 'Commande envoyée');
  await expectText(desk, 'Réserve éleveurs : 16 restant(s)');
  await shot(desk, '08d-boutique');
  // l'administrateur confirme puis livre
  await admin.goto(`${BASE}/admin`);
  await admin.getByRole('tab', { name: 'Boutique' }).click();
  const li = admin.locator('li', { hasText: `4 × Foin pangola ${RUN}` });
  await li.getByRole('button', { name: 'Confirmer' }).click();
  await li.getByRole('button', { name: 'Marquer livrée' }).click();
  await li.getByText('Livrée').waitFor();
  // le stock de l'éleveur est crédité
  await desk.goto(`${BASE}/stock`);
  const credited = desk.locator('.card', { hasText: `Foin pangola ${RUN}` });
  await credited.waitFor();
  if (!(await credited.innerText()).includes('4')) throw new Error('stock non crédité après livraison');
  await desk.goto(`${BASE}/boutique`);
  await expectText(desk, 'Livrée');
  log('Stocks : alerte à 1 botte restante ; boutique : commande, confirmation, livraison et stock crédité');

  // suppression de fournisseurs depuis l'administration
  await adminPost('/admin/shop/suppliers', { name: `Doublon ${RUN}` });
  await admin.goto(`${BASE}/admin`);
  await admin.getByRole('tab', { name: 'Boutique' }).click();
  admin.once('dialog', (dlg) => dlg.accept());
  await admin.getByRole('button', { name: `Supprimer Doublon ${RUN}` }).click();
  await expectText(admin, `« Doublon ${RUN} » a été supprimé.`);
  admin.once('dialog', (dlg) => dlg.accept());
  await admin.getByRole('button', { name: `Supprimer Coop fourrages ${RUN}` }).click();
  await expectText(admin, 'retiré de la boutique et archivé');
  await desk.goto(`${BASE}/boutique`);
  await expectText(desk, 'Livrée'); // l'historique de commande de l'éleveur est conservé
  if (await desk.getByText(`Foin pangola ${RUN}`, { exact: true }).count()) throw new Error('produit archivé encore en vente');
  log('Fournisseurs : suppression définitive (sans commande) et archivage (avec historique)');

  // ---------- Vétérinaire : compte vérifié, consultation par code, avis signé, coproscopie importée et signée ----------
  const VET = { email: `veto-${RUN}@example.org`, password: 'Veto-Martinique-2026' };
  const vetCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const vetP = await vetCtx.newPage(); watch(vetP, 'vétérinaire');
  await vetP.goto(`${BASE}/register`);
  await vetP.getByLabel('Prénom').fill('Marie');
  await vetP.getByLabel(/^Nom/).fill('Laurent');
  await vetP.getByLabel('Adresse courriel').fill(VET.email);
  await vetP.getByLabel('Mot de passe').fill(VET.password);
  await vetP.getByRole('button', { name: 'Créer un compte' }).click();
  await expectText(vetP, 'Vérifiez votre adresse courriel');
  await vetP.goto(`${BASE}/verify-email?token=${await token(VET.email)}`);
  await vetP.getByRole('button', { name: 'Confirmer' }).click();
  await expectText(vetP, 'Adresse vérifiée');
  await vetP.goto(BASE);
  await vetP.getByRole('button', { name: /Je suis vétérinaire/ }).click();
  await vetP.getByLabel(/N° d’inscription à l’Ordre/).fill('27345');
  await vetP.getByLabel(/Clinique/).fill('Clinique vétérinaire du Lamentin');
  await vetP.getByRole('button', { name: 'Envoyer pour vérification' }).click();
  await expectText(vetP, 'En vérification');
  await admin.goto(`${BASE}/admin`);
  await admin.getByRole('tab', { name: 'Vétérinaires' }).click();
  await admin.locator('li', { hasText: VET.email }).getByRole('button', { name: 'Valider l’inscription' }).click();
  await admin.locator('li', { hasText: VET.email }).getByText('Vérifié').waitFor();
  // l'éleveur montre un code
  await desk.goto(`${BASE}/veterinaire`);
  await desk.getByRole('button', { name: 'Afficher un code' }).click();
  const vcode = (await desk.locator('.code-big').innerText()).trim();
  await vetP.goto(`${BASE}/veto`);
  await expectText(vetP, 'Ouvrir une consultation avec un code');
  await vetP.getByLabel('Code de consultation').fill(vcode);
  await vetP.getByRole('button', { name: 'Accéder à l’exploitation' }).click();
  await expectText(vetP, `Consultation ouverte par l’éleveur : Habitation Bellevue ${RUN}`);
  // avis signé sur les seuils ovins
  const signOn = async (page, email) => {
    await page.locator('canvas.sigpad').scrollIntoViewIfNeeded();
    const box = await page.locator('canvas.sigpad').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 90); await page.mouse.down();
    for (const [dx, dy] of [[80, 30], [140, 100], [210, 40], [300, 110], [380, 60]]) await page.mouse.move(box.x + dx, box.y + dy, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Recevoir le code de confirmation' }).click();
    await expectText(page, 'Code envoyé par courriel');
    const r = await db.query(`select subject from outbox_emails where to_email = $1 and subject like 'Code de signature%' order by id desc limit 1`, [email]);
    await page.getByLabel(/Code de confirmation/).fill(/(\d{6})/.exec(r.rows[0].subject)[1]);
  };
  await vetP.getByRole('link', { name: 'Donner mon avis' }).first().click();
  await vetP.getByLabel('Condition : état corporel inférieur ou égal à').fill('2.5');
  await vetP.getByLabel('Coproscopie : seuil de traitement (œufs par gramme)').fill('800');
  await vetP.getByLabel('Commentaire du vétérinaire').fill('Saison des pluies : tournées tous les 14 jours.');
  await signOn(vetP, VET.email);
  await vetP.getByRole('button', { name: 'Signer l’avis' }).click();
  await expectText(vetP, 'Seuils Ovins validés');
  await shot(vetP, '10a-veto-avis-signe');
  // l'éleveur : seuils validés, tournée d'examen
  await desk.goto(`${BASE}/parasitisme`);
  await expectText(desk, 'Seuils Ovins validés');
  await desk.goto(`${BASE}/parasitisme/tournee`);
  const tourAnimal = desk.locator('.tour-animal h2');
  for (let i = 0; i < 12; i++) {
    const name = (await tourAnimal.innerText()).trim();
    if (name === 'Bélier 1') {
      await desk.getByRole('button', { name: '4', exact: true }).first().click();
      await expectText(desk, 'Candidat au traitement');
      await desk.getByRole('button', { name: /Enregistrer et suivant|^Enregistrer$/ }).click();
      break;
    }
    await desk.getByRole('button', { name: /Passer cet animal/ }).click();
  }
  await desk.goto(`${BASE}/parasitisme`);
  await expectText(desk, 'Bilan de la dernière tournée');
  await desk.locator('li', { hasText: 'Bélier 1' }).getByText('À traiter').waitFor();
  // l'éleveur prépare la coproscopie (pré-remplie avec l'animal à traiter)
  await desk.getByRole('button', { name: 'Préparer une coproscopie' }).click();
  await expectText(desk, 'Animaux prélevés (1)');
  await desk.getByRole('button', { name: 'Créer le rapport' }).click();
  await expectText(desk, 'En attente du vétérinaire');
  const copro = (await asUser(FARMER.email, `select id, number from copro_reports order by created_at desc limit 1`)).rows[0];
  // le vétérinaire importe le compte rendu (lecture automatique en mode démonstration), vérifie, interprète, signe
  await vetP.goto(`${BASE}/parasitisme/copro/${copro.id}`);
  await vetP.locator('input[type=file]').first().setInputFiles({ name: 'compte-rendu-labo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n') });
  await expectText(vetP, 'résultat(s) lu(s)', 20000);
  await expectText(vetP, 'identifiant(s) à rattacher');
  await shot(vetP, '10b-veto-import-ia');
  await vetP.locator('tr.warnrow').getByRole('button', { name: 'Supprimer' }).click();
  await vetP.getByLabel('Interprétation et conclusion du vétérinaire').fill('Infestation marquée chez Bélier 1, compatible avec une haemonchose. Traitement ciblé selon ordonnance.');
  await vetP.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expectText(vetP, 'Signature du vétérinaire');
  await vetP.locator('canvas.sigpad').waitFor();
  await signOn(vetP, VET.email);
  await vetP.getByRole('button', { name: 'Signer et valider' }).click();
  await expectText(vetP, 'Signé par Dr Marie Laurent');
  // l'éleveur : rapport signé, PDF, accusé de lecture, vérification publique
  await desk.goto(`${BASE}/parasitisme/copro/${copro.id}`);
  await expectText(desk, 'Signé par Dr Marie Laurent (n° 27345)');
  const pdfHref = await desk.getByRole('link', { name: 'Ouvrir le PDF signé' }).getAttribute('href');
  const pdfRes = await desk.request.get(BASE + pdfHref);
  if (!(pdfRes.headers()['content-type'] ?? '').includes('application/pdf') || (await pdfRes.body()).subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF signé indisponible');
  await desk.getByRole('button', { name: 'J’ai pris connaissance du rapport' }).click();
  await expectText(desk, 'Pris connaissance par l’éleveur');
  await shot(desk, '10c-rapport-signe');
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`${BASE}/verifier/${copro.number}`);
  await expectText(pub, `Document authentique : rapport ${copro.number}`);
  // l'éleveur retire l'accès : le vétérinaire ne voit plus l'exploitation
  await desk.goto(`${BASE}/veterinaire`);
  desk.once('dialog', (dlg) => dlg.accept());
  await desk.getByRole('button', { name: 'Retirer l’accès' }).first().click();
  await expectText(desk, 'retiré');
  const after = await vetP.evaluate(async (fid) => (await fetch(`/api/farms/${fid}/copro`)).status, copro && (await db.query('select farm_id from vet_access order by created_at desc limit 1')).rows[0].farm_id);
  if (after !== 404) throw new Error('accès vétérinaire non retiré : ' + after);
  log('Vétérinaire : compte vérifié, code de consultation, avis signé, tournée « 5 points », coproscopie importée (lecture auto), signée, PDF vérifiable, accès retiré');

  // ---------- Saillies entre élevages : publication, catalogue, simulation à deux, proposition acceptée ----------
  const F2 = { email: `eleveur2-${RUN}@example.org`, password: 'Brebis-Francois-2026' };
  const f2Ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const f2 = await f2Ctx.newPage(); watch(f2, 'éleveur 2');
  await f2.goto(BASE);
  const api2 = (method, path, body) => f2.evaluate(async ([m, p, b]) => {
    const r = await fetch('/api' + p, { method: m, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'carnet' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [method, path, body]);
  await api2('POST', '/auth/register', { email: F2.email, password: F2.password, first_name: 'Line', last_name: 'Sainte-Rose', lang: 'fr' });
  await api2('POST', '/auth/verify-email', { token: await token(F2.email) });
  const reg2 = await api2('PUT', '/registration/mine?submit=1', { territory_code: 'MQ', farm_name: `Élevage du François ${RUN}`, locality: 'Le François', production_type: 'sheep_meat', herd_size: 12, message: null, accepted_terms: true, truthful_declaration: true });
  const dec2 = await adminPost(`/registration/review/${reg2.body.id}/decision`, { action: 'approve' });
  if (dec2.status !== 200) throw new Error('éleveur 2 non approuvé : ' + JSON.stringify(dec2));
  const farm2 = dec2.body.farm_id;
  await api2('POST', `/farms/${farm2}/animals`, { internal_id: 'PERLE', name: 'Perle', sex: 'F', birth_date: '2023-03-01', breed_code: 'MARTINIK' });
  // l'éleveur 1 publie Bélier 1 depuis sa fiche (onglet Famille)
  await desk.goto(`${BASE}/herd/${b1.id}`);
  await desk.getByRole('tab', { name: 'Famille' }).click();
  await desk.getByRole('button', { name: /Partager pour une saillie/ }).click();
  await desk.getByLabel('Conditions (facultatif)').fill('Lutte libre 30 jours, tarif à convenir.');
  await desk.getByRole('button', { name: 'Publier dans le catalogue' }).click();
  await expectText(desk, 'Publié dans le catalogue des saillies');
  // l'éleveur 2 le trouve dans le catalogue, simule avec Perle et envoie une proposition
  await f2.goto(`${BASE}/saillies`);
  const brCard = f2.locator('.br-card', { hasText: 'Bélier 1' });
  await brCard.waitFor();
  await brCard.getByText('Compatible avec vos 1 animaux').waitFor();
  await shot(f2, '11a-catalogue-saillies');
  await brCard.getByRole('link', { name: 'Simuler' }).click();
  await expectText(f2, 'Consanguinité attendue de l’agneau');
  await expectText(f2, 'Ce que l’agneau peut donner');
  await f2.getByLabel('Message').fill('Saillie souhaitée en janvier ?');
  await shot(f2, '11b-simulation-a-deux');
  await f2.getByRole('button', { name: 'Envoyer la proposition' }).click();
  await f2.getByText('En attente').first().waitFor();
  // l'éleveur 1 reçoit la proposition et l'accepte
  await desk.goto(`${BASE}/saillies?tab=mine`);
  await desk.locator('.task', { hasText: 'Perle' }).first().click();
  await expectText(desk, 'Saillie souhaitée en janvier ?');
  await desk.getByRole('button', { name: 'Accepter' }).click();
  await desk.getByText('Acceptée').first().waitFor();
  await f2.goto(`${BASE}/saillies?tab=mine`);
  await f2.getByText('Acceptée').first().waitFor();
  log('Saillies entre élevages : publication depuis la fiche, catalogue (compatibilité), simulation à deux, proposition acceptée');

  // ---------- Aucune page ne doit déborder horizontalement sur un petit téléphone ----------
  await desk.setViewportSize({ width: 360, height: 740 });
  const overflowing = [];
  for (const path of ['/', '/herd', `/herd/${b1.id}`, '/herd/new', '/weigh', '/analytics', '/feeding', '/stock', '/boutique', '/health', '/repro', '/simulateur', '/parcels', '/members', '/collective', '/account', '/notifications', '/installer', '/parasitisme', '/parasitisme/tournee', '/parasitisme/seuils/ovine', '/veterinaire', '/saillies', '/saillies?tab=mine']) {
    await desk.goto(BASE + path); await desk.waitForTimeout(400);
    const extra = await desk.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (extra > 1) overflowing.push(`${path} (+${extra}px)`);
  }
  await desk.setViewportSize({ width: 1366, height: 900 });
  if (overflowing.length) throw new Error('Pages qui débordent sur téléphone : ' + overflowing.join(', '));
  log('Aucune page ne déborde horizontalement sur un téléphone de 360 px');

  await desk.goto(`${BASE}/herd`);
  await desk.getByRole('button', { name: 'EN', exact: true }).click();
  await expectText(desk, 'My flock');
  await expectText(desk, 'Overall ADG');
  await shot(desk, '08-cheptel-en');
  log('Interface en anglais (catalogue central)');

  // Journal d’audit côté administrateur
  await admin.goto(`${BASE}/admin`);
  await admin.getByRole('tab', { name: 'Paramètres' }).click();
  await expectText(admin, 'Limite de refus de consanguinité');
  await admin.getByRole('tab', { name: 'Journal d’audit' }).click();
  await expectText(admin, 'registration.approve');
  await shot(admin, '09-audit');
  log('Journal d’audit consultable par l’administrateur');

  // Suivi des inscriptions : éleveur qui n’a pas vérifié son adresse
  const lateEmail = `retard-${RUN}@example.org`;
  const reg = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'carnet' },
    body: JSON.stringify({ email: lateEmail, password: 'Mouton-Retard-2026', first_name: 'Paul', last_name: 'Retard', lang: 'fr' }) });
  if (!reg.ok) throw new Error('inscription impossible : ' + reg.status);
  await admin.goto(`${BASE}/admin`);
  await admin.getByRole('tab', { name: 'Utilisateurs' }).click();
  await admin.getByLabel('Rechercher').fill('retard-' + RUN);
  const row = admin.locator('tr', { hasText: lateEmail });
  await row.getByText('Adresse non vérifiée').waitFor();
  await row.getByText(/Lien envoyé le/).waitFor();
  await row.getByRole('button', { name: 'Renvoyer le lien' }).click();
  await expectText(admin, 'Nouveau lien de vérification envoyé');
  admin.once('dialog', (d) => d.accept('Adresse confirmée par téléphone'));
  await row.getByRole('button', { name: 'Valider l’adresse' }).click();
  await row.getByText('Dossier non commencé').waitFor();
  await shot(admin, '10-suivi-inscriptions');
  const ver = await db.query('select email_verified_at from users where email = $1', [lateEmail]);
  if (!ver.rows[0].email_verified_at) throw new Error('adresse non validée');
  log('Administration : adresse non vérifiée signalée, lien renvoyé, validation manuelle tracée');

  // Exploitation propre de l’administrateur
  await admin.goto(BASE);
  await admin.getByText('À faire aujourd’hui').or(admin.getByRole('button', { name: /Créer mon exploitation/ })).first().waitFor();
  const hasFarm = await admin.getByText('À faire aujourd’hui').count();
  if (!hasFarm) {
    await admin.getByRole('button', { name: /Créer mon exploitation/ }).click();
    await admin.getByLabel(/^Nom ou référence/).fill(`Ferme admin ${RUN}`);
    await admin.getByLabel(/^Localité/).fill('Sainte-Anne');
    await admin.getByRole('button', { name: 'Créer mon exploitation' }).click();
    await expectText(admin, 'À faire aujourd’hui');
  }
  await admin.getByRole('link', { name: /Mon cheptel/ }).first().waitFor();
  await admin.getByRole('link', { name: /Administration/ }).first().waitFor();
  await shot(admin, '11-admin-exploitation');
  log('Administrateur : « Créer mon exploitation » → espace éleveur + administration');

  // Application installable (PWA) + page d’aide accessible sans compte
  const instCtx = await browser.newContext();
  const inst = await instCtx.newPage(); watch(inst, 'installation');
  await inst.goto(BASE); await inst.waitForTimeout(2000); await inst.reload(); await inst.waitForTimeout(1000);
  const cdp = await instCtx.newCDPSession(inst);
  const ie = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
  if (ie.length) throw new Error('Application non installable : ' + JSON.stringify(ie));
  await inst.getByRole('link', { name: /Installer l’application/ }).click();
  await expectText(inst, 'Android (Samsung');
  await expectText(inst, 'iPhone et iPad — Safari');
  await instCtx.close();
  log('Application reconnue installable par Chrome ; bouton et page d’aide à l’installation');

  if (errors.length) throw new Error('Erreurs navigateur :\n' + errors.join('\n'));
  console.log(`\nE2E : ${step} étapes réussies, aucune erreur JavaScript. Captures : ${SCREENS}/`);
} catch (e) {
  console.error('\n✘ ÉCHEC E2E :', e.message);
  if (errors.length) console.error(errors.join('\n'));
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${SCREENS}/echec-${Math.random().toString(36).slice(2, 6)}.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
