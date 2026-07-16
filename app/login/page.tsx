import type { Metadata } from "next";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "登录 · 学业闭环" },
};

export default function LoginPage() {
  return <LoginForm configured={isSupabaseConfigured()} />;
}
