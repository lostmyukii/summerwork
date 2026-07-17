import type { SupabaseClient } from "@supabase/supabase-js";
import { PRESTUDY_LESSONS } from "../prestudy-plan";
import { SUMMER_PLAN, type SummerSubject } from "../summer-plan";
import type {
  PrestudyCourseSlot,
  PrestudyKnowledgeItem,
  PrestudyLesson,
  PrestudyUnmasteredItem,
} from "../workspace";

const SUBJECT_BY_ID: Record<string, SummerSubject> = {
  chinese: "语文",
  math: "数学",
  russian: "俄语",
  physics: "物理",
  chemistry: "化学",
  biology: "生物",
};

const SUBJECT_ID_BY_NAME: Record<SummerSubject, string> = Object.fromEntries(
  Object.entries(SUBJECT_BY_ID).map(([id, name]) => [name, id]),
) as Record<SummerSubject, string>;

type LessonRow = {
  id: string;
  source_key: string;
  student_id: string;
  subject_id: string;
  assigned_tutor_user_id: string;
  original_date: string;
  planned_date: string;
  schedule_adjustment_reason: string;
  tutor_lane: "本科" | "考背";
  module_code: string;
  lesson_code: string;
  title: string;
  input_0_25: string;
  analysis_25_55: string;
  practice_55_80: string;
  output_80_90: string;
  acceptance_criteria: string;
  planned_minutes: 90;
  version: number;
  content_edited_at: string | null;
  prestudy_state: PrestudyLesson["state"];
  led_at: string | null;
  validated_at: string | null;
  actual_question_count: number | null;
  execution_version: number;
};

type KnowledgeRow = { id: string; lesson_id: string; label: string; sort_order: number; active: boolean };
type UnmasteredRow = { id: string; lesson_id: string; knowledge_item_id: string | null; custom_label: string | null };
type CourseSlotRow = { subject_id: string; course_date: string; tutor_lane: "本科" | "考背" };

