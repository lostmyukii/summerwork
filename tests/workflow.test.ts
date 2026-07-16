import { describe, expect, it } from "vitest";
import {
  canCloseLoop,
  deriveMasteryLevel,
  deriveWorkflowState,
  isOverDailyCapacity,
  normalizeQuestionNumbers,
  type WorkflowEvidence,
} from "../app/lib/workflow";

const base: WorkflowEvidence = {
  started: true,
  studentCompleted: true,
  reviewSaved: true,
  hasErrors: true,
  correctionPassed: false,
  redoRequired: true,
  redoPassed: false,
  masteryConfirmed: false,
  requiredSubmissionConfirmed: false,
};

describe("knowledge mastery", () => {
  it("keeps completed but unreviewed work blue", () => {
    expect(deriveMasteryLevel({ ...base, reviewSaved: false })).toBe("practiced");
  });

  it("marks uncorrected errors as needing reinforcement", () => {
    expect(deriveMasteryLevel(base)).toBe("reinforce");
  });

  it("does not mark required redo as mastered before it passes", () => {
    expect(deriveMasteryLevel({ ...base, correctionPassed: true, masteryConfirmed: true })).toBe("basic");
  });

  it("allows mastery only after required evidence passes", () => {
    expect(deriveMasteryLevel({ ...base, correctionPassed: true, redoPassed: true, masteryConfirmed: true })).toBe("mastered");
  });
});

describe("closed-loop workflow", () => {
  it("keeps school submission separate from mastery", () => {
    const mastered = { ...base, correctionPassed: true, redoPassed: true, masteryConfirmed: true };
    expect(deriveMasteryLevel(mastered)).toBe("mastered");
    expect(deriveWorkflowState(mastered)).toBe("awaiting_acceptance");
    expect(canCloseLoop(mastered)).toBe(false);
  });

  it("closes only when the required submission is confirmed", () => {
    const complete = { ...base, correctionPassed: true, redoPassed: true, masteryConfirmed: true, requiredSubmissionConfirmed: true };
    expect(canCloseLoop(complete)).toBe(true);
  });
});

describe("input and planning helpers", () => {
  it("normalizes and deduplicates question numbers", () => {
    expect(normalizeQuestionNumbers("3, 7；12(2)、7")).toBe("3、7、12(2)");
  });

  it("flags days above the default two-block capacity", () => {
    expect(isOverDailyCapacity(2)).toBe(false);
    expect(isOverDailyCapacity(3)).toBe(true);
  });
});
