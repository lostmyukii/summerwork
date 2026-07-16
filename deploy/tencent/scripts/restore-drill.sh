#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${SUMMERWORK_ENV_FILE:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" || ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "用法：restore-drill.sh /srv/summerwork/backups/summerwork-postgres-<时间>.dump" >&2
  exit 1
fi

(cd "$(dirname "$BACKUP_FILE")" && shasum -a 256 -c "$(basename "$BACKUP_FILE").sha256") >/dev/null

compose=(docker compose --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
drill_db="summerwork_restore_$(date -u +%Y%m%d%H%M%S)_$$"

cleanup() {
  ${compose[@]} exec -T db dropdb -U postgres --if-exists "$drill_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

${compose[@]} exec -T db createdb -U postgres -T template0 "$drill_db"
${compose[@]} exec -T db pg_restore -U postgres -d "$drill_db" --exit-on-error < "$BACKUP_FILE"

result="$(${compose[@]} exec -T db psql -qAt -U postgres -d "$drill_db" -c \
  "select (to_regclass('public.homework_tasks') is not null)::int || ':' || (to_regclass('auth.users') is not null)::int")"
if [[ "$result" != "1:1" ]]; then
  echo "恢复演练结构校验失败。" >&2
  exit 1
fi

cleanup
trap - EXIT
echo "恢复演练通过，临时数据库已删除。"
