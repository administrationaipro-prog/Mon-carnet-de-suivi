#!/usr/bin/env bash
# Restauration d’une sauvegarde chiffrée dans une base CIBLE (vide ou à écraser).
# Usage : BACKUP_PASSPHRASE=... [OWNER_ROLE=carnet_owner] scripts/restore.sh fichier.dump.enc postgres://ROLE_BYPASSRLS@.../base_cible
# La connexion doit utiliser le rôle de sauvegarde (BYPASSRLS) ; les objets sont ensuite rendus au propriétaire applicatif.
set -euo pipefail
FILE="$1"; TARGET="$2"; : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE requis}"
[ -f "$FILE.sha256" ] && sha256sum -c "$FILE.sha256"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$TARGET"
psql -q "$TARGET" -c "REASSIGN OWNED BY CURRENT_USER TO ${OWNER_ROLE:-carnet_owner}"
echo "Restauration terminée dans $TARGET"
