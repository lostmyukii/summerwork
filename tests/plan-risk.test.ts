import { describe, expect, it } from "vitest";
import { computePlanRisks } from "../app/lib/plan-risk";
import { SUMMER_TASKS } from "../app/lib/summer-plan";
import type { WorkspaceTask } from "../app/lib/workspace";

function task(id: string, date: string, deadlineDate: string | null, subject: WorkspaceTask["subject"] = "数学"): WorkspaceTask {
  return {
    id, homeworkKey: id, date, weekday: "一", slotType: "自学", sourceSlotType: "自学", subject, title: id,
    knowledge: "知识点", knowledgeTags: ["知识点"], answerBasis: "首做后批改", submission: "学校平台",
    notes: "", kind: "practice", blockMinutes: 90, recommendedMinutes: 90, requiresSubmission: true,
    courseIntegrated: false, optional: false, uncertainty: false, priority: "standard",
    answerPolicy: "locked_until_first_attempt", requirementLevel: "required",
    evidenceRequired: ["first_attempt"], source: "fixture", deadlineDate, deadlineAt: null,
    deadlinePrecision: deadlineDate ? "date" : "unknown",
  };
}

describe("FR-005/FR-014 日期容量与截止风险", () => {
  it("默认每天超过2个90分钟块就产生跨科负荷风险", () => {
    const risks = computePlanRisks([
      task("m", "2026-07-20", "2026-07-25"),
      task("p", "2026-07-20", "2026-07-25", "物理"),
      task("c", "2026-07-20", "2026-07-25", "化学"),
    ], {}, {}, "2026-07-17");
    expect(risks.find((risk) => risk.type === "capacity")?.detail).toContain("涉及 3 科");
  });

  it("课内任务与独立作业分开计数，但仍显示当日总负荷", () => {
    const course = task("course", "2026-07-20", "2026-07-25", "化学");
    course.courseIntegrated = true;
    expect(computePlanRisks([
      task("m", "2026-07-20", "2026-07-25"),
      task("p", "2026-07-20", "2026-07-25", "物理"),
      course,
    ], {}, {}, "2026-07-17").some((risk) => risk.type === "capacity")).toBe(false);
    const risks = computePlanRisks([
      task("m", "2026-07-20", "2026-07-25"),
      task("p", "2026-07-20", "2026-07-25", "物理"),
      task("b", "2026-07-20", "2026-07-25", "生物"),
      course,
    ], {}, {}, "2026-07-17");
    expect(risks.find((risk) => risk.type === "capacity")?.detail).toContain("另有课内 1 块，当日共 4 块");
  });

  it("计划移动到截止后会产生红色风险", () => {
    const risks = computePlanRisks([task("m", "2026-07-20", "2026-07-25")], { m: { date: "2026-07-26", reason: "课程冲突", changedAt: "", actor: "家教" } }, {}, "2026-07-17");
    expect(risks).toEqual(expect.arrayContaining([expect.objectContaining({ type: "after_deadline", severity: "high" })]));
  });

  it("学校提交确认只消除提交风险，不改变计划规则", () => {
    const base = task("m", "2026-07-17", "2026-07-18");
    const open = computePlanRisks([base], {}, {}, "2026-07-19");
    const confirmed = computePlanRisks([base], {}, { m: { runState: "completed", unknown: "", accuracy: "100%", wrongNumbers: "", errorTags: [], note: "", reviewConfirmed: true, reviewSaved: true, correctionPassed: true, redoRequired: false, redoPassed: false, masteryConfirmed: true, schoolSubmitted: true } }, "2026-07-19");
    expect(open.some((risk) => risk.type === "overdue")).toBe(true);
    expect(confirmed.some((risk) => risk.type === "overdue")).toBe(false);
  });

  it("旅行期未入选首做合并成返程积压，不制造逐日容量爆表", () => {
    const risks = computePlanRisks(SUMMER_TASKS, {}, {}, "2026-07-17");
    const backlog = risks.find((risk) => risk.type === "travel_backlog");
    expect(backlog).toEqual(expect.objectContaining({
      severity: "high",
      date: "2026-08-13",
      taskIds: expect.any(Array),
    }));
    expect(backlog?.taskIds).toHaveLength(52);
    expect(risks.filter((risk) => risk.type === "capacity" && risk.date >= "2026-07-26" && risk.date <= "2026-08-12")).toHaveLength(0);
  });

  it("旅行软任务返程未完成时显示原截止、补位日和剩余分钟", () => {
    const russian = SUMMER_TASKS.find((item) => item.id === "russian-2026-07-27-01");
    expect(russian).toBeDefined();
    const risk = russian ? computePlanRisks([russian], {}, {}, "2026-08-13").find((item) => item.type === "travel_overdue") : undefined;
    expect(risk).toEqual(expect.objectContaining({ date: "2026-08-13", severity: "high" }));
    expect(risk?.detail).toContain("学校原截止 2026-07-27");
    expect(risk?.detail).toContain("剩余 90 分钟");
  });
});
