import { describe, expect, it } from "vitest";
import {
  PRESTUDY_LESSONS,
  PRESTUDY_PLAN,
  prestudyForDate,
  prestudyForSubject,
} from "../app/lib/prestudy-plan";

describe("2026 暑期独立预习计划", () => {
  it("固化43个90分钟预习块且稳定来源键唯一", () => {
    expect(PRESTUDY_LESSONS).toHaveLength(43);
    expect(new Set(PRESTUDY_LESSONS.map((lesson) => lesson.sourceKey)).size).toBe(43);
    expect(PRESTUDY_LESSONS.every((lesson) => lesson.plannedMinutes === 90)).toBe(true);
  });

  it("只保留数理化生预习且每节家教课均覆盖", () => {
    expect(Object.fromEntries(PRESTUDY_PLAN.meta.allowedSubjects.map((subject) => [subject, prestudyForSubject(subject).length]))).toEqual({
      数学: 11,
      物理: 10,
      化学: 11,
      生物: 11,
    });
  });

  it("8月12日不执行，M03顺延到8月14日并与物理分科并行", () => {
    expect(prestudyForDate("2026-08-12")).toHaveLength(0);
    expect(prestudyForDate("2026-08-14").map((lesson) => [lesson.subject, lesson.lessonCode])).toEqual([
      ["数学", "M03"],
      ["物理", "P03"],
    ]);
    const m03 = PRESTUDY_LESSONS.find((lesson) => lesson.lessonCode === "M03");
    expect(m03).toMatchObject({ originalDate: "2026-08-12", plannedDate: "2026-08-14" });
    expect(m03?.scheduleAdjustmentReason).toContain("俄罗斯");
  });

  it("俄语和语文不设预习线", () => {
    expect(prestudyForSubject("语文")).toEqual([]);
    expect(prestudyForSubject("俄语")).toEqual([]);
  });

  it("每节保留四阶段、验收标准和可勾选的预设知识点", () => {
    for (const lesson of PRESTUDY_LESSONS) {
      expect(lesson.title.length).toBeGreaterThan(0);
      expect(lesson.phases.input.length).toBeGreaterThan(0);
      expect(lesson.phases.analysis.length).toBeGreaterThan(0);
      expect(lesson.phases.practice.length).toBeGreaterThan(0);
      expect(lesson.phases.output.length).toBeGreaterThan(0);
      expect(lesson.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(lesson.knowledgePoints.length).toBeGreaterThanOrEqual(2);
      expect(lesson.knowledgePoints.every((item) => item.length <= 24)).toBe(true);
    }
  });

  it("来源文件留在仓库外，结构化数据保留溯源说明", () => {
    expect(PRESTUDY_PLAN.meta.sourceFiles).toContain("黑龙江高二上每日90分钟预习计划_双方案统一版.xlsx#每日预习");
    expect(JSON.stringify(PRESTUDY_PLAN)).not.toContain(".inspect.ndjson");
  });
});
