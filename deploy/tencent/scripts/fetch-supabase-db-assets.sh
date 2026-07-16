#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_COMMIT="11fb71514905d73c006da32bdbcbcc0d3274ba31"
BASE_URL="https://raw.githubusercontent.com/supabase/supabase/${UPSTREAM_COMMIT}/docker/volumes/db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/vendor/db"

for command_name in curl shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必需命令：$command_name" >&2
    exit 1
  fi
done

mkdir -p "$TARGET_DIR"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for file_name in realtime.sql roles.sql jwt.sql; do
  case "$file_name" in
    realtime.sql) expected_sha="7e9e442e7fc4dae05544c07b67bede37a00d84644304dfce4d937134cb4c8f88" ;;
    roles.sql) expected_sha="3ad717b225daa38aa982da26750f35641eb404e1eb5e69a763c22236ab96c1b2" ;;
    jwt.sql) expected_sha="1cc94a4f16f6e2932b383cd68e211a96bcae298437ca4120d8a5106396c58465" ;;
    *) echo "未登记资产：$file_name" >&2; exit 1 ;;
  esac
  curl --fail --silent --show-error --location \
    "$BASE_URL/$file_name" -o "$tmp_dir/$file_name"
  actual_sha="$(shasum -a 256 "$tmp_dir/$file_name" | awk '{print $1}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "Supabase 固定资产哈希不匹配：$file_name" >&2
    exit 1
  fi
  install -m 0644 "$tmp_dir/$file_name" "$TARGET_DIR/$file_name"
done

echo "已校验并安装 3 个固定 Supabase 数据库资产（提交 ${UPSTREAM_COMMIT}）。"
