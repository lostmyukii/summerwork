import type { SummerSubject, SummerTask } from "./summer-plan";
import type { PlanOverride, TaskProgress } from "./workspace";

export const TRAVEL_START_DATE = "2026-07-26";
export const TRAVEL_END_DATE = "2026-08-12";
export const RETURN_START_DATE = "2026-08-13";
export const TRAVEL_COURSE_CONFLICT_DATE = "2026-08-12";

export type PreTravelBlock = {
  date: string;
  taskId: string;
  subject: SummerSubject;
  label: string;
  plannedMinutes: 45 | 90;
};

export type TravelSoftTask = {
  travelDate: string;
  taskId: string;
  subject: SummerSubject;
  shortLabel: string;
  fallbackDate: string;
};

export type RecoveryDayRule = {
  date: string;
  convertedSubjects: SummerSubject[];
  restoredSubjects: SummerSubject[];
  chineseExtraBlock: boolean;
  concentratedFallbackLimit?: 4 | 5;
};

export type TravelTaskState = "soft" | "partial" | "released" | "recovery" | "overdue_recovery";

export type TravelTaskMeta = TravelSoftTask & {
  state: TravelTaskState;
  plannedDate: string;
  completedMinutes: number;
  remainingMinutes: number;
  overdue: boolean;
};

export const PRE_TRAVEL_BLOCKS: readonly PreTravelBlock[] = [
  { date: "2026-07-19", taskId: "math-2026-07-27-01", subject: "数学", label: "作业4", plannedMinutes: 90 },
  { date: "2026-07-20", taskId: "chemistry-2026-07-27-01", subject: "化学", label: "必刷题（六）", plannedMinutes: 90 },
  { date: "2026-07-21", taskId: "physics-2026-07-27-01", subject: "物理", label: "作业8", plannedMinutes: 90 },
  { date: "2026-07-22", taskId: "russian-2026-07-26-01", subject: "俄语", label: "强基训练7", plannedMinutes: 90 },
  { date: "2026-07-23", taskId: "math-2026-07-29-01", subject: "数学", label: "作业5", plannedMinutes: 90 },
  { date: "2026-07-24", taskId: "biology-2026-07-27-01", subject: "生物", label: "测试一选择", plannedMinutes: 90 },
  { date: "2026-07-25", taskId: "physics-2026-07-28-01", subject: "物理", label: "作业9", plannedMinutes: 90 },
] as const;

export const TRAVEL_SOFT_TASKS: readonly TravelSoftTask[] = [
  { travelDate: "2026-07-26", taskId: "russian-2026-07-27-01", subject: "俄语", shortLabel: "强基训练8", fallbackDate: "2026-08-13" },
  { travelDate: "2026-07-27", taskId: "biology-2026-07-28-01", subject: "生物", shortLabel: "测试一非选择续做", fallbackDate: "2026-08-13" },
  { travelDate: "2026-07-28", taskId: "physics-2026-07-29-01", subject: "物理", shortLabel: "作业10", fallbackDate: "2026-08-14" },
  { travelDate: "2026-07-29", taskId: "math-2026-07-31-01", subject: "数学", shortLabel: "作业6", fallbackDate: "2026-08-14" },
  { travelDate: "2026-07-30", taskId: "chemistry-2026-07-28-01", subject: "化学", shortLabel: "必刷题（七）", fallbackDate: "2026-08-13" },
  { travelDate: "2026-07-31", taskId: "chinese-2026-07-27-01", subject: "语文", shortLabel: "套三除作文外", fallbackDate: "2026-08-14" },
  { travelDate: "2026-08-01", taskId: "russian-2026-07-28-01", subject: "俄语", shortLabel: "强基训练9", fallbackDate: "2026-08-15" },
  { travelDate: "2026-08-02", taskId: "biology-2026-07-29-01", subject: "生物", shortLabel: "测试二选择", fallbackDate: "2026-08-15" },
  { travelDate: "2026-08-03", taskId: "physics-2026-07-30-01", subject: "物理", shortLabel: "作业11", fallbackDate: "2026-08-18" },
  { travelDate: "2026-08-04", taskId: "math-2026-08-03-01", subject: "数学", shortLabel: "作业7", fallbackDate: "2026-08-18" },
  { travelDate: "2026-08-05", taskId: "chemistry-2026-07-29-01", subject: "化学", shortLabel: "必刷题（八）", fallbackDate: "2026-08-15" },
  { travelDate: "2026-08-06", taskId: "chinese-2026-07-28-01", subject: "语文", shortLabel: "套三作文", fallbackDate: "2026-08-18" },
  { travelDate: "2026-08-07", taskId: "russian-2026-07-29-01", subject: "俄语", shortLabel: "强基训练10", fallbackDate: "2026-08-17" },
  { travelDate: "2026-08-08", taskId: "biology-2026-07-30-01", subject: "生物", shortLabel: "测试二非选择", fallbackDate: "2026-08-17" },
  { travelDate: "2026-08-09", taskId: "physics-2026-07-31-01", subject: "物理", shortLabel: "作业12", fallbackDate: "2026-08-18" },
  { travelDate: "2026-08-10", taskId: "math-2026-08-05-01", subject: "数学", shortLabel: "作业8", fallbackDate: "2026-08-20" },
  { travelDate: "2026-08-11", taskId: "chemistry-2026-07-30-01", subject: "化学", shortLabel: "必刷题（九）", fallbackDate: "2026-08-17" },
  { travelDate: "2026-08-12", taskId: "chinese-2026-07-29-01", subject: "语文", shortLabel: "《红楼梦》31—40回阅读", fallbackDate: "2026-08-18" },
] as const;

