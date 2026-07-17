import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "../app/lib/supabase/homework";
import { canCloseLoop, deriveWorkflowState } from "../app/lib/workflow";
import { blankTaskProgress, deriveSubmissionTiming, evidenceFor } from "../app/lib/workspace";

describe("逐任务独立闭环状态", () => {
  it("大计划查询按固定上限拆分，避免超长URL", () => {
    const values = Array.from({ length: 203 }, (_, index) => `task-${index + 1}`);
    const chunks = splitIntoChunks(values);
    expect(chunks).toHaveLength(5);
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50, 50, 50, 3]);
    expect(chunks.flat()).toEqual(values);
  });

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

  it("学校提交状态由原截止、首次完成和实际提交时间派生", () => {
    const task = {
      requiresSubmission: true,
      deadlineDate: "2026-08-13",
      deadlineAt: "2026-08-13T21:00:00+08:00",
    };
    const pending = blankTaskProgress();
    expect(deriveSubmissionTiming(task, pending, "2026-08-13T12:00:00+08:00").state).toBe("pending");

    const completed = { ...pending, runState: "completed" as const, completedAt: "2026-08-13T20:00:00+08:00" };
    expect(deriveSubmissionTiming(task, completed, "2026-08-14T08:00:00+08:00")).toEqual(expect.objectContaining({
      state: "overdue_completed",
      label: "已完成·待补交",
      completedAt: "2026-08-13T20:00:00+08:00",
    }));

    const late = { ...completed, schoolSubmitted: true, schoolSubmittedAt: "2026-08-15T09:00:00+08:00" };
    expect(deriveSubmissionTiming(task, late, "2026-08-15T09:00:00+08:00")).toEqual(expect.objectContaining({
      state: "submitted_late",
      label: "已补交·逾期2天",
      lateDays: 2,
    }));

    const onTime = { ...completed, schoolSubmitted: true, schoolSubmittedAt: "2026-08-13T20:30:00+08:00" };
    expect(deriveSubmissionTiming(task, onTime, "2026-08-13T20:30:00+08:00").state).toBe("submitted_on_time");
  });

  it("无需提交和缺少提交时间不会被误判为按时", () => {
    expect(deriveSubmissionTiming({ requiresSubmission: false, deadlineDate: null, deadlineAt: null }, blankTaskProgress()).state).toBe("not_required");
    expect(deriveSubmissionTiming(
      { requiresSubmission: true, deadlineDate: "2026-08-13", deadlineAt: null },
      { ...blankTaskProgress(), schoolSubmitted: true },
      "2026-08-14T12:00:00+08:00",
    ).state).toBe("submitted_unknown_time");
  });
});
