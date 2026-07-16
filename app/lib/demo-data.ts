import type { MasteryLevel } from "./workflow";

export type Role = "parent" | "tutor" | "student";
export type CalendarMode = "week" | "month" | "changes";

export type PlanTask = {
  id: string;
  subject: string;
  title: string;
  scope: string;
  status: "待批改" | "待开始" | "待订正" | "待提交";
  tone: "blue" | "orange" | "green" | "red";
  due?: string;
  unknown?: string;
};

export type KnowledgeItem = {
  name: string;
  detail: string;
  level: MasteryLevel;
};

export const ROLE_COPY: Record<Role, { label: string; note: string; glyph: string }> = {
  parent: { label: "家长", note: "全科总览", glyph: "家" },
  tutor: { label: "家教", note: "数学工作台", glyph: "数" },
  student: { label: "孩子", note: "今日任务", glyph: "学" },
};

export const WEEK_DAYS = [
  { weekday: "一", day: 20, count: 1 },
  { weekday: "二", day: 21, count: 2 },
  { weekday: "三", day: 22, count: 1 },
  { weekday: "四", day: 23, count: 3, risk: true },
  { weekday: "五", day: 24, count: 1 },
  { weekday: "六", day: 25, count: 1 },
  { weekday: "日", day: 26, count: 0 },
];

export const TUTOR_TASKS: PlanTask[] = [
  {
    id: "vector-review",
    subject: "数学",
    title: "平面向量 · 作业1（1）",
    scope: "题号 1—20 · 孩子已完成",
    status: "待批改",
    tone: "blue",
    due: "7月25日 21:00",
    unknown: "13、18(2)",
  },
  {
    id: "vector-start",
    subject: "数学",
    title: "平面向量 · 作业1（2）",
    scope: "题号 1—19 · 独立首做",
    status: "待开始",
    tone: "orange",
    due: "7月27日 21:00",
  },
];

export const PARENT_ATTENTION = [
  { subject: "语文", title: "第三套综合卷", detail: "还需 3 个任务块 · 8月1日截止", tone: "red" },
  { subject: "物理", title: "作业 08", detail: "已完成首做 · 等待家教批改", tone: "blue" },
];

export const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  { name: "向量的线性运算", detail: "2 次练习 · 最近一次 90%以上", level: "mastered" },
  { name: "数量积与夹角", detail: "错题 7、12 · 等待独立复做", level: "reinforce" },
  { name: "投影与坐标表示", detail: "完成首做 · 尚未批改", level: "practiced" },
];

export const ERROR_TAGS = ["概念不清", "审题错误", "计算错误", "步骤不规范", "粗心", "时间不足"];

export const MASTERY_COPY: Record<MasteryLevel, { label: string; tone: string }> = {
  unpracticed: { label: "未练习", tone: "gray" },
  practiced: { label: "已练习", tone: "blue" },
  reinforce: { label: "待巩固", tone: "orange" },
  basic: { label: "基本掌握", tone: "mint" },
  mastered: { label: "已掌握", tone: "green" },
};
