#!/bin/sh
# Initialisation PostgreSQL : rôle applicatif SANS contournement de la RLS, rôle de sauvegarde BYPASSRLS distinct.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE carnet_owner LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE carnet_backup LOGIN PASSWORD '${BACKUP_DB_PASSWORD}' BYPASSRLS IN ROLE carnet_owner;
CREATE DATABASE carnet OWNER carnet_owner;
SQL
