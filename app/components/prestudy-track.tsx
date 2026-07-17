import { formatPlanDate } from "../lib/summer-plan";
import type { PrestudyLesson } from "../lib/workspace";

const STATE_COPY: Record<PrestudyLesson["state"], string> = {
  pending: "待带学",
  led: "已带学",
  validated: "验收通过",
};

export function PrestudyTrack({
  lessons,
  role,
  onAction,
}: {
  lessons: PrestudyLesson[];
  role: "parent" | "tutor" | "student";
  onAction?: (lesson: PrestudyLesson) => void;
}) {
  return (
    <section className="calendar-track prestudy-calendar-track" aria-labelledby="prestudy-track-title">
      <header className="calendar-track-head">
        <div><span className="track-line-mark" /><div><strong id="prestudy-track-title">预习线</strong><small>家教带学 · 新课90分钟</small></div></div>
        <span>{lessons.length} 项</span>
      </header>
      {lessons.length ? <div className="prestudy-card-list">
        {lessons.map((lesson) => (
          <article className={`prestudy-calendar-card state-${lesson.state}`} key={lesson.id}>
            <div className="prestudy-card-top">
              <span className="prestudy-subject">{lesson.subject === "语文" ? "语文·考背" : lesson.subject}</span>
              <span className={`prestudy-state state-${lesson.state}`}>{STATE_COPY[lesson.state]}</span>
            </div>
            <p className="prestudy-code">{lesson.moduleCode} · {lesson.lessonCode} · {lesson.assignedTutorLabel}</p>
            <h3>{lesson.title}</h3>
            <div className="prestudy-meta">
              <span>{lesson.plannedMinutes}分钟</span>
              {lesson.actualQuestionCount !== undefined ? <span>完成 {lesson.actualQuestionCount} 题</span> : <span>题数待验收</span>}
              {lesson.unmasteredItems.length ? <span>未掌握 {lesson.unmasteredItems.length} 项</span> : null}
            </div>
            {lesson.scheduleAdjustmentReason ? <p className="prestudy-adjustment">原定 {formatPlanDate(lesson.originalDate)} · {lesson.scheduleAdjustmentReason}</p> : null}
            <details className="prestudy-details">
              <summary>查看带学内容与知识点</summary>
              <ol>
                <li><span>0—25</span><p>{lesson.phases.input}</p></li>
                <li><span>25—55</span><p>{lesson.phases.analysis}</p></li>
                <li><span>55—80</span><p>{lesson.phases.practice}</p></li>
                <li><span>80—90</span><p>{lesson.phases.output}</p></li>
              </ol>
              <p className="prestudy-acceptance"><strong>验收</strong>{lesson.acceptanceCriteria}</p>
              <div className="knowledge-chip-row">{lesson.knowledgeItems.map((item) => <span key={item.id}>{item.label}</span>)}</div>
            </details>
            {role === "tutor" && onAction ? <button className="prestudy-open-button" type="button" onClick={() => onAction(lesson)}>进入预习工作台</button> : null}
          </article>
        ))}
      </div> : <div className="track-empty"><span>预</span><p>当天没有家教预习，作业线仍按原计划执行。</p></div>}
    </section>
  );
}
