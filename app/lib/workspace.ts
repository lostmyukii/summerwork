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
  completedAt?: string;
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

export type SubmissionTimingState =
  | "not_required"
  | "pending"
  | "completed_pending"
  | "overdue_incomplete"
  | "overdue_completed"
  | "submitted_on_time"
  | "submitted_late"
  | "submitted_unknown_time";

export type SubmissionTiming = {
  state: SubmissionTimingState;
  label: string;
  detail: string;
  tone: "gray" | "orange" | "red" | "green";
  deadlineAt?: string;
  completedAt?: string;
  submittedAt?: string;
  lateDays?: number;
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

export type PlanVersionStatus = {
  catalogId: string;
  appliedVersion: number;
  availableVersion: number;
  updateAvailable: boolean;
};

export type PrestudyState = "pending" | "led" | "validated";

export type PrestudyKnowledgeItem = {
  id: string;
  label: string;
  sortOrder: number;
};

export type PrestudyUnmasteredItem = {
  id: string;
  knowledgeItemId?: string;
  label: string;
  custom: boolean;
};

export type PrestudyLesson = {
  id: string;
  sourceKey: string;
  studentId?: string;
  subject: SummerTask["subject"];
  subjectId: string;
  assignedTutorUserId?: string;
  assignedTutorLabel: string;
  originalDate: string;
  plannedDate: string;
  scheduleAdjustmentReason?: string;
  tutorLane: "本科" | "考背";
  moduleCode: string;
  lessonCode: string;
  title: string;
  phases: {
    input: string;
    analysis: string;
    practice: string;
    output: string;
  };
  acceptanceCriteria: string;
  plannedMinutes: 90;
  version: number;
  contentEditedAt?: string;
  state: PrestudyState;
  executionVersion: number;
  ledAt?: string;
  validatedAt?: string;
  actualQuestionCount?: number;
  knowledgeItems: PrestudyKnowledgeItem[];
  unmasteredItems: PrestudyUnmasteredItem[];
};

export type PrestudyCourseSlot = {
  subject: SummerTask["subject"];
  date: string;
  tutorLane: "本科" | "考背";
};

export type InitialWorkspace = StoredWorkspace & {
  tasks: WorkspaceTask[];
  prestudyLessons?: PrestudyLesson[];
  prestudyCourseSlots?: PrestudyCourseSlot[];
  studentId?: string;
  notifications?: NotificationSummary[];
  weeklyReports?: WeeklyReportSummary[];
  archivedHomeworks?: ArchivedHomeworkSummary[];
  archivedPlanBlocks?: WorkspaceTask[];
  planVersionStatus?: PlanVersionStatus;
  familyId?: string;
  dailyBlockCapacity?: number;
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

function taskDeadlineAt(task: Pick<SummerTask, "deadlineAt" | "deadlineDate">): string | undefined {
  if (task.deadlineAt && Number.isFinite(Date.parse(task.deadlineAt))) return task.deadlineAt;
  if (!task.deadlineDate) return undefined;
  return `${task.deadlineDate}T23:59:59+08:00`;
}

function displayAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function submissionDetail(prefix: string, completedAt?: string, submittedAt?: string): string {
  const parts = [prefix];
  if (completedAt) parts.push(`首次完成 ${displayAt(completedAt)}`);
  if (submittedAt) parts.push(`提交确认 ${displayAt(submittedAt)}`);
  return parts.join(" · ");
}

export function deriveSubmissionTiming(
  task: Pick<SummerTask, "requiresSubmission" | "deadlineAt" | "deadlineDate">,
  progress: TaskProgress,
  referenceAt = new Date().toISOString(),
): SubmissionTiming {
  if (!task.requiresSubmission) {
    return { state: "not_required", label: "无需提交", detail: "本任务没有学校平台提交要求", tone: "gray" };
  }

  const deadlineAt = taskDeadlineAt(task);
  const completedAt = progress.completedAt;
  const submittedAt = progress.schoolSubmittedAt;
  if (progress.schoolSubmitted) {
    if (!submittedAt || !deadlineAt) {
      return {
        state: "submitted_unknown_time",
        label: "已提交·时间待确认",
        detail: submissionDetail(deadlineAt ? `学校截止 ${displayAt(deadlineAt)}` : "学校截止待确认", completedAt, submittedAt),
        tone: "green",
        deadlineAt,
        completedAt,
        submittedAt,
      };
    }
    const delay = Date.parse(submittedAt) - Date.parse(deadlineAt);
    if (delay <= 0) {
      return {
        state: "submitted_on_time",
        label: "按时提交",
        detail: submissionDetail(`学校截止 ${displayAt(deadlineAt)}`, completedAt, submittedAt),
        tone: "green",
        deadlineAt,
        completedAt,
        submittedAt,
      };
    }
    const lateDays = Math.max(1, Math.ceil(delay / 86_400_000));
    return {
      state: "submitted_late",
      label: `已补交·逾期${lateDays}天`,
      detail: submissionDetail(`学校原截止 ${displayAt(deadlineAt)}`, completedAt, submittedAt),
      tone: "green",
      deadlineAt,
      completedAt,
      submittedAt,
      lateDays,
    };
  }

  const overdue = Boolean(deadlineAt && Date.parse(referenceAt) > Date.parse(deadlineAt));
  if (overdue && deadlineAt && progress.runState === "completed") {
    return {
      state: "overdue_completed",
      label: "已完成·待补交",
      detail: submissionDetail(`学校原截止 ${displayAt(deadlineAt)}`, completedAt),
      tone: "red",
      deadlineAt,
      completedAt,
    };
  }
  if (overdue && deadlineAt) {
    return {
      state: "overdue_incomplete",
      label: "逾期待补交",
      detail: submissionDetail(`学校原截止 ${displayAt(deadlineAt)}`),
      tone: "red",
      deadlineAt,
    };
  }
  if (progress.runState === "completed") {
    return {
      state: "completed_pending",
      label: "已完成·待提交",
      detail: submissionDetail(deadlineAt ? `学校截止 ${displayAt(deadlineAt)}` : "学校截止待确认", completedAt),
      tone: "orange",
      deadlineAt,
      completedAt,
    };
  }
  return {
    state: "pending",
    label: "待提交",
    detail: deadlineAt ? `学校截止 ${displayAt(deadlineAt)}` : "学校截止待确认",
    tone: "orange",
    deadlineAt,
  };
}
