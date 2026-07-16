import type { SummerTask } from "./summer-plan";
import { normalizeQuestionNumbers, type WorkflowEvidence } from "./workflow";

export type StudentRunState = "ready" | "running" | "paused" | "completed";

export type WorkspaceTask = SummerTask & {
  databaseId?: string;
  studentId?: string;
};

export type TaskProgress = {
  runState: StudentRunState;
  unknown: string;
  accuracy: string;
  wrongNumbers: string;
  errorTags: string[];
  reviewConfirmed: boolean;
  reviewConfirmedAt?: string;
  reviewSaved: boolean;
  correctionPassed: boolean;
  redoRequired: boolean;
  redoPassed: boolean;
  masteryConfirmed: boolean;
  schoolSubmitted: boolean;
  schoolSubmittedAt?: string;
  updatedAt?: string;
};

export type PlanOverride = {
  date: string;
  reason: string;
  changedAt: string;
  actor: string;
};

export type AuditEntry = {
  id: string;
  taskId: string;
  title: string;
  detail: string;
  actor: string;
  occurredAt: string;
  tone: "blue" | "orange" | "green";
};

export type StoredWorkspace = {
  progress: Record<string, TaskProgress>;
  overrides: Record<string, PlanOverride>;
  audit: AuditEntry[];
};

export type InitialWorkspace = StoredWorkspace & {
  tasks: WorkspaceTask[];
  role?: "parent" | "tutor" | "student";
  userId?: string;
  remoteEnabled?: boolean;
};

export function blankTaskProgress(): TaskProgress {
  return {
    runState: "ready",
    unknown: "",
    accuracy: "70%—89%",
    wrongNumbers: "",
    errorTags: [],
    reviewConfirmed: false,
    reviewSaved: false,
    correctionPassed: false,
    redoRequired: true,
    redoPassed: false,
    masteryConfirmed: false,
    schoolSubmitted: false,
  };
}

export function evidenceFor(progress: TaskProgress, requiresSubmission = true): WorkflowEvidence {
  return {
    started: progress.runState !== "ready",
    studentCompleted: progress.runState === "completed",
    reviewSaved: progress.reviewSaved,
    hasErrors: progress.accuracy !== "100%" && normalizeQuestionNumbers(progress.wrongNumbers).length > 0,
    correctionPassed: progress.correctionPassed,
    redoRequired: progress.redoRequired,
    redoPassed: progress.redoPassed,
    masteryConfirmed: progress.masteryConfirmed,
    requiredSubmissionConfirmed: !requiresSubmission || progress.schoolSubmitted,
  };
}
