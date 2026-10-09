#!/usr/bin/env bash
# Runs once on first Postgres volume init. Creates a disposable DB for Playwright.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  SELECT 'CREATE DATABASE events_e2e'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'events_e2e')\gexec
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname events_e2e <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL
