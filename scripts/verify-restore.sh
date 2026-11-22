#!/usr/bin/env bash
# Test de restauration (§15, §25) : sauvegarde → restauration dans une base jetable → comparaison des volumes.
# Usage : BACKUP_DATABASE_URL=... RESTORE_TEST_URL=postgres://<rôle BYPASSRLS>@.../carnet_restore_test BACKUP_PASSPHRASE=... scripts/verify-restore.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RESTORE_TEST_URL:?RESTORE_TEST_URL requis (base jetable)}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
scripts/backup.sh "$TMP" >/dev/null
F=$(ls "$TMP"/*.dump.enc)
psql -q "$RESTORE_TEST_URL" -c 'drop schema if exists public cascade; create schema public;'
scripts/restore.sh "$F" "$RESTORE_TEST_URL" >/dev/null
Q="select string_agg(t || '=' || n, ' ' order by t) from (
  select 'users' t, count(*) n from users union all select 'farms', count(*) from farms union all
  select 'audit_logs', count(*) from audit_logs union all select 'consents', count(*) from consents union all
  select 'animals', count(*) from animals union all select 'weighings', count(*) from weighings union all
  select 'health_events', count(*) from health_events union all select 'feeding_events', count(*) from feeding_events union all
  select 'repro_events', count(*) from repro_events) x"
A=$(psql -At "$BACKUP_DATABASE_URL" -c "$Q"); B=$(psql -At "$RESTORE_TEST_URL" -c "$Q")
echo "source   : $A"; echo "restaurée: $B"
[ "$A" = "$B" ] || { echo "ÉCHEC : écart après restauration"; exit 1; }
[ "$(psql -At "$RESTORE_TEST_URL" -c "select count(*) from pg_policies where policyname like 'p\\_%'")" -ge 36 ] || { echo "ÉCHEC : politiques RLS absentes"; exit 1; }
echo "OK : restauration vérifiée (volumes identiques, politiques RLS présentes)."
