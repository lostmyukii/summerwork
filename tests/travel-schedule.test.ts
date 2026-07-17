import { describe, expect, it } from "vitest";
import { SUMMER_TASKS, addPlanDays } from "../app/lib/summer-plan";
import {
  PRE_TRAVEL_BLOCKS,
  RECOVERY_DAY_RULES,
  TRAVEL_END_DATE,
  TRAVEL_SOFT_TASKS,
  TRAVEL_START_DATE,
  isDeferredTravelBacklogTask,
  isDeferredTravelReviewTask,
  isTravelChildWorkTask,
  isTravelCourseConflictDate,
  recoveryRuleForDate,
  scheduledDateForTask,
  travelScheduleSummary,
  travelTaskMeta,
} from "../app/lib/travel-schedule";
import { blankTaskProgress } from "../app/lib/workspace";

describe("旅行期软任务与返程补位", () => {
  it("7月26日至8月12日连续18天每天恰好一个软任务", () => {
    expect(TRAVEL_SOFT_TASKS).toHaveLength(18);
    expect(new Set(TRAVEL_SOFT_TASKS.map((item) => item.travelDate)).size).toBe(18);
    expect(TRAVEL_SOFT_TASKS.map((item) => item.travelDate)).toEqual(
      Array.from({ length: 18 }, (_, index) => addPlanDays(TRAVEL_START_DATE, index)),
    );
    expect(TRAVEL_SOFT_TASKS.at(-1)?.travelDate).toBe(TRAVEL_END_DATE);
  });

  it("软任务与前置任务全部指向真实作业且科目一致", () => {
    const byId = new Map(SUMMER_TASKS.map((task) => [task.id, task]));
    for (const item of [...PRE_TRAVEL_BLOCKS, ...TRAVEL_SOFT_TASKS]) {
      expect(byId.get(item.taskId)?.subject).toBe(item.subject);
    }
  });

  it("只从77项旅行首做中挑选前置和软任务，其余进入返程积压", () => {
    const travelWork = SUMMER_TASKS.filter(isTravelChildWorkTask);
    const summary = travelScheduleSummary(SUMMER_TASKS, {}, "2026-07-17");
    expect(travelWork).toHaveLength(77);
    expect(travelWork.reduce((sum, task) => sum + task.blockMinutes, 0)).toBe(115.5 * 60);
    expect(travelWork.filter(isDeferredTravelBacklogTask)).toHaveLength(52);
    expect(summary).toEqual(expect.objectContaining({ total: 18, pending: 18, deferredBacklog: 52 }));
  });

  it("旅行任务支持未开始、部分完成、返程补位和完成释放", () => {
    const task = SUMMER_TASKS.find((item) => item.id === "russian-2026-07-27-01");
    expect(task).toBeDefined();
    if (!task) return;

    expect(travelTaskMeta(task, blankTaskProgress(), "2026-07-26")).toEqual(expect.objectContaining({
      state: "soft",
      plannedDate: "2026-07-26",
      remainingMinutes: 90,
    }));

    expect(travelTaskMeta(task, { ...blankTaskProgress(), runState: "paused", actualSeconds: 45 * 60 }, "2026-07-26")).toEqual(expect.objectContaining({
      state: "partial",
      completedMinutes: 45,
      remainingMinutes: 45,
    }));

    expect(travelTaskMeta(task, blankTaskProgress(), "2026-08-13")).toEqual(expect.objectContaining({
      state: "overdue_recovery",
      plannedDate: "2026-08-13",
      overdue: true,
    }));

    expect(travelTaskMeta(task, { ...blankTaskProgress(), runState: "completed", actualSeconds: 72 * 60 }, "2026-08-13")).toEqual(expect.objectContaining({
      state: "released",
      plannedDate: "2026-07-26",
      completedMinutes: 90,
      remainingMinutes: 0,
    }));
  });

  it("未入选旅行软任务的首做不再挤入旅行日历", () => {
    const backlog = SUMMER_TASKS.find((task) => task.id === "russian-2026-07-30-01");
    const review = SUMMER_TASKS.find((task) => task.date >= TRAVEL_START_DATE && task.date <= TRAVEL_END_DATE && task.kind === "review");
    const submission = SUMMER_TASKS.find((task) => task.date === "2026-08-01" && task.kind === "submission");
    expect(backlog && scheduledDateForTask(backlog, {}, {}, "2026-07-17")).toBeNull();
    expect(review && isDeferredTravelReviewTask(review)).toBe(true);
    expect(review && scheduledDateForTask(review, {}, {}, "2026-07-17")).toBeNull();
    expect(submission && scheduledDateForTask(submission, {}, {}, "2026-07-17")).toBe("2026-08-01");
  });

  it("8月12日标记旅行冲突，8月16日和23日不再设置集中补位", () => {
    expect(isTravelCourseConflictDate("2026-08-12")).toBe(true);
    expect(recoveryRuleForDate("2026-08-13")).toBeUndefined();
    expect(recoveryRuleForDate("2026-08-16")).toBeUndefined();
    expect(recoveryRuleForDate("2026-08-23")).toBeUndefined();
    expect(RECOVERY_DAY_RULES).toHaveLength(0);
    expect(TRAVEL_SOFT_TASKS.some((item) => ["2026-08-16", "2026-08-23"].includes(item.fallbackDate))).toBe(false);
  });
});
