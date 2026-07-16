import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error("缺少 SUPABASE_DB_URL。请先在 .env.local 中填写 Supabase 数据库连接 URI。");
  process.exit(1);
}

const cliPath = fileURLToPath(new URL("../node_modules/.bin/supabase", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(cliPath, ["db", "push", "--db-url", databaseUrl, "--yes"], {
  cwd: projectRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

child.on("error", (error) => {
  console.error(`无法启动 Supabase CLI：${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  const safeOutput = output.split(databaseUrl).join("[数据库连接已隐藏]").trim();
  if (safeOutput) console.log(safeOutput);

  if (code !== 0) {
    console.error("数据库迁移失败；未输出数据库连接信息。");
    process.exit(code ?? 1);
  }

  console.log("Supabase 数据库迁移已完成。");
});
