#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="${1:-$DEPLOY_DIR/.env}"

for command_name in node openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必需命令：$command_name" >&2
    exit 1
  fi
done

if [[ -e "$OUTPUT_FILE" ]]; then
  echo "拒绝覆盖已有密钥文件：$OUTPUT_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

node --input-type=module - "$OUTPUT_FILE" <<'NODE'
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";

const outputFile = process.argv[2];
const base64url = (value) => Buffer.from(value).toString("base64url");
const randomHex = (bytes) => randomBytes(bytes).toString("hex");
const randomUrl = (bytes) => randomBytes(bytes).toString("base64url");

const jwtSecret = randomUrl(48);
const now = Math.floor(Date.now() / 1000);
const expires = now + 5 * 365 * 24 * 60 * 60;

function signLegacy(role) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ role, iss: "supabase", iat: now, exp: expires }));
  const content = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret).update(content).digest("base64url");
  return `${content}.${signature}`;
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateJwk = privateKey.export({ format: "jwk" });
const kid = randomUUID();
const symmetricJwk = { kty: "oct", k: base64url(jwtSecret), alg: "HS256" };
const privateSigningJwk = {
  kty: "EC", kid, use: "sig", key_ops: ["sign", "verify"], alg: "ES256", ext: true,
  crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y, d: privateJwk.d,
};
const publicSigningJwk = {
  kty: "EC", kid, use: "sig", key_ops: ["verify"], alg: "ES256", ext: true,
  crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y,
};

function signAsymmetric(role) {
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = base64url(JSON.stringify({ role, iss: "supabase", iat: now, exp: expires }));
  const content = `${header}.${payload}`;
  const signature = sign("SHA256", Buffer.from(content), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${content}.${signature}`;
}

function opaqueKey(prefix) {
  const random = randomBytes(17).toString("base64url").slice(0, 22);
  const intermediate = `${prefix}${random}`;
  const checksum = createHash("sha256")
    .update(`supabase-self-hosted|${intermediate}`)
    .digest("base64url")
    .slice(0, 8);
  return `${intermediate}_${checksum}`;
}

const publishableKey = opaqueKey("sb_publishable_");
const secretKey = opaqueKey("sb_secret_");
const values = {
  COMPOSE_PROJECT_NAME: "summerwork",
  POSTGRES_HOST: "db",
  POSTGRES_PORT: "5432",
  POSTGRES_DB: "postgres",
  POSTGRES_PASSWORD: randomHex(32),
  JWT_SECRET: jwtSecret,
  JWT_EXPIRY: "3600",
  ANON_KEY: signLegacy("anon"),
  SERVICE_ROLE_KEY: signLegacy("service_role"),
  JWT_KEYS: JSON.stringify([privateSigningJwk, symmetricJwk]),
  JWT_JWKS: JSON.stringify({ keys: [publicSigningJwk, symmetricJwk] }),
  ANON_KEY_ASYMMETRIC: signAsymmetric("anon"),
  SERVICE_ROLE_KEY_ASYMMETRIC: signAsymmetric("service_role"),
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  SECRET_KEY_BASE: randomHex(64),
  REALTIME_DB_ENC_KEY: randomHex(16),
  SITE_URL: "https://summerwork.ilelezhan.cn",
  API_EXTERNAL_URL: "https://summerwork-api.ilelezhan.cn/auth/v1",
  ADDITIONAL_REDIRECT_URLS: "https://summerwork.ilelezhan.cn/**",
  NEXT_PUBLIC_SUPABASE_URL: "https://summerwork-api.ilelezhan.cn",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: secretKey,
  PGRST_DB_SCHEMAS: "public",
  PGRST_DB_MAX_ROWS: "1000",
};

const content = `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
const fd = openSync(outputFile, "wx", 0o600);
try {
  writeFileSync(fd, content, { encoding: "utf8" });
} finally {
  closeSync(fd);
}
NODE

chmod 600 "$OUTPUT_FILE"
echo "已生成独立生产密钥文件（内容未输出）：$OUTPUT_FILE"
