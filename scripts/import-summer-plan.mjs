import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = process.env.SUMMER_PLAN_SOURCE_DIR || path.resolve(projectRoot, "..", "系统搭建");
const outputPath = process.env.SUMMER_PLAN_OUTPUT_PATH || path.join(projectRoot, "app", "data", "summer-2026.json");
const scheduleLedgerPath = path.join(projectRoot, "data-sources", "course-schedule-2026.json");

const sourceFiles = ["语文.csv", "数学.csv", "物理.csv", "化学.csv", "生物俄语.csv"];
const allowedSubjects = ["语文", "数学", "俄语", "物理", "化学", "生物"];
const excludedSubjects = ["英语", "政治", "历史", "地理"];
const subjectOrder = new Map(allowedSubjects.map((subject, index) => [subject, index]));
const subjectSlugs = {
  语文: "chinese",
  数学: "math",
  俄语: "russian",
  物理: "physics",
  化学: "chemistry",
  生物: "biology",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  return rows;
}

function normalizeDate(value) {
  const match = value.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) throw new Error(`无法识别日期：${value}`);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function splitKnowledge(value) {
  if (!value || value === "—" || value === "-") return [];
  return value.split(/[；;、]/).map((item) => item.trim()).filter(Boolean);
}

const allowedTaskStages = ["practice", "reading", "review", "submission"];

function inferRecommendedMinutes(title, notes) {
  const combined = `${title} ${notes}`;
  if (/约需2小时|需延长/.test(combined)) return 120;
  if (/约40min|约40分钟/.test(combined)) return 40;
  return 90;
}

function requiresSubmission(subject, taskStage, title) {
  if (taskStage === "submission") return true;
  if (subject === "数学" && taskStage === "practice" && /^作业\d+/.test(title)) return true;
  if (subject === "俄语" && taskStage === "practice") return true;
  if (subject === "物理" && ((taskStage === "practice" && /^作业\d+/.test(title)) || (taskStage === "review" && /^本周作业/.test(title)))) return true;
  if (subject === "生物" && taskStage === "practice") return true;
  return false;
}

function answerPolicyFor(subject) {
  return {
    语文: "after_school_submission",
    数学: "after_school_submission",
    俄语: "guardian_held_until_attempt",
    物理: "weekly_teacher_release",
    化学: "locked_until_first_attempt",
    生物: "locked_until_first_attempt",
  }[subject];
}

function requirementLevelFor(subject, title, notes) {
  const combined = `${title}${notes}`;
  if (subject === "语文" && /征文/.test(combined)) return "pending_confirmation";
  if (subject === "化学" && /学新课|新课阶段|电化学/.test(combined)) return "pending_confirmation";
  if (subject === "生物" && /稳态与调节/.test(combined)) return "optional";
  if (/可选|选做|无需提交/.test(combined)) return "optional";
  return "required";
}

