import type { PrestudyLesson } from "../workspace";
import { getSupabaseBrowserClient } from "./client";

function requireRemoteLesson(lesson: PrestudyLesson) {
  if (!lesson.studentId) throw new Error("预习课尚未绑定 Supabase 实例");
  return lesson.id;
}

export async function markPrestudyLed(lesson: PrestudyLesson): Promise<number> {
  const { data, error } = await getSupabaseBrowserClient().rpc("mark_prestudy_led", {
    target_lesson_id: requireRemoteLesson(lesson),
    expected_version: lesson.executionVersion,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function validatePrestudyLesson(
  lesson: PrestudyLesson,
  input: { actualQuestionCount: number; knowledgeItemIds: string[]; customUnmastered: string[] },
): Promise<number> {
  if (!Number.isInteger(input.actualQuestionCount) || input.actualQuestionCount < 0) throw new Error("实际完成题数必须是非负整数");
  const { data, error } = await getSupabaseBrowserClient().rpc("validate_prestudy_lesson", {
    target_lesson_id: requireRemoteLesson(lesson),
    target_actual_question_count: input.actualQuestionCount,
    target_knowledge_item_ids: input.knowledgeItemIds,
    target_custom_unmastered: input.customUnmastered,
    expected_version: lesson.executionVersion,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function revokePrestudyState(lesson: PrestudyLesson, state: "led" | "validated", reason: string): Promise<number> {
  if (!reason.trim()) throw new Error("撤销原因不能为空");
  const { data, error } = await getSupabaseBrowserClient().rpc("revoke_prestudy_state", {
    target_lesson_id: requireRemoteLesson(lesson),
    target_state: state,
    change_reason: reason.trim(),
    expected_version: lesson.executionVersion,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function movePrestudyLesson(lesson: PrestudyLesson, date: string, reason: string): Promise<number> {
  if (!reason.trim()) throw new Error("调整原因不能为空");
  const { data, error } = await getSupabaseBrowserClient().rpc("move_prestudy_lesson", {
    target_lesson_id: requireRemoteLesson(lesson),
    target_planned_date: date,
    change_reason: reason.trim(),
    expected_version: lesson.version,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export type PrestudyContentRevision = {
  title: string;
  phases: PrestudyLesson["phases"];
  acceptanceCriteria: string;
  knowledgeLabels: string[];
  reason: string;
};

export async function revisePrestudyContent(lesson: PrestudyLesson, input: PrestudyContentRevision): Promise<number> {
  const knowledgeLabels = [...new Set(input.knowledgeLabels.map((label) => label.trim()).filter(Boolean))];
  const requiredText = [input.title, input.phases.input, input.phases.analysis, input.phases.practice, input.phases.output, input.acceptanceCriteria, input.reason];
  if (requiredText.some((value) => !value.trim())) throw new Error("预习内容和变更原因不能为空");
  if (knowledgeLabels.length < 1 || knowledgeLabels.length > 12) throw new Error("预设知识点需保留1—12项");
  const { data, error } = await getSupabaseBrowserClient().rpc("revise_prestudy_content", {
    target_lesson_id: requireRemoteLesson(lesson),
    target_title: input.title.trim(),
    target_input_0_25: input.phases.input.trim(),
    target_analysis_25_55: input.phases.analysis.trim(),
    target_practice_55_80: input.phases.practice.trim(),
    target_output_80_90: input.phases.output.trim(),
    target_acceptance_criteria: input.acceptanceCriteria.trim(),
    target_knowledge_labels: knowledgeLabels,
    change_reason: input.reason.trim(),
    expected_version: lesson.version,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data as number;
}
