import planData from "../data/summer-2026.json";

export type SummerSubject = "语文" | "数学" | "俄语" | "物理" | "化学" | "生物";
export type SummerTaskKind = "practice" | "reading" | "review" | "submission";
export type RequirementLevel = "required" | "optional" | "pending_confirmation";

export type SummerTask = {
  id: string;
  homeworkKey: string;
  date: string;
  weekday: string;
  slotType: string;
  sourceSlotType: string;
  subject: SummerSubject;
  title: string;
  knowledge: string;
  knowledgeTags: string[];
  answerBasis: string;
  submission: string;
  notes: string;
  kind: SummerTaskKind;
  blockMinutes: number;
  recommendedMinutes: number;
  requiresSubmission: boolean;
  courseIntegrated: boolean;
  optional: boolean;
  uncertainty: boolean;
  priority: "standard" | "attention" | "high";
  answerPolicy: "after_school_submission" | "guardian_held_until_attempt" | "weekly_teacher_release" | "locked_until_first_attempt";
  requirementLevel: RequirementLevel;
  evidenceRequired: string[];
  source: string;
  deadlineDate: string | null;
  deadlineAt: string | null;
  deadlinePrecision: "time" | "date" | "unknown";
};

export type CourseDay = {
  date: string;
  labels: string[];
  subjects: SummerSubject[];
  source: string;
};

export type SubjectRequirement = {
  subject: SummerSubject;
  workBody: string;
  answerSource: string;
  splitRule: string;
  answerPolicy: SummerTask["answerPolicy"];
  source: string;
};

export type OntologyIssue = {
  id: string;
  severity: "high" | "attention";
  subject: SummerSubject | "全科";
  title: string;
  detail: string;
};

type SummerPlan = {
  meta: {
    id: string;
    title: string;
    version: number;
    dateRange: { start: string; end: string };
    defaultBlockMinutes: number;
    allowedSubjects: SummerSubject[];
    excludedSubjects: string[];
    sourceFiles: string[];
  };
  tasks: SummerTask[];
  courseSchedule: CourseDay[];
  importantDates: Array<{ date: string; type: string; label: string }>;
  subjectRequirements: SubjectRequirement[];
  ontologyIssues: OntologyIssue[];
};

export const SUMMER_PLAN = planData as SummerPlan;
export const SUMMER_TASKS = SUMMER_PLAN.tasks;
export const SUMMER_SUBJECTS = SUMMER_PLAN.meta.allowedSubjects;
export const SUBJECT_REQUIREMENTS = SUMMER_PLAN.subjectRequirements;
export const ONTOLOGY_ISSUES = SUMMER_PLAN.ontologyIssues;
export const PLAN_START_DATE = SUMMER_PLAN.meta.dateRange.start;
export const PLAN_END_DATE = SUMMER_PLAN.meta.dateRange.end;
export const PLAN_REFERENCE_DATE = "2026-07-17";

export const SUBJECT_TONES: Record<SummerSubject, string> = {
  语文: "red",
  数学: "blue",
  俄语: "purple",
  物理: "indigo",
  化学: "orange",
  生物: "green",
};

export const ANSWER_POLICY_COPY: Record<SummerTask["answerPolicy"], string> = {
  after_school_submission: "提交后解锁答案",
  guardian_held_until_attempt: "家长保管，首做后给答案",
  weekly_teacher_release: "等待老师按周发布答案",
  locked_until_first_attempt: "首做完成前锁定答案",
};

function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addPlanDays(date: string, amount: number): string {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return toDateKey(next);
}

export function clampPlanDate(date: string): string {
  if (date < PLAN_START_DATE) return PLAN_START_DATE;
  if (date > PLAN_END_DATE) return PLAN_END_DATE;
  return date;
}

export function weekDatesFor(date: string): string[] {
  const current = parseDate(date);
  const day = current.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addPlanDays(date, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addPlanDays(monday, index));
}

export function tasksForDate(date: string, subject?: SummerSubject | "全部"): SummerTask[] {
  return SUMMER_TASKS.filter((task) => task.date === date && (!subject || subject === "全部" || task.subject === subject));
}

export function tasksForSubject(subject: SummerSubject): SummerTask[] {
  return SUMMER_TASKS.filter((task) => task.subject === subject);
}

export function courseForDate(date: string): CourseDay | undefined {
  return SUMMER_PLAN.courseSchedule.find((item) => item.date === date);
}

export function importantDateFor(date: string) {
  return SUMMER_PLAN.importantDates.find((item) => item.date === date);
}

export function formatPlanDate(date: string, includeYear = false): string {
  const [, month, day] = date.split("-").map(Number);
  return includeYear ? `2026年${month}月${day}日` : `${month}月${day}日`;
}

export function weekdayFor(date: string): string {
  return ["日", "一", "二", "三", "四", "五", "六"][parseDate(date).getUTCDay()];
}

export function taskCountsBySubject(): Array<{ subject: SummerSubject; count: number; uncertain: number }> {
  return SUMMER_SUBJECTS.map((subject) => ({
    subject,
    count: SUMMER_TASKS.filter((task) => task.subject === subject).length,
    uncertain: SUMMER_TASKS.filter((task) => task.subject === subject && task.uncertainty).length,
  }));
}