function inferHomeworkKey(subject, title, fallbackId, taskStage) {
  if (subject === "数学") {
    const match = title.match(/^作业(\d+)(?:\(|\s|$)/);
    if (match) return `math-assignment-${Number(match[1])}`;
  }
  if (subject === "物理" && taskStage === "practice") {
    const match = title.match(/^作业(\d+)(?:\+(\d+))?/);
    if (match) return `physics-assignment-${match[1]}${match[2] ? `-${match[2]}` : ""}`;
  }
  if (subject === "化学") {
    const match = title.match(/^必刷题\(([一二三四五六七八九十]+)\)/);
    if (match) return `chemistry-assignment-${match[1]}`;
  }
  if (subject === "生物") {
    const match = title.match(/^(测试[一二三四五六七八九十]+|综合[一二三四五六七八九十]+)/);
    if (match) return `biology-${match[1]}`;
  }
  if (subject === "语文") {
    if (taskStage === "submission") return `${fallbackId}-batch`;
    const paper = title.match(/套([一二三四五六七八])(?:[①②]|\s|$)/);
    if (paper) return `chinese-paper-${paper[1]}`;
    const novel = title.match(/^红楼(\d+-\d+)回/);
    if (novel) return `chinese-honglou-${novel[1]}`;
  }
  return fallbackId;
}

function formatDeadline(year, month, day, hour, minute) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

function inferExplicitDeadline(date, ...values) {
  const text = values.join(" ");
  const year = Number(date.slice(0, 4));
  const explicit = text.match(/(\d{1,2})[./月](\d{1,2})(?:日)?\s*(?:早|晚)?\s*(\d{1,2}):?(\d{2})/);
  if (explicit) return formatDeadline(year, Number(explicit[1]), Number(explicit[2]), Number(explicit[3]), Number(explicit[4]));

  const nextDay = text.match(/次日\s*(?:早|晚)?\s*(\d{1,2}):?(\d{2})/);
  if (nextDay) {
    const base = new Date(`${date}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + 1);
    return formatDeadline(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), Number(nextDay[1]), Number(nextDay[2]));
  }

  const sameDay = text.match(/(?:当日|当天|晚|早)?\s*(\d{1,2}):(\d{2})(?:前|截止)/);
  if (sameDay && /提交|截止/.test(text)) {
    const [, month, day] = date.split("-").map(Number);
    return formatDeadline(year, month, day, Number(sameDay[1]), Number(sameDay[2]));
  }
  return null;
}

const chineseDeadlineByPaper = {
  一: "2026-07-18T21:00:00+08:00",
  二: "2026-07-25T21:00:00+08:00",
  三: "2026-08-01T21:00:00+08:00",
  四: "2026-08-08T21:00:00+08:00",
  五: "2026-08-15T21:00:00+08:00",
  六: "2026-08-22T21:00:00+08:00",
  七: "2026-08-29T21:00:00+08:00",
  八: "2026-08-29T21:00:00+08:00",
};

const chineseDeadlineByNovelRange = {
  "1-20": "2026-07-25T21:00:00+08:00",
  "21-30": "2026-08-01T21:00:00+08:00",
  "31-40": "2026-08-08T21:00:00+08:00",
  "41-50": "2026-08-15T21:00:00+08:00",
  "51-60": "2026-08-22T21:00:00+08:00",
  "51-70": "2026-08-22T21:00:00+08:00",
  "61-70": "2026-08-22T21:00:00+08:00",
  "71-80": "2026-08-29T21:00:00+08:00",
};

const mathDeadlineByBatch = [
  [1, 3, "2026-07-26T21:00:00+08:00"],
  [4, 6, "2026-08-02T21:00:00+08:00"],
  [7, 9, "2026-08-09T21:00:00+08:00"],
  [10, 12, "2026-08-16T21:00:00+08:00"],
  [13, 15, "2026-08-25T21:00:00+08:00"],
];

const chemistryDeadlineByBatch = [
  [1, 5, "2026-07-26"],
  [6, 10, "2026-08-02"],
  [11, 15, "2026-08-09"],
  [16, 17, "2026-08-16"],
];

const chineseNumerals = new Map(["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七"].map((value, index) => [value, index + 1]));

function deadlineResult(value, precision = "time") {
  if (!value) return { deadlineDate: null, deadlineAt: null, deadlinePrecision: "unknown" };
  if (value.includes("T")) return { deadlineDate: value.slice(0, 10), deadlineAt: value, deadlinePrecision: precision };
  return { deadlineDate: value, deadlineAt: null, deadlinePrecision: "date" };
}

function officialDeadline(subject, taskStage, date, title, submission, notes) {
  const explicit = inferExplicitDeadline(date, title, submission, notes);
  if (explicit) return deadlineResult(explicit);

  if (subject === "语文" && taskStage !== "review") {
    const papers = [...title.matchAll(/套([一二三四五六七八])/g)].map((match) => chineseDeadlineByPaper[match[1]]).filter(Boolean);
    const novel = title.match(/红楼(\d+-\d+)回/);
    const candidates = [...papers, novel ? chineseDeadlineByNovelRange[novel[1]] : null].filter(Boolean).sort();
    return deadlineResult(candidates.at(-1));
  }
  if (subject === "数学") {
    const assignment = title.match(/作业(\d+)/);
    const batch = title.match(/^批次(\d)/);
    const number = assignment ? Number(assignment[1]) : batch ? [1, 4, 7, 10, 13][Number(batch[1]) - 1] : null;
    const mapped = number == null ? null : mathDeadlineByBatch.find(([start, end]) => number >= start && number <= end)?.[2];
    return deadlineResult(mapped);
  }
  if (subject === "俄语" && taskStage === "practice") return deadlineResult(date, "date");
  if (subject === "物理" && (taskStage === "practice" || /^本周作业/.test(title) || taskStage === "submission")) return deadlineResult(date, "date");
  if (subject === "化学") {
    const assignment = title.match(/^必刷题\(([一二三四五六七八九十]+)\)/);
    const batch = title.match(/^批次(\d)/);
    const number = assignment ? chineseNumerals.get(assignment[1]) : batch ? [1, 6, 11, 16][Number(batch[1]) - 1] : null;
    const mapped = number == null ? null : chemistryDeadlineByBatch.find(([start, end]) => number >= start && number <= end)?.[2];
    return deadlineResult(mapped, "date");
  }
  return deadlineResult(null);
}

const tasks = [];
const taskCounters = new Map();

for (const sourceFile of sourceFiles) {
  const sourcePath = path.join(sourceDir, sourceFile);
  const text = (await fs.readFile(sourcePath, "utf8")).replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  const header = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim());
  const expectedHeader = ["日期", "星期", "时段类型", "科目", "任务", "知识点标签", "答案批改依据", "提交上传", "备注", "任务阶段"];
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
    throw new Error(`${sourceFile} 表头不符合预期：${JSON.stringify(header)}`);
  }

  for (const [rowIndex, values] of rows.entries()) {
    if (values.length !== expectedHeader.length) {
      throw new Error(`${sourceFile} 第 ${rowIndex + 2} 行应为 ${expectedHeader.length} 列，实际为 ${values.length} 列`);
    }

    const [rawDate, weekday, sourceSlotType, subject, title, knowledge, answerBasis, submission, notes, taskStage] = values.map((value) => value.trim());
    if (!allowedSubjects.includes(subject)) throw new Error(`${sourceFile} 包含未授权科目：${subject}`);
    if (!allowedTaskStages.includes(taskStage)) throw new Error(`${sourceFile} 第 ${rowIndex + 2} 行任务阶段无效：${taskStage}`);
    if (excludedSubjects.some((item) => `${subject}${title}`.includes(item))) {
      throw new Error(`${sourceFile} 混入已排除科目：${subject} / ${title}`);
    }

    const date = normalizeDate(rawDate);
    const slotType = subject === "语文"
      ? sourceSlotType.startsWith("自学")
        ? "考背自主单元"
        : sourceSlotType === "机动"
          ? "考背机动单元"
          : sourceSlotType
      : sourceSlotType;
    const counterKey = `${date}-${subject}`;
    const sequence = (taskCounters.get(counterKey) ?? 0) + 1;
    taskCounters.set(counterKey, sequence);
    const uncertainty = /【存疑】|需确认|待通知|若.*返校|学校通知.*返校/.test(`${title}${notes}`);

    const deadline = officialDeadline(subject, taskStage, date, title, submission, notes);
    const taskId = `${subjectSlugs[subject]}-${date}-${String(sequence).padStart(2, "0")}`;
    const requirementLevel = requirementLevelFor(subject, title, notes);
    const submissionRequired = requiresSubmission(subject, taskStage, title);
    tasks.push({
      id: taskId,
      homeworkKey: inferHomeworkKey(subject, title, taskId, taskStage),
      date,
      weekday,
      slotType,
      sourceSlotType,
      subject,
      title,
      knowledge,
      knowledgeTags: splitKnowledge(knowledge),
      answerBasis,
      submission,
      notes,
      kind: taskStage,
      blockMinutes: 90,
      recommendedMinutes: inferRecommendedMinutes(title, notes),
      requiresSubmission: submissionRequired,
      courseIntegrated: slotType.includes("课内"),
      optional: requirementLevel === "optional" || requirementLevel === "pending_confirmation" || /可选|无需提交/.test(`${title}${submission}${notes}`),
      uncertainty,
      priority: /重点盯|全书难点|难度峰值|截止|重负荷/.test(`${title}${knowledge}${notes}`)
        ? "high"
        : uncertainty
          ? "attention"
          : "standard",
      answerPolicy: answerPolicyFor(subject),
      requirementLevel,
      evidenceRequired: taskStage === "submission"
        ? ["school_submission_confirmation"]
        : ["first_attempt", "tutor_review", "correction", "independent_redo", ...(submissionRequired ? ["school_submission_confirmation"] : [])],
      source: `系统搭建/${sourceFile}#${rowIndex + 2}`,
      ...deadline,
    });
  }
}

