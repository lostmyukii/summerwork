export type MasteryLevel = "unpracticed" | "practiced" | "reinforce" | "basic" | "mastered";

export type WorkflowState =
  | "ready"
  | "in_progress"
  | "awaiting_review"
  | "awaiting_correction"
  | "awaiting_redo"
  | "awaiting_acceptance"
  | "closed_loop";

export type WorkflowEvidence = {
  started: boolean;
  studentCompleted: boolean;
  reviewSaved: boolean;
  hasErrors: boolean;
  correctionPassed: boolean;
  redoRequired: boolean;
  redoPassed: boolean;
  masteryConfirmed: boolean;
  requiredSubmissionConfirmed: boolean;
};

export function deriveMasteryLevel(evidence: WorkflowEvidence): MasteryLevel {
  if (!evidence.studentCompleted) return "unpracticed";
  if (!evidence.reviewSaved) return "practiced";
  if (evidence.hasErrors && !evidence.correctionPassed) return "reinforce";
  if (evidence.redoRequired && !evidence.redoPassed) return "basic";
  if (evidence.masteryConfirmed) return "mastered";
  return evidence.hasErrors ? "basic" : "practiced";
}

export function deriveWorkflowState(evidence: WorkflowEvidence): WorkflowState {
  if (!evidence.started) return "ready";
  if (!evidence.studentCompleted) return "in_progress";
  if (!evidence.reviewSaved) return "awaiting_review";
  if (evidence.hasErrors && !evidence.correctionPassed) return "awaiting_correction";
  if (evidence.redoRequired && !evidence.redoPassed) return "awaiting_redo";
  if (!evidence.masteryConfirmed) return "awaiting_acceptance";
  if (!evidence.requiredSubmissionConfirmed) return "awaiting_acceptance";
  return "closed_loop";
}

export function canCloseLoop(evidence: WorkflowEvidence): boolean {
  return deriveWorkflowState(evidence) === "closed_loop";
}

export function normalizeQuestionNumbers(value: string): string {
  const parts = value
    .split(/[，,、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(parts)].join("、");
}

export function isOverDailyCapacity(taskCount: number, capacity = 2): boolean {
  return taskCount > capacity;
}
