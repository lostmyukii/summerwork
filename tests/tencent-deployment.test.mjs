import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Tencent compose is minimal, pinned and loopback-only", async () => {
  const compose = await read("deploy/tencent/docker-compose.yml");
  const servicesBlock = compose.slice(compose.indexOf("services:"), compose.indexOf("\nnetworks:"));
  const services = [...servicesBlock.matchAll(/^  ([a-z][a-z0-9_-]*):$/gm)].map((match) => match[1]);
  assert.deepEqual(services, ["db", "auth", "rest", "realtime", "kong", "app"]);

  for (const excluded of ["storage", "imgproxy", "functions", "analytics", "logflare", "vector", "studio", "meta", "supavisor"]) {
    assert.doesNotMatch(servicesBlock, new RegExp(`^  ${excluded}:`, "m"));
  }

  assert.match(compose, /supabase\/postgres:17\.6\.1\.136/);
  assert.match(compose, /supabase\/gotrue:v2\.189\.0/);
  assert.match(compose, /postgrest\/postgrest:v14\.12/);
  assert.match(compose, /supabase\/realtime:v2\.102\.3/);
  assert.match(compose, /kong\/kong:3\.9\.1/);
  assert.doesNotMatch(compose, /:latest\b/);

  const publishedPorts = [...compose.matchAll(/^\s+-\s+([^\s#]+:\d+\/tcp)$/gm)].map((match) => match[1]);
  assert.deepEqual(publishedPorts.sort(), ["127.0.0.1:3180:3000/tcp", "127.0.0.1:8180:8000/tcp"]);
  assert.doesNotMatch(compose, /0\.0\.0\.0:\d+:/);
  assert.doesNotMatch(compose, /(?:^|\s)-\s+(?:5432|9999|3000|4000):\d+/m);
  assert.doesNotMatch(compose, /privileged:\s*true|docker\.sock/i);
  assert.equal((compose.match(/restart: unless-stopped/g) ?? []).length, 6);
  assert.equal((compose.match(/mem_limit:/g) ?? []).length, 6);
  assert.equal((compose.match(/cpus:/g) ?? []).length, 6);
  assert.match(compose, /name: summerwork_net/);
  assert.match(compose, /name: \$\{SUMMERWORK_DB_VOLUME:-summerwork_db_data\}/);
  assert.match(compose, /name: \$\{SUMMERWORK_DB_CONFIG_VOLUME:-summerwork_db_config\}/);
  assert.match(compose, /roles-minimal\.sql/);
  assert.match(compose, /pg_get_userbyid\(p\.proowner\)='supabase_auth_admin'/);
  assert.match(compose, /Authorization: Bearer \$\$\{ANON_KEY\}/);
  assert.match(compose, /version: "2\.4"/);

  const appBlock = servicesBlock.slice(servicesBlock.indexOf("\n  app:"));
  assert.doesNotMatch(appBlock, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|POSTGRES_PASSWORD/);
});

test("Nginx templates add only the two named sites and preserve WebSocket", async () => {
  const [http, https, limits] = await Promise.all([
    read("deploy/tencent/nginx/summerwork-http.conf"),
    read("deploy/tencent/nginx/summerwork-https.conf"),
    read("deploy/tencent/nginx/summerwork-rate-limit.conf"),
  ]);
  const combined = `${http}\n${https}`;
  assert.match(combined, /server_name summerwork\.ilelezhan\.cn;/);
  assert.match(combined, /server_name summerwork-api\.ilelezhan\.cn;/);
  assert.doesNotMatch(combined, /default_server/);
  assert.match(https, /proxy_pass http:\/\/127\.0\.0\.1:3180/);
  assert.match(https, /proxy_pass http:\/\/127\.0\.0\.1:8180/);
  assert.match(https, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(https, /proxy_set_header Connection \$summerwork_connection_upgrade/);
  assert.match(limits, /zone=summerwork_auth/);
  assert.doesNotMatch(combined, /include\s+\/etc\/nginx\/sites-enabled/);
});

test("secrets, upstream assets and rollback boundaries are fail-closed", async () => {
  const [example, generate, fetch, backup, restore, cron, logrotate, readme, dockerfile, composeWrapper] = await Promise.all([
    read("deploy/tencent/env.example"),
    read("deploy/tencent/scripts/generate-secrets.sh"),
    read("deploy/tencent/scripts/fetch-supabase-db-assets.sh"),
    read("deploy/tencent/scripts/backup.sh"),
    read("deploy/tencent/scripts/restore-drill.sh"),
    read("deploy/tencent/cron/summerwork-backup"),
    read("deploy/tencent/logrotate/summerwork-backup"),
    read("deploy/tencent/README.md"),
    read("deploy/tencent/Dockerfile"),
    read("deploy/tencent/scripts/compose.sh"),
  ]);

  assert.doesNotMatch(example, /eyJhbGciOiJIUzI1Ni/);
  assert.doesNotMatch(example, /your-super-secret-and-long-postgres-password|super-secret-jwt-token-with-at-least-32-characters-long/i);
  assert.match(generate, /openSync\(outputFile, "wx", 0o600\)/);
  assert.match(generate, /REALTIME_DB_ENC_KEY: randomHex\(8\)/);
  assert.doesNotMatch(generate, /console\.log\([^)]*(?:values|secret|password)/i);
  assert.match(fetch, /11fb71514905d73c006da32bdbcbcc0d3274ba31/);
  assert.match(fetch, /7e9e442e7fc4dae05544c07b67bede37a00d84644304dfce4d937134cb4c8f88/);
  assert.match(fetch, /1cc94a4f16f6e2932b383cd68e211a96bcae298437ca4120d8a5106396c58465/);
  assert.match(backup, /BACKUP_DIR="\$\{SUMMERWORK_BACKUP_DIR:-\/srv\/summerwork\/backups\}"/);
  assert.match(backup, /-maxdepth 1/);
  assert.match(backup, /summerwork-postgres-/);
  assert.match(restore, /summerwork_restore_/);
  assert.match(restore, /pg_restore -U supabase_admin/);
  assert.doesNotMatch(restore, /pg_restore -U postgres/);
  assert.match(cron, /^17 3 \* \* \* root \/srv\/summerwork\/deploy\/scripts\/backup\.sh/m);
  assert.match(logrotate, /^\/var\/log\/summerwork-backup\.log/m);
  assert.match(logrotate, /^\s+su root adm$/m);
  assert.doesNotMatch(`${cron}\n${logrotate}`, /docker system prune|down -v|\/etc\/nginx/);

  const operational = `${readme}\n${backup}\n${restore}`;
  assert.doesNotMatch(operational, /docker\s+(?:system|image|volume|container)?\s*prune/i);
  assert.doesNotMatch(operational, /down[^\n]*\s-v(?:\s|$)/i);
  assert.match(dockerfile, /FROM node:22\.19\.0-bookworm-slim/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /ARG\s+(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|POSTGRES_PASSWORD)/);
  assert.match(composeWrapper, /docker compose version/);
  assert.match(composeWrapper, /exec docker-compose/);
  assert.match(readme, /\$COMPOSE up -d --no-deps app/);
  assert.doesNotMatch(readme, /\$COMPOSE up -d app/);
});

test("Kong exposes Auth, REST and Realtime only", async () => {
  const kong = await read("deploy/tencent/kong/kong.yml");
  assert.match(kong, /name: auth-v1/);
  assert.match(kong, /name: rest-v1/);
  assert.match(kong, /name: realtime-v1-ws/);
  assert.match(kong, /protocol: ws/);
  assert.match(kong, /status_code: 403/);
  assert.doesNotMatch(kong, /storage-v1|functions-v1|analytics-v1|pg-meta/);
});
