import { describe, expect, it } from "vitest";
import scheduleLedger from "../data-sources/course-schedule-2026.json";
import {
  ONTOLOGY_ISSUES,
  SUBJECT_REQUIREMENTS,
  SUMMER_PLAN,
  SUMMER_TASKS,
  tasksForDate,
  tasksForSubject,
} from "../app/lib/summer-plan";

describe("2026 暑期真实计划数据", () => {
  it("完整导入五份CSV中的200条任务", () => {
    expect(SUMMER_TASKS).toHaveLength(200);
    expect(Object.fromEntries(SUMMER_PLAN.meta.allowedSubjects.map((subject) => [subject, tasksForSubject(subject).length]))).toEqual({
      语文: 45,
      数学: 30,
      俄语: 30,
      物理: 42,
      化学: 31,
      生物: 22,
    });
  });

  it("把173项作业本体与200个执行任务块分开计数", () => {
    expect(new Set(SUMMER_TASKS.map((task) => task.homeworkKey)).size).toBe(173);
    expect(SUMMER_TASKS.filter((task) => task.homeworkKey === "math-assignment-1")).toHaveLength(2);
    expect(SUMMER_TASKS.filter((task) => task.homeworkKey === "biology-测试一")).toHaveLength(2);
  });

  it("严格排除英语、政治、历史、地理和7月5日安排", () => {
    const serialized = JSON.stringify(SUMMER_TASKS);
    for (const subject of SUMMER_PLAN.meta.excludedSubjects) expect(serialized).not.toContain(subject);
    expect(tasksForDate("2026-07-05")).toHaveLength(0);
  });

  it("所有任务使用90分钟标准块并保留个别建议时长", () => {
    expect(SUMMER_TASKS.every((task) => task.blockMinutes === 90)).toBe(true);
    expect(SUMMER_TASKS.some((task) => task.recommendedMinutes === 120)).toBe(true);
  });

  it("语文任务全部归入考背课内、自主或机动单元", () => {
    expect(tasksForSubject("语文").every((task) => task.slotType.includes("考背"))).toBe(true);
    const courseDates = tasksForSubject("语文").filter((task) => task.slotType === "考背课内").map((task) => task.date);
    expect(courseDates).toEqual(["2026-08-12", "2026-08-14", "2026-08-18", "2026-08-20", "2026-08-22", "2026-08-24", "2026-08-26", "2026-08-28"]);
  });

  it("课程表保留原始7月19日数学和俄语，并无7月5日课程", () => {
    expect(SUMMER_PLAN.courseSchedule.find((item) => item.date === "2026-07-19")?.subjects).toEqual(["数学", "俄语"]);
    expect(SUMMER_PLAN.courseSchedule.find((item) => item.date === "2026-07-19")?.labels).toEqual(["数学新课", "俄语"]);
    expect(SUMMER_PLAN.courseSchedule).toHaveLength(23);
    expect(SUMMER_PLAN.courseSchedule.every((item) => item.labels.every((label) => !/\d{1,2}:\d{2}/.test(label)))).toBe(true);
    expect(SUMMER_PLAN.courseSchedule.some((item) => item.date === "2026-07-05")).toBe(false);
    expect(scheduleLedger.entries.filter((item) => item.disposition === "included")).toHaveLength(23);
    expect(scheduleLedger.entries.find((item) => item.date === "2026-07-05")?.disposition).toBe("excluded_by_user");
    expect(scheduleLedger.entries.filter((item) => item.disposition === "important_date").map((item) => item.date)).toEqual(["2026-07-13", "2026-07-14"]);
  });

  it("六科都有本体规则，且材料冲突不会被隐藏", () => {
    expect(SUBJECT_REQUIREMENTS).toHaveLength(6);
    expect(ONTOLOGY_ISSUES.map((item) => item.id)).toEqual(expect.arrayContaining([
      "math-under-split",
      "chinese-early-deadlines",
      "chemistry-material-conflict",
      "missing-materials",
      "return-date-conflict",
    ]));
    expect(tasksForSubject("化学").filter((task) => task.requirementLevel === "pending_confirmation")).toHaveLength(6);
  });

  it("每条任务都有知识、批改、提交和溯源字段", () => {
    expect(new Set(SUMMER_TASKS.map((task) => task.id)).size).toBe(SUMMER_TASKS.length);
    for (const task of SUMMER_TASKS) {
      expect(task.date >= SUMMER_PLAN.meta.dateRange.start && task.date <= SUMMER_PLAN.meta.dateRange.end).toBe(true);
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.answerBasis.length).toBeGreaterThan(0);
      expect(task.submission.length).toBeGreaterThan(0);
      expect(task.source).toMatch(/^系统搭建\/.+\.csv#\d+$/);
      expect(task.evidenceRequired.length).toBeGreaterThan(0);
    }
  });

  it("从提交计划提取可核验截止，不自行编造缺失时间", () => {
    const chineseFirst = tasksForSubject("语文").find((task) => task.title.startsWith("套一①"));
    expect(chineseFirst?.deadlineAt).toBe("2026-07-18T21:00:00+08:00");
    const biologyFirst = tasksForSubject("生物")[0];
    expect(biologyFirst.deadlineAt).toBe("2026-07-28T08:00:00+08:00");
    expect(tasksForSubject("俄语").every((task) => task.deadlinePrecision === "date" && task.deadlineAt === null)).toBe(true);
    expect(tasksForSubject("化学").filter((task) => task.requirementLevel === "pending_confirmation").some((task) => task.deadlineDate === null)).toBe(true);
  });
});
