#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少环境文件。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose=("$SCRIPT_DIR/compose.sh" --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

for service in db auth rest realtime kong app; do
  container_id="$(${compose[@]} ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "服务未运行：$service" >&2
    exit 1
  fi
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  if [[ "$health" != "healthy" && "$health" != "running" ]]; then
    echo "服务不健康：$service ($health)" >&2
    exit 1
  fi
done

curl --fail --silent --show-error http://127.0.0.1:3180/login >/dev/null
curl --fail --silent --show-error \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  http://127.0.0.1:8180/auth/v1/health >/dev/null
curl --fail --silent --show-error \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  http://127.0.0.1:8180/rest/v1/ >/dev/null
${compose[@]} exec -T realtime \
  sh -c 'curl -sSfL --head -o /dev/null -H "Authorization: Bearer $ANON_KEY_ASYMMETRIC" http://127.0.0.1:4000/api/tenants/realtime-dev/health'

new_ports="$(ss -ltnH | awk '{print $4}' | grep -E '(^|:)(3180|8180)$' | sort -u)"
if [[ "$new_ports" != *"127.0.0.1:3180"* || "$new_ports" != *"127.0.0.1:8180"* ]]; then
  echo "专用 loopback 端口监听异常。" >&2
  exit 1
fi

echo "本机健康检查通过：应用、Auth、REST、Realtime 和网关均正常。"
