#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
REPO_ROOT="${SUMMERWORK_APP_ROOT:-$(cd "$DEPLOY_DIR/../.." && pwd)}"

compose=(docker compose --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
${compose[@]} exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create schema if not exists summerwork_deploy;
create table if not exists summerwork_deploy.schema_migrations (
  filename text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
revoke all on schema summerwork_deploy from public, anon, authenticated;
revoke all on all tables in schema summerwork_deploy from public, anon, authenticated;
SQL

for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  filename="$(basename "$migration")"
  sha256="$(shasum -a 256 "$migration" | awk '{print $1}')"
  recorded="$(${compose[@]} exec -T db psql -qAt -U postgres -d postgres \
    -v filename="$filename" -c "select sha256 from summerwork_deploy.schema_migrations where filename = :'filename'")"
  if [[ -n "$recorded" ]]; then
    if [[ "$recorded" != "$sha256" ]]; then
      echo "已应用迁移被改写，停止：$filename" >&2
      exit 1
    fi
    continue
  fi

  ${compose[@]} exec -T db psql -1 -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration"
  ${compose[@]} exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -v filename="$filename" -v sha256="$sha256" \
    -c "insert into summerwork_deploy.schema_migrations(filename, sha256) values (:'filename', :'sha256')" >/dev/null
  echo "已应用：$filename"
done

echo "数据库迁移全部完成且校验和已登记。"