function requireRows<T>(result: { data: T[] | null; error: { message: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data ?? [];
}

export function previewPrestudyLessons(): PrestudyLesson[] {
  return PRESTUDY_LESSONS.map((lesson) => ({
    id: lesson.sourceKey,
    sourceKey: lesson.sourceKey,
    subject: lesson.subject,
    subjectId: SUBJECT_ID_BY_NAME[lesson.subject],
    assignedTutorLabel: lesson.subject === "语文" ? "考背家教" : `${lesson.subject}家教`,
    originalDate: lesson.originalDate,
    plannedDate: lesson.plannedDate,
    scheduleAdjustmentReason: lesson.scheduleAdjustmentReason ?? undefined,
    tutorLane: lesson.tutorLane,
    moduleCode: lesson.moduleCode,
    lessonCode: lesson.lessonCode,
    title: lesson.title,
    phases: lesson.phases,
    acceptanceCriteria: lesson.acceptanceCriteria,
    plannedMinutes: lesson.plannedMinutes,
    version: 1,
    state: "pending",
    executionVersion: 0,
    knowledgeItems: lesson.knowledgePoints.map((label, index) => ({ id: `${lesson.sourceKey}-k${index + 1}`, label, sortOrder: index })),
    unmasteredItems: [],
  }));
}

export function previewPrestudyCourseSlots(): PrestudyCourseSlot[] {
  return SUMMER_PLAN.courseSchedule.flatMap((day) => day.date === "2026-08-12" ? [] : day.subjects.map((subject) => ({
    subject,
    date: day.date,
    tutorLane: subject === "语文" ? "考背" as const : "本科" as const,
  })));
}

export async function loadPrestudyWorkspace(client: SupabaseClient, studentId: string): Promise<{
  lessons: PrestudyLesson[];
  courseSlots: PrestudyCourseSlot[];
}> {
  const [lessonRows, courseSlotRows] = await Promise.all([
    client.from("prestudy_lesson_overview").select("id,source_key,student_id,subject_id,assigned_tutor_user_id,original_date,planned_date,schedule_adjustment_reason,tutor_lane,module_code,lesson_code,title,input_0_25,analysis_25_55,practice_55_80,output_80_90,acceptance_criteria,planned_minutes,version,content_edited_at,prestudy_state,led_at,validated_at,actual_question_count,execution_version").eq("student_id", studentId).order("planned_date").order("lesson_code"),
    client.from("prestudy_course_slots").select("subject_id,course_date,tutor_lane").eq("student_id", studentId).eq("active", true).order("course_date"),
  ]);
  const lessons = requireRows(lessonRows as { data: LessonRow[] | null; error: { message: string } | null }, "读取预习计划");
  const slots = requireRows(courseSlotRows as { data: CourseSlotRow[] | null; error: { message: string } | null }, "读取预习课程槽");
  if (lessons.length === 0) {
    return {
      lessons: [],
      courseSlots: slots.flatMap((slot) => {
        const subject = SUBJECT_BY_ID[slot.subject_id];
        return subject ? [{ subject, date: slot.course_date, tutorLane: slot.tutor_lane }] : [];
      }),
    };
  }

  const lessonIds = lessons.map((lesson) => lesson.id);
  const [knowledgeRows, unmasteredRows] = await Promise.all([
    client.from("prestudy_knowledge_items").select("id,lesson_id,label,sort_order,active").in("lesson_id", lessonIds).order("sort_order"),
    client.from("prestudy_unmastered_items").select("id,lesson_id,knowledge_item_id,custom_label").in("lesson_id", lessonIds).order("created_at"),
  ]);
  const knowledge = requireRows(knowledgeRows as { data: KnowledgeRow[] | null; error: { message: string } | null }, "读取预习知识点");
  const unmastered = requireRows(unmasteredRows as { data: UnmasteredRow[] | null; error: { message: string } | null }, "读取预习未掌握项");
  const knowledgeById = new Map(knowledge.map((item) => [item.id, item]));
  const knowledgeByLesson = new Map<string, PrestudyKnowledgeItem[]>();
  for (const item of knowledge.filter((entry) => entry.active)) {
    knowledgeByLesson.set(item.lesson_id, [
      ...(knowledgeByLesson.get(item.lesson_id) ?? []),
      { id: item.id, label: item.label, sortOrder: item.sort_order },
    ]);
  }
  const unmasteredByLesson = new Map<string, PrestudyUnmasteredItem[]>();
  for (const item of unmastered) {
    const knowledgeItem = item.knowledge_item_id ? knowledgeById.get(item.knowledge_item_id) : undefined;
    const mapped: PrestudyUnmasteredItem = {
      id: item.id,
      knowledgeItemId: item.knowledge_item_id ?? undefined,
      label: item.custom_label ?? knowledgeItem?.label ?? "未命名知识点",
      custom: Boolean(item.custom_label),
    };
    unmasteredByLesson.set(item.lesson_id, [...(unmasteredByLesson.get(item.lesson_id) ?? []), mapped]);
  }

  return {
    lessons: lessons.flatMap((row) => {
      const subject = SUBJECT_BY_ID[row.subject_id];
      if (!subject) return [];
      return [{
        id: row.id,
        sourceKey: row.source_key,
        studentId: row.student_id,
        subject,
        subjectId: row.subject_id,
        assignedTutorUserId: row.assigned_tutor_user_id,
        assignedTutorLabel: subject === "语文" ? "考背家教" : `${subject}家教`,
        originalDate: row.original_date,
        plannedDate: row.planned_date,
        scheduleAdjustmentReason: row.schedule_adjustment_reason || undefined,
        tutorLane: row.tutor_lane,
        moduleCode: row.module_code,
        lessonCode: row.lesson_code,
        title: row.title,
        phases: {
          input: row.input_0_25,
          analysis: row.analysis_25_55,
          practice: row.practice_55_80,
          output: row.output_80_90,
        },
        acceptanceCriteria: row.acceptance_criteria,
        plannedMinutes: row.planned_minutes,
        version: row.version,
        contentEditedAt: row.content_edited_at ?? undefined,
        state: row.prestudy_state,
        executionVersion: row.execution_version,
        ledAt: row.led_at ?? undefined,
        validatedAt: row.validated_at ?? undefined,
        actualQuestionCount: row.actual_question_count ?? undefined,
        knowledgeItems: knowledgeByLesson.get(row.id) ?? [],
        unmasteredItems: unmasteredByLesson.get(row.id) ?? [],
      } satisfies PrestudyLesson];
    }),
    courseSlots: slots.flatMap((slot) => {
      const subject = SUBJECT_BY_ID[slot.subject_id];
      return subject ? [{ subject, date: slot.course_date, tutorLane: slot.tutor_lane }] : [];
    }),
  };
}
