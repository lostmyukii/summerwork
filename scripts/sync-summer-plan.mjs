import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key] || /your-|example|placeholder|填写/i.test(process.env[key]));

if (missingEnvironment.length > 0) {
  console.error(`缺少环境变量：${missingEnvironment.join("、")}。请先填写 .env.local。`);
  process.exit(1);
}

const planPath = fileURLToPath(new URL("../app/data/summer-2026.json", import.meta.url));
const planText = await fs.readFile(planPath, "utf8");
const plan = JSON.parse(planText);
const sourceDigest = createHash("sha256").update(planText).digest("hex");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const subjectIds = {
  语文: "chinese",
  数学: "math",
  俄语: "russian",
  物理: "physics",
  化学: "chemistry",
  生物: "biology",
};

function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

const catalogId = plan.meta.id;
requireSuccess(await admin.from("plan_catalogs").upsert({
  id: catalogId,
  title: plan.meta.title,
  version: plan.meta.version,
  starts_on: plan.meta.dateRange.start,
  ends_on: plan.meta.dateRange.end,
  default_block_minutes: plan.meta.defaultBlockMinutes,
  source_digest: sourceDigest,
  configuration: {
    allowedSubjects: plan.meta.allowedSubjects,
    excludedSubjects: plan.meta.excludedSubjects,
    sourceFiles: plan.meta.sourceFiles,
    courseSchedule: plan.courseSchedule,
    importantDates: plan.importantDates,
    subjectRequirements: plan.subjectRequirements,
    ontologyIssues: plan.ontologyIssues,
  },
}), "同步暑期计划目录");

const templates = plan.tasks.map((task) => ({
  id: task.id,
  homework_key: task.homeworkKey,
  catalog_id: catalogId,
  subject_id: subjectIds[task.subject],
  planned_date: task.date,
  slot_type: task.slotType,
  source_slot_type: task.sourceSlotType,
  title: task.title,
  knowledge: task.knowledge,
  knowledge_tags: task.knowledgeTags,
  answer_basis: task.answerBasis,
  submission_requirement: task.submission,
  notes: task.notes,
  task_kind: task.kind,
  block_minutes: task.blockMinutes,
  recommended_minutes: task.recommendedMinutes,
  requires_submission: task.requiresSubmission,
  course_integrated: task.courseIntegrated,
  optional: task.optional,
  uncertainty: task.uncertainty,
  priority: task.priority,
  answer_policy: task.answerPolicy,
  requirement_level: task.requirementLevel,
  evidence_required: task.evidenceRequired,
  source_reference: task.source,
  deadline_date: task.deadlineDate,
  deadline_at: task.deadlineAt,
  deadline_precision: task.deadlinePrecision,
}));

for (let index = 0; index < templates.length; index += 100) {
  requireSuccess(
    await admin.from("homework_task_templates").upsert(templates.slice(index, index + 100)),
    `同步任务模板 ${index + 1}—${Math.min(index + 100, templates.length)}`,
  );
}

const rows = requireSuccess(
  await admin.from("homework_task_templates").select("id,subject_id,planned_date").eq("catalog_id", catalogId),
  "复核任务模板",
);

if (rows.length !== templates.length) {
  throw new Error(`模板数量不一致：本地 ${templates.length}，Supabase ${rows.length}`);
}

const remoteIds = new Set(rows.map((row) => row.id));
const missingIds = templates.filter((item) => !remoteIds.has(item.id)).map((item) => item.id);
if (missingIds.length > 0) throw new Error(`Supabase 缺少任务：${missingIds.join("、")}`);

console.log(`Supabase 暑期计划同步完成：${templates.length} 个真实任务，目录 ${catalogId}，摘要 ${sourceDigest.slice(0, 12)}。`);
