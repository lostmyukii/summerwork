import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomeworkPlatform } from "./components/homework-platform";
import { isSupabaseConfigured } from "./lib/supabase/config";
import { loadInitialWorkspace } from "./lib/supabase/homework";
import { getSupabaseServerClient } from "./lib/supabase/server";

export const metadata: Metadata = {
  title: { absolute: "学业闭环 · 暑假作业管理" },
  description: "连接作业计划、独立练习、家教批改、订正复做与学校提交的家庭学习平台。",
};

export default async function Home() {
  if (!isSupabaseConfigured()) return <HomeworkPlatform />;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const initialWorkspace = await loadInitialWorkspace(supabase, data.user.id);
  return <HomeworkPlatform initialWorkspace={initialWorkspace} />;
}
