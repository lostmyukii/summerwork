#!/usr/bin/env bash
set -euo pipefail

POSTGRES_BIN="$(command -v postgres || true)"
INITDB_BIN="$(command -v initdb || true)"
PG_CTL_BIN="$(command -v pg_ctl || true)"
CREATEDB_BIN="$(command -v createdb || true)"
PSQL_BIN="$(command -v psql || true)"

if [[ -z "$POSTGRES_BIN" || -z "$INITDB_BIN" || -z "$PG_CTL_BIN" || -z "$CREATEDB_BIN" || -z "$PSQL_BIN" ]]; then
  echo "PostgreSQL 16 command-line tools are required for the local database integration test." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
PORT="$((55000 + $$ % 1000))"

cleanup() {
  "$PG_CTL_BIN" -D "$TMP_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

"$INITDB_BIN" -D "$TMP_DIR/data" -A trust -U postgres >/dev/null
"$PG_CTL_BIN" -D "$TMP_DIR/data" -o "-k $TMP_DIR -p $PORT" -w start >/dev/null
"$CREATEDB_BIN" -h "$TMP_DIR" -p "$PORT" -U postgres summerwork

"$PSQL_BIN" -v ON_ERROR_STOP=1 -h "$TMP_DIR" -p "$PORT" -U postgres -d summerwork -c \
  "create role anon nologin;
   create role authenticated nologin;
   create role service_role nologin;
   grant usage on schema public to anon, authenticated, service_role;
   create schema extensions;
   create extension pgcrypto with schema extensions;
   alter database summerwork set search_path = public, extensions;
   alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
   alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
   alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
   create schema auth;
   create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
   create or replace function auth.uid() returns uuid language sql stable as
     'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
   grant usage on schema auth to anon, authenticated, service_role;
   grant execute on function auth.uid() to anon, authenticated, service_role;" >/dev/null

for migration in supabase/migrations/*.sql; do
  PGOPTIONS='-c client_min_messages=warning' "$PSQL_BIN" -q -v ON_ERROR_STOP=1 \
    -h "$TMP_DIR" -p "$PORT" -U postgres -d summerwork -f "$migration"
done

RESULT="$(PGOPTIONS='-c client_min_messages=warning' "$PSQL_BIN" -q -t -A -v ON_ERROR_STOP=1 \
  -h "$TMP_DIR" -p "$PORT" -U postgres -d summerwork \
  -f tests/supabase-workflow.integration.sql | tail -1)"

if [[ "$RESULT" != "WORKFLOW_INTEGRATION_OK" ]]; then
  echo "Unexpected integration result: $RESULT" >&2
  exit 1
fi

echo "$RESULT"
