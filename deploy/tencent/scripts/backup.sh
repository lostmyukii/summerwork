#!/usr/bin/env bash
set -euo pipefail

umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${SUMMERWORK_ENV_FILE:-$DEPLOY_DIR/.env}"
BACKUP_DIR="${SUMMERWORK_BACKUP_DIR:-/srv/summerwork/backups}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
RETENTION_DAYS="${SUMMERWORK_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/summerwork-postgres-$timestamp.dump"
tmp_file="$backup_file.tmp"
compose=("$SCRIPT_DIR/compose.sh" --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

nice -n 10 ionice -c2 -n7 "${compose[@]}" exec -T db \
  pg_dump -U postgres -d postgres --format=custom --compress=9 --no-password > "$tmp_file"
chmod 600 "$tmp_file"
mv "$tmp_file" "$backup_file"
shasum -a 256 "$backup_file" > "$backup_file.sha256"
chmod 600 "$backup_file.sha256"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'summerwork-postgres-*.dump' -o -name 'summerwork-postgres-*.dump.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

echo "备份与 SHA-256 校验文件已生成：$backup_file"
