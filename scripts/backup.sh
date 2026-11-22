#!/usr/bin/env bash
# Sauvegarde chiffrée de la base (pg_dump format custom + chiffrement AES-256 via openssl).
# Usage : BACKUP_PASSPHRASE=... BACKUP_DATABASE_URL=... scripts/backup.sh [dossier]
# BACKUP_DATABASE_URL : rôle dédié BYPASSRLS (la RLS forcée bloque sinon la lecture complète) — jamais utilisé par l’application.
set -euo pipefail
DIR="${1:-backups}"; mkdir -p "$DIR"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL requis (rôle BYPASSRLS dédié)}"; : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE requis}"
OUT="$DIR/carnet-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
echo "Sauvegarde : $OUT"
