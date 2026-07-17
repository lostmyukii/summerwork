import { useMemo, useState } from "react";
import { formatPlanDate } from "../lib/summer-plan";
import type { PrestudyContentRevision } from "../lib/supabase/prestudy-actions";
import type { PrestudyCourseSlot, PrestudyLesson } from "../lib/workspace";

const STATE_COPY: Record<PrestudyLesson["state"], string> = {
  pending: "待带学",
  led: "已带学",
  validated: "验收通过",
};

type ValidationInput = { actualQuestionCount: number; knowledgeItemIds: string[]; customUnmastered: string[] };

type PrestudyWorkspaceProps = {
  lessons: PrestudyLesson[];
  courseSlots: PrestudyCourseSlot[];
  selectedLessonId?: string;
  onSelectLesson: (lessonId: string) => void;
  onMarkLed: (lesson: PrestudyLesson) => Promise<void>;
  onValidate: (lesson: PrestudyLesson, input: ValidationInput) => Promise<void>;
  onRevoke: (lesson: PrestudyLesson, state: "led" | "validated") => Promise<void>;
  onMove: (lesson: PrestudyLesson, date: string, reason: string) => Promise<void>;
  onReviseContent: (lesson: PrestudyLesson, input: PrestudyContentRevision) => Promise<void>;
};

export function PrestudyWorkspace(props: PrestudyWorkspaceProps) {
  const lesson = props.lessons.find((item) => item.id === props.selectedLessonId) ?? props.lessons[0];
  if (!lesson) {
    return <section className="prestudy-workspace empty-prestudy-workspace"><strong>本科暂无预习</strong><p>家长同步预习计划后会自动出现。</p></section>;
  }
  return <PrestudyWorkspaceForm key={`${lesson.id}:${lesson.version}:${lesson.executionVersion}`} {...props} lesson={lesson} />;
}

