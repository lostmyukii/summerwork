import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../demo-data";
import { weekdayFor, type RequirementLevel, type SummerTask, type SummerTaskKind } from "../summer-plan";
import type { MasteryLevel, WorkflowState } from "../workflow";
import {
  blankTaskProgress,
  type ArchivedHomeworkSummary,
  type AuditEntry,
  type InitialWorkspace,
  type PlanOverride,
  type TaskProgress,
  type WorkspaceTask,
} from "../workspace";

type MembershipRow = { family_id: string; role: Role };
type FamilyRow = { daily_block_capacity: number };
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
  homework_id: string | null;
  homework_version_id: string | null;
  version: number;
  block_type: WorkspaceTask["blockType"];
  sequence_number: number;
  deleted_at: string | null;
};

type WorkflowRow = {
  task_id: string;
  stage: WorkflowState | "unscheduled";
  actual_seconds: number;
  active_started_at: string | null;
  version: number;
  updated_at: string;
};

type KnowledgeLinkRow = { task_id: string; knowledge_node_id: string };
type KnowledgeNodeRow = { id: string; display_name: string };
type MasterySnapshotRow = { knowledge_node_id: string; current_level: MasteryLevel; highest_level: MasteryLevel };
type CheckpointRow = {
  id: string;
  homework_id: string;
  label: string;
  required: boolean;
  due_date: string | null;
  due_at: string | null;
  status: "not_due" | "awaiting_confirmation" | "confirmed" | "revoked";
  confirmed_at: string | null;
  archived_at: string | null;
  version: number;
};
type HomeworkSummaryRow = { id: string; version: number; current_version_id: string | null };
type ArchivedHomeworkRow = HomeworkSummaryRow & { subject_id: string; updated_at: string };
type HomeworkVersionSummaryRow = {
  id: string;
  title: string;
  requirements: string;
  knowledge_tags: string[];
  requirement_level: RequirementLevel;
  answer_policy: SummerTask["answerPolicy"];
  answer_basis: string;
  submission_requirement: string;
  deadline_date: string | null;
};
type NotificationRow = { id: number; notification_type: string; title: string; body: string; read_at: string | null; created_at: string };
type WeeklyReportRow = { id: string; week_start: string; week_end: string; metrics: Record<string, number>; narrative: string; generated_at: string };
type PlanVersionStatusRow = { catalog_id: string; applied_version: number; available_version: number; update_available: boolean };

type ActivityRow = {
  task_id: string;
  run_state: TaskProgress["runState"];
  unknown_numbers: string[];
  completed_at: string | null;
  updated_at: string;
};

type ReviewRow = {
  task_id: string;
  accuracy_band: "100" | "90+" | "70-89" | "below-70";
  wrong_numbers: string[];
  error_tags: string[];
  note: string;
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

const TASK_SELECT = "id,student_id,subject_id,title,planned_date,original_date,slot_type,knowledge,knowledge_tags,answer_basis,submission_requirement,notes,task_kind,block_minutes,recommended_minutes,requires_submission,course_integrated,optional,uncertainty,priority,answer_policy,requirement_level,evidence_required,source_reference,deadline_date,deadline_at,deadline_precision,homework_id,homework_version_id,version,block_type,sequence_number,deleted_at";

function requireData<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  if (result.data === null) throw new Error(`${label}：没有返回数据`);
  return result.data;
}

const IN_FILTER_CHUNK_SIZE = 50;

type ArrayQueryResult<T> = { data: T[] | null; error: { message: string } | null };

