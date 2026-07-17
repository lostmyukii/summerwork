import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key] || /your-|example|placeholder|填写/i.test(process.env[key]));
if (missingEnvironment.length > 0) {
  console.error(`缺少环境变量：${missingEnvironment.join("、")}。请先填写 .env.local。`);
  process.exit(1);
}

const planPath = fileURLToPath(new URL("../app/data/prestudy-2026.json", import.meta.url));
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
if (plan.lessons.length !== 23) throw new Error(`预习源数据必须为23节，当前为${plan.lessons.length}节。`);

const subjectIds = {
  语文: "chinese",
  数学: "math",
  俄语: "russian",
  物理: "physics",
  化学: "chemistry",
  生物: "biology",
};
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

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
const createdBy = parentRows[0].user_id;

const tutorRows = requireSuccess(
  await admin.from("tutor_assignments").select("subject_id,tutor_user_id").eq("student_id", student.id).is("ends_at", null),
  "读取分科家教",
);
const tutorBySubject = new Map(tutorRows.map((row) => [row.subject_id, row.tutor_user_id]));
const missingTutorSubjects = Object.values(subjectIds).filter((subjectId) => !tutorBySubject.has(subjectId));
if (missingTutorSubjects.length > 0) throw new Error(`拒绝导入：以下科目没有有效家教授权：${missingTutorSubjects.join("、")}。`);

const summerPlan = JSON.parse(await fs.readFile(fileURLToPath(new URL("../app/data/summer-2026.json", import.meta.url)), "utf8"));
const courseSlots = summerPlan.courseSchedule.flatMap((day) => {
  if (day.date === "2026-08-12") return [];
  return day.subjects.map((subject) => ({
    family_id: student.family_id,
    student_id: student.id,
    subject_id: subjectIds[subject],
    course_date: day.date,
    tutor_lane: subject === "语文" ? "考背" : "本科",
    planned_minutes: 90,
    active: true,
    source_reference: day.source,
  }));
});
requireSuccess(
  await admin.from("prestudy_course_slots").upsert(courseSlots, { onConflict: "student_id,subject_id,course_date,tutor_lane" }),
  "同步家教课程槽",
);

const slotKeys = new Set(courseSlots.map((slot) => `${slot.subject_id}|${slot.course_date}|${slot.tutor_lane}`));
for (const lesson of plan.lessons) {
  const subjectId = subjectIds[lesson.subject];
  const slotKey = `${subjectId}|${lesson.plannedDate}|${lesson.tutorLane}`;
  if (!slotKeys.has(slotKey)) throw new Error(`拒绝导入：${lesson.lessonCode}没有匹配的有效家教课程槽。`);
  if (lesson.plannedDate === "2026-08-12") throw new Error(`拒绝导入：${lesson.lessonCode}落在8月12日旅行日。`);
}

const existingLessons = requireSuccess(
  await admin.from("prestudy_lessons").select("id,source_key,source_digest,version").eq("student_id", student.id),
  "读取现有预习课",
);
const existingBySource = new Map(existingLessons.map((lesson) => [lesson.source_key, lesson]));
const existingIds = existingLessons.map((lesson) => lesson.id);
const executionRows = existingIds.length === 0 ? [] : requireSuccess(
  await admin.from("prestudy_execution_records").select("lesson_id,led_at").in("lesson_id", existingIds),
  "读取预习执行记录",
);
const startedLessonIds = new Set(executionRows.filter((row) => row.led_at).map((row) => row.lesson_id));