function PrestudyWorkspaceForm({
  lesson,
  lessons,
  courseSlots,
  onSelectLesson,
  onMarkLed,
  onValidate,
  onRevoke,
  onMove,
  onReviseContent,
}: PrestudyWorkspaceProps & { lesson: PrestudyLesson }) {
  const [actualQuestions, setActualQuestions] = useState(lesson.actualQuestionCount?.toString() ?? "");
  const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>(lesson.unmasteredItems.flatMap((item) => item.knowledgeItemId ? [item.knowledgeItemId] : []));
  const [customKnowledge, setCustomKnowledge] = useState(lesson.unmasteredItems.filter((item) => item.custom).map((item) => item.label).join("、"));
  const [moveDate, setMoveDate] = useState(lesson.plannedDate);
  const [moveReason, setMoveReason] = useState("课程安排变化");
  const [editTitle, setEditTitle] = useState(lesson.title);
  const [editInput, setEditInput] = useState(lesson.phases.input);
  const [editAnalysis, setEditAnalysis] = useState(lesson.phases.analysis);
  const [editPractice, setEditPractice] = useState(lesson.phases.practice);
  const [editOutput, setEditOutput] = useState(lesson.phases.output);
  const [editAcceptance, setEditAcceptance] = useState(lesson.acceptanceCriteria);
  const [editKnowledge, setEditKnowledge] = useState(lesson.knowledgeItems.map((item) => item.label).join("\n"));
  const [editReason, setEditReason] = useState("根据实际学情调整");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const moveChoices = useMemo(() => {
    return [...new Set(courseSlots.filter((slot) => slot.subject === lesson.subject && slot.tutorLane === lesson.tutorLane).map((slot) => slot.date))].sort();
  }, [courseSlots, lesson]);

  function toggleKnowledge(id: string) {
    setSelectedKnowledge((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFormError("");
    try { await action(); } catch (error) { setFormError(error instanceof Error ? error.message : "操作未完成"); } finally { setBusy(false); }
  }

  async function validate() {
    if (!/^\d+$/.test(actualQuestions)) throw new Error("请填写实际完成题数，可填写0");
    const customUnmastered = customKnowledge.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
    await onValidate(lesson, { actualQuestionCount: Number(actualQuestions), knowledgeItemIds: selectedKnowledge, customUnmastered });
  }

  async function reviseContent() {
    const knowledgeLabels = [...new Set(editKnowledge.split(/[\n，,、]/).map((item) => item.trim()).filter(Boolean))];
    if ([editTitle, editInput, editAnalysis, editPractice, editOutput, editAcceptance, editReason].some((value) => !value.trim())) {
      throw new Error("预习内容和变更原因不能为空");
    }
    if (knowledgeLabels.length < 1 || knowledgeLabels.length > 12) throw new Error("预设知识点需保留1—12项");
    await onReviseContent(lesson, {
      title: editTitle.trim(),
      phases: { input: editInput.trim(), analysis: editAnalysis.trim(), practice: editPractice.trim(), output: editOutput.trim() },
      acceptanceCriteria: editAcceptance.trim(),
      knowledgeLabels,
      reason: editReason.trim(),
    });
  }

  return (
    <section className="prestudy-workspace" aria-labelledby="prestudy-workspace-title">
      <div className="prestudy-workspace-heading">
        <div><p>独立预习线</p><h2 id="prestudy-workspace-title">家教带学与验收</h2><span>只记录预习，不改变作业闭环和知识点亮。</span></div>
        <span className={`prestudy-state state-${lesson.state}`}>{STATE_COPY[lesson.state]}</span>
      </div>

      <div className="prestudy-lesson-tabs" aria-label="选择预习课">
        {lessons.map((item) => <button className={item.id === lesson.id ? "active" : ""} type="button" key={item.id} onClick={() => onSelectLesson(item.id)}><small>{formatPlanDate(item.plannedDate)}</small><strong>{item.lessonCode}</strong><span>{item.title}</span></button>)}
      </div>

      <div className="prestudy-focus-card">
        <div className="prestudy-focus-title"><div><span>{lesson.subject === "语文" ? "语文·考背" : lesson.subject}</span><small>{lesson.moduleCode} · {lesson.assignedTutorLabel} · 90分钟</small></div><h3>{lesson.title}</h3></div>
        <div className="prestudy-phase-grid">
          <article><span>01 · 0—25</span><strong>教材输入</strong><p>{lesson.phases.input}</p></article>
          <article><span>02 · 25—55</span><strong>例题拆解</strong><p>{lesson.phases.analysis}</p></article>
          <article><span>03 · 55—80</span><strong>最小自测</strong><p>{lesson.phases.practice}</p></article>
          <article><span>04 · 80—90</span><strong>输出续接</strong><p>{lesson.phases.output}</p></article>
        </div>
        <div className="prestudy-acceptance-card"><span>验收标准</span><strong>{lesson.acceptanceCriteria}</strong></div>
      </div>

      <div className="prestudy-control-grid">
        <section className="prestudy-check-panel">
          <div className="panel-title"><div><strong>未掌握知识点</strong><p>勾选即可，可为空。</p></div><span>{selectedKnowledge.length} 项</span></div>
          <div className="prestudy-check-list">
            {lesson.knowledgeItems.map((item) => <label className={selectedKnowledge.includes(item.id) ? "selected" : ""} key={item.id}><input type="checkbox" checked={selectedKnowledge.includes(item.id)} disabled={lesson.state === "validated" || busy} onChange={() => toggleKnowledge(item.id)} /><span>{item.label}</span></label>)}
          </div>
          <label className="prestudy-custom-field"><span>补充未掌握（顿号分隔）</span><input value={customKnowledge} disabled={lesson.state === "validated" || busy} onChange={(event) => setCustomKnowledge(event.target.value)} placeholder="例如：斜率不存在情形" /></label>
        </section>

        <section className="prestudy-action-panel">
          <label><span>实际完成题数</span><input inputMode="numeric" min="0" step="1" value={actualQuestions} disabled={lesson.state === "validated" || busy} onChange={(event) => setActualQuestions(event.target.value)} placeholder="可填0" /></label>
          <div className="prestudy-action-note"><strong>{STATE_COPY[lesson.state]}</strong><p>{lesson.state === "pending" ? "家教完成本次带学后先确认带学。" : lesson.state === "led" ? "填写题数、勾选未掌握项后验收。" : `已完成 ${lesson.actualQuestionCount ?? 0} 题；验收不等于已掌握。`}</p></div>
          {lesson.state === "pending" ? <button className="primary-button full" disabled={busy} type="button" onClick={() => void run(() => onMarkLed(lesson))}>标记已带学</button> : null}
          {lesson.state === "led" ? <><button className="primary-button full" disabled={busy} type="button" onClick={() => void run(validate)}>验收通过</button><button className="text-danger-button" disabled={busy} type="button" onClick={() => void run(() => onRevoke(lesson, "led"))}>撤销带学</button></> : null}
          {lesson.state === "validated" ? <button className="text-danger-button" disabled={busy} type="button" onClick={() => void run(() => onRevoke(lesson, "validated"))}>撤销验收</button> : null}
        </section>
      </div>

      <details className="prestudy-move-panel">
        <summary>调整本科预习日期</summary>
        <div><label><span>有效家教课</span><select value={moveDate} disabled={busy} onChange={(event) => setMoveDate(event.target.value)}>{moveChoices.map((date) => <option value={date} key={date}>{formatPlanDate(date, true)}</option>)}</select></label><label><span>变更原因</span><input value={moveReason} disabled={busy} onChange={(event) => setMoveReason(event.target.value)} /></label><button className="secondary-button" type="button" disabled={busy || moveDate === lesson.plannedDate || !moveDate} onClick={() => void run(() => onMove(lesson, moveDate, moveReason))}>保存变更</button></div>
      </details>

      <details className="prestudy-edit-panel">
        <summary>编辑本科预习内容{lesson.contentEditedAt ? " · 已由家教调整" : ""}</summary>
        <div className="prestudy-edit-form">
          <label><span>课题</span><input value={editTitle} disabled={busy} onChange={(event) => setEditTitle(event.target.value)} /></label>
          <div className="prestudy-edit-phase-grid">
            <label><span>0—25 教材输入</span><textarea value={editInput} disabled={busy} onChange={(event) => setEditInput(event.target.value)} /></label>
            <label><span>25—55 例题拆解</span><textarea value={editAnalysis} disabled={busy} onChange={(event) => setEditAnalysis(event.target.value)} /></label>
            <label><span>55—80 最小自测</span><textarea value={editPractice} disabled={busy} onChange={(event) => setEditPractice(event.target.value)} /></label>
            <label><span>80—90 输出续接</span><textarea value={editOutput} disabled={busy} onChange={(event) => setEditOutput(event.target.value)} /></label>
          </div>
          <label><span>验收标准</span><textarea value={editAcceptance} disabled={busy} onChange={(event) => setEditAcceptance(event.target.value)} /></label>
          <label><span>预设知识点（每行一项，1—12项）</span><textarea value={editKnowledge} disabled={busy} onChange={(event) => setEditKnowledge(event.target.value)} /></label>
          <label><span>变更原因</span><input value={editReason} disabled={busy} onChange={(event) => setEditReason(event.target.value)} /></label>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(reviseContent)}>保存预习内容</button>
          <small>仅本科家教可改；系统保留旧版本并通知家长。</small>
        </div>
      </details>
      {formError ? <p className="prestudy-form-error" role="alert">{formError}</p> : null}
    </section>
  );
}
