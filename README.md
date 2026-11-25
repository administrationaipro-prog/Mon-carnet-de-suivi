# Carnet de suivi — Optimisation de sa production

Application de suivi et d’optimisation de la production ovine, multi-exploitations et bilingue (FR/EN), conforme au cahier des charges **V0.3** (15/11/2026).

> Principe directeur : données privées par exploitation, partage collectif volontaire, protocoles homogènes, distinction explicite entre observation, estimation et diagnostic.

## Fonctionnalités

| Domaine | Ce que fait l’application |
|---|---|
| **Comptes** | Création de compte, vérification de l’adresse courriel, connexion, mot de passe oublié, limitation des tentatives (5 échecs / 15 min), gestion et révocation des sessions, **double authentification TOTP obligatoire pour les administrateurs** |
| **Inscription éleveur (§20)** | Brouillon → En attente → Complément demandé → Approuvée / Refusée → Suspendue ; décision motivée, horodatée, notifiée, tracée ; réexamen après refus ; affectation automatique au validateur du territoire |
| **Rôles (§21)** | Administrateur plateforme, validateur territorial (ne voit que les demandes qui lui sont affectées), responsable d’exploitation, collaborateur (saisie), référent technique (lecture seule), analyste collectif (agrégats uniquement) |
| **Cheptel** | Fiches animales (identifiant interne unique, identification officielle, sexe, race/croisement + libellé déclaré, objectif, lot, statut/sortie), recherche et filtres |
| **Généalogie & naissance** | Père/mère (internes ou externes), source et degré de certitude, grands-parents, descendants ; portée, poids de naissance, vitalité, colostrum, assistance |
| **Pesées & mesures** | Poids, hauteur, longueur, opérateur ; refus des dates antérieures à la naissance, futures et des poids non positifs ; doublons et valeurs atypiques signalés avec confirmation ; correction/suppression avec motif et historique d’audit |
| **Croissance** | GMQ exact (jours réels) par période et global, courbes de croissance, poids à âge standard par interpolation encadrée (jamais de valeur inventée), calendrier de pesées J0…J120 puis mensuel, alertes de retard |
| **Alimentation** | Ration par animal ou par lot, quantité, base brute/MS, distribuée vs réellement consommée, fréquence, eau, période, coût |
| **Santé** | Observation, analyse (coproscopie, FAMACHA, NEC), traitement, délai d’attente, suivi programmé ; diagnostic « suspecté » ou « confirmé » ; **aucun diagnostic ni prescription automatisés** |
| **Reproduction** | Lutte, contrôle de gestation, mise bas (nés vivants/morts), sevrage, avortement ; alerte de mise bas attendue |
| **Consanguinité** | Coefficient F de chaque animal calculé automatiquement (méthode de Wright) à partir de la généalogie saisie, affiché sur la fiche avec jauge, nombre de générations connues et complétude. **Refus d'enregistrement** d'un animal dont F dépasse la limite (création et changement de parents). Limites réglables par l'administrateur (défauts : alerte 6,25 %, refus au-delà de 12,5 %) |
| **Simulateur de saillie** | Choix d'un bélier et d'une brebis : consanguinité attendue de l'agneau, apparentement, ancêtres communs, verdict (acceptable / à éviter / refusée), performances observées des parents et de leurs descendants, taux de réussite historique des saillies (avec effectif et intervalle de confiance), date de mise bas attendue. Lecture seule |
| **Vétérinaires** | Compte vétérinaire (n° d'inscription à l'Ordre vérifié par l'administrateur). L'éleveur ouvre une **consultation** : choix du vétérinaire ou code à 6 chiffres (15 min, usage unique), portées (troupeau, santé, reproduction, alimentation), durée (24 h, 7 j, 30 j), révocable, tracée. Le vétérinaire voit uniquement les parties ouvertes, en lecture seule, et ne peut écrire que dans le parasitisme |
| **Parasitisme** | Tournée d'examen « 5 points » (FAMACHA©, état corporel, diarrhée, mâchoire, nez) avec aide à la décision (à traiter / à surveiller / sans traitement) et alerte troupeau ; seuils par espèce (ovins, caprins) par défaut issus des références, **validés et signés par le vétérinaire uniquement** ; jamais de prescription |
| **Coproscopie** | Rapport officiel pré-rempli (exploitation, n° EDE, animaux, derniers examens) ; le vétérinaire **importe le compte rendu du laboratoire** (PDF ou photo) lu automatiquement par l'API Claude, vérifie chaque valeur (niveaux de confiance), interprète et **signe** (signature dessinée + code SMS/courriel). PDF scellé (empreinte SHA-256, QR de vérification publique), rapport figé en base, PDF source conservé ; test FECRT J0/J14 |
| **Stocks** | Articles consommables (foin, grains, aliment, minéraux, litière…) : quantité inventoriée, entrées/sorties, rythme de consommation (ex. 1 botte / 7 jours). Stock estimé au jour le jour, jours restants, date de rupture et date limite de commande (délai de livraison) ; **alerte au responsable** (notification + courriel) quand il reste le seuil choisi (1 unité par défaut), une seule fois par cycle de réapprovisionnement |
| **Boutique** | Catalogue de produits négociés par la plateforme auprès de fournisseurs partenaires, avec une **quantité réservée aux éleveurs de l'application** (jamais dépassée, verrouillage transactionnel) ; commande = réservation (pas de paiement en ligne), confirmée/livrée/annulée par l'administrateur ; à la livraison, le stock de l'exploitation est crédité automatiquement |
| **Lots & parcelles** | Lots et système de conduite, parcelles (surface, occupation, repos, lot présent) |
| **Indicateurs (§8)** | Mortalité, morbidité, taux de sevrage, productivité maternelle, coût alimentaire/kg gagné, complétude, croissance par race — toujours avec effectifs, période et données manquantes, sans inférence causale |
| **Exports** | CSV (animaux, pesées, alimentation, santé, reproduction) en FR ou EN, compatible Excel, neutralisation des formules, export journalisé |
| **Collectif (§24)** | Consentement explicite par finalité, catégories, périmètre et durée ; retrait à tout moment ; agrégats publiés uniquement si ≥ 5 exploitations (seuil paramétrable) ; aucune ligne individuelle |
| **Administration** | Utilisateurs et rôles, territoires, races (FR/EN, synonymes), paramètres (seuil, protocole, tolérances), suspension d’exploitation, accès justifié et temporaire aux données (tracé), journal d’audit, courriels envoyés |
| **RGPD** | Export des données personnelles, suppression (pseudonymisation) du compte, sauvegardes chiffrées et restauration testée |
| **PWA** | Mobile d’abord, installable, consultation hors connexion, **saisie des pesées hors connexion** avec synchronisation idempotente et gestion explicite des conflits |
| **i18n (§23)** | Catalogue central FR/EN, français par défaut, langue mémorisée par utilisateur, changement de langue sans perte de saisie, dates stockées en ISO / affichées selon la locale, horodatages UTC, fuseau par territoire |

## Architecture

```
client/   React + TypeScript (Vite), PWA (manifest + service worker), Recharts
server/   Node.js + Express + TypeScript, validation Zod, PostgreSQL (pg)
scripts/  e2e.mjs (Playwright), backup/restore chiffrés, vérification de restauration
deploy/   initialisation des rôles PostgreSQL pour Docker
```

**Sécurité à deux niveaux (§21 : « évaluées sur le serveur et dans la base »)** :
1. l’API vérifie l’appartenance et le rôle de l’utilisateur pour chaque exploitation (un identifiant d’exploitation transmis par le navigateur ne suffit jamais) ;
2. PostgreSQL applique une **Row-Level Security forcée** sur toutes les tables métier : chaque requête s’exécute dans une transaction portant l’identité de l’utilisateur (`app.user_id`). Même en cas de bogue applicatif, la base ne renvoie aucune ligne d’une autre exploitation et refuse toute écriture non autorisée.

Le rôle de connexion de l’application ne doit **pas** être superutilisateur ni `BYPASSRLS` (un avertissement est affiché au démarrage sinon). Les sauvegardes utilisent un rôle distinct `BYPASSRLS`.

Autres protections : mots de passe hachés (scrypt), jetons de session aléatoires stockés hachés, cookies `HttpOnly`/`SameSite` (et `Secure` en HTTPS), en-tête anti-CSRF obligatoire, CSP stricte (Helmet), requêtes SQL paramétrées, réponses identiques pour éviter l’énumération des comptes, journal d’audit (approbations, droits, exports, accès administratifs, consentements).

## Démarrage rapide (développement)

Prérequis : Node.js 22, PostgreSQL 16.

```bash
# 1. Base et rôles (une fois)
sudo -u postgres psql -c "create role carnet_owner login password 'owner_dev';" \
  -c "create database carnet owner carnet_owner;" \
  -c "create database carnet_test owner carnet_owner;"

# 2. Configuration
cp .env.example .env        # ajuster DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD

# 3. Installation, build, lancement
npm install
npm run build
npm start                   # http://localhost:3000 (crée le schéma et l’administrateur initial)

# Optionnel : exploitation de démonstration (Bélier 1 et 2 du cahier des charges)
npm run seed:demo           # demo@carnet.local / Demo-Carnet-2026
```

En développement avec rechargement à chaud : `npm run dev` (API sur :3000, interface sur :5173).

À la première connexion, l’administrateur doit activer la double authentification (application TOTP : Google Authenticator, Aegis, FreeOTP…).

**Courriels** : envoyés via l’API Brevo si `BREVO_API_KEY` et `MAIL_FROM_EMAIL` sont définis (voir plus bas) ; sinon enregistrés dans `outbox_emails`, affichés dans la console en développement et consultables dans *Administration → Courriels envoyés*.

## Mise en ligne sur Render (sans ordinateur, depuis un navigateur)

Le fichier `render.yaml` décrit l’application web et sa base PostgreSQL (région Francfort).

1. Sur render.com : **Sign in with GitHub**.
2. **New → Blueprint**, choisir ce dépôt (branche contenant `render.yaml`).
3. Saisir `ADMIN_EMAIL` et `ADMIN_PASSWORD` lorsque Render les demande, puis **Apply**.
4. À la fin du déploiement, ouvrir l’adresse `https://….onrender.com` et se connecter avec ce compte administrateur (activation de la double authentification à la première connexion).

L’adresse publique est détectée automatiquement (`RENDER_EXTERNAL_URL`) : cookies `Secure` et HSTS sont activés. `render.yaml` déclare les plans payants : site `starter` (sans mise en veille) et base `basic-256mb` (permanente). Les plans indiqués dans ce fichier font foi : un changement fait seulement dans le tableau de bord peut être annulé à la synchronisation suivante du Blueprint.

### Envoi des courriels (Brevo)

1. Créer un compte sur brevo.com, puis valider l’adresse d’expéditeur (*Senders, Domains & Dedicated IPs → Senders*).
2. Créer une clé API (*SMTP & API → API Keys*).
3. Dans Render, service `carnet-de-suivi` → *Environment* : renseigner `BREVO_API_KEY` et `MAIL_FROM_EMAIL` (l’adresse validée), puis enregistrer (redéploiement automatique).
4. *Administration → Vue d’ensemble → M’envoyer un courriel de test*. L’état de chaque envoi (envoyé, en attente, échec + motif) est visible dans *Courriels envoyés*.

Les courriels sont mis en file dans la même transaction que l’opération, puis envoyés en arrière-plan (nouvelles tentatives à 1, 4, 9, 16, 25 min ; échec définitif si Brevo refuse la requête). Si Brevo répond « unrecognised IP address », désactiver la restriction d’IP de la clé (*Security → Authorised IPs*) : les adresses de Render ne sont pas fixes. Sans clé configurée, les courriels sont seulement enregistrés et consultables dans *Courriels envoyés*.

## Déploiement Docker

```bash
cp .env.example .env   # renseigner POSTGRES_PASSWORD, APP_DB_PASSWORD, BACKUP_DB_PASSWORD, ADMIN_*, PUBLIC_URL
docker compose up -d --build
```

Placer l’application derrière un reverse proxy HTTPS (Caddy, Nginx, Traefik) et définir `PUBLIC_URL=https://…` : les cookies `Secure`, HSTS et `upgrade-insecure-requests` sont alors activés automatiquement.

## Sauvegarde et restauration

```bash
# Sauvegarde chiffrée (AES-256, clé dérivée PBKDF2) + empreinte SHA-256
BACKUP_DATABASE_URL=postgres://carnet_backup:…@host/carnet BACKUP_PASSPHRASE=… scripts/backup.sh backups/

# Restauration
BACKUP_PASSPHRASE=… scripts/restore.sh backups/carnet-….dump.enc postgres://carnet_backup:…@host/carnet

# Test de restauration (critère §15) : sauvegarde → restauration dans une base jetable → comparaison
BACKUP_DATABASE_URL=… RESTORE_TEST_URL=postgres://carnet_backup:…@host/carnet_restore_test BACKUP_PASSPHRASE=… scripts/verify-restore.sh
```

## Tests

```bash
npm test             # API + règles métier (36 tests, base carnet_test) + catalogue i18n
npm run test:e2e     # parcours complet dans Chromium (serveur démarré requis)
```

Couverture des critères d’acceptation :

| Critère (§15, §27) | Vérifié par |
|---|---|
| Fiche avec identifiant unique | `api.test.ts` |
| Historique ordonné et GMQ exact ; dates incohérentes rejetées | `indicators.test.ts`, `api.test.ts`, E2E |
| Aucune valeur inventée en cas de données manquantes | `indicators.test.ts`, `api.test.ts` |
| Blocage / signalement des saisies incohérentes | `api.test.ts`, E2E |
| Aucun accès à une autre exploitation (API **et** base) | `api.test.ts` (tests inter-exploitations + RLS directe) |
| Utilisateur non validé sans accès métier | `api.test.ts`, E2E |
| Validateur limité à ses demandes | `api.test.ts` |
| Changement de langue conservant la saisie | E2E |
| Refus / suspension : état cohérent, notification sans donnée de tiers | `api.test.ts` |
| Retrait du consentement effectif | `api.test.ts` |
| Export CSV fidèle | `api.test.ts`, E2E |
| Synchronisation sans écrasement silencieux | `api.test.ts` (idempotence), E2E (hors connexion) |
| Sauvegarde et restauration vérifiées | `scripts/verify-restore.sh` |

## Consanguinité : méthode, limites et réserves

- **Calcul** : F(animal) = coefficient de parenté entre son père et sa mère (méthode tabulaire de Wright), calculé sur la généalogie réellement saisie. Un ancêtre inconnu est traité comme non apparenté : le taux affiché est donc un **minimum**, d'autant plus fiable que la généalogie est complète (la fiche indique générations connues et complétude). Sans père **et** mère connus, le taux n'est pas calculable et n'est jamais deviné.
- **Valeurs de référence vérifiées par les tests** : frère × sœur ou parent × descendant 25 % ; demi-frère × demi-sœur, oncle × nièce, grand-parent × petit-enfant 12,5 % ; cousins germains 6,25 %.
- **Limites par défaut** : alerte à partir de **6,25 %**, **refus** d'enregistrement au-delà de **12,5 %** (un couple à exactement 12,5 % est accepté avec alerte). Ce sont des repères zootechniques usuels, **pas un barème réglementaire vérifié** : ils sont réglables dans *Administration → Paramètres* (alerte 1–25 %, limite 3–25 %) et doivent être validés avec l'organisme de sélection de la race / l'Institut de l'Élevage avant usage officiel.
- **Refus** : création d'un animal et changement de ses parents (la modification d'autres champs n'est pas bloquée). Détection des boucles de généalogie.
- **Simulateur** : les « performances » affichées sont **observées et descriptives** (l'héritabilité n'est pas appliquée) ; la probabilité de réussite d'une saillie vient de l'historique saisi (saillie suivie d'une mise bas 100 à 200 jours plus tard) et n'est affichée qu'à partir de 3 saillies.

## Stocks et boutique : fonctionnement

- **Estimation** : stock estimé = dernier inventaire + entrées − sorties depuis − (rythme × jours écoulés). Sans rythme renseigné, aucune date de rupture n'est inventée.
- **Alerte** : « Il faut passer commande » dès que le stock estimé atteint le seuil d'alerte **ou** que la rupture arrive avant la fin du délai de livraison. Vérification à chaque mouvement et toutes les heures ; une nouvelle alerte n'est émise qu'après une entrée ou un inventaire.
- **Réserves fournisseurs** : l'administrateur saisit fournisseurs, produits, prix indicatifs, territoire et quantité réservée (*Administration → Boutique*). Les éleveurs commandent dans la limite du restant ; une annulation libère la quantité.
- **Hors périmètre à ce stade** : paiement en ligne, facturation, CGV et contrats fournisseurs (à définir par la plateforme).

## Vétérinaires, parasitisme et coproscopie : fonctionnement

- **Vérification du vétérinaire** : à la création du compte, le vétérinaire donne son n° d'inscription à l'Ordre ; l'administrateur le contrôle dans l'annuaire de l'Ordre (*Administration → Vétérinaires*). Seul un compte vérifié peut ouvrir une consultation et signer.
- **Consultation** : accès temporaire accordé par le responsable de l'exploitation (*Mon vétérinaire*), limité aux portées choisies ; contrôlé par l'API et par la sécurité au niveau des lignes de PostgreSQL ; tout est journalisé.
- **Aide à la décision** : FAMACHA ≥ 4 → à traiter ; note 3 → à traiter si jeune, gestante/allaitante, état corporel faible, note en hausse ou alerte troupeau (> 10 % en note ≥ 4), sinon à surveiller ; œdème de la mâchoire → à traiter ; diarrhée, jetage, croissance faible des jeunes → à surveiller. Valeurs par défaut : guides FAMACHA© (UF/IFAS, NC State, Cornell), Five Point Check, INRAE Antilles, WAAVP 2023. Le seuil de coproscopie n'a pas de valeur de référence unique : il reste vide jusqu'à l'avis du vétérinaire.
- **Signature** : signature dessinée + code à 6 chiffres envoyé par SMS (Brevo, variable `BREVO_SMS_SENDER`) ou à défaut par courriel. C'est une **signature électronique simple** au sens du règlement eIDAS : recevable comme preuve, appuyée par l'identité vérifiée, l'horodatage, l'empreinte SHA-256 du contenu, l'adresse IP et le journal d'audit. Le rapport signé est figé par un déclencheur en base. Pour une valeur probante renforcée, un prestataire de signature qualifiée peut être ajouté.
- **Lecture automatique** : le PDF ou la photo est envoyé à l'API Claude (`ANTHROPIC_API_KEY`, modèle `claude-opus-5-5`, sorties structurées) avec la liste des animaux pour le rapprochement. Les valeurs ne sont qu'une proposition : le vétérinaire vérifie chaque ligne avant de signer. Le document original est conservé intact (empreinte SHA-256). **Données personnelles** : le compte rendu (nom de l'éleveur, n° EDE) est transmis à ce prestataire, à mentionner dans la politique de confidentialité. Sans clé, la saisie reste manuelle ; `AI_EXTRACT_FAKE=1` active un lecteur de démonstration (tests).
- **Vérification publique** : `/verifier/<n° de rapport>` (QR code du PDF) affiche le vétérinaire signataire, la date et l'empreinte.

## Points restant à arbitrer (cahier des charges §30)

L’application les rend configurables sans les trancher : désignation des administrateurs et validateurs (*Administration → Utilisateurs*), ouverture de territoires anglophones (*Référentiels*, désactivés par défaut), justificatifs proportionnés (champ libre, aucune pièce d’identité demandée), seuil d’agrégation (5 par défaut, *Paramètres*), hébergement (Docker, tout fournisseur conforme RGPD). Une étude juridique reste nécessaire avant tout déploiement hors Martinique/Guadeloupe.

> Ne saisissez pas de données sensibles réelles avant la validation des contrôles d’accès sur l’environnement de production.
