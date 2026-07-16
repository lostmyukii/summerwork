import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { getSupabaseServerClient } from "../../lib/supabase/server";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: { absolute: "接受邀请 · 学业闭环" } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return <AcceptInvitation token={token} configured={false} />;

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return <AcceptInvitation token={token} configured />;
}
