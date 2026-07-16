#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$DEPLOY_DIR/.env}"

required_commands=(docker curl ss awk grep df nginx stat ionice sudo)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必需命令：$command_name" >&2
    exit 1
  fi
done

"$SCRIPT_DIR/compose.sh" version >/dev/null
docker info >/dev/null
sudo -n nginx -t >/dev/null

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少生产环境文件：$ENV_FILE" >&2
  exit 1
fi

env_mode="$(stat -c '%a' "$ENV_FILE")"
if [[ "$env_mode" != "600" ]]; then
  echo "环境文件权限必须为 600，当前为 $env_mode" >&2
  exit 1
fi

if grep -Eqi 'CHANGE_ME|placeholder|example|your-' "$ENV_FILE"; then
  echo "环境文件仍含占位值。" >&2
  exit 1
fi

realtime_key="$(awk -F= '$1 == "REALTIME_DB_ENC_KEY" {print $2}' "$ENV_FILE")"
if [[ ! "$realtime_key" =~ ^[0-9a-fA-F]{16}$ ]]; then
  echo "Realtime 数据库加密密钥必须为 16 个十六进制字符。" >&2
  exit 1
fi

for file_name in realtime.sql jwt.sql; do
  if [[ ! -s "$DEPLOY_DIR/vendor/db/$file_name" ]]; then
    echo "缺少已校验数据库资产：$file_name" >&2
    exit 1
  fi
done

if [[ ! -s "$DEPLOY_DIR/db/roles-minimal.sql" ]]; then
  echo "缺少精简角色初始化文件。" >&2
  exit 1
fi

if ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)(3180|8180)$'; then
  echo "停止：3180 或 8180 已被占用。" >&2
  exit 1
fi

disk_kb="$(df --output=avail -k /srv | tail -1 | tr -d ' ')"
if (( disk_kb < 45 * 1024 * 1024 )); then
  echo "停止：/srv 可用磁盘低于 45GB。" >&2
  exit 1
fi

mem_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
if (( mem_kb < 4 * 1024 * 1024 )); then
  echo "停止：可用内存低于 4GB。" >&2
  exit 1
fi

echo "部署前置检查通过：现有 Nginx 有效、资源达标、专用端口空闲。"
