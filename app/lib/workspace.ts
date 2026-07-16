import type { SummerTask } from "./summer-plan";
import { normalizeQuestionNumbers, type MasteryLevel, type WorkflowEvidence, type WorkflowState } from "./workflow";

export type StudentRunState = "ready" | "running" | "paused" | "completed";

export type WorkspaceTask = SummerTask & {
  databaseId?: string;
  studentId?: string;
  homeworkId?: string;
  homeworkVersionId?: string;
  homeworkRecordVersion?: number;
  homeworkTitle?: string;
  homeworkRequirements?: string;
  homeworkKnowledgeTags?: string[];
  homeworkRequirementLevel?: SummerTask["requirementLevel"];
  homeworkAnswerPolicy?: SummerTask["answerPolicy"];
  homeworkAnswerBasis?: string;
  homeworkSubmissionRequirement?: string;
  homeworkDeadlineDate?: string;
  recordVersion?: number;
  blockType?: "knowledge_review" | "first_attempt" | "continuation" | "tutor_review" | "correction" | "independent_redo" | "submission_confirmation" | "reading";
  sequenceNumber?: number;
  deletedAt?: string;
  knowledgeNodes?: KnowledgeNodeSummary[];
  submissionCheckpoints?: SubmissionCheckpointSummary[];
};

export type KnowledgeNodeSummary = {
  id: string;
  name: string;
  currentLevel: MasteryLevel;
  highestLevel: MasteryLevel;
};

export type SubmissionCheckpointSummary = {
  id: string;
  label: string;
  required: boolean;
  status: "not_due" | "awaiting_confirmation" | "confirmed" | "revoked";
  version: number;
  dueDate?: string;
  dueAt?: string;
  confirmedAt?: string;
  archivedAt?: string;
};

export type TaskProgress = {
  runState: StudentRunState;
  unknown: string;
  accuracy: string;
  wrongNumbers: string;
  errorTags: string[];
  note: string;
  reviewConfirmed: boolean;
  reviewConfirmedAt?: string;
  reviewSaved: boolean;
  correctionPassed: boolean;
  redoRequired: boolean;
  redoPassed: boolean;
  masteryConfirmed: boolean;
  schoolSubmitted: boolean;
  schoolSubmittedAt?: string;
  workflowStage?: WorkflowState;
  workflowVersion?: number;
  actualSeconds?: number;
  activeStartedAt?: string;
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

export type NotificationSummary = {
  id: number;
  type: string;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
};

export type WeeklyReportSummary = {
  id: string;
  weekStart: string;
  weekEnd: string;
  metrics: Record<string, number>;
  narrative: string;
  generatedAt: string;
};

export type ArchivedHomeworkSummary = {
  id: string;
  subject: SummerTask["subject"];
  title: string;
  version: number;
  updatedAt: string;
};

export type InitialWorkspace = StoredWorkspace & {
  tasks: WorkspaceTask[];
  studentId?: string;
  notifications?: NotificationSummary[];
  weeklyReports?: WeeklyReportSummary[];
  archivedHomeworks?: ArchivedHomeworkSummary[];
  archivedPlanBlocks?: WorkspaceTask[];
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
    note: "",
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
