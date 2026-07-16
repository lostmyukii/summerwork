import { normalizeQuestionNumbers } from "../workflow";
import type { ArchivedHomeworkSummary, TaskProgress, WorkspaceTask } from "../workspace";
import { getSupabaseBrowserClient } from "./client";

const ACCURACY_BAND: Record<string, "100" | "90+" | "70-89" | "below-70"> = {
  "100%": "100",
  "90%以上": "90+",
  "70%—89%": "70-89",
  "70%以下": "below-70",
};

type WorkflowRpcRow = { version: number; stage: TaskProgress["workflowStage"] };

export type HomeworkRequirementLevel = "required" | "optional" | "pending_confirmation";
export type HomeworkAnswerPolicy = "after_school_submission" | "guardian_held_until_attempt" | "weekly_teacher_release" | "locked_until_first_attempt";
export type HomeworkAuthoringInput = {
  studentId: string;
  subjectId: string;
  title: string;
  requirements: string;
  plannedDate: string;
  deadlineDate?: string;
  requirementLevel: HomeworkRequirementLevel;
  answerPolicy: HomeworkAnswerPolicy;
  answerBasis: string;
  submissionRequirement: string;
  knowledgeTags: string[];
};
export type HomeworkRevisionInput = Omit<HomeworkAuthoringInput, "studentId" | "subjectId" | "plannedDate"> & { reason: string };

function requireRemoteTask(task: WorkspaceTask) {
  if (!task.databaseId || !task.studentId) throw new Error("任务尚未绑定 Supabase 实例");
  return { taskId: task.databaseId, studentId: task.studentId };
}

function questionArray(value: string): string[] {
  const normalized = normalizeQuestionNumbers(value);
  return normalized ? normalized.split("、") : [];
}

function requireWorkflowVersion(progress: TaskProgress) {
  if (!progress.workflowVersion) throw new Error("缺少权威工作流版本，请刷新后重试");
  return progress.workflowVersion;
}

async function currentWorkflow(taskId: string): Promise<WorkflowRpcRow> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("task_workflow_current")
    .select("version,stage")
    .eq("task_id", taskId)
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowRpcRow;
}