tasks.sort((left, right) => {
  const dateDifference = left.date.localeCompare(right.date);
  if (dateDifference !== 0) return dateDifference;
  const subjectDifference = subjectOrder.get(left.subject) - subjectOrder.get(right.subject);
  return subjectDifference || left.id.localeCompare(right.id);
});

const scheduleLedger = JSON.parse(await fs.readFile(scheduleLedgerPath, "utf8"));
const courseSchedule = scheduleLedger.entries
  .filter((entry) => entry.disposition === "included")
  .map((entry) => ({
    date: entry.date,
    labels: entry.labels,
    subjects: entry.subjects,
    source: `${scheduleLedger.sourceFile}/${Number(entry.date.slice(5, 7))}月`,
  }))
  .sort((left, right) => left.date.localeCompare(right.date));

const importantDates = [
  ...scheduleLedger.entries
    .filter((entry) => entry.disposition === "important_date")
    .map((entry) => ({ date: entry.date, type: "travel", label: entry.labels.join("、") })),
  { date: "2026-07-30", type: "school-admin", label: "综评证书扫描件提交班主任（校/市三好、优干、优秀团员等）" },
  { date: "2026-08-20", type: "uncertain", label: "学校通知约此时返校，需确认后段计划" },
  { date: "2026-08-29", type: "plan-end", label: "当前暑期计划结束节点" },
];

