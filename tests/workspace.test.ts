import { describe, expect, it } from "vitest";
import { canCloseLoop, deriveWorkflowState } from "../app/lib/workflow";
import { blankTaskProgress, evidenceFor } from "../app/lib/workspace";

describe("逐任务独立闭环状态", () => {
  it("每个任务获得独立的错误标签数组", () => {
    const math = blankTaskProgress();
    const physics = blankTaskProgress();
    math.errorTags.push("计算错误");
    expect(physics.errorTags).toEqual([]);
  });

  it("未完成独立首做时保持待开始或进行中", () => {
    expect(deriveWorkflowState(evidenceFor(blankTaskProgress()))).toBe("ready");
    expect(deriveWorkflowState(evidenceFor({ ...blankTaskProgress(), runState: "running" }))).toBe("in_progress");
  });

  it("无需学校提交的任务不会被提交标记卡住", () => {
    const completed = {
      ...blankTaskProgress(),
      runState: "completed" as const,
      accuracy: "100%",
      reviewConfirmed: true,
      reviewSaved: true,
      correctionPassed: true,
      redoRequired: false,
      masteryConfirmed: true,
    };
    expect(canCloseLoop(evidenceFor(completed, false))).toBe(true);
    expect(canCloseLoop(evidenceFor(completed, true))).toBe(false);
  });

  it("有错题时必须经过订正和独立复做才可点亮", () => {
    const evidence = evidenceFor({
      ...blankTaskProgress(),
      runState: "completed",
      wrongNumbers: "7、12",
      reviewConfirmed: true,
      reviewSaved: true,
      masteryConfirmed: true,
      schoolSubmitted: true,
    });
    expect(deriveWorkflowState(evidence)).toBe("awaiting_correction");
  });
});
