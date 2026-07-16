import type { MasteryLevel } from "./workflow";

export type Role = "parent" | "tutor" | "student";

export const ROLE_COPY: Record<Role, { label: string; note: string; glyph: string }> = {
  parent: { label: "家长", note: "全科总览", glyph: "家" },
  tutor: { label: "家教", note: "数学工作台", glyph: "数" },
  student: { label: "孩子", note: "今日任务", glyph: "学" },
};

export const ERROR_TAGS = ["概念不清", "审题错误", "计算错误", "步骤不规范", "粗心", "时间不足"];

export const MASTERY_COPY: Record<MasteryLevel, { label: string; tone: string }> = {
  unpracticed: { label: "未练习", tone: "gray" },
  practiced: { label: "已练习", tone: "blue" },
  reinforce: { label: "待巩固", tone: "orange" },
  basic: { label: "基本掌握", tone: "mint" },
  mastered: { label: "已掌握", tone: "green" },
};
