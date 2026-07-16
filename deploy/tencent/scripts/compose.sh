#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

echo "未找到 Docker Compose 插件或 docker-compose 命令。" >&2
exit 1
