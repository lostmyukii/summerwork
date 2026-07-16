"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ERROR_TAGS,
  MASTERY_COPY,
  ROLE_COPY,
  type Role,
} from "../lib/demo-data";
import {
  canCloseLoop,
  deriveMasteryLevel,
  deriveWorkflowState,
  isOverDailyCapacity,
  normalizeQuestionNumbers,
  type WorkflowEvidence,
} from "../lib/workflow";
import {
  ANSWER_POLICY_COPY,
  ONTOLOGY_ISSUES,
  PLAN_REFERENCE_DATE,
  SUBJECT_REQUIREMENTS,
  SUBJECT_TONES,
  SUMMER_PLAN,
  SUMMER_SUBJECTS,
  addPlanDays,
  clampPlanDate,
  courseForDate,
  formatPlanDate,
  importantDateFor,
  weekdayFor,
  weekDatesFor,
  type SummerSubject,
} from "../lib/summer-plan";
import {
  blankTaskProgress,
  evidenceFor,
  type AuditEntry,
  type InitialWorkspace,
  type PlanOverride,
  type StoredWorkspace,
  type TaskProgress,
  type WorkspaceTask,
} from "../lib/workspace";
import { persistPlanChange, persistStudentActivity, persistTaskReview } from "../lib/supabase/workspace-actions";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import { computePlanRisks, countRisksBySeverity, type PlanRisk } from "../lib/plan-risk";

const STORAGE_KEY = "summerwork:workspace:v1";

const NAV_ITEMS: Record<Role, string[]> = {
  parent: ["总览", "日历", "作业", "知识", "设置"],
  tutor: ["今天", "日历", "批改", "知识", "我的"],
  student: ["今天", "本周", "知识", "我的"],
};

const WORKFLOW_COPY = {
  ready: "待开始",
  in_progress: "进行中",
  awaiting_review: "待批改",
  awaiting_correction: "待订正",
  awaiting_redo: "待复做",
  awaiting_acceptance: "待验收",
  closed_loop: "已闭环",
} as const;

function MiniIcon({ children }: { children: React.ReactNode }) {
  return <span className="mini-icon" aria-hidden="true">{children}</span>;
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

function AppHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function SectionHeading({ title, action }: { title: string; action?: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action ? <button className="text-action" type="button">{action}</button> : null}
    </div>
  );
}

