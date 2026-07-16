"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ERROR_TAGS,
  MASTERY_COPY,
  PARENT_ATTENTION,
  ROLE_COPY,
  TUTOR_TASKS,
  WEEK_DAYS,
  type CalendarMode,
  type PlanTask,
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

type StudentRunState = "ready" | "running" | "paused" | "completed";

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

export function HomeworkPlatform() {
  const [role, setRole] = useState<Role>("tutor");
  const [activeNav, setActiveNav] = useState<Record<Role, string>>({ parent: "总览", tutor: "日历", student: "今天" });
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("week");
  const [selectedDay, setSelectedDay] = useState(21);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [studentRunState, setStudentRunState] = useState<StudentRunState>("ready");
  const [studentUnknown, setStudentUnknown] = useState("");
  const [accuracy, setAccuracy] = useState("70%—89%");
  const [wrongNumbers, setWrongNumbers] = useState("7、12");
  const [errorTags, setErrorTags] = useState<string[]>(["计算错误"]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [correctionPassed, setCorrectionPassed] = useState(false);
  const [redoRequired, setRedoRequired] = useState(true);
  const [redoPassed, setRedoPassed] = useState(false);
  const [masteryConfirmed, setMasteryConfirmed] = useState(false);
  const [schoolSubmitted, setSchoolSubmitted] = useState(false);
  const [planDate, setPlanDate] = useState(23);
  const [planReason, setPlanReason] = useState("课程冲突");

  const evidence: WorkflowEvidence = useMemo(() => ({
    started: true,
    studentCompleted: true,
    reviewSaved,
    hasErrors: accuracy !== "100%" && normalizeQuestionNumbers(wrongNumbers).length > 0,
    correctionPassed,
    redoRequired,
    redoPassed,
    masteryConfirmed,
    requiredSubmissionConfirmed: schoolSubmitted,
  }), [accuracy, correctionPassed, masteryConfirmed, redoPassed, redoRequired, reviewSaved, schoolSubmitted, wrongNumbers]);

  const workflowState = deriveWorkflowState(evidence);
  const masteryLevel = deriveMasteryLevel(evidence);
  const closeLoopReady = canCloseLoop(evidence);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    setReviewOpen(false);
    setPlanOpen(false);
  }

  function toggleErrorTag(tag: string) {
    setErrorTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  function saveReview() {
    if (!reviewConfirmed) {
      showToast("请先勾选“已完成批改”");
      return;
    }
    if (accuracy !== "100%" && !normalizeQuestionNumbers(wrongNumbers)) {
      showToast("请填写错题号");
      return;
    }
    setWrongNumbers(normalizeQuestionNumbers(wrongNumbers));
    setReviewSaved(true);
    showToast("批改已保存，等待订正与复做");
  }

  function savePlanChange() {
    setSelectedDay(planDate);
    setPlanOpen(false);
    showToast(`已调整到 7月${planDate}日 · ${planReason}`);
  }

  return (
    <div className="app-frame">
      <aside className="side-rail" aria-label="开发预览角色切换">
        <div className="brand-lockup">
          <span className="brand-mark">闭</span>
          <div><strong>学业闭环</strong><small>暑假作业系统</small></div>
        </div>

        <div className="rail-section">
          <p className="rail-label">开发预览 · 角色</p>
          <div className="role-switcher">
            {(Object.keys(ROLE_COPY) as Role[]).map((item) => (
              <button
                key={item}
                type="button"
                className={role === item ? "role-option active" : "role-option"}
                onClick={() => changeRole(item)}
                aria-pressed={role === item}
              >
                <span>{ROLE_COPY[item].glyph}</span>
                <div><strong>{ROLE_COPY[item].label}</strong><small>{ROLE_COPY[item].note}</small></div>
              </button>
            ))}
          </div>
        </div>

        <div className="rail-progress">
          <div className="rail-progress-top"><span>本周闭环</span><strong>68%</strong></div>
          <div className="progress-track"><i style={{ width: "68%" }} /></div>
          <p>14 个任务块 · 2 项待关注</p>
        </div>

        <div className="rail-footer">
          <MiniIcon>同</MiniIcon>
          <div><strong>状态实时同步</strong><small>最后更新：刚刚</small></div>
        </div>
        <Link className="account-link" href="/login">进入账号登录</Link>
      </aside>

      <main className="main-shell">
        <div className="mobile-role-bar">
          {(Object.keys(ROLE_COPY) as Role[]).map((item) => (
            <button key={item} className={role === item ? "active" : ""} onClick={() => changeRole(item)} type="button">
              {ROLE_COPY[item].label}
            </button>
          ))}
        </div>

        {role === "parent" ? <ParentView schoolSubmitted={schoolSubmitted} showToast={showToast} /> : null}
        {role === "tutor" ? (
          <TutorView
            calendarMode={calendarMode}
            closeLoopReady={closeLoopReady}
            evidence={evidence}
            masteryLevel={masteryLevel}
            schoolSubmitted={schoolSubmitted}
            selectedDay={selectedDay}
            setCalendarMode={setCalendarMode}
            setPlanOpen={setPlanOpen}
            setReviewOpen={setReviewOpen}
            setSelectedDay={setSelectedDay}
            workflowState={workflowState}
          />
        ) : null}
        {role === "student" ? (
          <StudentView
            masteryLevel={masteryLevel}
            runState={studentRunState}
            setRunState={setStudentRunState}
            setUnknown={setStudentUnknown}
            showToast={showToast}
            unknown={studentUnknown}
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
          accuracy={accuracy}
          closeLoopReady={closeLoopReady}
          correctionPassed={correctionPassed}
          errorTags={errorTags}
          masteryConfirmed={masteryConfirmed}
          masteryLevel={masteryLevel}
          onClose={() => setReviewOpen(false)}
          onSave={saveReview}
          redoPassed={redoPassed}
          redoRequired={redoRequired}
          reviewConfirmed={reviewConfirmed}
          reviewSaved={reviewSaved}
          schoolSubmitted={schoolSubmitted}
          setAccuracy={setAccuracy}
          setCorrectionPassed={setCorrectionPassed}
          setMasteryConfirmed={setMasteryConfirmed}
          setRedoPassed={setRedoPassed}
          setRedoRequired={setRedoRequired}
          setReviewConfirmed={setReviewConfirmed}
          setSchoolSubmitted={setSchoolSubmitted}
          setWrongNumbers={setWrongNumbers}
          toggleErrorTag={toggleErrorTag}
          workflowState={workflowState}
          wrongNumbers={wrongNumbers}
        />
      ) : null}

      {planOpen ? (
        <PlanPanel
          onClose={() => setPlanOpen(false)}
          onSave={savePlanChange}
          planDate={planDate}
          planReason={planReason}
          setPlanDate={setPlanDate}
          setPlanReason={setPlanReason}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function ParentView({ schoolSubmitted, showToast }: { schoolSubmitted: boolean; showToast: (message: string) => void }) {
  return (
    <div className="page-content parent-page">
      <AppHeader
        eyebrow="家长管理员"
        title="学习总览"
        subtitle="全部科目 · 7月20日—26日"
        action={<button className="avatar-button" type="button" aria-label="家长账户">家</button>}
      />

      <section className="metric-grid" aria-label="本周概况">
        <article className="metric-card"><span>任务块</span><strong>14</strong><small>已完成 9 个</small></article>
        <article className="metric-card risk"><span>截止风险</span><strong>2</strong><small>语文、化学</small></article>
        <article className="metric-card success"><span>知识点亮</span><strong>68%</strong><small>本周新增 7 个</small></article>
        <article className="metric-card"><span>学校提交</span><strong>{schoolSubmitted ? "6/6" : "5/6"}</strong><small>{schoolSubmitted ? "全部已确认" : "1 项待确认"}</small></article>
      </section>

      <div className="content-columns">
        <section>
          <SectionHeading title="需要关注" action="查看全部" />
          <div className="attention-list">
            {PARENT_ATTENTION.map((item) => (
              <article className="attention-card" key={item.title}>
                <MiniIcon>{item.subject.slice(0, 1)}</MiniIcon>
                <div><div className="card-title-row"><h3>{item.title}</h3><StatusPill tone={item.tone}>{item.subject}</StatusPill></div><p>{item.detail}</p></div>
                <button type="button" aria-label={`查看${item.title}`}>›</button>
              </article>
            ))}
          </div>

          <SectionHeading title="本周进度" />
          <article className="subject-progress-card">
            {[{ name: "数学", value: 72, tone: "blue" }, { name: "物理", value: 61, tone: "purple" }, { name: "语文 · 考背", value: 48, tone: "orange" }, { name: "生物", value: 84, tone: "green" }].map((item) => (
              <div className="subject-progress" key={item.name}>
                <span>{item.name}</span><div className="progress-track"><i className={`fill-${item.tone}`} style={{ width: `${item.value}%` }} /></div><strong>{item.value}%</strong>
              </div>
            ))}
          </article>
        </section>

        <aside>
          <SectionHeading title="最近变更" action="变更记录" />
          <article className="change-card">
            <div className="timeline-dot blue" />
            <div><strong>数学计划已调整</strong><p>作业1（2）移动到 7月23日</p><small>数学家教 · 12分钟前</small></div>
          </article>
          <article className="change-card">
            <div className="timeline-dot orange" />
            <div><strong>语文增加自主任务</strong><p>第三套综合卷提前启动</p><small>语文家教 · 昨天</small></div>
          </article>
          <button className="primary-button full" type="button" onClick={() => showToast("录入作业表单已纳入阶段2")}>＋ 录入新作业</button>
        </aside>
      </div>
    </div>
  );
}

type TutorViewProps = {
  calendarMode: CalendarMode;
  closeLoopReady: boolean;
  evidence: WorkflowEvidence;
  masteryLevel: ReturnType<typeof deriveMasteryLevel>;
  schoolSubmitted: boolean;
  selectedDay: number;
  setCalendarMode: (mode: CalendarMode) => void;
  setPlanOpen: (open: boolean) => void;
  setReviewOpen: (open: boolean) => void;
  setSelectedDay: (day: number) => void;
  workflowState: ReturnType<typeof deriveWorkflowState>;
};

function TutorView(props: TutorViewProps) {
  const taskCount = WEEK_DAYS.find((item) => item.day === props.selectedDay)?.count ?? 0;
  const tasks = props.selectedDay === 21 ? TUTOR_TASKS : props.selectedDay === 23 ? [TUTOR_TASKS[1], { ...TUTOR_TASKS[0], id: "redo", title: "数量积与夹角 · 独立复做", scope: "错题 7、12 · 不查看原答案", status: "待订正" as const, tone: "orange" as const }] : [];

  return (
    <div className="page-content tutor-page">
      <AppHeader
        eyebrow="数学家教"
        title="本周"
        subtitle="7月20日—26日 · 6个任务块"
        action={<button className="avatar-button" type="button" aria-label="数学家教账户">数</button>}
      />

      <div className="segment-control" aria-label="日历视图">
        {(["week", "month", "changes"] as CalendarMode[]).map((mode) => (
          <button key={mode} className={props.calendarMode === mode ? "active" : ""} onClick={() => props.setCalendarMode(mode)} type="button">
            {{ week: "周", month: "月", changes: "变更" }[mode]}
          </button>
        ))}
      </div>

      {props.calendarMode === "week" ? (
        <>
          <div className="week-strip" aria-label="7月20日至26日">
            {WEEK_DAYS.map((item) => (
              <button
                key={item.day}
                className={props.selectedDay === item.day ? "day-button active" : "day-button"}
                type="button"
                onClick={() => props.setSelectedDay(item.day)}
                aria-pressed={props.selectedDay === item.day}
              >
                <span>{item.weekday}</span><strong>{item.day}</strong>
                <i className={item.risk ? "count-dot risk" : "count-dot"}>{item.count || ""}</i>
              </button>
            ))}
          </div>

          <div className="tutor-grid">
            <section>
              <SectionHeading title={`7月${props.selectedDay}日 · ${taskCount}个任务块`} action="调整计划" />
              {tasks.length ? tasks.map((task) => (
                <TutorTask
                  key={task.id}
                  task={task}
                  workflowState={task.id === "vector-review" ? props.workflowState : undefined}
                  onAction={() => task.id === "vector-review" ? props.setReviewOpen(true) : props.setPlanOpen(true)}
                />
              )) : (
                <div className="empty-day"><span>✓</span><h3>这一天没有安排</h3><p>可以从其他日期移动一个 90 分钟任务块。</p><button type="button" onClick={() => props.setPlanOpen(true)}>安排任务</button></div>
              )}
              {isOverDailyCapacity(taskCount) ? <div className="risk-notice"><MiniIcon>!</MiniIcon><div><strong>当天负荷偏高</strong><p>已安排 {taskCount} 个任务块，默认容量为 2 个。</p></div></div> : null}
            </section>

            <aside className="closure-column">
              <SectionHeading title="闭环状态" />
              <article className="closure-card">
                <div className="closure-head"><div><span>平面向量 · 作业1</span><strong>{closeLoopReadyLabel(props.closeLoopReady)}</strong></div><span className="closure-score">3/6</span></div>
                <StatusTrack label="作业流程" value={WORKFLOW_COPY[props.workflowState]} tone={props.workflowState === "closed_loop" ? "green" : "blue"} detail={props.evidence.reviewSaved ? "批改记录已保存" : "等待家教批改"} />
                <StatusTrack label="知识掌握" value={MASTERY_COPY[props.masteryLevel].label} tone={MASTERY_COPY[props.masteryLevel].tone} detail="证据独立计算" />
                <StatusTrack label="学校提交" value={props.schoolSubmitted ? "已确认" : "待确认"} tone={props.schoolSubmitted ? "green" : "orange"} detail="不会改变知识等级" />
                <button className="primary-button full" type="button" onClick={() => props.setReviewOpen(true)}>继续处理闭环</button>
              </article>

              <SectionHeading title="截止提醒" />
              <article className="deadline-card"><span className="date-tile"><strong>25</strong><small>7月</small></span><div><strong>作业1首次提交</strong><p>周六 21:00 前 · 还剩 4 天</p></div></article>
            </aside>
          </div>
        </>
      ) : null}

      {props.calendarMode === "month" ? <MonthOverview onSelect={props.setSelectedDay} /> : null}
      {props.calendarMode === "changes" ? <ChangeLog /> : null}
    </div>
  );
}

function closeLoopReadyLabel(ready: boolean) {
  return ready ? "闭环已完成" : "还有步骤待确认";
}

function TutorTask({ task, onAction, workflowState }: { task: PlanTask; onAction: () => void; workflowState?: ReturnType<typeof deriveWorkflowState> }) {
  const status = workflowState ? WORKFLOW_COPY[workflowState] : task.status;
  return (
    <article className="task-card">
      <div className="task-card-top"><StatusPill tone={task.tone}>{status}</StatusPill><span className="duration">90分钟</span></div>
      <h3>{task.title}</h3>
      <p>{task.scope}</p>
      {task.unknown ? <div className="unknown-line"><span>不会题号</span><strong>{task.unknown}</strong></div> : null}
      {task.due ? <p className="due-line">学校截止 {task.due}</p> : null}
      <button className={task.status === "待批改" ? "primary-button full" : "secondary-button full"} type="button" onClick={onAction}>
        {task.status === "待批改" ? "开始批改" : "调整日期"}
      </button>
    </article>
  );
}

function StatusTrack({ label, value, tone, detail }: { label: string; value: string; tone: string; detail: string }) {
  return <div className="status-track"><i className={`track-dot tone-${tone}`} /><div><span>{label}</span><small>{detail}</small></div><strong className={`text-${tone}`}>{value}</strong></div>;
}

function MonthOverview({ onSelect }: { onSelect: (day: number) => void }) {
  return (
    <section className="month-card">
      <div className="month-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="month-grid">
        {[...Array.from({ length: 19 }, (_, index) => index + 1), ...WEEK_DAYS.map((item) => item.day), 27, 28, 29, 30, 31].map((day) => {
          const item = WEEK_DAYS.find((candidate) => candidate.day === day);
          return <button key={day} type="button" onClick={() => onSelect(day)} className={item?.risk ? "has-risk" : item?.count ? "has-task" : ""}><span>{day}</span>{item?.count ? <i>{item.count}</i> : null}</button>;
        })}
      </div>
    </section>
  );
}

function ChangeLog() {
  return (
    <section className="change-log">
      <article><div className="timeline-dot blue" /><div><span>今天 12:18</span><h3>作业1（2）移动到 7月23日</h3><p>原因：课程冲突 · 操作人：数学家教</p></div></article>
      <article><div className="timeline-dot orange" /><div><span>昨天 18:42</span><h3>增加“数量积与夹角”独立复做</h3><p>原因：错题复现 · 操作人：数学家教</p></div></article>
      <article><div className="timeline-dot green" /><div><span>7月18日 09:10</span><h3>学校截止调整为 7月25日 21:00</h3><p>操作人：家长管理员</p></div></article>
    </section>
  );
}

type StudentViewProps = {
  masteryLevel: ReturnType<typeof deriveMasteryLevel>;
  runState: StudentRunState;
  setRunState: (state: StudentRunState) => void;
  setUnknown: (value: string) => void;
  showToast: (message: string) => void;
  unknown: string;
};

function StudentView({ masteryLevel, runState, setRunState, setUnknown, showToast, unknown }: StudentViewProps) {
  const buttonCopy = { ready: "开始做题", running: "暂停", paused: "继续", completed: "已完成" }[runState];
  function handleMainAction() {
    if (runState === "ready" || runState === "paused") setRunState("running");
    else if (runState === "running") setRunState("paused");
  }
  return (
    <div className="page-content student-page">
      <AppHeader eyebrow="我的学习" title="今天" subtitle="2个任务块 · 共180分钟" action={<button className="avatar-button" type="button" aria-label="孩子账户">学</button>} />
      <div className="student-grid">
        <section className="focus-task">
          <div className="focus-top"><StatusPill tone="blue">数学</StatusPill><span>90分钟</span></div>
          <p className="task-kicker">当前任务</p>
          <h2>平面向量 · 作业1（2）</h2>
          <p>题号 1—19<br />先独立完成，不查看答案。</p>
          <div className={`study-orb state-${runState}`}><span>{runState === "running" ? "进行中" : runState === "paused" ? "已暂停" : runState === "completed" ? "完成" : "准备好"}</span><strong>{runState === "running" ? "32:18" : "90"}</strong><small>{runState === "running" ? "已学习" : "分钟"}</small></div>
          <div className="student-actions">
            <button type="button" className="primary-button" disabled={runState === "completed"} onClick={handleMainAction}>{buttonCopy}</button>
            <button type="button" className="secondary-button" disabled={runState === "ready" || runState === "completed"} onClick={() => { setRunState("completed"); showToast("任务已完成，家教会看到待批改提醒"); }}>我已完成</button>
          </div>
        </section>

        <aside>
          <SectionHeading title="遇到困难" />
          <article className="unknown-card">
            <label htmlFor="student-unknown">不会的题号</label>
            <div><input id="student-unknown" value={unknown} onChange={(event) => setUnknown(event.target.value)} placeholder="例如 3、7、12(2)" /><button type="button" onClick={() => { setUnknown(normalizeQuestionNumbers(unknown)); showToast("不会题号已记录"); }}>记录</button></div>
            <p>家教批改时会优先看到这些题。</p>
          </article>
          <SectionHeading title="我的点亮" />
          <article className="knowledge-summary">
            <div><strong>平面向量</strong><StatusPill tone={MASTERY_COPY[masteryLevel].tone}>{MASTERY_COPY[masteryLevel].label}</StatusPill></div>
            <div className="progress-track"><i style={{ width: "58%" }} /></div>
            <p>3 个已掌握 · 2 个还要再练一次</p>
          </article>
          <SectionHeading title="下一项" />
          <article className="next-task"><MiniIcon>生</MiniIcon><div><strong>第一章综合测试</strong><p>生物 · 选择题 · 90分钟</p></div><span>›</span></article>
        </aside>
      </div>
    </div>
  );
}

type ReviewPanelProps = {
  accuracy: string;
  closeLoopReady: boolean;
  correctionPassed: boolean;
  errorTags: string[];
  masteryConfirmed: boolean;
  masteryLevel: ReturnType<typeof deriveMasteryLevel>;
  onClose: () => void;
  onSave: () => void;
  redoPassed: boolean;
  redoRequired: boolean;
  reviewConfirmed: boolean;
  reviewSaved: boolean;
  schoolSubmitted: boolean;
  setAccuracy: (value: string) => void;
  setCorrectionPassed: (value: boolean) => void;
  setMasteryConfirmed: (value: boolean) => void;
  setRedoPassed: (value: boolean) => void;
  setRedoRequired: (value: boolean) => void;
  setReviewConfirmed: (value: boolean) => void;
  setSchoolSubmitted: (value: boolean) => void;
  setWrongNumbers: (value: string) => void;
  toggleErrorTag: (tag: string) => void;
  workflowState: ReturnType<typeof deriveWorkflowState>;
  wrongNumbers: string;
};

function ReviewPanel(props: ReviewPanelProps) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="side-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header className="sheet-header"><div><p>数学 · 待批改</p><h2 id="review-title">平面向量 · 作业1（1）</h2></div><button type="button" onClick={props.onClose} aria-label="关闭批改面板">×</button></header>

        <div className="triple-track">
          <StatusTrack label="作业流程" value={WORKFLOW_COPY[props.workflowState]} tone={props.workflowState === "closed_loop" ? "green" : "blue"} detail="练习与订正" />
          <StatusTrack label="知识掌握" value={MASTERY_COPY[props.masteryLevel].label} tone={MASTERY_COPY[props.masteryLevel].tone} detail="证据单独判断" />
          <StatusTrack label="学校提交" value={props.schoolSubmitted ? "已确认" : "待确认"} tone={props.schoolSubmitted ? "green" : "orange"} detail="外部平台标记" />
        </div>

        <form className="review-form" onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
          <fieldset><legend><span>1</span>正确率</legend><div className="choice-row">{["100%", "90%以上", "70%—89%", "70%以下"].map((item) => <label key={item} className={props.accuracy === item ? "choice-chip selected" : "choice-chip"}><input type="radio" name="accuracy" checked={props.accuracy === item} onChange={() => props.setAccuracy(item)} />{item}</label>)}</div></fieldset>
          <fieldset><legend><span>2</span>错题号</legend><input className="line-input" value={props.wrongNumbers} onChange={(event) => props.setWrongNumbers(event.target.value)} placeholder="例如 3、7、12(2)" /><small>支持顿号、逗号或空格分隔</small></fieldset>
          <fieldset><legend><span>3</span>错误类型</legend><div className="choice-row">{ERROR_TAGS.map((tag) => <label key={tag} className={props.errorTags.includes(tag) ? "choice-chip selected" : "choice-chip"}><input type="checkbox" checked={props.errorTags.includes(tag)} onChange={() => props.toggleErrorTag(tag)} />{tag}</label>)}</div></fieldset>
          <fieldset><legend><span>4</span>订正与复做</legend><div className="check-stack"><label><input type="checkbox" checked={props.correctionPassed} onChange={(event) => props.setCorrectionPassed(event.target.checked)} /><span><strong>订正已通过</strong><small>孩子已改对全部必改错题</small></span></label><label><input type="checkbox" checked={props.redoRequired} onChange={(event) => props.setRedoRequired(event.target.checked)} /><span><strong>要求独立复做</strong><small>不查看原答案再次完成</small></span></label><label className={!props.redoRequired ? "disabled" : ""}><input type="checkbox" disabled={!props.redoRequired} checked={props.redoPassed} onChange={(event) => props.setRedoPassed(event.target.checked)} /><span><strong>独立复做已通过</strong><small>通过后才可点亮“已掌握”</small></span></label></div></fieldset>
          <fieldset><legend><span>5</span>双确认</legend><div className="confirmation-grid"><label className={props.reviewConfirmed ? "confirm-box checked" : "confirm-box"}><input type="checkbox" checked={props.reviewConfirmed} onChange={(event) => props.setReviewConfirmed(event.target.checked)} /><span className="check-mark">✓</span><span><strong>已完成批改</strong><small>必选 · 单独记录时间</small></span></label><label className={props.schoolSubmitted ? "confirm-box checked green" : "confirm-box"}><input type="checkbox" checked={props.schoolSubmitted} onChange={(event) => props.setSchoolSubmitted(event.target.checked)} /><span className="check-mark">✓</span><span><strong>已在学校平台提交</strong><small>必选节点 · 单独记录时间</small></span></label></div></fieldset>
          <label className={props.masteryConfirmed ? "mastery-confirm checked" : "mastery-confirm"}><input type="checkbox" checked={props.masteryConfirmed} onChange={(event) => props.setMasteryConfirmed(event.target.checked)} /><span><strong>确认本次掌握等级</strong><small>由练习、订正和复做证据自动计算</small></span><StatusPill tone={MASTERY_COPY[props.masteryLevel].tone}>{MASTERY_COPY[props.masteryLevel].label}</StatusPill></label>
          <button className={props.closeLoopReady ? "primary-button full success-button" : "primary-button full"} type="submit">{props.reviewSaved ? props.closeLoopReady ? "闭环已完成" : "更新批改记录" : "保存批改"}</button>
        </form>
      </section>
    </div>
  );
}

function PlanPanel({ onClose, onSave, planDate, planReason, setPlanDate, setPlanReason }: { onClose: () => void; onSave: () => void; planDate: number; planReason: string; setPlanDate: (day: number) => void; setPlanReason: (reason: string) => void }) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mini-sheet" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <header className="sheet-header"><div><p>调整计划</p><h2 id="plan-title">平面向量 · 作业1（2）</h2></div><button type="button" onClick={onClose} aria-label="关闭计划面板">×</button></header>
        <div className="plan-summary"><span>90分钟</span><p>当前日期：7月21日<br />学校截止：7月27日 21:00</p></div>
        <fieldset><legend>移动到</legend><div className="date-choice-row">{[22, 23, 24, 25].map((day) => <label className={planDate === day ? "selected" : ""} key={day}><input type="radio" name="plan-date" checked={planDate === day} onChange={() => setPlanDate(day)} /><small>7月</small><strong>{day}</strong></label>)}</div></fieldset>
        <fieldset><legend>变更原因</legend><select value={planReason} onChange={(event) => setPlanReason(event.target.value)}><option>课程冲突</option><option>孩子未完成</option><option>难度超预期</option><option>学校截止变化</option><option>其他</option></select></fieldset>
        {planDate === 23 ? <div className="risk-notice compact"><MiniIcon>!</MiniIcon><div><strong>7月23日将有 3 个任务块</strong><p>超过默认容量，可保留并记录原因。</p></div></div> : null}
        <button className="primary-button full" type="button" onClick={onSave}>确认调整</button>
      </section>
    </div>
  );
}
