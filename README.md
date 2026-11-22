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

**Courriels** : en l’absence de relais SMTP, les messages (vérification, réinitialisation, décisions, invitations) sont enregistrés dans la table `outbox_emails`, affichés dans la console en développement et consultables dans *Administration → Courriels envoyés*. Le branchement d’un relais SMTP se fait dans `server/src/lib/mail.ts`.

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

## Points restant à arbitrer (cahier des charges §30)

L’application les rend configurables sans les trancher : désignation des administrateurs et validateurs (*Administration → Utilisateurs*), ouverture de territoires anglophones (*Référentiels*, désactivés par défaut), justificatifs proportionnés (champ libre, aucune pièce d’identité demandée), seuil d’agrégation (5 par défaut, *Paramètres*), hébergement (Docker, tout fournisseur conforme RGPD). Une étude juridique reste nécessaire avant tout déploiement hors Martinique/Guadeloupe.

> Ne saisissez pas de données sensibles réelles avant la validation des contrôles d’accès sur l’environnement de production.
