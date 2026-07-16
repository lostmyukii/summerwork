#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"
OUTPUT_FILE="${2:-/srv/summerwork/checkpoints/resource-soak-$(date -u +%Y%m%dT%H%M%SZ).log}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
compose=("$SCRIPT_DIR/compose.sh" --project-name summerwork --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

umask 077
mkdir -p "$(dirname "$OUTPUT_FILE")"
printf 'timestamp\tmem_available_kb\tswap_free_kb\tload\tcontainer\tcpu\tmem\trestarts\n' > "$OUTPUT_FILE"

for sample in $(seq 1 31); do
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mem_available="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  swap_free="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
  load="$(awk '{print $1","$2","$3}' /proc/loadavg)"
  docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
    summerwork_db summerwork_auth summerwork_rest summerwork_realtime summerwork_kong summerwork_app | \
    while IFS=$'\t' read -r name cpu mem; do
      restarts="$(docker inspect --format '{{.RestartCount}}' "$name")"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$timestamp" "$mem_available" "$swap_free" "$load" "$name" "$cpu" "$mem" "$restarts" >> "$OUTPUT_FILE"
    done
  curl --fail --silent http://127.0.0.1:3180/login >/dev/null
  if (( sample < 31 )); then sleep 30; fi
done

echo "15 分钟资源静置记录已完成：$OUTPUT_FILE"
