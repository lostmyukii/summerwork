import { describe, expect, it } from "vitest";
import scheduleLedger from "../data-sources/course-schedule-2026.json";
import {
  ONTOLOGY_ISSUES,
  SUBJECT_REQUIREMENTS,
  SUMMER_PLAN,
  SUMMER_TASKS,
  currentPlanDate,
  tasksForDate,
  tasksForSubject,
} from "../app/lib/summer-plan";

describe("2026 暑期真实计划数据", () => {
  it("完整导入五份CSV中的203条真实任务", () => {
    expect(SUMMER_TASKS).toHaveLength(203);
    expect(Object.fromEntries(SUMMER_PLAN.meta.allowedSubjects.map((subject) => [subject, tasksForSubject(subject).length]))).toEqual({
      语文: 46,
      数学: 31,
      俄语: 30,
      物理: 43,
      化学: 31,
      生物: 22,
    });
  });

  it("把175项作业本体与203个执行任务块分开计数", () => {
    expect(new Set(SUMMER_TASKS.map((task) => task.homeworkKey)).size).toBe(175);
    expect(SUMMER_TASKS.filter((task) => task.homeworkKey === "math-assignment-1")).toHaveLength(2);
    expect(SUMMER_TASKS.filter((task) => task.homeworkKey === "math-assignment-2")).toHaveLength(3);
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

  it("今天按上海时区动态计算并限制在暑期计划区间", () => {
    expect(currentPlanDate(new Date("2026-07-16T15:59:59Z"), "")).toBe("2026-07-16");
    expect(currentPlanDate(new Date("2026-07-16T16:00:00Z"), "")).toBe("2026-07-17");
    expect(currentPlanDate(new Date("2026-01-01T00:00:00Z"), "")).toBe("2026-07-16");
    expect(currentPlanDate(new Date("2026-12-01T00:00:00Z"), "")).toBe("2026-08-29");
    expect(currentPlanDate(new Date("2026-07-20T00:00:00Z"), "2026-08-08")).toBe("2026-08-08");
  });

  it("语文任务全部归入考背课内、自主或机动单元", () => {
    expect(tasksForSubject("语文").every((task) => task.slotType.includes("考背"))).toBe(true);
    const courseDates = [...new Set(tasksForSubject("语文").filter((task) => task.slotType === "考背课内").map((task) => task.date))];
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
    expect(SUBJECT_REQUIREMENTS.every((item) => item.executionRules.length >= 3)).toBe(true);
    expect(ONTOLOGY_ISSUES.map((item) => item.id)).toEqual(expect.arrayContaining([
      "chinese-early-deadlines",
      "chemistry-material-conflict",
      "missing-materials",
      "return-date-conflict",
    ]));
    expect(ONTOLOGY_ISSUES.map((item) => item.id)).not.toContain("math-under-split");
    expect(tasksForSubject("化学").filter((task) => task.requirementLevel === "pending_confirmation")).toHaveLength(6);
  });

  it("暑期实践与行政节点不会混入学科任务", () => {
    expect(SUMMER_PLAN.importantDates).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-07-13", type: "travel" }),
      expect.objectContaining({ date: "2026-07-14", type: "travel" }),
      expect.objectContaining({ date: "2026-07-30", type: "school-admin" }),
      expect.objectContaining({ date: "2026-08-20", type: "uncertain" }),
    ]));
    expect(JSON.stringify(SUMMER_TASKS)).not.toContain("综评证书扫描件提交班主任");
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

  it("按正式方案锁定语文七个批次与红楼梦回目", () => {
    expect(tasksForSubject("语文").filter((task) => task.kind === "submission").map((task) => [task.deadlineAt, task.title])).toEqual([
      ["2026-07-18T21:00:00+08:00", "套一 平板提交（21:00前）+答案核对+错题标记"],
      ["2026-07-25T21:00:00+08:00", "套二+红楼1-20回 平板提交（21:00前）+答案核对"],
      ["2026-08-01T21:00:00+08:00", "套三+红楼21-30回 平板提交（21:00前）+答案核对"],
      ["2026-08-08T21:00:00+08:00", "套四+红楼31-40回 平板提交（21:00前）+答案核对"],
      ["2026-08-15T21:00:00+08:00", "套五+红楼41-50回 平板提交（21:00前）+答案核对"],
      ["2026-08-22T21:00:00+08:00", "套六+红楼51-70回 平板提交（21:00前）+答案核对"],
      ["2026-08-29T21:00:00+08:00", "套七+套八+红楼71-80回 平板提交（21:00前）+全卷答案核对"],
    ]);
  });

  it("征文只保留待通知建议壳，不生成学校提交节点", () => {
    const essays = tasksForSubject("语文").filter((task) => /征文[①②]/.test(task.title));
    expect(essays).toHaveLength(2);
    expect(essays.every((task) => task.requirementLevel === "pending_confirmation" && task.optional && task.uncertainty)).toBe(true);
    expect(essays.every((task) => !task.requiresSubmission && task.deadlineDate === null)).toBe(true);
  });

  it("数学作业2按11、22、15题三个子卷拆分且不会误归前一批", () => {
    const assignment2 = SUMMER_TASKS.filter((task) => task.homeworkKey === "math-assignment-2");
    expect(assignment2.map((task) => task.title.match(/（(\d+)题/)?.[1])).toEqual(["11", "22", "15"]);
    expect(assignment2.every((task) => task.deadlineAt === "2026-07-26T21:00:00+08:00")).toBe(true);
    expect(SUMMER_TASKS.filter((task) => task.homeworkKey === "math-assignment-10").every((task) => task.deadlineAt === "2026-08-16T21:00:00+08:00")).toBe(true);
  });

  it("显式阶段不会把首做批改误判为复盘或提交", () => {
    expect(tasksForSubject("俄语").every((task) => task.kind === "practice")).toBe(true);
    expect(tasksForSubject("物理").filter((task) => /^作业\d+/.test(task.title)).every((task) => task.kind === "practice")).toBe(true);
    const biologyLast = tasksForSubject("生物").find((task) => task.title.startsWith("综合三非选日"));
    expect(biologyLast?.kind).toBe("practice");
    expect(biologyLast?.deadlineAt).toBe("2026-08-16T08:00:00+08:00");
  });

  it("学校提交渠道与本系统标记边界清楚", () => {
    expect(SUMMER_TASKS.filter((task) => task.requiresSubmission).every((task) => task.submission.includes("本系统仅标记"))).toBe(true);
  });
});
