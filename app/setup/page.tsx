import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { getSupabaseServerClient } from "../lib/supabase/server";
import { SUMMER_TASKS } from "../lib/summer-plan";
import { SetupManager } from "./setup-manager";

export const metadata: Metadata = { title: { absolute: "家庭与家教设置 · 学业闭环" } };

export default async function SetupPage() {
  const expectedTaskCount = SUMMER_TASKS.length;
  if (!isSupabaseConfigured()) return <SetupManager configured={false} expectedTaskCount={expectedTaskCount} />;

  const supabase = await getSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/setup");

  const { data: membership } = await supabase
    .from("family_memberships")
    .select("family_id,role")
    .eq("user_id", authData.user.id)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  if (membership && membership.role !== "parent") redirect("/");

  let student: { id: string; display_name: string; grade: string } | null = null;
  let assignments: Array<{ id: string; subject_id: string; tutor_user_id: string }> = [];
  let taskCount = 0;
  if (membership?.family_id) {
    const { data } = await supabase
      .from("students")
      .select("id,display_name,grade")
      .eq("family_id", membership.family_id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    student = data;

    if (student) {
      const [assignmentResult, taskResult] = await Promise.all([
        supabase.from("tutor_assignments").select("id,subject_id,tutor_user_id").eq("student_id", student.id).is("ends_at", null),
        supabase.from("homework_tasks").select("id", { count: "exact", head: true }).eq("student_id", student.id).is("deleted_at", null),
      ]);
      assignments = assignmentResult.data ?? [];
      taskCount = taskResult.count ?? 0;
    }
  }

  return (
    <SetupManager
      configured
      familyId={membership?.family_id}
      student={student ?? undefined}
      assignments={assignments}
      taskCount={taskCount}
      expectedTaskCount={expectedTaskCount}
      userId={authData.user.id}
    />
  );
}