export const RECOVERY_DAY_RULES: readonly RecoveryDayRule[] = [] as const;

const travelTaskById = new Map(TRAVEL_SOFT_TASKS.map((item) => [item.taskId, item]));
const fullyFrontloadedTaskIds = new Set(PRE_TRAVEL_BLOCKS.filter((item) => item.plannedMinutes === 90).map((item) => item.taskId));

export const TRAVEL_STATE_COPY: Record<TravelTaskState, string> = {
  soft: "旅行自主·可顺延",
  partial: "旅行中·部分完成",
  released: "旅行完成·补位释放",
  recovery: "返程补位",
  overdue_recovery: "逾期待补交",
};

function completedMinutes(progress: TaskProgress | undefined): number {
  if (progress?.runState === "completed") return 90;
  return Math.min(89, Math.max(0, Math.floor((progress?.actualSeconds ?? 0) / 60)));
}

export function travelTaskDefinition(taskId: string): TravelSoftTask | undefined {
  return travelTaskById.get(taskId);
}

export function preTravelBlocksForDate(date: string): PreTravelBlock[] {
  return PRE_TRAVEL_BLOCKS.filter((item) => item.date === date);
}

export function recoveryRuleForDate(date: string): RecoveryDayRule | undefined {
  return RECOVERY_DAY_RULES.find((item) => item.date === date);
}

export function isTravelCourseConflictDate(date: string): boolean {
  return date === TRAVEL_COURSE_CONFLICT_DATE;
}

export function isTravelChildWorkTask(task: SummerTask): boolean {
  return task.date >= TRAVEL_START_DATE
    && task.date <= TRAVEL_END_DATE
    && (task.kind === "practice" || task.kind === "reading");
}

export function isDeferredTravelBacklogTask(task: SummerTask): boolean {
  return isTravelChildWorkTask(task) && !travelTaskById.has(task.id) && !fullyFrontloadedTaskIds.has(task.id);
}

export function isDeferredTravelReviewTask(task: SummerTask): boolean {
  return task.date >= TRAVEL_START_DATE && task.date <= TRAVEL_END_DATE && task.kind === "review";
}

export function travelTaskMeta(task: SummerTask, progress: TaskProgress | undefined, referenceDate: string): TravelTaskMeta | undefined {
  const definition = travelTaskById.get(task.id);
  if (!definition) return undefined;
  const minutes = completedMinutes(progress);
  const completed = progress?.runState === "completed";
  const overdue = Boolean(task.deadlineDate && referenceDate > task.deadlineDate && !completed);
  const afterTravel = referenceDate > TRAVEL_END_DATE;
  const state: TravelTaskState = completed
    ? "released"
    : afterTravel
      ? overdue ? "overdue_recovery" : "recovery"
      : minutes > 0 || progress?.runState === "running" || progress?.runState === "paused"
        ? "partial"
        : "soft";
  return {
    ...definition,
    state,
    plannedDate: afterTravel && !completed ? definition.fallbackDate : definition.travelDate,
    completedMinutes: minutes,
    remainingMinutes: completed ? 0 : 90 - minutes,
    overdue,
  };
}

export function scheduledDateForTask(
  task: SummerTask,
  overrides: Record<string, PlanOverride>,
  progress: Record<string, TaskProgress>,
  referenceDate: string,
): string | null {
  const travelMeta = travelTaskMeta(task, progress[task.id], referenceDate);
  if (travelMeta) return travelMeta.plannedDate;
  if (overrides[task.id]) return overrides[task.id].date;
  const frontloaded = PRE_TRAVEL_BLOCKS.find((item) => item.taskId === task.id && item.plannedMinutes === 90);
  if (frontloaded) return frontloaded.date;
  if (isDeferredTravelBacklogTask(task) || isDeferredTravelReviewTask(task)) return null;
  return task.date;
}

export function travelScheduleSummary(tasks: SummerTask[], progress: Record<string, TaskProgress>, referenceDate: string) {
  const metas = tasks.flatMap((task) => {
    const meta = travelTaskMeta(task, progress[task.id], referenceDate);
    return meta ? [meta] : [];
  });
  return {
    total: TRAVEL_SOFT_TASKS.length,
    completed: metas.filter((item) => item.state === "released").length,
    partial: metas.filter((item) => item.state === "partial").length,
    pending: metas.filter((item) => item.state === "soft").length,
    recovery: metas.filter((item) => item.state === "recovery" || item.state === "overdue_recovery").length,
    overdue: metas.filter((item) => item.state === "overdue_recovery").length,
    deferredBacklog: tasks.filter(isDeferredTravelBacklogTask).length,
  };
}