const subjectRequirements = [
  {
    subject: "语文",
    workBody: "8套综合卷（184道编号题、8篇作文）＋《红楼梦》1—80回导读与思考题",
    answerSource: "提交对应批次后由学校平台开放",
    splitRule: "每套至少拆现代文、古诗文与语用、作文、答案开放后订正四类动作；原著阅读进度与导读题分开记录",
    executionRules: ["黑笔独立作答、红笔订正，不得空题、挑题或抄答案", "纸质练习册与全部批改痕迹保留备查", "《乡土中国》未读者补读；高一上下册背诵篇目重温，学有余力逐句笔译", "两篇征文题目、字数和截止待学校通知，不生成强制节点"],
    answerPolicy: "after_school_submission",
    source: "暑期作业本体分析（用于规划系统）.md#语文作业分析",
  },
  {
    subject: "数学",
    workBody: "15个文件、19个子卷、351道编号题",
    answerSource: "PAD提交后开放详解或家长群答案",
    splitRule: "作业1、2、10按子卷拆；其余按1—11题、12—末题、订正复做与上传拆；错题必须合上答案独立复做",
    executionRules: ["先复习并在空白处整理知识点，再独立做题", "PAD提交后看详解，红笔订正后回传，再合上答案独立复做", "开学交纸质作业，模拟考约90%来自原题", "完成核心作业后按解析几何、数列、概率顺序预习教材、例题与课后练习"],
    answerPolicy: "after_school_submission",
    source: "暑期作业本体分析（用于规划系统）.md#数学作业分析",
  },
  {
    subject: "物理",
    workBody: "26份作业、383道编号题，部分含多问计算题",
    answerSource: "老师按周发布详细答案",
    splitRule: "一份作业首做最多占一个90分钟单元；17—19题或多问作业预设续做；周日集中批改、订正、独立复做再上传",
    executionRules: ["周一至周六每日首做并逐页提交学校平板App，周日等老师答案后红笔批改再提交", "禁止拍题搜答案；看答案后必须合上独立复做", "保留物理专用本、目录和全部纸质批改痕迹"],
    answerPolicy: "weekly_teacher_release",
    source: "暑期作业本体分析（用于规划系统）.md#物理作业分析",
  },
  {
    subject: "化学",
    workBody: "必刷题1—17＋选必一预习材料＋目录外电化学检测",
    answerSource: "PDF第63—84页",
    splitRule: "答案在首做提交前锁定；选做题分开；第45—62页在老师确认前标记待确认/拓展",
    executionRules: ["基础知识反复看、独立刷题、错题改会", "《高中化学基础知识》材料尚未提供，不能虚构页内任务", "各班提交渠道按任课教师通知；纸质册保留备查"],
    answerPolicy: "locked_until_first_attempt",
    source: "暑期作业本体分析（用于规划系统）.md#化学作业分析",
  },
  {
    subject: "生物",
    workBody: "9套测试、每套25题，共225道编号题",
    answerSource: "PDF第44—47页",
    splitRule: "每套拆1—20题选择单元和21—25题非选择单元；答案在首次作答提交后解锁",
    executionRules: ["当日任务次日08:00前在美师优课提交", "必修一二知识点填空建议全做；三套提升卷选做，材料未提供前只保留待确认", "选必一《稳态与调节》仅通读浏览，不虚构练习"],
    answerPolicy: "locked_until_first_attempt",
    source: "暑期作业本体分析（用于规划系统）.md#生物作业分析",
  },
  {
    subject: "俄语",
    workBody: "强基训练1—15＋巩固提升1—15，每日一练",
    answerSource: "家长群答案，家长保管、做完再给",
    splitRule: "当前只建每日提交与批改壳；正文材料补齐后再做题目—知识点映射",
    executionRules: ["7月20日至8月18日每日一练、当天提交，不攒堆", "答案由家长保管，完成当题后再给", "变格、变位结合课文句子会应用；期末不及格者补齐初中三册"],
    answerPolicy: "guardian_held_until_attempt",
    source: "暑期作业本体分析（用于规划系统）.md#目前无法完成题目级分析的材料",
  },
];

