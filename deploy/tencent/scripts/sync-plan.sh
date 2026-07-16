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

docker compose --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  run --rm --no-deps \
  -e NEXT_PUBLIC_SUPABASE_URL=http://kong:8000 \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SECRET_KEY" \
  app node scripts/sync-summer-plan.mjs
