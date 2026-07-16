import type { Metadata } from "next";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "登录 · 学业闭环" },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <LoginForm configured={isSupabaseConfigured()} nextPath={nextPath} />;
}
