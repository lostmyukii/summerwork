"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

const SUBJECTS = [
  { id: "chinese", name: "语文·考背" },
  { id: "math", name: "数学" },
  { id: "russian", name: "俄语" },
  { id: "physics", name: "物理" },
  { id: "chemistry", name: "化学" },
  { id: "biology", name: "生物" },
];

type SetupProps = {
  configured: boolean;
  familyId?: string;
  userId?: string;
  student?: { id: string; display_name: string; grade: string };
  assignments?: Array<{ id: string; subject_id: string; tutor_user_id: string }>;
  taskCount?: number;
};

export function SetupManager({ configured, familyId, userId, student, assignments = [], taskCount = 0 }: SetupProps) {
  const [familyName, setFamilyName] = useState("我的家庭学习空间");
  const [studentName, setStudentName] = useState("");
  const [grade, setGrade] = useState("高一");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubject, setInviteSubject] = useState("math");
  const [inviteRole, setInviteRole] = useState<"tutor" | "student">("tutor");
  const [inviteLink, setInviteLink] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function createFamilyAndStudent(event: React.FormEvent) {
    event.preventDefault();
    if (!configured || !userId) return setStatus("请先配置 Supabase 并登录家长账号。");
    setBusy(true);
    setStatus("");
    try {
      const supabase = getSupabaseBrowserClient();
      let targetFamilyId = familyId;
      if (!targetFamilyId) {
        const { data, error } = await supabase.rpc("create_family_space", { family_name: familyName });
        if (error) throw error;
        targetFamilyId = data;
      }
      const { data: newStudent, error: studentError } = await supabase.from("students").insert({
        family_id: targetFamilyId,
        display_name: studentName.trim(),
        grade,
        school_year: "2026-2027",
        created_by: userId,
      }).select("id").single();
      if (studentError) throw studentError;
      const { data: inserted, error: planError } = await supabase.rpc("create_student_plan", {
        target_student_id: newStudent.id,
        target_catalog_id: "summer-2026-family-tutoring",
      });
      if (planError) throw planError;
      setStatus(`孩子档案与暑期计划已建立，共生成 ${inserted} 条任务。`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function ensurePlan() {
    if (!student) return;
    setBusy(true);
    const { data, error } = await getSupabaseBrowserClient().rpc("create_student_plan", {
      target_student_id: student.id,
      target_catalog_id: "summer-2026-family-tutoring",
    });
    setBusy(false);
    if (error) return setStatus(error.message);
    setStatus(data ? `已补充 ${data} 条任务。` : "200条计划已完整，无需重复生成。");
    window.setTimeout(() => window.location.reload(), 700);
  }

  async function createInvitation(event: React.FormEvent) {
    event.preventDefault();
    if (!student) return;
    setBusy(true);
    setInviteLink("");
    setStatus("");
    const { data, error } = await getSupabaseBrowserClient().rpc("create_account_invitation", {
      target_email: inviteEmail.trim(),
      target_role: inviteRole,
      target_student_id: student.id,
      target_subject_id: inviteRole === "tutor" ? inviteSubject : null,
      valid_hours: 168,
    });
    setBusy(false);
    if (error) return setStatus(error.message);
    const token = data?.[0]?.raw_token;
    if (!token) return setStatus("邀请已创建，但未取得邀请令牌。");
    setInviteLink(`${window.location.origin}/invite/${token}`);
    setStatus("邀请已创建，7天内有效。请把链接单独发给对应家教或孩子。");
  }

  async function revokeAssignment(assignmentId: string, subjectName: string) {
    const reason = window.prompt(`请输入撤销${subjectName}家教权限的原因`, "家教安排变化");
    if (!reason?.trim()) return;
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().rpc("revoke_tutor_access", {
      target_assignment_id: assignmentId,
      revoke_reason: reason.trim(),
      target_idempotency_key: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) return setStatus(error.message);
    setStatus(`${subjectName}家教权限已撤销，当前登录会话立即失权。`);
    window.setTimeout(() => window.location.reload(), 700);
  }

  return (
    <main className="setup-page">
      <header className="setup-header"><Link href="/" className="login-brand dark"><span>闭</span><strong>学业闭环</strong></Link><Link href="/">返回系统</Link></header>
      <section className="setup-intro"><p className="eyebrow">家长管理员</p><h1>家庭、孩子与分科家教</h1><p>家长统一建立作业；每位家教只获得一个孩子的一门学科权限。</p></section>

      {!configured ? <article className="setup-card"><h2>Supabase 尚未连接</h2><p>填写四项环境变量并完成数据库迁移后，才能创建真实账号与邀请。</p><Link className="secondary-button" href="/login">返回开发预览</Link></article> : null}

      {configured && !student ? (
        <article className="setup-card">
          <span className="step-number">1</span><h2>创建家庭与孩子档案</h2><p>提交后会一次生成已核验的200条暑期任务。</p>
          <form className="setup-form" onSubmit={createFamilyAndStudent}>
            {!familyId ? <label><span>家庭空间名称</span><input value={familyName} onChange={(event) => setFamilyName(event.target.value)} required /></label> : null}
            <label><span>孩子称呼</span><input value={studentName} onChange={(event) => setStudentName(event.target.value)} required /></label>
            <label><span>年级</span><select value={grade} onChange={(event) => setGrade(event.target.value)}><option>高一</option><option>高二</option></select></label>
            <button className="primary-button" disabled={busy} type="submit">{busy ? "正在建立…" : "创建并生成暑期计划"}</button>
          </form>
        </article>
      ) : null}

      {configured && student ? (
        <div className="setup-grid">
          <article className="setup-card profile-card"><span className="step-number done">✓</span><h2>{student.display_name}</h2><p>{student.grade} · 2026—2027学年</p><div className="setup-stat"><strong>{taskCount}</strong><span>已生成任务</span></div>{taskCount !== 200 ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void ensurePlan()}>补齐200条计划</button> : <span className="verified-badge">计划完整</span>}</article>
          <article className="setup-card"><span className="step-number">2</span><h2>邀请账号</h2><p>邀请链接不通过本系统发送，请由家长单独转发。</p>
            <form className="setup-form" onSubmit={createInvitation}>
              <div className="invite-role-tabs"><button type="button" className={inviteRole === "tutor" ? "active" : ""} onClick={() => setInviteRole("tutor")}>分科家教</button><button type="button" className={inviteRole === "student" ? "active" : ""} onClick={() => setInviteRole("student")}>孩子账号</button></div>
              <label><span>登录邮箱</span><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></label>
              {inviteRole === "tutor" ? <label><span>负责科目</span><select value={inviteSubject} onChange={(event) => setInviteSubject(event.target.value)}>{SUBJECTS.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label> : null}
              <button className="primary-button" disabled={busy} type="submit">生成7天邀请链接</button>
            </form>
            {inviteLink ? <div className="invite-result"><input readOnly value={inviteLink} /><button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}>复制</button></div> : null}
          </article>
          <article className="setup-card assignment-card"><span className="step-number">3</span><h2>当前分科授权</h2>{SUBJECTS.map((subject) => { const assignment = assignments.find((item) => item.subject_id === subject.id); return <div className="assignment-row" key={subject.id}><span>{subject.name}</span><div><strong className={assignment ? "active" : ""}>{assignment ? "已邀请并接受" : "待邀请"}</strong>{assignment ? <button type="button" disabled={busy} onClick={() => void revokeAssignment(assignment.id, subject.name)}>撤销</button> : null}</div></div>; })}</article>
        </div>
      ) : null}

      {status ? <p className="setup-status" role="status">{status}</p> : null}
    </main>
  );
}
