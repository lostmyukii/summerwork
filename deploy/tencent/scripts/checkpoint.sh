#!/usr/bin/env bash
set -euo pipefail

umask 077
checkpoint_root="${1:-/srv/summerwork/checkpoints}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$checkpoint_root/$timestamp"
mkdir -p "$target"

docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' > "$target/docker-ps.tsv"
for container_id in $(docker ps -q); do
  docker inspect --format '{{.Id}}\t{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.RestartCount}}' \
    "$container_id" >> "$target/docker-health.tsv"
done
systemctl list-units --type=service --state=running --no-pager > "$target/systemd-running.txt"
ss -lntup > "$target/listening-ports.txt"
free -h > "$target/memory.txt"
df -h > "$target/disk.txt"
uptime > "$target/uptime.txt"
ps -eo pid,comm,rss,%cpu --sort=-rss | sed -n '1,40p' > "$target/processes.tsv"
sudo nginx -T > "$target/nginx-config.txt" 2> "$target/nginx-test.txt"

find "$target" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > "$target/SHA256SUMS"
chmod -R go-rwx "$target"
echo "服务器基线检查点已建立：$target"
