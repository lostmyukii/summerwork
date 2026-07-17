import { describe, expect, it } from "vitest";
import schedule from "../app/data/daily-dual-track-2026.json";
import prestudy from "../app/data/prestudy-2026.json";

describe("最终逐日双轨清单", () => {
  it("203项学校作业恰好进入一个作业块", () => {
    const ids = schedule.blocks.flatMap((block) => block.taskIds);
    expect(schedule.blocks).toHaveLength(81);
    expect(ids).toHaveLength(203);
    expect(new Set(ids).size).toBe(203);
  });

  it("旅行期连续18天每天一项，旅行外没有自主作业", () => {
    const travel = schedule.blocks.filter((block) => block.kind === "travel_independent");
    expect(travel).toHaveLength(18);
    expect(travel.every((block) => block.taskIds.length === 1)).toBe(true);
    expect(travel[0]?.date).toBe("2026-07-26");
    expect(travel.at(-1)?.date).toBe("2026-08-12");
    expect(travel.every((block) => block.date >= "2026-07-26" && block.date <= "2026-08-12")).toBe(true);
  });

  it("8月16日和23日无执行块，其他非旅行作业全部绑定家教课", () => {
    expect(schedule.blocks.some((block) => ["2026-08-16", "2026-08-23"].includes(block.date))).toBe(false);
    expect(schedule.blocks.filter((block) => block.kind !== "travel_independent").every((block) => block.kind === "tutor_homework")).toBe(true);
  });

  it("预习线只覆盖数学物理化学生物43节", () => {
    expect(prestudy.lessons).toHaveLength(43);
    expect(new Set(prestudy.lessons.map((lesson) => lesson.sourceKey)).size).toBe(43);
    expect(Object.fromEntries(prestudy.meta.allowedSubjects.map((subject) => [subject, prestudy.lessons.filter((lesson) => lesson.subject === subject).length]))).toEqual({
      数学: 11,
      物理: 10,
      化学: 11,
      生物: 11,
    });
    expect(prestudy.lessons.some((lesson) => lesson.subject === "语文" || lesson.subject === "俄语")).toBe(false);
  });

  it("语文7月进入生物共享45分钟，8月进入考背90分钟", () => {
    const chinese = schedule.blocks.filter((block) => block.subject === "语文" && block.kind === "tutor_homework");
    expect(chinese.filter((block) => block.date.startsWith("2026-07")).every((block) => block.tutorLane === "生物课内共享" && block.capacityMinutes === 45)).toBe(true);
    expect(chinese.filter((block) => block.date.startsWith("2026-08")).every((block) => block.tutorLane === "考背" && block.capacityMinutes === 90)).toBe(true);
  });
});