function SummerPlanBrowser({
  role,
  onAction,
  onPlanChange,
  overrides,
  planTasks,
}: {
  role: Role;
  onAction: (task: WorkspaceTask) => void;
  onPlanChange?: (task: WorkspaceTask) => void;
  overrides: Record<string, PlanOverride>;
  planTasks: WorkspaceTask[];
}) {
  const defaultTutorSubject = planTasks.some((task) => task.subject === "数学") ? "数学" : planTasks[0]?.subject ?? "数学";
  const [selectedDate, setSelectedDate] = useState(role === "tutor" ? planTasks.find((task) => task.subject === defaultTutorSubject)?.date ?? planTasks[0]?.date ?? PLAN_REFERENCE_DATE : PLAN_REFERENCE_DATE);
  const [subject, setSubject] = useState<SummerSubject | "全部">(role === "tutor" ? defaultTutorSubject : "全部");
  const weekDates = weekDatesFor(selectedDate);
  const effectiveDate = (task: WorkspaceTask) => overrides[task.id]?.date ?? task.date;
  const tasks = planTasks.filter((task) => effectiveDate(task) === selectedDate && (subject === "全部" || task.subject === subject));
  const allDayTasks = planTasks.filter((task) => effectiveDate(task) === selectedDate);
  const course = courseForDate(selectedDate);
  const importantDate = importantDateFor(selectedDate);
  const requirement = subject === "全部" ? undefined : SUBJECT_REQUIREMENTS.find((item) => item.subject === subject);
  const actionCopy = role === "parent" ? "查看任务" : role === "tutor" ? "进入批改" : "开始做题";
  const availableSubjects = SUMMER_SUBJECTS.filter((item) => planTasks.some((task) => task.subject === item));

  function moveWeek(amount: number) {
    setSelectedDate(clampPlanDate(addPlanDays(selectedDate, amount * 7)));
  }

  return (
    <section className="summer-plan-panel" aria-label="2026暑期真实作业计划">
      <div className="summer-plan-head">
        <div>
          <p className="eyebrow">已加载真实计划 · {planTasks.length}条</p>
          <h2>{role === "tutor" ? "分科执行日历" : role === "student" ? "我的暑期任务" : "暑期总日历"}</h2>
          <p>来源：作业本体分析、5份分科CSV与7—8月原始课表</p>
        </div>
        <span className="verified-badge">本体已核对</span>
      </div>

      <div className="subject-filter" aria-label="按科目筛选">
        {(role === "tutor" ? availableSubjects : (["全部", ...availableSubjects] as const)).map((item) => (
          <button
            key={item}
            type="button"
            className={subject === item ? "active" : ""}
            onClick={() => setSubject(item)}
            aria-pressed={subject === item}
          >
            {item === "语文" ? "语文·考背" : item}
          </button>
        ))}
      </div>

      <div className="plan-week-control">
        <button type="button" onClick={() => moveWeek(-1)} aria-label="上一周">‹</button>
        <strong>{formatPlanDate(weekDates[0])}—{formatPlanDate(weekDates[6])}</strong>
        <button type="button" onClick={() => moveWeek(1)} aria-label="下一周">›</button>
      </div>

      <div className="real-week-strip">
        {weekDates.map((date) => {
          const dateTasks = planTasks.filter((task) => effectiveDate(task) === date);
          const count = dateTasks.filter((task) => subject === "全部" || task.subject === subject).length;
          const totalCount = dateTasks.length;
          return (
            <button
              key={date}
              type="button"
              className={selectedDate === date ? "active" : totalCount > 2 ? "risk" : ""}
              onClick={() => setSelectedDate(date)}
              aria-pressed={selectedDate === date}
            >
              <span>周{weekdayFor(date)}</span>
              <strong>{Number(date.slice(-2))}</strong>
              <small>{count ? `${count}项` : "—"}</small>
            </button>
          );
        })}
      </div>

      <div className="selected-day-summary">
        <div><strong>{formatPlanDate(selectedDate, true)} · 周{weekdayFor(selectedDate)}</strong><span>{subject === "全部" ? `${allDayTasks.length}个90分钟任务块` : `${subject} ${tasks.length}个任务块`}</span></div>
        {allDayTasks.length > 2 ? <StatusPill tone="red">超过建议容量 · {allDayTasks.length}项</StatusPill> : <StatusPill tone="green">负荷可控</StatusPill>}
      </div>

      {course ? <div className="course-banner"><MiniIcon>课</MiniIcon><div><strong>当天课程</strong><p>{course.labels.join(" / ")}</p></div></div> : null}
      {importantDate ? <div className="plan-alert"><MiniIcon>!</MiniIcon><div><strong>重要节点</strong><p>{importantDate.label}</p></div></div> : null}
      {requirement ? <div className="ontology-brief"><strong>{requirement.workBody}</strong><p>{requirement.splitRule}</p><small>答案：{requirement.answerSource}</small></div> : null}

      <div className="real-task-list">
        {tasks.length ? tasks.map((task) => (
          <article className={task.uncertainty ? "real-task-card uncertain" : "real-task-card"} key={task.id}>
            <div className="real-task-top">
              <div><StatusPill tone={SUBJECT_TONES[task.subject]}>{task.subject === "语文" ? "语文·考背" : task.subject}</StatusPill><span>{task.slotType}</span></div>
              <div><span>标准 {task.blockMinutes} 分钟</span>{task.recommendedMinutes !== 90 ? <StatusPill tone="orange">建议 {task.recommendedMinutes} 分钟</StatusPill> : null}</div>
            </div>
            <h3>{task.title}</h3>
            <dl className="task-facts">
              <div><dt>知识点</dt><dd>{task.knowledge || "待补充"}</dd></div>
              <div><dt>批改依据</dt><dd>{task.answerBasis}</dd></div>
              <div><dt>提交标记</dt><dd>{task.submission}</dd></div>
              <div><dt>学校截止</dt><dd>{task.deadlineAt ? task.deadlineAt.slice(0, 16).replace("T", " ") : task.deadlineDate ? `${task.deadlineDate}（时间未提供）` : "未提供正式截止"}</dd></div>
            </dl>
            <div className="task-policy-line">
              <span>{ANSWER_POLICY_COPY[task.answerPolicy]}</span>
              {overrides[task.id] ? <StatusPill tone="blue">已调整至 {formatPlanDate(overrides[task.id].date)}</StatusPill> : null}
              {task.requirementLevel === "pending_confirmation" ? <StatusPill tone="orange">待老师确认</StatusPill> : null}
              {task.requirementLevel === "optional" ? <StatusPill tone="gray">选做/拓展</StatusPill> : null}
              {task.uncertainty ? <StatusPill tone="red">计划存疑</StatusPill> : null}
            </div>
            {task.notes ? <p className="task-note">{task.notes}</p> : null}
            <div className={role === "tutor" ? "task-card-actions" : undefined}>
              <button type="button" className={role === "tutor" ? "primary-button" : "secondary-button full"} onClick={() => onAction(task)}>{task.kind === "submission" ? "标记提交" : actionCopy}</button>
              {role === "tutor" && onPlanChange ? <button type="button" className="secondary-button" onClick={() => onPlanChange(task)}>调整计划</button> : null}
            </div>
          </article>
        )) : (
          <div className="empty-day"><span>✓</span><h3>筛选范围内无任务</h3><p>可切换科目或选择其他日期。</p></div>
        )}
      </div>
    </section>
  );
}

