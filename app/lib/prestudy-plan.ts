import prestudyData from "../data/prestudy-2026.json";
import type { SummerSubject } from "./summer-plan";

export type PrestudyTutorLane = "本科" | "考背";

export type PrestudyLessonTemplate = {
  sourceKey: string;
  subject: SummerSubject;
  moduleCode: string;
  lessonCode: string;
  originalDate: string;
  plannedDate: string;
  scheduleAdjustmentReason: string | null;
  tutorLane: PrestudyTutorLane;
  title: string;
  phases: {
    input: string;
    analysis: string;
    practice: string;
    output: string;
  };
  acceptanceCriteria: string;
  plannedMinutes: 90;
  knowledgePoints: string[];
};

type PrestudyPlan = {
  meta: {
    id: string;
    title: string;
    version: number;
    dateRange: { start: string; end: string };
    plannedMinutes: 90;
    allowedSubjects: SummerSubject[];
    sourceFiles: string[];
  };
  lessons: PrestudyLessonTemplate[];
};

export const PRESTUDY_PLAN = prestudyData as PrestudyPlan;
export const PRESTUDY_LESSONS = PRESTUDY_PLAN.lessons;

export function prestudyForDate(date: string, subject?: SummerSubject | "全部"): PrestudyLessonTemplate[] {
  return PRESTUDY_LESSONS.filter((lesson) => (
    lesson.plannedDate === date && (!subject || subject === "全部" || lesson.subject === subject)
  ));
}

export function prestudyForSubject(subject: SummerSubject): PrestudyLessonTemplate[] {
  return PRESTUDY_LESSONS.filter((lesson) => lesson.subject === subject);
}