export function splitIntoChunks<T>(values: readonly T[], size = IN_FILTER_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("分批大小必须是正整数");
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function requireChunkedData<T>(
  values: readonly string[],
  label: string,
  query: (chunk: string[]) => PromiseLike<ArrayQueryResult<T>>,
): Promise<T[]> {
  const results = await Promise.all(splitIntoChunks(values).map((chunk) => query(chunk)));
  return results.flatMap((result) => requireData(result, label));
}

function toWorkspaceTask(row: TaskRow): WorkspaceTask {
  const subject = SUBJECT_BY_ID[row.subject_id];
  if (!subject) throw new Error(`未知科目：${row.subject_id}`);
  return {
    id: row.id,
    homeworkKey: row.homework_id ?? row.id,
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
    blockMinutes: row.block_minutes,
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
    homeworkId: row.homework_id ?? undefined,
    homeworkVersionId: row.homework_version_id ?? undefined,
    recordVersion: row.version,
    blockType: row.block_type,
    sequenceNumber: row.sequence_number,
    deletedAt: row.deleted_at ?? undefined,
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
  const familyResult = await client.from("family_spaces").select("daily_block_capacity").eq("id", membership.family_id).single();
  const family = requireData(familyResult, "读取家庭容量") as FamilyRow;

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

  if (!studentId) return { tasks: [], progress: {}, overrides: {}, audit: [], role: membership.role, userId, remoteEnabled: true, familyId: membership.family_id, dailyBlockCapacity: family.daily_block_capacity };

  const [notificationResult, weeklyReportResult, planVersionResult] = await Promise.all([
    client.from("notifications").select("id,notification_type,title,body,read_at,created_at").eq("recipient_id", userId).order("created_at", { ascending: false }).limit(30),
    client.from("weekly_reports").select("id,week_start,week_end,metrics,narrative,generated_at").eq("student_id", studentId).order("week_start", { ascending: false }).limit(12),
    client.from("student_plan_version_status").select("catalog_id,applied_version,available_version,update_available").eq("student_id", studentId).limit(1).maybeSingle(),
  ]);
  const notificationRows = requireData(notificationResult, "读取站内通知") as NotificationRow[];
  const weeklyReportRows = requireData(weeklyReportResult, "读取周报") as WeeklyReportRow[];
  if (planVersionResult.error) throw new Error(`读取计划版本：${planVersionResult.error.message}`);
  const planVersionRow = planVersionResult.data as PlanVersionStatusRow | null;
  let archivedHomeworks: ArchivedHomeworkSummary[] = [];
  let archivedPlanBlocks: WorkspaceTask[] = [];
  if (membership.role === "parent") {
    const archivedRows = requireData(
      await client.from("homeworks").select("id,subject_id,version,current_version_id,updated_at").eq("student_id", studentId).eq("status", "archived").is("deleted_at", null).order("updated_at", { ascending: false }),
      "读取已归档作业",
    ) as ArchivedHomeworkRow[];
    const archivedVersionIds = archivedRows.map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
    const archivedVersions = archivedVersionIds.length
      ? requireData(await client.from("homework_versions").select("id,title").in("id", archivedVersionIds), "读取已归档作业版本") as Array<{ id: string; title: string }>
      : [];
    const archivedTitleByVersion = new Map(archivedVersions.map((row) => [row.id, row.title]));
    archivedHomeworks = archivedRows.map((row) => ({
      id: row.id,
      subject: SUBJECT_BY_ID[row.subject_id],
      title: archivedTitleByVersion.get(row.current_version_id ?? "") ?? "已归档作业",
      version: row.version,
      updatedAt: row.updated_at,
    })).filter((row) => Boolean(row.subject));
  }
  if (membership.role === "tutor") {
    const activeHomeworkRows = requireData(
      await client
        .from("homeworks")
        .select("id")
        .eq("student_id", studentId)
        .eq("status", "active")
        .is("deleted_at", null),
      "读取有效作业范围",
    ) as Array<{ id: string }>;
    const activeHomeworkIds = activeHomeworkRows.map((row) => row.id);
    const archivedRows = activeHomeworkIds.length
      ? requireData(
        await client
          .from("homework_tasks")
          .select(TASK_SELECT)
          .eq("student_id", studentId)
          .in("homework_id", activeHomeworkIds)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false })
          .limit(30),
        "读取可恢复任务块",
      ) as TaskRow[]
      : [];
    archivedPlanBlocks = archivedRows.map((row) => ({
      ...toWorkspaceTask(row),
      date: row.planned_date,
      weekday: weekdayFor(row.planned_date),
    }));
  }
  const workspaceExtras = {
    studentId,
    familyId: membership.family_id,
    dailyBlockCapacity: family.daily_block_capacity,
    archivedHomeworks,
    archivedPlanBlocks,
    notifications: notificationRows.map((row) => ({ id: row.id, type: row.notification_type, title: row.title, body: row.body, readAt: row.read_at ?? undefined, createdAt: row.created_at })),
    weeklyReports: weeklyReportRows.map((row) => ({ id: row.id, weekStart: row.week_start, weekEnd: row.week_end, metrics: row.metrics, narrative: row.narrative, generatedAt: row.generated_at })),
    planVersionStatus: planVersionRow ? {
      catalogId: planVersionRow.catalog_id,
      appliedVersion: planVersionRow.applied_version,
      availableVersion: planVersionRow.available_version,
      updateAvailable: planVersionRow.update_available,
    } : undefined,
  };

  const taskRows = requireData(
    await client
      .from("homework_tasks")
      .select(TASK_SELECT)
      .eq("student_id", studentId)
      .is("deleted_at", null)
      .order("planned_date"),
    "读取暑期作业",
  ) as TaskRow[];

  const tasks = taskRows.map(toWorkspaceTask);
  if (tasks.length === 0) return { tasks, progress: {}, overrides: {}, audit: [], role: membership.role, userId, remoteEnabled: true, ...workspaceExtras };
  const taskIds = tasks.map((task) => task.id);
  const homeworkIds = [...new Set(taskRows.map((task) => task.homework_id).filter((id): id is string => Boolean(id)))];

  const [activityRows, reviewRows, unsortedChangeRows, workflowRows, checkpointRows, linkRows, homeworkRows] = await Promise.all([
    requireChunkedData<ActivityRow>(taskIds, "读取孩子任务状态", (chunk) => client.from("student_task_activity").select("task_id,run_state,unknown_numbers,completed_at,updated_at").in("task_id", chunk)),
    requireChunkedData<ReviewRow>(taskIds, "读取家教批改", (chunk) => client.from("task_reviews").select("task_id,accuracy_band,wrong_numbers,error_tags,note,correction_passed,redo_required,redo_passed,mastery_confirmed,review_confirmed_at,review_saved_at,school_submitted_at,updated_at").in("task_id", chunk)),
    requireChunkedData<PlanChangeRow>(taskIds, "读取计划变更", (chunk) => client.from("task_plan_changes").select("id,task_id,old_date,new_date,reason,changed_by,created_at").in("task_id", chunk).order("created_at", { ascending: false })),
    requireChunkedData<WorkflowRow>(taskIds, "读取权威工作流", (chunk) => client.from("task_workflow_current").select("task_id,stage,actual_seconds,active_started_at,version,updated_at").in("task_id", chunk)),
    requireChunkedData<CheckpointRow>(homeworkIds, "读取学校提交节点", (chunk) => client.from("submission_checkpoints").select("id,homework_id,label,required,due_date,due_at,status,confirmed_at,archived_at,version").in("homework_id", chunk)),
    requireChunkedData<KnowledgeLinkRow>(taskIds, "读取知识点关联", (chunk) => client.from("task_knowledge_links").select("task_id,knowledge_node_id").in("task_id", chunk)),
    requireChunkedData<HomeworkSummaryRow>(homeworkIds, "读取作业版本", (chunk) => client.from("homeworks").select("id,version,current_version_id").in("id", chunk)),
  ]);
  const changeRows = unsortedChangeRows.sort((left, right) => right.created_at.localeCompare(left.created_at));
  const knowledgeNodeIds = [...new Set(linkRows.map((link) => link.knowledge_node_id))];
  const currentHomeworkVersionIds = homeworkRows.map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const versionRows = await requireChunkedData<HomeworkVersionSummaryRow>(currentHomeworkVersionIds, "读取当前作业版本", (chunk) => client.from("homework_versions").select("id,title,requirements,knowledge_tags,requirement_level,answer_policy,answer_basis,submission_requirement,deadline_date").in("id", chunk));
  const [nodeRows, snapshotRows] = await Promise.all([
    requireChunkedData<KnowledgeNodeRow>(knowledgeNodeIds, "读取知识点", (chunk) => client.from("knowledge_nodes").select("id,display_name").in("id", chunk)),
    requireChunkedData<MasterySnapshotRow>(knowledgeNodeIds, "读取知识点亮", (chunk) => client.from("mastery_snapshots").select("knowledge_node_id,current_level,highest_level").in("knowledge_node_id", chunk)),
  ]);
  const activityByTask = new Map(activityRows.map((row) => [row.task_id, row]));
  const reviewByTask = new Map(reviewRows.map((row) => [row.task_id, row]));
  const workflowByTask = new Map(workflowRows.map((row) => [row.task_id, row]));
  const nodeById = new Map(nodeRows.map((row) => [row.id, row]));
  const snapshotByNode = new Map(snapshotRows.map((row) => [row.knowledge_node_id, row]));
  const homeworkById = new Map(homeworkRows.map((row) => [row.id, row]));
  const homeworkVersionById = new Map(versionRows.map((row) => [row.id, row]));
  const linksByTask = new Map<string, KnowledgeLinkRow[]>();
  for (const link of linkRows) linksByTask.set(link.task_id, [...(linksByTask.get(link.task_id) ?? []), link]);
  const checkpointsByHomework = new Map<string, CheckpointRow[]>();
  for (const checkpoint of checkpointRows) checkpointsByHomework.set(checkpoint.homework_id, [...(checkpointsByHomework.get(checkpoint.homework_id) ?? []), checkpoint]);
  const enrichedTasks = tasks.map((task) => {
    const currentVersion = homeworkVersionById.get(homeworkById.get(task.homeworkId ?? "")?.current_version_id ?? "");
    return {
    ...task,
    homeworkRecordVersion: homeworkById.get(task.homeworkId ?? "")?.version,
    homeworkTitle: currentVersion?.title,
    homeworkRequirements: currentVersion?.requirements,
    homeworkKnowledgeTags: currentVersion?.knowledge_tags,
    homeworkRequirementLevel: currentVersion?.requirement_level,
    homeworkAnswerPolicy: currentVersion?.answer_policy,
    homeworkAnswerBasis: currentVersion?.answer_basis,
    homeworkSubmissionRequirement: currentVersion?.submission_requirement,
    homeworkDeadlineDate: currentVersion?.deadline_date ?? undefined,
    knowledgeNodes: (linksByTask.get(task.id) ?? []).map((link) => ({
      id: link.knowledge_node_id,
      name: nodeById.get(link.knowledge_node_id)?.display_name ?? task.knowledge,
      currentLevel: snapshotByNode.get(link.knowledge_node_id)?.current_level ?? "unpracticed",
      highestLevel: snapshotByNode.get(link.knowledge_node_id)?.highest_level ?? "unpracticed",
    })),
    submissionCheckpoints: (checkpointsByHomework.get(task.homeworkId ?? "") ?? []).map((checkpoint) => ({
      id: checkpoint.id,
      label: checkpoint.label,
      required: checkpoint.required,
      status: checkpoint.status,
      version: checkpoint.version,
      dueDate: checkpoint.due_date ?? undefined,
      dueAt: checkpoint.due_at ?? undefined,
      confirmedAt: checkpoint.confirmed_at ?? undefined,
      archivedAt: checkpoint.archived_at ?? undefined,
    })),
  }; });
  const taskById = new Map(enrichedTasks.map((task) => [task.id, task]));
  const progress: Record<string, TaskProgress> = {};

  for (const task of enrichedTasks) {
    const activity = activityByTask.get(task.id);
    const review = reviewByTask.get(task.id);
    const workflow = workflowByTask.get(task.id);
    const requiredCheckpoints = (task.submissionCheckpoints ?? []).filter((checkpoint) => checkpoint.required);
    const confirmedCheckpoints = requiredCheckpoints.filter((checkpoint) => checkpoint.status === "confirmed");
    const latestConfirmation = confirmedCheckpoints.map((checkpoint) => checkpoint.confirmedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
    progress[task.id] = {
      ...blankTaskProgress(),
      runState: activity?.run_state ?? "ready",
      completedAt: activity?.completed_at ?? undefined,
      unknown: activity?.unknown_numbers?.join("、") ?? "",
      accuracy: review ? ACCURACY_COPY[review.accuracy_band] : "70%—89%",
      wrongNumbers: review?.wrong_numbers?.join("、") ?? "",
      errorTags: review?.error_tags ?? [],
      note: review?.note ?? "",
      reviewConfirmed: Boolean(review?.review_confirmed_at),
      reviewConfirmedAt: review?.review_confirmed_at ?? undefined,
      reviewSaved: Boolean(review?.review_saved_at),
      correctionPassed: review?.correction_passed ?? false,
      redoRequired: review?.redo_required ?? true,
      redoPassed: review?.redo_passed ?? false,
      masteryConfirmed: review?.mastery_confirmed ?? false,
      schoolSubmitted: requiredCheckpoints.length > 0 && confirmedCheckpoints.length === requiredCheckpoints.length,
      schoolSubmittedAt: latestConfirmation ?? review?.school_submitted_at ?? undefined,
      workflowStage: workflow?.stage === "unscheduled" ? "ready" : workflow?.stage,
      workflowVersion: workflow?.version ?? 1,
      actualSeconds: workflow?.actual_seconds ?? 0,
      activeStartedAt: workflow?.active_started_at ?? undefined,
      updatedAt: workflow?.updated_at ?? review?.updated_at ?? activity?.updated_at,
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

  return { tasks: enrichedTasks, progress, overrides, audit, role: membership.role, userId, remoteEnabled: true, ...workspaceExtras };
}