export async function persistStudentActivity(task: WorkspaceTask, previous: TaskProgress, next: TaskProgress): Promise<WorkflowRpcRow | undefined> {
  const { taskId } = requireRemoteTask(task);
  let event: "started" | "paused" | "completed" | "unknown_updated" | undefined;
  if (next.runState === "running" && previous.runState !== "running") event = "started";
  else if (next.runState === "paused" && previous.runState === "running") event = "paused";
  else if (next.runState === "completed" && previous.runState !== "completed") event = "completed";
  if (!event) event = "unknown_updated";

  const { data, error } = await getSupabaseBrowserClient().rpc("record_student_task_event", {
    target_task_id: taskId,
    target_event: event,
    target_unknown_numbers: questionArray(next.unknown),
    expected_version: requireWorkflowVersion(previous),
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as WorkflowRpcRow;
}

export async function persistInitialReview(task: WorkspaceTask, progress: TaskProgress): Promise<WorkflowRpcRow> {
  const { taskId } = requireRemoteTask(task);
  const wrongNumbers = questionArray(progress.wrongNumbers);
  const hasErrors = progress.accuracy !== "100%" && wrongNumbers.length > 0;
  const { error } = await getSupabaseBrowserClient().rpc("save_task_review", {
    target_task_id: taskId,
    target_accuracy_band: ACCURACY_BAND[progress.accuracy] ?? "70-89",
    target_wrong_numbers: wrongNumbers,
    target_error_tags: progress.errorTags,
    target_correction_required: hasErrors,
    target_redo_required: hasErrors && progress.redoRequired,
    target_note: progress.note,
    expected_version: requireWorkflowVersion(progress),
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return currentWorkflow(taskId);
}

export async function persistCorrectionValidation(task: WorkspaceTask, progress: TaskProgress): Promise<WorkflowRpcRow> {
  const { taskId } = requireRemoteTask(task);
  const { error } = await getSupabaseBrowserClient().rpc("record_correction_attempt", {
    target_task_id: taskId,
    correction_passed: progress.correctionPassed,
    redo_passed: progress.redoRequired && progress.redoPassed,
    target_note: progress.note,
    expected_version: requireWorkflowVersion(progress),
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return currentWorkflow(taskId);
}

export async function persistMasteryConfirmation(task: WorkspaceTask, progress: TaskProgress): Promise<WorkflowRpcRow> {
  const { taskId } = requireRemoteTask(task);
  const nodes = task.knowledgeNodes ?? [];
  if (nodes.length === 0) throw new Error("作业尚未关联知识点");
  let expectedVersion = requireWorkflowVersion(progress);
  for (const node of nodes) {
    const { error } = await getSupabaseBrowserClient().rpc("confirm_knowledge_mastery", {
      target_task_id: taskId,
      target_knowledge_node_id: node.id,
      target_level: "mastered",
      target_note: progress.note,
      expected_version: expectedVersion,
      target_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    expectedVersion = (await currentWorkflow(taskId)).version;
  }
  return currentWorkflow(taskId);
}

export async function persistSubmissionConfirmation(task: WorkspaceTask): Promise<WorkflowRpcRow> {
  const { taskId } = requireRemoteTask(task);
  const checkpoints = (task.submissionCheckpoints ?? []).filter((checkpoint) => checkpoint.required && checkpoint.status !== "confirmed");
  if (checkpoints.length === 0) throw new Error("没有待确认的学校提交节点");
  for (const checkpoint of checkpoints) {
    const { error } = await getSupabaseBrowserClient().rpc("confirm_submission_checkpoint", {
      target_checkpoint_id: checkpoint.id,
      target_note: "",
      expected_version: checkpoint.version,
      target_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
  }
  return currentWorkflow(taskId);
}

export async function persistSubmissionRevocation(task: WorkspaceTask, reason: string): Promise<WorkflowRpcRow> {
  const { taskId } = requireRemoteTask(task);
  const checkpoints = (task.submissionCheckpoints ?? []).filter((checkpoint) => checkpoint.required && checkpoint.status === "confirmed");
  if (checkpoints.length === 0) throw new Error("没有可撤销的学校提交节点");
  for (const checkpoint of checkpoints) {
    const { error } = await getSupabaseBrowserClient().rpc("revoke_submission_checkpoint", {
      target_checkpoint_id: checkpoint.id,
      target_revoke_reason: reason,
      expected_version: checkpoint.version,
      target_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
  }
  return currentWorkflow(taskId);
}

export async function persistPlanChange(task: WorkspaceTask, date: string, reason: string, moveFollowing = false) {
  const { taskId } = requireRemoteTask(task);
  if (!task.recordVersion) throw new Error("缺少计划块版本，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("move_homework_blocks", {
    target_task_id: taskId,
    target_date: date,
    change_reason: reason,
    expected_version: task.recordVersion,
    move_following: moveFollowing,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}

export async function generateWeeklyReport(studentId: string, weekStart: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("generate_weekly_report", {
    target_student_id: studentId,
    target_week_start: weekStart,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function exportStudentArchive(studentId: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("export_student_archive", { target_student_id: studentId });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function createBackupSnapshot(studentId: string, label: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("create_backup_snapshot", {
    target_student_id: studentId,
    snapshot_label: label,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createManualHomework(input: HomeworkAuthoringInput) {
  const { data, error } = await getSupabaseBrowserClient().rpc("create_manual_homework", {
    target_student_id: input.studentId,
    target_subject_id: input.subjectId,
    homework_title: input.title,
    homework_requirements: input.requirements,
    target_planned_date: input.plannedDate,
    target_deadline_date: input.deadlineDate || null,
    target_deadline_at: null,
    target_requirement_level: input.requirementLevel,
    target_answer_policy: input.answerPolicy,
    target_answer_basis: input.answerBasis,
    target_submission_requirement: input.submissionRequirement,
    target_knowledge_tags: input.knowledgeTags,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function reviseHomework(task: WorkspaceTask, input: HomeworkRevisionInput) {
  if (!task.homeworkId || !task.homeworkRecordVersion) throw new Error("缺少作业版本，请刷新后重试");
  const { data, error } = await getSupabaseBrowserClient().rpc("revise_homework", {
    target_homework_id: task.homeworkId,
    expected_version: task.homeworkRecordVersion,
    homework_title: input.title,
    homework_requirements: input.requirements,
    target_deadline_date: input.deadlineDate || null,
    target_deadline_at: null,
    revision_reason: input.reason,
    target_requirement_level: input.requirementLevel,
    target_answer_policy: input.answerPolicy,
    target_answer_basis: input.answerBasis,
    target_submission_requirement: input.submissionRequirement,
    target_knowledge_tags: input.knowledgeTags,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setHomeworkArchived(taskOrHomework: WorkspaceTask | ArchivedHomeworkSummary, archived: boolean, reason: string) {
  const isArchivedSummary = "updatedAt" in taskOrHomework;
  const homeworkId = isArchivedSummary ? taskOrHomework.id : taskOrHomework.homeworkId;
  const version = isArchivedSummary ? taskOrHomework.version : taskOrHomework.homeworkRecordVersion;
  if (!homeworkId || !version) throw new Error("缺少作业版本，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("set_homework_archived", {
    target_homework_id: homeworkId,
    archive_value: archived,
    change_reason: reason,
    expected_version: version,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}

export async function markNotificationRead(notificationId: number, read = true) {
  const { error } = await getSupabaseBrowserClient().rpc("mark_notification_read", {
    target_notification_id: notificationId,
    mark_as_read: read,
  });
  if (error) throw new Error(error.message);
}

export async function addSubmissionCheckpoint(task: WorkspaceTask, input: { label: string; dueDate?: string; type?: "initial" | "correction_return" | "paper_retention" | "custom" }) {
  if (!task.homeworkId) throw new Error("缺少作业标识，请刷新后重试");
  const { data, error } = await getSupabaseBrowserClient().rpc("add_submission_checkpoint", {
    target_homework_id: task.homeworkId,
    target_checkpoint_type: input.type ?? "custom",
    target_label: input.label,
    target_required: true,
    target_due_date: input.dueDate || null,
    target_due_at: null,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function reviseSubmissionCheckpoint(task: WorkspaceTask, checkpointId: string, input: { label: string; dueDate?: string; reason: string }) {
  const checkpoint = task.submissionCheckpoints?.find((item) => item.id === checkpointId);
  if (!checkpoint) throw new Error("提交节点不存在，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("revise_submission_checkpoint", {
    target_checkpoint_id: checkpoint.id,
    expected_version: checkpoint.version,
    target_label: input.label,
    target_required: checkpoint.required,
    target_due_date: input.dueDate || null,
    target_due_at: null,
    revision_reason: input.reason,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}

export async function archiveSubmissionCheckpoint(task: WorkspaceTask, checkpointId: string, reason: string) {
  const checkpoint = task.submissionCheckpoints?.find((item) => item.id === checkpointId);
  if (!checkpoint) throw new Error("提交节点不存在，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("set_submission_checkpoint_archived", {
    target_checkpoint_id: checkpoint.id,
    archive_value: true,
    required_on_restore: checkpoint.required,
    change_reason: reason,
    expected_version: checkpoint.version,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}

export async function restoreSubmissionCheckpoint(task: WorkspaceTask, checkpointId: string, reason: string) {
  const checkpoint = task.submissionCheckpoints?.find((item) => item.id === checkpointId);
  if (!checkpoint) throw new Error("提交节点不存在，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("set_submission_checkpoint_archived", {
    target_checkpoint_id: checkpoint.id,
    archive_value: false,
    required_on_restore: true,
    change_reason: reason,
    expected_version: checkpoint.version,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}

export async function splitPlanBlock(task: WorkspaceTask, secondDate: string, reason: string) {
  const { taskId } = requireRemoteTask(task);
  if (!task.recordVersion) throw new Error("缺少计划块版本，请刷新后重试");
  const firstMinutes = Math.max(15, Math.floor(task.blockMinutes / 2));
  const { data, error } = await getSupabaseBrowserClient().rpc("split_homework_block", {
    target_task_id: taskId,
    first_block_minutes: firstMinutes,
    second_block_date: secondDate,
    change_reason: reason,
    expected_version: task.recordVersion,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function appendPlanBlock(task: WorkspaceTask, date: string, reason: string, blockType: WorkspaceTask["blockType"] = "continuation") {
  if (!task.homeworkId) throw new Error("缺少作业标识，请刷新后重试");
  const { data, error } = await getSupabaseBrowserClient().rpc("append_homework_block", {
    target_homework_id: task.homeworkId,
    target_date: date,
    target_block_type: blockType,
    change_reason: reason,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function mergePlanBlocks(first: WorkspaceTask, second: WorkspaceTask, reason: string) {
  const { taskId: firstId } = requireRemoteTask(first);
  const { taskId: secondId } = requireRemoteTask(second);
  if (!first.recordVersion || !second.recordVersion) throw new Error("缺少计划块版本，请刷新后重试");
  const { data, error } = await getSupabaseBrowserClient().rpc("merge_homework_blocks", {
    target_first_task_id: firstId,
    target_second_task_id: secondId,
    first_expected_version: first.recordVersion,
    second_expected_version: second.recordVersion,
    change_reason: reason,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function restorePlanBlock(task: WorkspaceTask, reason: string) {
  const { taskId } = requireRemoteTask(task);
  if (!task.recordVersion) throw new Error("缺少计划块版本，请刷新后重试");
  const { error } = await getSupabaseBrowserClient().rpc("restore_plan_block", {
    target_task_id: taskId,
    restore_reason: reason,
    expected_version: task.recordVersion,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
}