const requestedLimit = Number.parseInt(process.env.PRESTUDY_SYNC_LIMIT ?? "23", 10);
const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 23) : 23;
const lessons = plan.lessons.slice(0, limit);
const preparedLessons = lessons.map((lesson) => {
  const existing = existingBySource.get(lesson.sourceKey);
  const sourceDigest = createHash("sha256").update(JSON.stringify(lesson)).digest("hex");
  if (existing && startedLessonIds.has(existing.id) && existing.source_digest !== sourceDigest) {
    throw new Error(`拒绝覆盖已带学预习：${lesson.lessonCode}。请建立人工版本变更。`);
  }
  return {
    id: existing?.id ?? randomUUID(),
    source_key: lesson.sourceKey,
    source_digest: sourceDigest,
    family_id: student.family_id,
    student_id: student.id,
    subject_id: subjectIds[lesson.subject],
    assigned_tutor_user_id: tutorBySubject.get(subjectIds[lesson.subject]),
    original_date: lesson.originalDate,
    planned_date: lesson.plannedDate,
    schedule_adjustment_reason: lesson.scheduleAdjustmentReason ?? "",
    tutor_lane: lesson.tutorLane,
    module_code: lesson.moduleCode,
    lesson_code: lesson.lessonCode,
    title: lesson.title,
    input_0_25: lesson.phases.input,
    analysis_25_55: lesson.phases.analysis,
    practice_55_80: lesson.phases.practice,
    output_80_90: lesson.phases.output,
    acceptance_criteria: lesson.acceptanceCriteria,
    planned_minutes: lesson.plannedMinutes,
    created_by: createdBy,
  };
});

for (const row of preparedLessons) {
  const started = startedLessonIds.has(row.id);
  if (started) {
    requireSuccess(
      await admin.from("prestudy_lessons").update({ assigned_tutor_user_id: row.assigned_tutor_user_id }).eq("id", row.id),
      `更新${row.lesson_code}负责家教`,
    );
  } else {
    requireSuccess(
      await admin.from("prestudy_lessons").upsert(row, { onConflict: "student_id,source_key" }),
      `同步${row.lesson_code}预习课`,
    );
  }
}

const syncedLessons = requireSuccess(
  await admin.from("prestudy_lessons").select("id,source_key").eq("student_id", student.id).in("source_key", lessons.map((lesson) => lesson.sourceKey)),
  "复核预习课",
);
const syncedBySource = new Map(syncedLessons.map((lesson) => [lesson.source_key, lesson.id]));
if (syncedLessons.length !== lessons.length) throw new Error(`预习同步数量不一致：目标${lessons.length}，远端${syncedLessons.length}。`);

for (const lesson of lessons) {
  const lessonId = syncedBySource.get(lesson.sourceKey);
  const started = startedLessonIds.has(lessonId);
  const existingKnowledge = requireSuccess(
    await admin.from("prestudy_knowledge_items").select("id,label").eq("lesson_id", lessonId),
    `读取${lesson.lessonCode}知识点`,
  );
  const knowledgeByLabel = new Map(existingKnowledge.map((item) => [item.label, item.id]));
  requireSuccess(
    await admin.from("prestudy_knowledge_items").upsert(lesson.knowledgePoints.map((label, index) => ({
      id: knowledgeByLabel.get(label) ?? randomUUID(),
      lesson_id: lessonId,
      label,
      sort_order: index,
    })), { onConflict: "lesson_id,label" }),
    `同步${lesson.lessonCode}知识点`,
  );
  const staleKnowledgeIds = existingKnowledge.filter((item) => !lesson.knowledgePoints.includes(item.label)).map((item) => item.id);
  if (staleKnowledgeIds.length > 0 && started) throw new Error(`拒绝删除已带学预习的知识点：${lesson.lessonCode}。`);
  if (staleKnowledgeIds.length > 0) {
    requireSuccess(await admin.from("prestudy_knowledge_items").delete().in("id", staleKnowledgeIds), `清理${lesson.lessonCode}旧知识点`);
  }
}

if (limit === 23) {
  const allRows = requireSuccess(
    await admin.from("prestudy_lessons").select("id,source_key").eq("student_id", student.id),
    "复核完整预习计划",
  );
  const expectedKeys = new Set(plan.lessons.map((lesson) => lesson.sourceKey));
  const matchingRows = allRows.filter((row) => expectedKeys.has(row.source_key));
  if (matchingRows.length !== 23) throw new Error(`完整预习计划应为23节，远端为${matchingRows.length}节。`);
}

console.log(`Supabase预习同步完成：${lessons.length}/23节，孩子${student.id}，课程槽${courseSlots.length}个。`);
