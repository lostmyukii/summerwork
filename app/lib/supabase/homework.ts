import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../demo-data";
import { weekdayFor, type RequirementLevel, type SummerTask, type SummerTaskKind } from "../summer-plan";
import {
  blankTaskProgress,
  type AuditEntry,
  type InitialWorkspace,
  type PlanOverride,
  type TaskProgress,
  type WorkspaceTask,
} from "../workspace";

type MembershipRow = { family_id: string; role: Role };
type StudentRow = { id: string };
type AssignmentRow = { student_id: string; subject_id: string };

type TaskRow = {
  id: string;
  student_id: string;
  subject_id: string;
  title: string;
  planned_date: string;
  original_date: string;
  slot_type: string;
  knowledge: string;
  knowledge_tags: string[];
  answer_basis: string;
  submission_requirement: string;
  notes: string;
  task_kind: SummerTaskKind;
  block_minutes: number;
  recommended_minutes: number;
  requires_submission: boolean;
  course_integrated: boolean;
  optional: boolean;
  uncertainty: boolean;
  priority: SummerTask["priority"];
  answer_policy: SummerTask["answerPolicy"];
  requirement_level: RequirementLevel;
  evidence_required: string[];
  source_reference: string;
  deadline_date: string | null;
  deadline_at: string | null;
  deadline_precision: SummerTask["deadlinePrecision"];
};

type ActivityRow = {
  task_id: string;
  run_state: TaskProgress["runState"];
  unknown_numbers: string[];
  updated_at: string;
};

type ReviewRow = {
  task_id: string;
  accuracy_band: "100" | "90+" | "70-89" | "below-70";
  wrong_numbers: string[];
  error_tags: string[];
  correction_passed: boolean;
  redo_required: boolean;
  redo_passed: boolean;
  mastery_confirmed: boolean;
  review_confirmed_at: string | null;
  review_saved_at: string | null;
  school_submitted_at: string | null;
  updated_at: string;
};

type PlanChangeRow = {
  id: number;
  task_id: string;
  old_date: string;
  new_date: string;
  reason: string;
  changed_by: string;
  created_at: string;
};

const SUBJECT_BY_ID: Record<string, SummerTask["subject"]> = {
  chinese: "语文",
  math: "数学",
  russian: "俄语",
  physics: "物理",
  chemistry: "化学",
  biology: "生物",
};

const ACCURACY_COPY: Record<ReviewRow["accuracy_band"], string> = {
  "100": "100%",
  "90+": "90%以上",
  "70-89": "70%—89%",
  "below-70": "70%以下",
};

function requireData<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  if (result.data === null) throw new Error(`${label}：没有返回数据`);
  return result.data;
}

function toWorkspaceTask(row: TaskRow): WorkspaceTask {
  const subject = SUBJECT_BY_ID[row.subject_id];
  if (!subject) throw new Error(`未知科目：${row.subject_id}`);
  return {
    id: row.id,
    databaseId: row.id,
    studentId: row.student_id,
    date: row.original_date,
    weekday: weekdayFor(row.original_date),
    slotType: row.slot_type,
    sourceSlotType: row.slot_type,
    subject,
    title: row.title,
    knowledge: row.knowledge,
    knowledgeTags: row.knowledge_tags ?? [],
    answerBasis: row.answer_basis,
    submission: row.submission_requirement,
    notes: row.notes,
    kind: row.task_kind,
    blockMinutes: 90,
    recommendedMinutes: row.recommended_minutes,
    requiresSubmission: row.requires_submission,
    courseIntegrated: row.course_integrated,
    optional: row.optional,
    uncertainty: row.uncertainty,
    priority: row.priority,
    answerPolicy: row.answer_policy,
    requirementLevel: row.requirement_level,
    evidenceRequired: row.evidence_required ?? [],
    source: row.source_reference,
    deadlineDate: row.deadline_date,
    deadlineAt: row.deadline_at,
    deadlinePrecision: row.deadline_precision,
  };
}

