import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const currentPlanPath = path.join(projectRoot, "app", "data", "summer-2026.json");
const ledgerPath = path.join(projectRoot, "data-sources", "course-schedule-2026.json");
const workbookPath = process.env.SUMMER_SCHEDULE_SOURCE
  || path.resolve(projectRoot, "..", "..", "假期课表初排.xlsx");
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "summerwork-source-audit-"));
const regeneratedPlanPath = path.join(temporaryDirectory, "summer-2026.json");

try {
  await execFileAsync(process.execPath, [path.join(projectRoot, "scripts", "import-summer-plan.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, SUMMER_PLAN_OUTPUT_PATH: regeneratedPlanPath },
  });

  const [currentPlan, regeneratedPlan, ledger, workbook] = await Promise.all([
    fs.readFile(currentPlanPath, "utf8").then(JSON.parse),
    fs.readFile(regeneratedPlanPath, "utf8").then(JSON.parse),
    fs.readFile(ledgerPath, "utf8").then(JSON.parse),
    fs.readFile(workbookPath),
  ]);

  assert.deepEqual(currentPlan, regeneratedPlan, "已提交计划与五份CSV重新导入结果不一致，请先运行 npm run plan:import");
  assert.equal(currentPlan.tasks.length, 200);
  assert.equal(new Set(currentPlan.tasks.map((task) => task.source)).size, 200, "CSV来源行必须一一对应");
  assert.equal(new Set(currentPlan.tasks.map((task) => task.homeworkKey)).size, 173);
  assert.equal(currentPlan.tasks.some((task) => task.date === "2026-07-05"), false);
  assert.equal(currentPlan.tasks.some((task) => ["英语", "政治", "历史", "地理"].includes(task.subject)), false);
  assert.equal(currentPlan.tasks.filter((task) => task.subject === "语文").every((task) => task.slotType.includes("考背")), true);

  const dispositions = Object.groupBy(ledger.entries, (entry) => entry.disposition);
  assert.equal(dispositions.included?.length, 23);
  assert.equal(dispositions.excluded_by_user?.length, 1);
  assert.equal(dispositions.important_date?.length, 2);
  assert.equal(dispositions.excluded_by_user?.[0]?.date, "2026-07-05");
  assert.equal(currentPlan.courseSchedule.length, 23);
  assert.equal(currentPlan.courseSchedule.some((entry) => entry.labels.some((label) => /\d{1,2}:\d{2}/.test(label))), false);

  const digest = createHash("sha256").update(workbook).digest("hex");
  assert.equal(digest, ledger.sourceSha256, "原始课表已变化，必须重新提取并复核课程数据账本");

  console.log("SOURCE_TRACEABILITY_OK tasks=200 homeworks=173 courseDays=23 excluded=7/5 travel=7/13-14");
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