export function HomeworkPlatform({ initialWorkspace }: { initialWorkspace?: InitialWorkspace }) {
  const router = useRouter();
  const planTasks = initialWorkspace ? initialWorkspace.tasks : SUMMER_PLAN.tasks;
  const remoteEnabled = Boolean(initialWorkspace?.remoteEnabled);
  const [role, setRole] = useState<Role>(initialWorkspace?.role ?? "tutor");
  const [activeNav, setActiveNav] = useState<Record<Role, string>>({ parent: "总览", tutor: "日历", student: "今天" });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [progress, setProgress] = useState<Record<string, TaskProgress>>(initialWorkspace?.progress ?? {});
  const [planOverrides, setPlanOverrides] = useState<Record<string, PlanOverride>>(initialWorkspace?.overrides ?? {});
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(initialWorkspace?.audit ?? []);
  const [persistenceReady, setPersistenceReady] = useState(remoteEnabled);
  const [planDate, setPlanDate] = useState(PLAN_REFERENCE_DATE);
  const [planReason, setPlanReason] = useState("课程冲突");
  const [planTask, setPlanTask] = useState<WorkspaceTask | null>(null);
  const [workflowTask, setWorkflowTask] = useState<WorkspaceTask>(() => planTasks.find((task) => task.subject === "数学") ?? planTasks[0] ?? SUMMER_PLAN.tasks[0]);

  const activeProgress = useMemo(() => progress[workflowTask.id] ?? blankTaskProgress(), [progress, workflowTask.id]);
  const evidence = useMemo(() => evidenceFor(activeProgress, workflowTask.requiresSubmission), [activeProgress, workflowTask.requiresSubmission]);

  const workflowState = deriveWorkflowState(evidence);
  const masteryLevel = deriveMasteryLevel(evidence);
  const closeLoopReady = canCloseLoop(evidence);
  const planRisks = useMemo(() => computePlanRisks(planTasks, planOverrides, progress, PLAN_REFERENCE_DATE), [planOverrides, planTasks, progress]);

  useEffect(() => {
    if (remoteEnabled) return;
    let parsed: Partial<StoredWorkspace> = {};
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) parsed = JSON.parse(stored) as Partial<StoredWorkspace>;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    queueMicrotask(() => {
      if (parsed.progress) setProgress(parsed.progress);
      if (parsed.overrides) setPlanOverrides(parsed.overrides);
      if (parsed.audit) setAuditEntries(parsed.audit);
      setPersistenceReady(true);
    });
  }, [remoteEnabled]);

  useEffect(() => {
    if (!persistenceReady || remoteEnabled) return;
    const workspace: StoredWorkspace = { progress, overrides: planOverrides, audit: auditEntries };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [auditEntries, persistenceReady, planOverrides, progress, remoteEnabled]);

  useEffect(() => {
    if (!remoteEnabled || !initialWorkspace) return;
    queueMicrotask(() => {
      setProgress(initialWorkspace.progress);
      setPlanOverrides(initialWorkspace.overrides);
      setAuditEntries(initialWorkspace.audit);
    });
  }, [initialWorkspace, remoteEnabled]);

  useEffect(() => {
    if (!remoteEnabled || !initialWorkspace?.userId) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => router.refresh();
    const channel = supabase
      .channel(`summerwork-${initialWorkspace.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "homework_tasks" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "student_task_activity" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_reviews" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_plan_changes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_mastery" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [initialWorkspace?.userId, remoteEnabled, router]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    window.location.assign("/login");
  }

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    setReviewOpen(false);
    setPlanOpen(false);
  }

  function updateTaskProgress(taskId: string, patch: Partial<TaskProgress>, persistActivity = false) {
    const next = { ...(progress[taskId] ?? blankTaskProgress()), ...patch, updatedAt: new Date().toISOString() };
    setProgress((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? blankTaskProgress()), ...patch, updatedAt: next.updatedAt },
    }));
    if (persistActivity && remoteEnabled) {
      const task = planTasks.find((item) => item.id === taskId);
      if (task) void persistStudentActivity(task, next).catch(() => showToast("同步失败，请检查网络后重试"));
    }
  }

  function toggleErrorTag(tag: string) {
    const next = activeProgress.errorTags.includes(tag)
      ? activeProgress.errorTags.filter((item) => item !== tag)
      : [...activeProgress.errorTags, tag];
    updateTaskProgress(workflowTask.id, { errorTags: next });
  }

  async function saveReview() {
    if (workflowTask.kind !== "submission" && activeProgress.runState !== "completed") {
      showToast("孩子完成独立首做后才能保存批改");
      return;
    }
    if (!activeProgress.reviewConfirmed) {
      showToast("请先勾选“已完成批改”");
      return;
    }
    if (activeProgress.accuracy !== "100%" && !normalizeQuestionNumbers(activeProgress.wrongNumbers)) {
      showToast("请填写错题号");
      return;
    }
    const now = new Date().toISOString();
    const savedProgress = {
      ...activeProgress,
      wrongNumbers: normalizeQuestionNumbers(activeProgress.wrongNumbers),
      reviewSaved: true,
    };
    if (remoteEnabled) {
      try {
        if (!initialWorkspace?.userId) throw new Error("登录用户缺失");
        await persistTaskReview(workflowTask, savedProgress, initialWorkspace.userId);
      } catch {
        showToast("批改未同步，请检查权限或网络");
        return;
      }
    }
    updateTaskProgress(workflowTask.id, savedProgress);
    setAuditEntries((current) => [{
      id: `review-${workflowTask.id}-${now}`,
      taskId: workflowTask.id,
      title: `${workflowTask.subject}批改记录已保存`,
      detail: `${workflowTask.title} · 正确率 ${activeProgress.accuracy}`,
      actor: `${workflowTask.subject}家教`,
      occurredAt: now,
      tone: "green" as const,
    }, ...current].slice(0, 50));
    showToast("批改已保存，等待订正与复做");
  }

  function openPlanChange(task: WorkspaceTask) {
    setPlanTask(task);
    setPlanDate(planOverrides[task.id]?.date ?? task.date);
    setPlanReason(planOverrides[task.id]?.reason ?? "课程冲突");
    setPlanOpen(true);
  }

  async function savePlanChange() {
    if (!planTask) return;
    const nextDate = clampPlanDate(planDate);
    const now = new Date().toISOString();
    if (remoteEnabled) {
      try {
        await persistPlanChange(planTask, nextDate, planReason);
      } catch {
        showToast("计划调整未同步，请检查本科权限或网络");
        return;
      }
    }
    setPlanOverrides((current) => ({ ...current, [planTask.id]: { date: nextDate, reason: planReason, changedAt: now, actor: `${planTask.subject}家教` } }));
    setAuditEntries((current) => [{
      id: `plan-${planTask.id}-${now}`,
      taskId: planTask.id,
      title: `${planTask.title}调整至${formatPlanDate(nextDate)}`,
      detail: `原计划 ${formatPlanDate(planTask.date)} · 原因：${planReason}`,
      actor: `${planTask.subject}家教`,
      occurredAt: now,
      tone: "blue" as const,
    }, ...current].slice(0, 50));
    setPlanOpen(false);
    showToast(`已调整到 ${formatPlanDate(nextDate)} · ${planReason}`);
  }

  if (remoteEnabled && planTasks.length === 0) {
    return (
      <main className="empty-workspace-page">
        <div className="brand-mark">闭</div>
        <p className="eyebrow">私有家庭空间</p>
        <h1>账号已连接，计划尚未建立</h1>
        <p>{role === "parent" ? "请先创建孩子档案，并从“2026暑期家教作业闭环计划”生成任务。" : role === "tutor" ? "等待家长邀请并分配负责科目后，本科任务会自动出现。" : "等待家长创建暑期计划后，你就可以开始做题。"}</p>
        <Link className="secondary-button" href={role === "parent" ? "/setup" : "/login"}>{role === "parent" ? "建立孩子与计划" : "返回登录"}</Link>
      </main>
    );
  }

  return (
    <div className="app-frame">
      <aside className="side-rail" aria-label="开发预览角色切换">
        <div className="brand-lockup">
          <span className="brand-mark">闭</span>
          <div><strong>学业闭环</strong><small>暑假作业系统</small></div>
        </div>

        <div className="rail-section">
          <p className="rail-label">{remoteEnabled ? "当前登录身份" : "开发预览 · 角色"}</p>
          <div className="role-switcher">
            {(remoteEnabled ? [role] : Object.keys(ROLE_COPY) as Role[]).map((item) => (
              <button
                key={item}
                type="button"
                className={role === item ? "role-option active" : "role-option"}
                onClick={() => changeRole(item)}
                aria-pressed={role === item}
              >
                <span>{remoteEnabled && item === "tutor" ? planTasks[0]?.subject.slice(0, 1) ?? "教" : ROLE_COPY[item].glyph}</span>
                <div><strong>{ROLE_COPY[item].label}</strong><small>{remoteEnabled && item === "tutor" ? `${planTasks[0]?.subject ?? "分科"}工作台` : ROLE_COPY[item].note}</small></div>
              </button>
            ))}
          </div>
        </div>

        <div className="rail-progress">
          <div className="rail-progress-top"><span>真实计划已导入</span><strong>{planTasks.length}</strong></div>
          <div className="progress-track"><i style={{ width: "100%" }} /></div>
          <p>{new Set(planTasks.map((task) => task.subject)).size} 科 · 23 个课程日 · 5 项待核对</p>
        </div>

        <div className="rail-footer">
          <MiniIcon>同</MiniIcon>
          <div><strong>状态实时同步</strong><small>最后更新：刚刚</small></div>
        </div>
        {remoteEnabled ? <button className="account-link" type="button" onClick={() => void signOut()}>退出当前账号</button> : <Link className="account-link" href="/login">进入账号登录</Link>}
      </aside>

      <main className="main-shell">
        <div className="mobile-role-bar">
          {(remoteEnabled ? [role] : Object.keys(ROLE_COPY) as Role[]).map((item) => (
            <button key={item} className={role === item ? "active" : ""} onClick={() => changeRole(item)} type="button">
              {ROLE_COPY[item].label}
            </button>
          ))}
        </div>

        {role === "parent" ? <ParentView auditEntries={auditEntries} overrides={planOverrides} planRisks={planRisks} planTasks={planTasks} progress={progress} showToast={showToast} /> : null}
        {role === "tutor" ? (
          <TutorView
            auditEntries={auditEntries}
            closeLoopReady={closeLoopReady}
            evidence={evidence}
            masteryLevel={masteryLevel}
            overrides={planOverrides}
            planTasks={planTasks}
            planRisks={planRisks}
            progress={activeProgress}
            remoteEnabled={remoteEnabled}
            setPlanOpen={openPlanChange}
            setReviewOpen={setReviewOpen}
            setWorkflowTask={setWorkflowTask}
            workflowTask={workflowTask}
            workflowState={workflowState}
          />
        ) : null}
        {role === "student" ? (
          <StudentView
            overrides={planOverrides}
            planTasks={planTasks}
            progress={progress}
            setWorkflowTask={setWorkflowTask}
            showToast={showToast}
            updateTaskProgress={updateTaskProgress}
          />
        ) : null}

        <nav className="bottom-nav" aria-label={`${ROLE_COPY[role].label}端导航`}>
          {NAV_ITEMS[role].map((item) => (
            <button
              type="button"
              className={activeNav[role] === item ? "active" : ""}
              key={item}
              onClick={() => {
                setActiveNav((current) => ({ ...current, [role]: item }));
                if (!["总览", "日历", "今天"].includes(item)) showToast(`${item}页已纳入下一开发批次`);
              }}
            >
              <span aria-hidden="true">{item.slice(0, 1)}</span>{item}
            </button>
          ))}
        </nav>
      </main>

      {reviewOpen ? (
        <ReviewPanel
          closeLoopReady={closeLoopReady}
          masteryLevel={masteryLevel}
          onClose={() => setReviewOpen(false)}
          onSave={saveReview}
          progress={activeProgress}
          setProgress={(patch) => updateTaskProgress(workflowTask.id, patch)}
          toggleErrorTag={toggleErrorTag}
          task={workflowTask}
          workflowState={workflowState}
        />
      ) : null}

      {planOpen && planTask ? (
        <PlanPanel
          onClose={() => setPlanOpen(false)}
          onSave={savePlanChange}
          planDate={planDate}
          planReason={planReason}
          overrides={planOverrides}
          setPlanDate={setPlanDate}
          setPlanReason={setPlanReason}
          task={planTask}
          tasks={planTasks}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function ParentView({ auditEntries, overrides, planRisks, planTasks, progress, showToast }: { auditEntries: AuditEntry[]; overrides: Record<string, PlanOverride>; planRisks: PlanRisk[]; planTasks: WorkspaceTask[]; progress: Record<string, TaskProgress>; showToast: (message: string) => void }) {
  const subjectCounts = SUMMER_SUBJECTS.map((subject) => ({ subject, count: planTasks.filter((task) => task.subject === subject).length }));
  const availableSubjectCount = subjectCounts.filter((item) => item.count > 0).length;
  const submittedCount = Object.values(progress).filter((item) => item.schoolSubmitted).length;
  const completedCount = Object.values(progress).filter((item) => item.runState === "completed").length;
  const riskCounts = countRisksBySeverity(planRisks);
  return (
    <div className="page-content parent-page">
      <AppHeader
        eyebrow="家长管理员"
        title="学习总览"
        subtitle="6科真实计划 · 7月16日—8月29日"
        action={<button className="avatar-button" type="button" aria-label="家长账户">家</button>}
      />

      <section className="metric-grid" aria-label="暑期计划概况">
        <article className="metric-card"><span>真实任务块</span><strong>{planTasks.length}</strong><small>已完成首做 {completedCount} 项</small></article>
        <article className="metric-card risk"><span>高风险</span><strong>{riskCounts.high}</strong><small>另有 {riskCounts.attention + ONTOLOGY_ISSUES.length} 项需关注</small></article>
        <article className="metric-card success"><span>科目范围</span><strong>{availableSubjectCount}</strong><small>英语、政史地已排除</small></article>
        <article className="metric-card"><span>提交确认</span><strong>{submittedCount}</strong><small>7月5日无安排</small></article>
      </section>

      <SummerPlanBrowser role="parent" overrides={overrides} planTasks={planTasks} onAction={(task) => showToast(`已选择：${task.subject} · ${task.title}`)} />

      <div className="content-columns">
        <section>
          <SectionHeading title="需要关注" action="查看全部" />
          <div className="attention-list">
            {planRisks.slice(0, 3).map((item) => (
              <article className="attention-card" key={item.id}>
                <MiniIcon>!</MiniIcon>
                <div><div className="card-title-row"><h3>{item.title}</h3><StatusPill tone={item.severity === "high" ? "red" : "orange"}>{item.subject ?? "全科"}</StatusPill></div><p>{item.detail}</p></div>
                <button type="button" aria-label={`查看${item.title}`}>›</button>
              </article>
            ))}
            {planRisks.length < 3 ? ONTOLOGY_ISSUES.slice(0, 3 - planRisks.length).map((item) => (
              <article className="attention-card" key={item.id}>
                <MiniIcon>{item.subject.slice(0, 1)}</MiniIcon>
                <div><div className="card-title-row"><h3>{item.title}</h3><StatusPill tone={item.severity === "high" ? "red" : "orange"}>{item.subject}</StatusPill></div><p>{item.detail}</p></div>
                <button type="button" aria-label={`查看${item.title}`}>›</button>
              </article>
            )) : null}
          </div>

          <SectionHeading title="本周进度" />
          <article className="subject-progress-card">
            {subjectCounts.filter((item) => item.count > 0).map((item) => (
              <div className="subject-progress" key={item.subject}>
                <span>{item.subject === "语文" ? "语文 · 考背" : item.subject}</span><div className="progress-track"><i className={`fill-${SUBJECT_TONES[item.subject]}`} style={{ width: `${Math.max(12, Math.round(item.count / 45 * 100))}%` }} /></div><strong>{item.count}项</strong>
              </div>
            ))}
          </article>
        </section>

        <aside>
          <SectionHeading title="最近变更" action="变更记录" />
          {auditEntries.length ? auditEntries.slice(0, 3).map((entry) => (
            <article className="change-card" key={entry.id}>
              <div className={`timeline-dot ${entry.tone}`} />
              <div><strong>{entry.title}</strong><p>{entry.detail}</p><small>{entry.actor} · {new Date(entry.occurredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
            </article>
          )) : <article className="change-card empty-change"><div className="timeline-dot green" /><div><strong>暂无变更</strong><p>家教调整计划或保存批改后，会在这里留下记录。</p><small>所有操作均按任务追踪</small></div></article>}
          <Link className="primary-button full setup-link-button" href="/setup">管理孩子与分科家教</Link>
        </aside>
      </div>
    </div>
  );
}

type TutorViewProps = {
  auditEntries: AuditEntry[];
  closeLoopReady: boolean;
  evidence: WorkflowEvidence;
  masteryLevel: ReturnType<typeof deriveMasteryLevel>;
  overrides: Record<string, PlanOverride>;
  planTasks: WorkspaceTask[];
  planRisks: PlanRisk[];
  progress: TaskProgress;
  remoteEnabled: boolean;
  setPlanOpen: (task: WorkspaceTask) => void;
  setReviewOpen: (open: boolean) => void;
  setWorkflowTask: (task: WorkspaceTask) => void;
  workflowTask: WorkspaceTask;
  workflowState: ReturnType<typeof deriveWorkflowState>;
};

function TutorView(props: TutorViewProps) {
  const tutorSubject = props.remoteEnabled ? props.planTasks[0]?.subject ?? props.workflowTask.subject : props.workflowTask.subject;
  const taskAudit = props.auditEntries.filter((entry) => entry.taskId === props.workflowTask.id).slice(0, 3);
  const completedSteps = [
    props.progress.runState === "completed",
    props.progress.reviewSaved,
    !props.evidence.hasErrors || props.progress.correctionPassed,
    !props.progress.redoRequired || props.progress.redoPassed,
    props.progress.masteryConfirmed,
    !props.workflowTask.requiresSubmission || props.progress.schoolSubmitted,
  ].filter(Boolean).length;
  const taskRisk = props.planRisks.find((risk) => risk.taskIds.includes(props.workflowTask.id));

  return (
    <div className="page-content tutor-page">
      <AppHeader
        eyebrow={`${tutorSubject}家教`}
        title="分科工作台"
        subtitle="真实暑期计划 · 仅显示本人负责科目"
        action={<button className="avatar-button" type="button" aria-label={`${tutorSubject}家教账户`}>{tutorSubject.slice(0, 1)}</button>}
      />

      <SummerPlanBrowser
        role="tutor"
        overrides={props.overrides}
        planTasks={props.planTasks}
        onAction={(task) => { props.setWorkflowTask(task); props.setReviewOpen(true); }}
        onPlanChange={(task) => { props.setWorkflowTask(task); props.setPlanOpen(task); }}
      />

      <div className="workflow-section-head"><span>真实任务闭环</span><p>每个任务独立记录，切换学科或日期不会串状态。</p></div>
      <div className="tutor-grid workflow-workspace">
        <section>
          <SectionHeading title="当前任务" />
          <article className="selected-workflow-task">
            <div className="selected-task-title"><StatusPill tone={SUBJECT_TONES[props.workflowTask.subject]}>{props.workflowTask.subject}</StatusPill><span>{formatPlanDate(props.overrides[props.workflowTask.id]?.date ?? props.workflowTask.date)} · {props.workflowTask.slotType}</span></div>
            <h3>{props.workflowTask.title}</h3>
            <dl className="task-facts">
              <div><dt>知识点</dt><dd>{props.workflowTask.knowledge || "待补充"}</dd></div>
              <div><dt>作业要求</dt><dd>{props.workflowTask.answerBasis}</dd></div>
              <div><dt>提交节点</dt><dd>{props.workflowTask.submission}</dd></div>
              <div><dt>答案锁</dt><dd>{ANSWER_POLICY_COPY[props.workflowTask.answerPolicy]}</dd></div>
            </dl>
            <div className="task-card-actions">
              <button className="primary-button" type="button" onClick={() => props.setReviewOpen(true)}>处理批改与确认</button>
              <button className="secondary-button" type="button" onClick={() => props.setPlanOpen(props.workflowTask)}>调整本科计划</button>
            </div>
          </article>

          <SectionHeading title="本任务记录" />
          <div className="task-audit-list">
            {taskAudit.length ? taskAudit.map((entry) => (
              <article key={entry.id}><div className={`timeline-dot ${entry.tone}`} /><div><strong>{entry.title}</strong><p>{entry.detail}</p><small>{entry.actor} · {new Date(entry.occurredAt).toLocaleString("zh-CN")}</small></div></article>
            )) : <div className="empty-audit"><span>留</span><div><strong>尚无操作记录</strong><p>批改、提交确认和计划变更会自动留痕。</p></div></div>}
          </div>
        </section>

        <aside className="closure-column">
          <SectionHeading title="闭环状态" />
          <article className="closure-card">
            <div className="closure-head"><div><span>{props.workflowTask.subject} · {props.workflowTask.title}</span><strong>{closeLoopReadyLabel(props.closeLoopReady)}</strong></div><span className="closure-score">{completedSteps}/6</span></div>
            <StatusTrack label="作业流程" value={WORKFLOW_COPY[props.workflowState]} tone={props.workflowState === "closed_loop" ? "green" : "blue"} detail={props.progress.reviewSaved ? "批改记录已保存" : props.progress.runState === "completed" ? "等待家教批改" : "等待孩子独立完成"} />
            <StatusTrack label="知识掌握" value={MASTERY_COPY[props.masteryLevel].label} tone={MASTERY_COPY[props.masteryLevel].tone} detail="订正与复做证据单独判断" />
            <StatusTrack label="学校提交" value={!props.workflowTask.requiresSubmission ? "无需提交" : props.progress.schoolSubmitted ? "已确认" : "待确认"} tone={!props.workflowTask.requiresSubmission || props.progress.schoolSubmitted ? "green" : "orange"} detail={!props.workflowTask.requiresSubmission ? "本任务无学校平台提交要求" : props.progress.schoolSubmittedAt ? `确认于 ${new Date(props.progress.schoolSubmittedAt).toLocaleString("zh-CN")}` : "不在本系统上传，只做提交标记"} />
            <button className="primary-button full" type="button" onClick={() => props.setReviewOpen(true)}>继续处理闭环</button>
          </article>

          <SectionHeading title="答案与风险" />
          <article className="deadline-card"><span className="date-tile"><strong>{taskRisk ? "!" : props.workflowTask.subject.slice(0, 1)}</strong><small>{taskRisk ? "风险" : "规则"}</small></span><div><strong>{taskRisk?.title ?? ANSWER_POLICY_COPY[props.workflowTask.answerPolicy]}</strong><p>{taskRisk?.detail ?? (props.workflowTask.notes || props.workflowTask.submission)}</p></div></article>
        </aside>
      </div>
    </div>
  );
}

function closeLoopReadyLabel(ready: boolean) {
  return ready ? "闭环已完成" : "还有步骤待确认";
}

function StatusTrack({ label, value, tone, detail }: { label: string; value: string; tone: string; detail: string }) {
  return <div className="status-track"><i className={`track-dot tone-${tone}`} /><div><span>{label}</span><small>{detail}</small></div><strong className={`text-${tone}`}>{value}</strong></div>;
}

type StudentViewProps = {
  overrides: Record<string, PlanOverride>;
  planTasks: WorkspaceTask[];
  progress: Record<string, TaskProgress>;
  setWorkflowTask: (task: WorkspaceTask) => void;
  showToast: (message: string) => void;
  updateTaskProgress: (taskId: string, patch: Partial<TaskProgress>, persistActivity?: boolean) => void;
};

function StudentView({ overrides, planTasks, progress, setWorkflowTask, showToast, updateTaskProgress }: StudentViewProps) {
  const todayTasks = planTasks.filter((task) => (overrides[task.id]?.date ?? task.date) === PLAN_REFERENCE_DATE);
  const [focusTask, setFocusTask] = useState<WorkspaceTask>(() => todayTasks[0] ?? SUMMER_PLAN.tasks[0]);
  const focusProgress = progress[focusTask.id] ?? blankTaskProgress();
  const masteryLevel = deriveMasteryLevel(evidenceFor(focusProgress, focusTask.requiresSubmission));
  const runState = focusProgress.runState;
  const nextTask = todayTasks.find((task) => task.id !== focusTask.id) ?? planTasks.find((task) => (overrides[task.id]?.date ?? task.date) > PLAN_REFERENCE_DATE) ?? planTasks[1] ?? SUMMER_PLAN.tasks[1];
  const buttonCopy = { ready: "开始做题", running: "暂停", paused: "继续", completed: "已完成" }[runState];
  function handleMainAction() {
    if (runState === "ready" || runState === "paused") updateTaskProgress(focusTask.id, { runState: "running" }, true);
    else if (runState === "running") updateTaskProgress(focusTask.id, { runState: "paused" }, true);
  }
  return (
    <div className="page-content student-page">
      <AppHeader eyebrow="我的学习" title="今天" subtitle={`${todayTasks.length}个任务块 · 共${todayTasks.length * 90}分钟`} action={<button className="avatar-button" type="button" aria-label="孩子账户">学</button>} />
      <SummerPlanBrowser role="student" overrides={overrides} planTasks={planTasks} onAction={(task) => { setFocusTask(task); setWorkflowTask(task); showToast(`已切换到：${task.subject} · ${task.title}`); }} />
      <div className="student-grid">
        <section className="focus-task">
          <div className="focus-top"><StatusPill tone={SUBJECT_TONES[focusTask.subject]}>{focusTask.subject === "语文" ? "语文·考背" : focusTask.subject}</StatusPill><span>标准 {focusTask.blockMinutes} 分钟</span></div>
          <p className="task-kicker">当前任务</p>
          <h2>{focusTask.title}</h2>
          <p>{focusTask.knowledge || "按任务要求独立完成"}<br />{ANSWER_POLICY_COPY[focusTask.answerPolicy]}。</p>
          <div className={`study-orb state-${runState}`}><span>{runState === "running" ? "进行中" : runState === "paused" ? "已暂停" : runState === "completed" ? "完成" : "准备好"}</span><strong>{runState === "running" ? "32:18" : "90"}</strong><small>{runState === "running" ? "已学习" : "分钟"}</small></div>
          <div className="student-actions">
            <button type="button" className="primary-button" disabled={runState === "completed"} onClick={handleMainAction}>{buttonCopy}</button>
            <button type="button" className="secondary-button" disabled={runState === "ready" || runState === "completed"} onClick={() => { updateTaskProgress(focusTask.id, { runState: "completed" }, true); showToast("任务已完成，家教会看到待批改提醒"); }}>我已完成</button>
          </div>
        </section>

        <aside>
          <SectionHeading title="遇到困难" />
          <article className="unknown-card">
            <label htmlFor="student-unknown">不会的题号</label>
            <div><input id="student-unknown" value={focusProgress.unknown} onChange={(event) => updateTaskProgress(focusTask.id, { unknown: event.target.value })} placeholder="例如 3、7、12(2)" /><button type="button" onClick={() => { updateTaskProgress(focusTask.id, { unknown: normalizeQuestionNumbers(focusProgress.unknown) }, true); showToast("不会题号已记录"); }}>记录</button></div>
            <p>家教批改时会优先看到这些题。</p>
          </article>
          <SectionHeading title="我的点亮" />
          <article className="knowledge-summary">
            <div><strong>{focusTask.knowledgeTags[0] || focusTask.subject}</strong><StatusPill tone={MASTERY_COPY[masteryLevel].tone}>{MASTERY_COPY[masteryLevel].label}</StatusPill></div>
            <div className="progress-track"><i style={{ width: "58%" }} /></div>
            <p>完成首做后进入家教批改；订正与独立复做通过才点亮。</p>
          </article>
          <SectionHeading title="下一项" />
          <article className="next-task"><MiniIcon>{nextTask.subject.slice(0, 1)}</MiniIcon><div><strong>{nextTask.title}</strong><p>{nextTask.subject} · {nextTask.slotType} · 90分钟</p></div><span>›</span></article>
        </aside>
      </div>
    </div>
  );
}

type ReviewPanelProps = {
  closeLoopReady: boolean;
  masteryLevel: ReturnType<typeof deriveMasteryLevel>;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  progress: TaskProgress;
  setProgress: (patch: Partial<TaskProgress>) => void;
  toggleErrorTag: (tag: string) => void;
  task: WorkspaceTask;
  workflowState: ReturnType<typeof deriveWorkflowState>;
};

function ReviewPanel(props: ReviewPanelProps) {
  const hasErrors = props.progress.accuracy !== "100%" && normalizeQuestionNumbers(props.progress.wrongNumbers).length > 0;
  const canConfirmMastery = props.progress.reviewSaved
    && (!hasErrors || props.progress.correctionPassed)
    && (!props.progress.redoRequired || props.progress.redoPassed);
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="side-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header className="sheet-header"><div><p>{props.task.subject} · {props.task.slotType}</p><h2 id="review-title">{props.task.title}</h2></div><button type="button" onClick={props.onClose} aria-label="关闭批改面板">×</button></header>

        <div className="review-task-context"><p><strong>知识点</strong>{props.task.knowledge || "待补充"}</p><p><strong>答案规则</strong>{ANSWER_POLICY_COPY[props.task.answerPolicy]}</p><p><strong>提交标记</strong>{props.task.submission}</p></div>

        <div className="triple-track">
          <StatusTrack label="作业流程" value={WORKFLOW_COPY[props.workflowState]} tone={props.workflowState === "closed_loop" ? "green" : "blue"} detail="练习与订正" />
          <StatusTrack label="知识掌握" value={MASTERY_COPY[props.masteryLevel].label} tone={MASTERY_COPY[props.masteryLevel].tone} detail="证据单独判断" />
          <StatusTrack label="学校提交" value={!props.task.requiresSubmission ? "无需提交" : props.progress.schoolSubmitted ? "已确认" : "待确认"} tone={!props.task.requiresSubmission || props.progress.schoolSubmitted ? "green" : "orange"} detail="外部平台标记" />
        </div>

        <form className="review-form" onSubmit={(event) => { event.preventDefault(); void props.onSave(); }}>
          <fieldset><legend><span>1</span>正确率</legend><div className="choice-row">{["100%", "90%以上", "70%—89%", "70%以下"].map((item) => <label key={item} className={props.progress.accuracy === item ? "choice-chip selected" : "choice-chip"}><input type="radio" name="accuracy" checked={props.progress.accuracy === item} onChange={() => props.setProgress({ accuracy: item })} />{item}</label>)}</div></fieldset>
          <fieldset><legend><span>2</span>错题号</legend><input className="line-input" value={props.progress.wrongNumbers} onChange={(event) => props.setProgress({ wrongNumbers: event.target.value })} placeholder="例如 3、7、12(2)" /><small>支持顿号、逗号或空格分隔</small></fieldset>
          <fieldset><legend><span>3</span>错误类型</legend><div className="choice-row">{ERROR_TAGS.map((tag) => <label key={tag} className={props.progress.errorTags.includes(tag) ? "choice-chip selected" : "choice-chip"}><input type="checkbox" checked={props.progress.errorTags.includes(tag)} onChange={() => props.toggleErrorTag(tag)} />{tag}</label>)}</div></fieldset>
          <fieldset><legend><span>4</span>订正与复做</legend><div className="check-stack"><label><input type="checkbox" checked={props.progress.correctionPassed} onChange={(event) => props.setProgress({ correctionPassed: event.target.checked })} /><span><strong>订正已通过</strong><small>孩子已改对全部必改错题</small></span></label><label><input type="checkbox" checked={props.progress.redoRequired} onChange={(event) => props.setProgress({ redoRequired: event.target.checked, redoPassed: event.target.checked ? props.progress.redoPassed : false })} /><span><strong>要求独立复做</strong><small>不查看原答案再次完成</small></span></label><label className={!props.progress.redoRequired ? "disabled" : ""}><input type="checkbox" disabled={!props.progress.redoRequired} checked={props.progress.redoPassed} onChange={(event) => props.setProgress({ redoPassed: event.target.checked })} /><span><strong>独立复做已通过</strong><small>通过后才可点亮“已掌握”</small></span></label></div></fieldset>
          <fieldset><legend><span>5</span>双确认</legend><div className="confirmation-grid"><label className={props.progress.reviewConfirmed ? "confirm-box checked" : "confirm-box"}><input type="checkbox" checked={props.progress.reviewConfirmed} onChange={(event) => props.setProgress({ reviewConfirmed: event.target.checked, reviewConfirmedAt: event.target.checked ? new Date().toISOString() : undefined })} /><span className="check-mark">✓</span><span><strong>已完成批改</strong><small>{props.progress.reviewConfirmedAt ? `确认于 ${new Date(props.progress.reviewConfirmedAt).toLocaleString("zh-CN")}` : "必选 · 单独记录时间"}</small></span></label><label className={props.progress.schoolSubmitted ? "confirm-box checked green" : !props.task.requiresSubmission ? "confirm-box disabled" : "confirm-box"}><input type="checkbox" disabled={!props.task.requiresSubmission} checked={props.progress.schoolSubmitted} onChange={(event) => props.setProgress({ schoolSubmitted: event.target.checked, schoolSubmittedAt: event.target.checked ? new Date().toISOString() : undefined })} /><span className="check-mark">✓</span><span><strong>{props.task.requiresSubmission ? "已在学校平台提交" : "无需学校平台提交"}</strong><small>{!props.task.requiresSubmission ? "按作业本体规则自动判定" : props.progress.schoolSubmittedAt ? `确认于 ${new Date(props.progress.schoolSubmittedAt).toLocaleString("zh-CN")}` : "本系统只做标记"}</small></span></label></div></fieldset>
          <label className={props.progress.masteryConfirmed ? "mastery-confirm checked" : canConfirmMastery ? "mastery-confirm" : "mastery-confirm disabled"}><input type="checkbox" disabled={!canConfirmMastery} checked={props.progress.masteryConfirmed} onChange={(event) => props.setProgress({ masteryConfirmed: event.target.checked })} /><span><strong>确认本次掌握等级</strong><small>{canConfirmMastery ? "订正与复做证据已满足" : "先保存批改，并完成必要的订正与复做"}</small></span><StatusPill tone={MASTERY_COPY[props.masteryLevel].tone}>{MASTERY_COPY[props.masteryLevel].label}</StatusPill></label>
          <button className={props.closeLoopReady ? "primary-button full success-button" : "primary-button full"} type="submit">{props.progress.reviewSaved ? props.closeLoopReady ? "闭环已完成" : "更新批改记录" : "保存批改"}</button>
        </form>
      </section>
    </div>
  );
}

function PlanPanel({ onClose, onSave, overrides, planDate, planReason, setPlanDate, setPlanReason, task, tasks }: { onClose: () => void; onSave: () => void | Promise<void>; overrides: Record<string, PlanOverride>; planDate: string; planReason: string; setPlanDate: (date: string) => void; setPlanReason: (reason: string) => void; task: WorkspaceTask; tasks: WorkspaceTask[] }) {
  const currentDate = overrides[task.id]?.date ?? task.date;
  const choices = [...new Set([-2, -1, 0, 1, 2, 4].map((amount) => clampPlanDate(addPlanDays(currentDate, amount))))];
  const targetCount = tasks.filter((candidate) => candidate.id !== task.id && (overrides[candidate.id]?.date ?? candidate.date) === planDate).length + 1;
  const afterDeadline = Boolean(task.deadlineDate && planDate > task.deadlineDate);
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mini-sheet" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <header className="sheet-header"><div><p>{task.subject}家教 · 调整本科计划</p><h2 id="plan-title">{task.title}</h2></div><button type="button" onClick={onClose} aria-label="关闭计划面板">×</button></header>
        <div className="plan-summary"><span>90分钟</span><p>原始日期：{formatPlanDate(task.date)}<br />当前日期：{formatPlanDate(currentDate)}</p></div>
        <fieldset><legend>移动到</legend><div className="date-choice-row">{choices.map((date) => { const [, month, day] = date.split("-").map(Number); return <label className={planDate === date ? "selected" : ""} key={date}><input type="radio" name="plan-date" checked={planDate === date} onChange={() => setPlanDate(date)} /><small>{month}月</small><strong>{day}</strong></label>; })}</div></fieldset>
        <fieldset><legend>变更原因</legend><select value={planReason} onChange={(event) => setPlanReason(event.target.value)}><option>课程冲突</option><option>孩子未完成</option><option>难度超预期</option><option>学校截止变化</option><option>其他</option></select></fieldset>
        {isOverDailyCapacity(targetCount, 2) || afterDeadline ? <div className="risk-notice compact"><MiniIcon>!</MiniIcon><div><strong>{afterDeadline ? "新日期晚于学校截止" : `${formatPlanDate(planDate)}将有 ${targetCount} 个任务块`}</strong><p>{afterDeadline ? `截止为 ${task.deadlineDate}；如仍需保存，必须保留变更原因。` : "超过家庭默认每日2块容量，可强制保留并记录原因。"}</p></div></div> : null}
        <button className="primary-button full" type="button" onClick={() => void onSave()}>确认调整</button>
      </section>
    </div>
  );
}
