"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import type { Role } from "../lib/demo-data";

const ROLE_LABELS: Record<Role, { label: string; note: string }> = {
  parent: { label: "家长", note: "管理全科作业与家教" },
  tutor: { label: "家教", note: "处理负责科目的闭环" },
  student: { label: "孩子", note: "查看任务并独立完成" },
};

export function LoginForm({ configured }: { configured: boolean }) {
  const [role, setRole] = useState<Role>("parent");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      setStatus("error");
      setMessage("开发环境尚未连接 Supabase，可先返回角色预览。");
      return;
    }

    setStatus("loading");
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setMessage("邮箱或密码不正确，请重新输入。");
      return;
    }

    window.location.assign("/");
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <Link href="/" className="login-brand"><span>闭</span><strong>学业闭环</strong></Link>
        <div>
          <p>一个作业，不止一个“完成”。</p>
          <h1>把独立练习、家教批改、知识掌握与学校提交真正连起来。</h1>
        </div>
        <div className="login-tracks">
          <span><i className="tone-blue" />作业流程</span>
          <span><i className="tone-green" />知识掌握</span>
          <span><i className="tone-orange" />学校提交</span>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <p className="eyebrow">私有家庭空间</p>
          <h2>登录</h2>
          <p className="login-intro">请选择你的身份。系统权限仍以家长邀请和分科授权为准。</p>

          <div className="login-role-grid" aria-label="选择登录身份">
            {(Object.keys(ROLE_LABELS) as Role[]).map((item) => (
              <button type="button" key={item} className={role === item ? "active" : ""} onClick={() => setRole(item)} aria-pressed={role === item}>
                <strong>{ROLE_LABELS[item].label}</strong><small>{ROLE_LABELS[item].note}</small>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <label><span>邮箱</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label>
            <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" required /></label>
            {message ? <p className="login-message" role="alert">{message}</p> : null}
            <button className="primary-button full" type="submit" disabled={status === "loading"}>{status === "loading" ? "正在登录…" : `以${ROLE_LABELS[role].label}身份登录`}</button>
          </form>

          {!configured ? <div className="preview-note"><strong>当前是开发预览</strong><p>账号界面和认证边界已经接入；连接 Supabase 后启用真实登录。</p><Link href="/">返回三角色预览</Link></div> : null}
        </div>
      </section>
    </main>
  );
}
