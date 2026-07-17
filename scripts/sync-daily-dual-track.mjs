import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key] || /your-|example|placeholder|填写/i.test(process.env[key]));
if (missingEnvironment.length > 0) {
  console.error(`缺少环境变量：${missingEnvironment.join("、")}。请先填写 .env.local。`);
  process.exit(1);
}

const schedulePath = fileURLToPath(new URL("../app/data/daily-dual-track-2026.json", import.meta.url));
const schedule = JSON.parse(await fs.readFile(schedulePath, "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const subjectIds = { 语文: "chinese", 数学: "math", 俄语: "russian", 物理: "physics", 化学: "chemistry", 生物: "biology" };

function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

function chunks(values, size = 50) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function validateSource() {
  if (schedule.blocks.length !== 81) throw new Error(`作业块必须为81个，当前${schedule.blocks.length}个。`);
  const taskIds = schedule.blocks.flatMap((block) => block.taskIds);
  if (taskIds.length !== 203 || new Set(taskIds).size !== 203) throw new Error(`任务映射必须为203项且无重复，当前${taskIds.length}/${new Set(taskIds).size}。`);
  const travelBlocks = schedule.blocks.filter((block) => block.kind === "travel_independent");
  if (travelBlocks.length !== 18 || travelBlocks.some((block) => block.taskIds.length !== 1)) throw new Error("旅行自主必须为18天且每天1项。");
  if (schedule.blocks.some((block) => ["2026-08-16", "2026-08-23"].includes(block.date))) throw new Error("8月16日和23日不得有执行块。");
  if (schedule.blocks.some((block) => block.kind === "travel_independent" && (block.date < schedule.meta.travelRange.start || block.date > schedule.meta.travelRange.end))) throw new Error("旅行期外不得有自主作业。");
  return taskIds;
}

function slotTypeFor(block) {
  if (block.kind === "travel_independent") return "旅行自主·可顺延";
  if (block.tutorLane === "考背") return "考背课内90分钟";
  if (block.tutorLane === "生物课内共享") return "生物课内共享45分钟";
  if (block.subject === "生物" && ["2026-07-20", "2026-07-22", "2026-07-24"].includes(block.date)) return "生物课内45分钟";
  if (block.supplementMinutes === 60) return "家教课内90+补充60分钟";
  return "家教课内90分钟";
}

const sourceTaskIds = validateSource();
let studentsQuery = admin.from("students").select("id,family_id").eq("active", true).is("deleted_at", null);
if (process.env.SUMMERWORK_STUDENT_ID) studentsQuery = studentsQuery.eq("id", process.env.SUMMERWORK_STUDENT_ID);
if (process.env.SUMMERWORK_FAMILY_ID) studentsQuery = studentsQuery.eq("family_id", process.env.SUMMERWORK_FAMILY_ID);
const students = requireSuccess(await studentsQuery, "读取孩子档案");
if (students.length !== 1) throw new Error(`需要唯一孩子档案，当前匹配${students.length}个；请设置SUMMERWORK_STUDENT_ID。`);
const student = students[0];

const parentRows = requireSuccess(
  await admin.from("family_memberships").select("user_id").eq("family_id", student.family_id).eq("role", "parent").is("removed_at", null),
  "读取家长管理员",
);
if (parentRows.length !== 1) throw new Error(`需要唯一家长管理员，当前匹配${parentRows.length}个。`);
const actorId = parentRows[0].user_id;

const taskRows = requireSuccess(
  await admin.from("homework_tasks").select("id,template_id,subject_id,planned_date,original_date,slot_type,course_integrated,version").eq("student_id", student.id).is("deleted_at", null),
  "读取203项作业",
);
if (taskRows.length !== 203) throw new Error(`线上有效作业应为203项，当前${taskRows.length}项。`);
const taskByTemplate = new Map(taskRows.map((task) => [task.template_id, task]));
const missingTemplates = sourceTaskIds.filter((id) => !taskByTemplate.has(id));
if (missingTemplates.length > 0) throw new Error(`线上缺少${missingTemplates.length}个任务模板实例：${missingTemplates.slice(0, 8).join("、")}。`);

const changeRows = [];
const eventRows = [];
let changedTasks = 0;
for (const block of schedule.blocks) {
  const slotType = slotTypeFor(block);
  for (const templateId of block.taskIds) {
    const task = taskByTemplate.get(templateId);
    const courseIntegrated = block.kind !== "travel_independent";
    const changed = task.planned_date !== block.date || task.slot_type !== slotType || task.course_integrated !== courseIntegrated;
    if (!changed) continue;
    const updatedTask = requireSuccess(
      await admin.from("homework_tasks").update({
        planned_date: block.date,
        slot_type: slotType,
        course_integrated: courseIntegrated,
        version: task.version + 1,
        updated_by: actorId,
      }).eq("id", task.id).eq("version", task.version).select("id").single(),
      `迁移${templateId}`,
    );
    if (updatedTask.id !== task.id) throw new Error(`迁移${templateId}时发生版本冲突。`);
    if (task.planned_date !== block.date) {
      changeRows.push({ task_id: task.id, old_date: task.planned_date, new_date: block.date, reason: "按最终逐日双轨清单迁入家教课内或旅行自主", changed_by: actorId });
    }
    eventRows.push({
      family_id: student.family_id,
      student_id: student.id,
      subject_id: task.subject_id,
      entity_type: "task",
      entity_id: task.id,
      event_type: "daily_dual_track_schedule_applied",
      before_value: { planned_date: task.planned_date, slot_type: task.slot_type, course_integrated: task.course_integrated },
      after_value: { planned_date: block.date, slot_type: slotType, course_integrated: courseIntegrated, schedule_version: schedule.meta.version },
      reason: "按最终逐日双轨清单迁入系统",
      actor_id: actorId,
      idempotency_key: randomUUID(),
    });
    changedTasks += 1;
  }
}

for (const batch of chunks(changeRows, 100)) requireSuccess(await admin.from("task_plan_changes").insert(batch), "写入计划变更记录");
for (const batch of chunks(eventRows, 100)) requireSuccess(await admin.from("change_events").insert(batch), "写入清单迁移审计");

const existingBlocks = requireSuccess(
  await admin.from("study_blocks").select("id,source_key,active").eq("student_id", student.id),
  "读取现有作业块",
);
const existingBlockByKey = new Map(existingBlocks.map((block) => [block.source_key, block]));
const blockRows = schedule.blocks.map((block) => ({
  id: existingBlockByKey.get(block.sourceKey)?.id ?? randomUUID(),
  source_key: block.sourceKey,
  family_id: student.family_id,
  student_id: student.id,
  subject_id: subjectIds[block.subject],
  planned_date: block.date,
  block_kind: block.kind,
  tutor_lane: block.tutorLane,
  title: block.title,
  capacity_minutes: block.capacityMinutes,
  estimated_minutes: block.estimatedMinutes,
  overflow_minutes: block.overflowMinutes,
  supplement_minutes: block.supplementMinutes,
  fallback_date: block.fallbackDate,
  active: true,
  source_reference: `${schedule.meta.title} v${schedule.meta.version}`,
  created_by: actorId,
}));
for (const batch of chunks(blockRows, 50)) requireSuccess(await admin.from("study_blocks").upsert(batch, { onConflict: "student_id,source_key" }), "同步作业块");

const expectedBlockKeys = new Set(schedule.blocks.map((block) => block.sourceKey));
const staleBlockIds = existingBlocks.filter((block) => block.active && !expectedBlockKeys.has(block.source_key)).map((block) => block.id);
for (const batch of chunks(staleBlockIds)) requireSuccess(await admin.from("study_blocks").update({ active: false }).in("id", batch), "停用旧作业块");

const syncedBlocks = requireSuccess(
  await admin.from("study_blocks").select("id,source_key").eq("student_id", student.id).eq("active", true),
  "复核作业块",
);
if (syncedBlocks.length !== 81) throw new Error(`有效作业块应为81个，当前${syncedBlocks.length}个。`);
const syncedBlockByKey = new Map(syncedBlocks.map((block) => [block.source_key, block.id]));
for (const batch of chunks(syncedBlocks.map((block) => block.id))) requireSuccess(await admin.from("study_block_items").delete().in("block_id", batch), "刷新作业块任务映射");
const itemRows = schedule.blocks.flatMap((block) => block.taskIds.map((templateId, sortOrder) => ({
  block_id: syncedBlockByKey.get(block.sourceKey),
  task_id: taskByTemplate.get(templateId).id,
  sort_order: sortOrder,
})));
for (const batch of chunks(itemRows, 100)) requireSuccess(await admin.from("study_block_items").insert(batch), "同步作业块任务映射");

const travelBlocks = schedule.blocks.filter((block) => block.kind === "travel_independent");
const travelTaskDatabaseIds = travelBlocks.map((block) => taskByTemplate.get(block.taskIds[0]).id);
const existingTravelRows = requireSuccess(
  await admin.from("task_travel_recovery_schedules").select("task_id,original_purpose").in("task_id", travelTaskDatabaseIds),
  "读取现有旅行补位",
);
const existingTravelByTask = new Map(existingTravelRows.map((row) => [row.task_id, row]));
const travelRows = travelBlocks.map((block) => {
  const task = taskByTemplate.get(block.taskIds[0]);
  return {
    task_id: task.id,
    original_planned_date: task.original_date,
    travel_date: block.date,
    fallback_date: block.fallbackDate,
    planned_minutes: 90,
    original_purpose: existingTravelByTask.get(task.id)?.original_purpose ?? task.slot_type,
    current_purpose: "旅行自主·可顺延",
    created_by: actorId,
  };
});
requireSuccess(await admin.from("task_travel_recovery_schedules").upsert(travelRows, { onConflict: "task_id" }), "同步旅行补位");

const validationTasks = requireSuccess(
  await admin.from("homework_tasks").select("id,planned_date,course_integrated").eq("student_id", student.id).is("deleted_at", null),
  "复核迁移后作业",
);
const mappedItems = requireSuccess(
  await admin.from("study_block_items").select("task_id,block_id").in("block_id", syncedBlocks.map((block) => block.id)),
  "复核作业映射",
);
if (validationTasks.length !== 203 || mappedItems.length !== 203 || new Set(mappedItems.map((item) => item.task_id)).size !== 203) {
  throw new Error(`迁移后数量不一致：任务${validationTasks.length}、映射${mappedItems.length}/${new Set(mappedItems.map((item) => item.task_id)).size}。`);
}
const independentCount = validationTasks.filter((task) => !task.course_integrated).length;
if (independentCount !== 18) throw new Error(`旅行自主任务应为18项，当前${independentCount}项。`);

console.log(`逐日双轨清单同步完成：81个作业块、203项任务、18项旅行自主；本次更新${changedTasks}项，记录${changeRows.length}条日期变更。`);
