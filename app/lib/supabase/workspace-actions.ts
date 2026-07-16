import { normalizeQuestionNumbers } from "../workflow";
import type { TaskProgress, WorkspaceTask } from "../workspace";
import { getSupabaseBrowserClient } from "./client";

const ACCURACY_BAND: Record<string, "100" | "90+" | "70-89" | "below-70"> = {
  "100%": "100",
  "90%以上": "90+",
  "70%—89%": "70-89",
  "70%以下": "below-70",
};

function requireRemoteTask(task: WorkspaceTask) {
  if (!task.databaseId || !task.studentId) throw new Error("任务尚未绑定 Supabase 实例");
  return { taskId: task.databaseId, studentId: task.studentId };
}

function questionArray(value: string): string[] {
  const normalized = normalizeQuestionNumbers(value);
  return normalized ? normalized.split("、") : [];
}

export async function persistStudentActivity(task: WorkspaceTask, progress: TaskProgress) {
  const { taskId, studentId } = requireRemoteTask(task);
  const now = new Date().toISOString();
  const { error } = await getSupabaseBrowserClient().from("student_task_activity").upsert({
    task_id: taskId,
    student_id: studentId,
    run_state: progress.runState,
    unknown_numbers: questionArray(progress.unknown),
    started_at: progress.runState === "ready" ? null : now,
    completed_at: progress.runState === "completed" ? now : null,
  }, { onConflict: "task_id" });
  if (error) throw new Error(error.message);
}

export async function persistTaskReview(task: WorkspaceTask, progress: TaskProgress, userId: string) {
  const { taskId } = requireRemoteTask(task);
  const now = new Date().toISOString();
  const { error } = await getSupabaseBrowserClient().from("task_reviews").upsert({
    task_id: taskId,
    reviewed_by: userId,
    accuracy_band: ACCURACY_BAND[progress.accuracy] ?? "70-89",
    wrong_numbers: questionArray(progress.wrongNumbers),
    error_tags: progress.errorTags,
    correction_passed: progress.correctionPassed,
    redo_required: progress.redoRequired,
    redo_passed: progress.redoPassed,
    mastery_confirmed: progress.masteryConfirmed,
    review_confirmed_at: progress.reviewConfirmed ? progress.reviewConfirmedAt ?? now : null,
    review_saved_at: now,
    school_submitted_at: progress.schoolSubmitted ? progress.schoolSubmittedAt ?? now : null,
  }, { onConflict: "task_id" });
  if (error) throw new Error(error.message);
}

export async function persistPlanChange(task: WorkspaceTask, date: string, reason: string) {
  const { taskId } = requireRemoteTask(task);
  const { error } = await getSupabaseBrowserClient().rpc("move_homework_task", {
    target_task_id: taskId,
    target_date: date,
    change_reason: reason,
  });
  if (error) throw new Error(error.message);
}