export async function loadInitialWorkspace(client: SupabaseClient, userId: string): Promise<InitialWorkspace> {
  const membershipResult = await client
    .from("family_memberships")
    .select("family_id,role")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();
  if (membershipResult.error) throw new Error(`读取家庭身份：${membershipResult.error.message}`);
  const membership = membershipResult.data as MembershipRow | null;
  if (!membership) return { tasks: [], progress: {}, overrides: {}, audit: [], userId, remoteEnabled: true };

  let studentId: string | undefined;
  if (membership.role === "student") {
    const result = await client.from("students").select("id").eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (result.error) throw new Error(`读取孩子档案：${result.error.message}`);
    studentId = (result.data as StudentRow | null)?.id;
  } else if (membership.role === "tutor") {
    const result = await client.from("tutor_assignments").select("student_id,subject_id").eq("tutor_user_id", userId).is("ends_at", null).limit(1).maybeSingle();
    if (result.error) throw new Error(`读取家教授权：${result.error.message}`);
    studentId = (result.data as AssignmentRow | null)?.student_id;
  } else {
    const result = await client.from("students").select("id").eq("family_id", membership.family_id).is("deleted_at", null).limit(1).maybeSingle();
    if (result.error) throw new Error(`读取孩子档案：${result.error.message}`);
    studentId = (result.data as StudentRow | null)?.id;
  }

  if (!studentId) return { tasks: [], progress: {}, overrides: {}, audit: [], role: membership.role, userId, remoteEnabled: true };

  const taskRows = requireData(
    await client
      .from("homework_tasks")
      .select("id,student_id,subject_id,title,planned_date,original_date,slot_type,knowledge,knowledge_tags,answer_basis,submission_requirement,notes,task_kind,block_minutes,recommended_minutes,requires_submission,course_integrated,optional,uncertainty,priority,answer_policy,requirement_level,evidence_required,source_reference,deadline_date,deadline_at,deadline_precision")
      .eq("student_id", studentId)
      .is("deleted_at", null)
      .order("planned_date"),
    "读取暑期作业",
  ) as TaskRow[];

  const tasks = taskRows.map(toWorkspaceTask);
  if (tasks.length === 0) return { tasks, progress: {}, overrides: {}, audit: [], role: membership.role, userId, remoteEnabled: true };
  const taskIds = tasks.map((task) => task.id);

  const [activityResult, reviewResult, changeResult] = await Promise.all([
    client.from("student_task_activity").select("task_id,run_state,unknown_numbers,updated_at").in("task_id", taskIds),
    client.from("task_reviews").select("task_id,accuracy_band,wrong_numbers,error_tags,correction_passed,redo_required,redo_passed,mastery_confirmed,review_confirmed_at,review_saved_at,school_submitted_at,updated_at").in("task_id", taskIds),
    client.from("task_plan_changes").select("id,task_id,old_date,new_date,reason,changed_by,created_at").in("task_id", taskIds).order("created_at", { ascending: false }),
  ]);

  const activityRows = requireData(activityResult, "读取孩子任务状态") as ActivityRow[];
  const reviewRows = requireData(reviewResult, "读取家教批改") as ReviewRow[];
  const changeRows = requireData(changeResult, "读取计划变更") as PlanChangeRow[];
  const activityByTask = new Map(activityRows.map((row) => [row.task_id, row]));
  const reviewByTask = new Map(reviewRows.map((row) => [row.task_id, row]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const progress: Record<string, TaskProgress> = {};

  for (const task of tasks) {
    const activity = activityByTask.get(task.id);
    const review = reviewByTask.get(task.id);
    progress[task.id] = {
      ...blankTaskProgress(),
      runState: activity?.run_state ?? "ready",
      unknown: activity?.unknown_numbers?.join("、") ?? "",
      accuracy: review ? ACCURACY_COPY[review.accuracy_band] : "70%—89%",
      wrongNumbers: review?.wrong_numbers?.join("、") ?? "",
      errorTags: review?.error_tags ?? [],
      reviewConfirmed: Boolean(review?.review_confirmed_at),
      reviewConfirmedAt: review?.review_confirmed_at ?? undefined,
      reviewSaved: Boolean(review?.review_saved_at),
      correctionPassed: review?.correction_passed ?? false,
      redoRequired: review?.redo_required ?? true,
      redoPassed: review?.redo_passed ?? false,
      masteryConfirmed: review?.mastery_confirmed ?? false,
      schoolSubmitted: Boolean(review?.school_submitted_at),
      schoolSubmittedAt: review?.school_submitted_at ?? undefined,
      updatedAt: review?.updated_at ?? activity?.updated_at,
    };
  }

  const latestChangeByTask = new Map<string, PlanChangeRow>();
  for (const change of changeRows) if (!latestChangeByTask.has(change.task_id)) latestChangeByTask.set(change.task_id, change);
  const overrides: Record<string, PlanOverride> = {};
  for (const row of taskRows) {
    if (row.planned_date === row.original_date) continue;
    const latest = latestChangeByTask.get(row.id);
    overrides[row.id] = {
      date: row.planned_date,
      reason: latest?.reason ?? "计划调整",
      changedAt: latest?.created_at ?? "",
      actor: latest?.changed_by === userId ? "当前用户" : "授权成员",
    };
  }

  const audit: AuditEntry[] = changeRows.map((change) => {
    const task = taskById.get(change.task_id);
    return {
      id: String(change.id),
      taskId: change.task_id,
      title: `${task?.title ?? "任务"}调整至${change.new_date.slice(5).replace("-", "月")}日`,
      detail: `原计划 ${change.old_date} · 原因：${change.reason}`,
      actor: change.changed_by === userId ? "当前用户" : `${task?.subject ?? "分科"}家教`,
      occurredAt: change.created_at,
      tone: "blue",
    };
  });

  return { tasks, progress, overrides, audit, role: membership.role, userId, remoteEnabled: true };
}
