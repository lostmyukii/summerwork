import type { PlanOverride, TaskProgress, WorkspaceTask } from "./workspace";
import {
  RETURN_START_DATE,
  isDeferredTravelBacklogTask,
  scheduledDateForTask,
  travelTaskMeta,
} from "./travel-schedule";

export type PlanRiskType = "capacity" | "after_deadline" | "due_soon" | "overdue" | "deadline_day_work" | "uncertainty" | "missing_deadline" | "travel_backlog" | "travel_overdue";

export type PlanRisk = {
  id: string;
  type: PlanRiskType;
  severity: "high" | "attention";
  date: string;
  subject?: WorkspaceTask["subject"];
  taskIds: string[];
  title: string;
  detail: string;
};

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

export function effectiveTaskDate(task: WorkspaceTask, overrides: Record<string, PlanOverride>): string {
  return overrides[task.id]?.date ?? task.date;
}

export function computePlanRisks(
  tasks: WorkspaceTask[],
  overrides: Record<string, PlanOverride>,
  progress: Record<string, TaskProgress>,
  referenceDate: string,
  capacity = 2,
): PlanRisk[] {
  const risks: PlanRisk[] = [];
  const byDate = new Map<string, WorkspaceTask[]>();
  const deferredTravelBacklog = tasks.filter(isDeferredTravelBacklogTask);
  for (const task of tasks) {
    const date = scheduledDateForTask(task, overrides, progress, referenceDate);
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), task]);
  }

  if (deferredTravelBacklog.length) {
    risks.push({
      id: "travel-backlog",
      type: "travel_backlog",
      severity: "high",
      date: RETURN_START_DATE,
      taskIds: deferredTravelBacklog.map((task) => task.id),
      title: `旅行期 ${deferredTravelBacklog.length} 项首做待返程分配`,
      detail: "这些任务不进入7月26日至8月12日的每日软任务；学校原截止保留，返程后按新课让位、集中补位和后续截止重新分配。",
    });
  }

  for (const [date, dateTasks] of byDate) {
    const courseTasks = dateTasks.filter((task) => task.courseIntegrated);
    const independentTasks = dateTasks.filter((task) => !task.courseIntegrated && task.kind !== "submission");
    if (independentTasks.length <= capacity) continue;
    const subjects = new Set(dateTasks.map((task) => task.subject));
    risks.push({
      id: `capacity-${date}`,
      type: "capacity",
      severity: independentTasks.length > capacity + 1 ? "high" : "attention",
      date,
      taskIds: dateTasks.map((task) => task.id),
      title: `${date.slice(5).replace("-", "月")}日独立作业 ${independentTasks.length} 块`,
      detail: `另有课内 ${courseTasks.length} 块，当日共 ${dateTasks.length} 块、涉及 ${subjects.size} 科；家庭独立作业建议容量为 ${capacity} 块。`,
    });
  }

  for (const task of tasks) {
    const plannedDate = scheduledDateForTask(task, overrides, progress, referenceDate) ?? task.date;
    const taskProgress = progress[task.id];
    const submissionDone = !task.requiresSubmission || Boolean(taskProgress?.schoolSubmitted);
    const travelMeta = travelTaskMeta(task, taskProgress, referenceDate);
    if (task.uncertainty) {
      risks.push({ id: `uncertainty-${task.id}`, type: "uncertainty", severity: "attention", date: plannedDate, subject: task.subject, taskIds: [task.id], title: `${task.subject}计划仍待确认`, detail: `${task.title}：${task.notes || "需要家长依据学校通知确认。"}` });
    }
    if (!task.deadlineDate) {
      if (task.requiresSubmission) risks.push({ id: `missing-deadline-${task.id}`, type: "missing_deadline", severity: "attention", date: plannedDate, subject: task.subject, taskIds: [task.id], title: `${task.title}缺少正式截止`, detail: "来源材料没有提供可核验的截止日期；系统不会自行编造，需家长确认。" });
      continue;
    }
    if (travelMeta?.state === "overdue_recovery") {
      risks.push({ id: `travel-overdue-${task.id}`, type: "travel_overdue", severity: "high", date: travelMeta.fallbackDate, subject: task.subject, taskIds: [task.id], title: `${task.title}逾期待补交`, detail: `学校原截止 ${task.deadlineDate}；返程补位 ${travelMeta.fallbackDate}，剩余 ${travelMeta.remainingMinutes} 分钟。` });
      continue;
    } else if (plannedDate > task.deadlineDate) {
      risks.push({ id: `after-deadline-${task.id}`, type: "after_deadline", severity: "high", date: plannedDate, subject: task.subject, taskIds: [task.id], title: `${task.title}排在截止之后`, detail: `计划 ${plannedDate}，学校截止 ${task.deadlineDate}。必须调整或记录强制原因。` });
      continue;
    }
    if (plannedDate === task.deadlineDate && task.kind !== "submission") {
      risks.push({ id: `deadline-day-${task.id}`, type: "deadline_day_work", severity: "attention", date: plannedDate, subject: task.subject, taskIds: [task.id], title: `${task.title}压在截止当天`, detail: "没有为批改、订正和提交留出独立余量。" });
    }
    const remainingDays = daysBetween(referenceDate, task.deadlineDate);
    if (!submissionDone && remainingDays < 0) {
      risks.push({ id: `overdue-${task.id}`, type: "overdue", severity: "high", date: task.deadlineDate, subject: task.subject, taskIds: [task.id], title: `${task.title}已逾期未确认`, detail: `截止 ${task.deadlineDate}，系统仍未记录学校平台提交确认。` });
    } else if (!submissionDone && remainingDays <= 1) {
      risks.push({ id: `due-soon-${task.id}`, type: "due_soon", severity: "attention", date: task.deadlineDate, subject: task.subject, taskIds: [task.id], title: `${task.title}即将截止`, detail: task.deadlineAt ? `精确截止 ${task.deadlineAt.slice(5, 16).replace("T", " ")}。` : `截止日期 ${task.deadlineDate}，具体时间未提供。` });
    }
  }

  return risks.sort((left, right) => left.date.localeCompare(right.date) || (left.severity === "high" ? -1 : 1));
}

export function countRisksBySeverity(risks: PlanRisk[]) {
  return {
    high: risks.filter((risk) => risk.severity === "high").length,
    attention: risks.filter((risk) => risk.severity === "attention").length,
  };
}