const ontologyIssues = [
  {
    id: "chinese-early-deadlines",
    severity: "high",
    subject: "语文",
    title: "前四批截止早于正式考背课",
    detail: "7月18日、7月25日、8月1日、8月8日均早于8月12日首次考背课；已将这些任务归类为“考背自主单元”。",
  },
  {
    id: "chemistry-material-conflict",
    severity: "attention",
    subject: "化学",
    title: "预习章节与附件目录不完全一致",
    detail: "8月17日后的预习和电化学检测均标记“待确认”，不与必刷题1—17等同处理。",
  },
  {
    id: "missing-materials",
    severity: "attention",
    subject: "全科",
    title: "部分题目或答案材料尚未提供",
    detail: "俄语正文、两篇语文征文题目、生物额外填空与提升卷、化学基础知识册，以及语数物正式答案仍待补充。",
  },
  {
    id: "return-date-conflict",
    severity: "attention",
    subject: "全科",
    title: "8月20日前后返校与8月下旬课表冲突",
    detail: "系统保留8月29日前初排课程，同时把8月20日设为待确认节点；确认后再批量顺延或压缩。",
  },
];

const payload = {
  meta: {
    id: "summer-2026-family-tutoring",
    title: "2026 暑期家教作业闭环计划",
    version: 2,
    dateRange: { start: "2026-07-16", end: "2026-08-29" },
    defaultBlockMinutes: 90,
    allowedSubjects,
    excludedSubjects,
    sourceFiles: [
      ...sourceFiles.map((file) => `系统搭建/${file}`),
      "假期课表初排.xlsx",
      "暑期作业内容分析报告.md",
      "暑期作业本体分析（用于规划系统）.md",
    ],
  },
  tasks,
  courseSchedule,
  importantDates,
  subjectRequirements,
  ontologyIssues,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已导入 ${tasks.length} 条任务、${courseSchedule.length} 个课程日：${outputPath}`);
