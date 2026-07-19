import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "infographic", "subject-tutor-guides");
const guideRoot = path.join(outputRoot, "teacher-guides");
const promptRoot = path.join(outputRoot, "prompts");
const imageRoot = path.join(outputRoot, "images");

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
const readText = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").trim();

const plan = readJson("app/data/summer-2026.json");
const dualTrack = readJson("app/data/daily-dual-track-2026.json");
const prestudy = readJson("app/data/prestudy-2026.json");
const roleGuide = readText("docs/release/2026-07-17-role-operation-guide.md");
const releaseRecord = readText("docs/release/2026-07-17-final-daily-dual-track-production-release.md");

const subjects = [
  { name: "语文", slug: "chinese", accent: "#FF453A", accentName: "系统红" },
  { name: "数学", slug: "math", accent: "#0A84FF", accentName: "系统蓝" },
  { name: "俄语", slug: "russian", accent: "#BF5AF2", accentName: "系统紫" },
  { name: "物理", slug: "physics", accent: "#5E5CE6", accentName: "靛蓝" },
  { name: "化学", slug: "chemistry", accent: "#FF9F0A", accentName: "系统橙" },
  { name: "生物", slug: "biology", accent: "#30D158", accentName: "系统绿" },
];

const stageKnowledge = {
  语文: ["套卷综合", "二元思辨作文", "《红楼梦》整本书", "古诗文默写与笔译", "错题归因", "征文写作"],
  数学: ["平面向量", "复数与立体几何", "统计概率与计数", "直线与圆", "圆锥曲线", "综合错题复盘"],
  俄语: ["变格与变位基础", "词汇句式积累", "变格变位应用", "强基训练", "巩固提升"],
  物理: ["圆周运动", "万有引力与机械能", "动量", "静电场", "闭合电路与电学实验", "机械振动与机械波"],
  化学: ["必修一二基础复习", "反应热与焓变", "化学反应速率", "化学平衡", "有机化学基础", "电化学"],
  生物: ["遗传规律", "减数分裂与伴性遗传", "DNA复制表达", "变异与进化", "神经调节", "激素与稳态调节"],
};

const specialNotes = {
  语文: ["本学科不设预习线。", "7月语文任务使用生物家教课内共享时段；8月主要使用考背课内时段。", "系统内始终使用语文家教身份完成批改、掌握与提交确认。"],
  数学: ["家教课同时存在预习线和作业线；两条线分别操作。", "作业提交后再看详解，红笔订正后合上答案独立复做。"],
  俄语: ["本学科不设预习线。", "答案由家长保管，完成当题后再给；正文材料未补齐前不虚构题目—知识点映射。"],
  物理: ["家教课同时存在预习线和作业线；两条线分别操作。", "老师按周发布答案；看答案后必须合上独立复做。"],
  化学: ["家教课同时存在预习线和作业线；两条线分别操作。", "答案在首做提交前锁定；缺失材料保持待确认。"],
  生物: ["家教课同时存在预习线和作业线；两条线分别操作。", "7月课内曾与语文共享时段；8月生物作业使用完整课内块。"],
};

const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
const requirementBySubject = new Map(plan.subjectRequirements.map((item) => [item.subject, item]));
const dateLabel = (date) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

for (const directory of [outputRoot, guideRoot, promptRoot, imageRoot]) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeWithBackup(filePath, content) {
  const normalized = `${content.trim()}\n`;
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, "utf8") === normalized) return;
    const parsed = path.parse(filePath);
    const backup = path.join(parsed.dir, `${parsed.name}-backup-${stamp}${parsed.ext}`);
    fs.renameSync(filePath, backup);
  }
  fs.writeFileSync(filePath, normalized, "utf8");
}

function subjectData(subject) {
  const blocks = dualTrack.blocks.filter((block) => block.subject === subject);
  const lessons = prestudy.lessons.filter((lesson) => lesson.subject === subject);
  const allDates = [...new Set([...blocks.map((block) => block.date), ...lessons.map((lesson) => lesson.plannedDate)])].sort();
  const rows = allDates.map((date) => {
    const dateBlocks = blocks.filter((block) => block.date === date);
    const dateLessons = lessons.filter((lesson) => lesson.plannedDate === date);
    const taskIds = dateBlocks.flatMap((block) => block.taskIds);
    const tasks = taskIds.map((taskId) => {
      const task = taskById.get(taskId);
      if (!task) throw new Error(`${subject} 缺少任务：${taskId}`);
      return task;
    });
    const travel = dateBlocks.some((block) => block.kind === "travel_independent");
    return { date, lessons: dateLessons, tasks, travel };
  });
  const taskIds = blocks.flatMap((block) => block.taskIds);
  if (new Set(taskIds).size !== taskIds.length) throw new Error(`${subject} 作业块存在重复任务映射`);
  return { blocks, lessons, rows, tasks: taskIds.map((id) => taskById.get(id)) };
}

function renderUsageGuide(subject) {
  const meta = subjects.find((item) => item.name === subject);
  const data = subjectData(subject);
  const requirement = requirementBySubject.get(subject);
  const hasPrestudy = data.lessons.length > 0;
  const previewText = hasPrestudy
    ? [
        "1. 打开“预习”工作台，核对标题、四阶段内容、验收标准和预设知识点。",
        "2. 如需修改，只改本科内容并填写简短原因；系统自动保留版本并通知家长。",
        "3. 完成带学后勾选“已带学”，填写实际完成题数，勾选未掌握项或补充自定义知识点。",
        "4. 达到本节验收标准后勾选“验收通过”；这不等于学校作业完成，也不等于知识已掌握。",
      ]
    : [
        "本科不设置预习线，不需要操作“已带学”或“验收通过”。",
        "进入系统后直接查看作业日历和本科作业工作台。",
      ];

  return `# ${subject}家教｜系统使用说明

入口：<https://summerwork.ilelezhan.cn/>

## 本科任务概览

- 预习：${data.lessons.length} 节
- 学校作业：${data.tasks.length} 项
- 作业块：${data.blocks.length} 个
- 权限：只查看和调整 ${subject}；不能修改其他科目

## 1. 登录后先做什么

1. 使用家长分配的 ${subject} 家教身份登录。
2. 在日历选择当天日期，先辨认“预习线”和“作业线”。
3. 预习是家教带学新课；作业是学校作业闭环，两条线不能互相替代。

## 2. 预习线

${previewText.map((line) => `- ${line}`).join("\n")}

## 3. 作业线

1. 孩子仍可独立首做，在系统中点击开始、暂停或我已完成，并填写不会的题号。
2. 家教不必等待孩子在系统内点击“我已完成”；确认已批改时可自动代确认“首做已完成”。
3. 家教批改以勾选为主：正确率档、错误类型、是否完成订正、是否需要复做。
4. 只有孩子完成订正并合上答案独立复做通过后，才确认相关知识点“已掌握”。
5. 完成练习只点亮进度；确认掌握才点亮知识；两者不是同一状态。

## 4. 学校提交

- 本系统不上传作业本体。
- 先确认“已批改”，再在学校 PAD、平板 App、群或老师指定平台完成真实提交。
- 真实提交完成后，单独勾选“已在学校平台提交”；系统记录确认时间。

## 5. 调整本科计划

- 日历只安排日期，一个标准作业块按 90 分钟理解。
- 可移动、拆分或合并本科任务，但必须填写简短原因。
- 系统保留原日期、调整后日期和操作记录，并在站内通知家长。
- 材料、答案或提交渠道未给时保持“待确认”，不要补写虚构内容。

## 6. 本科作业边界

- 作业本体：${requirement.workBody}
- 答案来源：${requirement.answerSource}
- 拆分原则：${requirement.splitRule}
- 执行规则：
${requirement.executionRules.map((rule) => `  - ${rule}`).join("\n")}

## 7. ${subject}特别提醒

${specialNotes[subject].map((note) => `- ${note}`).join("\n")}

## 8. 四个状态不要混淆

- 预习验收：完成家教带学流程。
- 练习完成：孩子或家教确认本次作业首做已完成。
- 知识掌握：批改、订正、独立复做通过后由家教确认。
- 学校提交：家教确认作业已在学校指定平台真实提交。

图片强调色：${meta.accentName} ${meta.accent}`;
}

function renderScheduleGuide(subject) {
  const data = subjectData(subject);
  const hasPrestudy = data.lessons.length > 0;
  const rows = data.rows.map((row) => {
    const badge = row.travel ? "｜俄罗斯期间·自主块" : "｜家教课内";
    const previewLines = row.lessons.length
      ? row.lessons.map((lesson) => `  - ${lesson.title}`).join("\n")
      : "  - —";
    const homeworkLines = row.tasks.length
      ? row.tasks.map((task) => `  - ${task.title}`).join("\n")
      : "  - —";
    return hasPrestudy
      ? `### ${dateLabel(row.date)}${badge}\n\n**预习线**\n${previewLines}\n\n**作业线**\n${homeworkLines}`
      : `### ${dateLabel(row.date)}${badge}\n\n**作业线**\n${homeworkLines}`;
  }).join("\n\n");

  return `# ${subject}｜预习线与作业线明细

## 总量

- 预习：${data.lessons.length} 节
- 学校作业：${data.tasks.length} 项
- 作业块：${data.blocks.length} 个
- 日期范围：2026年7月19日至8月29日
- 预习线：${hasPrestudy ? "家教带学，和作业线分别记录" : "本学科不设置"}

## 按日期明细

${rows}

## 阶段知识点

${stageKnowledge[subject].map((point) => `- ${point}`).join("\n")}

## 使用提示

- “俄罗斯期间·自主块”只表示旅行期内允许自主完成；返程后仍由本科家教批改、订正和验收。
- 图片和本清单只显示计划内容；如家教调整日期，以系统内最新计划和变更记录为准。
- 作业完成、知识掌握和学校提交分别确认。`;
}

function renderPrompt({ subject, type, index, source, outputName }) {
  const meta = subjects.find((item) => item.name === subject);
  const title = type === "usage" ? `${subject}家教｜系统使用说明` : `${subject}｜预习线与作业线明细`;
  const pagePlan = type === "usage"
    ? `采用 7 个紧凑圆角模块：顶部标题与三项数量摘要；登录与权限；预习线；作业闭环；批改—订正—复做—掌握；学校提交；计划调整与本科提醒。用箭头表现操作顺序，用独立状态胶囊区分“预习验收 / 练习完成 / 知识掌握 / 学校提交”。`
    : `采用高密度日期模块。页首显示三项总量；主体按月份分为两列或三个阶段（7月家教课、俄罗斯期间、8月家教课）。数理化生在每个日期模块中保持“上方预习线、下方作业线”；语文和俄语在页首明确“本学科不设置预习线”，主体只显示作业线。页尾用 3—6 个短标签汇总阶段知识点。`;

  return `---
image_index: ${String(index).padStart(2, "0")}
subject: ${subject}
page_type: ${type}
output_path: images/${outputName}
layout: dense-modules
style: custom-ios-teacher-manual
aspect_ratio: "9:16"
language: zh
---

Create a professional raster infographic following these specifications.

## Image Specifications

- Type: Infographic
- Layout: dense-modules
- Style: custom iOS teacher manual
- Aspect Ratio: 9:16 portrait, target 1440 × 2560
- Language: Simplified Chinese
- Main title: ${title}

## Content Fidelity — Hard Requirement

- Copy every supplied Chinese title, date, number, task name and state label exactly as written.
- Do not paraphrase, shorten, merge, reorder, invent or omit task names.
- Do not add any account, password, invitation token, server address, QR code or Apple logo.
- Use only the content below. If space is tight, reduce decorative elements before reducing text.
- Chinese typography must be crisp and readable. Use PingFang-SC-like sans-serif glyphs, correct punctuation and no garbled characters.

## Layout Guidelines

- High-density modular grid with clear information functions.
- Every module has concrete dates, counts, actions or task names.
- Strict alignment, compact spacing, thin dividers and strong hierarchy.
- ${pagePlan}

## Custom iOS Teacher Manual Style

- White canvas with grouped light-gray background #F2F2F7.
- Rounded white cards, 20—28 px corner radius, subtle soft shadow, thin #D1D1D6 separators.
- System blue #0A84FF for primary actions and navigation; ${meta.accentName} ${meta.accent} for ${subject} identity.
- Secondary text #6E6E73, primary text #1C1C1E, success #30D158, warning #FF9F0A.
- Minimal line icons, segmented-control pills and compact status badges. No texture, no illustration-heavy decoration, no gradients.
- Visual language should feel like an elegant iPhone productivity app help page, without using Apple trademarks.

## Exact Content

${source}

## Exact Interface Labels

${type === "usage"
    ? "进入本科工作台｜预习线｜作业线｜已带学｜实际完成题数｜未掌握知识点｜验收通过｜已批改｜完成订正｜独立复做｜已掌握｜已在学校平台提交｜调整计划｜待确认"
    : "预习线｜作业线｜家教课内｜俄罗斯期间·自主块｜阶段知识点｜作业完成｜知识掌握｜学校提交"}

Return one polished, publication-ready infographic image. Do not include explanatory prose outside the image.`;
}

const usageGuides = new Map();
const scheduleGuides = new Map();
for (const subject of subjects.map((item) => item.name)) {
  usageGuides.set(subject, renderUsageGuide(subject));
  scheduleGuides.set(subject, renderScheduleGuide(subject));
}

const sourceSystemGuide = `# 信息图源材料：系统操作\n\n## 角色操作手册\n\n${roleGuide}\n\n## 最终双轨发布事实\n\n${releaseRecord}`;
const sourceSchedules = subjects.map(({ name }) => scheduleGuides.get(name)).join("\n\n---\n\n");

const analysis = `---
title: "六科家教使用说明与双线明细"
topic: "教育管理与家教操作"
data_type: "流程教程 + 日期明细 + 指标"
complexity: "complex"
point_count: 12
source_language: "zh"
user_language: "zh"
---

## Main Topic

为六科分科家教提供可以手机查看和微信转发的系统操作说明，并准确呈现本科预习线与作业线的逐日安排。

## Learning Objectives

After viewing this infographic, the viewer should understand:

1. 本科家教登录后应如何分别操作预习线、作业线、知识掌握和学校提交。
2. 本科在 2026 年 7 月 19 日至 8 月 29 日每个执行日期的预习课和作业任务。
3. 哪些状态可以确认、哪些任务可以调整，以及本科权限边界。

## Target Audience

- **Knowledge Level**: 第一次使用系统的分科家教。
- **Context**: 家教课前快速查看计划，课中完成带学和批改，课后确认掌握与学校提交。
- **Expectations**: 不阅读长需求文档即可知道当天做什么、在哪里勾选、什么时候确认。

## Content Type Analysis

- **Data Structure**: 六科并列；每科分操作页与明细页；明细页按日期升序并保持预习线与作业线分轨。
- **Key Relationships**: 预习验收独立于学校作业；练习完成独立于知识掌握；学校提交单独确认；家教只操作本科。
- **Visual Opportunities**: 数量用摘要卡；流程用箭头；双轨用上下分区；旅行任务用标签；阶段知识点用短胶囊。

## Key Data Points (Verbatim)

- "作业：203项，81个作业块，203条块—任务映射，无遗漏、无重复。"
- "旅行自主：18项，只分布在7月26日至8月12日；旅行期外自主0项。"
- "预习：数学11、物理10、化学11、生物11，共43节；有效课程槽43个。"
- "俄语和语文旧预习已停用并保留历史；两科当前有效预习均为0。"
- "8月16日、8月23日：执行任务0项。"

## Layout × Style Signals

- Content type: high-density guide → suggests dense-modules.
- Tone: professional, concise, operational → suggests custom iOS teacher manual.
- Audience: subject tutors on mobile → suggests portrait 9:16.
- Complexity: 13—15 date groups per subject → requires compact modules and strict hierarchy.

## Design Instructions (from user input)

- 每科两张，共 12 张。
- 第 1 张“系统怎么用”，第 2 张“预习线＋作业线逐日明细”。
- 明细页按日期列出每项作业的准确名称，知识点只做阶段汇总。
- 白底、浅灰圆角卡片、系统蓝操作色、分科强调色。
- 操作页像系统工作台，明细页采用上下双轨日期表。
- 竖版 9:16，简体中文。

## Recommended Combinations

1. **dense-modules + custom iOS teacher manual** (Confirmed): 与已上线系统一致，适合高密度手机阅读。
2. **dense-modules + morandi-journal**: 更温和，但精确任务名较多时视觉噪声较高。
3. **linear-progression + ikea-manual**: 操作流程清楚，但承载逐日明细能力不足。
`;

const structuredContent = `# 六科家教使用说明与双线明细

## Overview

12 张竖版信息图组成六科家教包。每科第一张解释系统操作，第二张按日期展示本科预习线与作业线。

## Learning Objectives

The viewer will understand:

1. 如何完成本科预习带学、作业批改、订正复做、掌握确认和学校提交确认。
2. 本科每个执行日期的准确预习标题与作业任务名称。
3. 预习验收、练习完成、知识掌握和学校提交之间的区别。

---

${subjects.map(({ name }, subjectIndex) => `## ${name}信息图组

### ${subjectIndex * 2 + 1}. ${name}家教｜系统使用说明

**Key Concept**: 家教只操作本科，并按系统状态机完成真实闭环。

**Content**:

${usageGuides.get(name)}

**Visual Element**: iOS 工作台式 7 模块操作卡；箭头连接预习或作业流程；四个状态使用独立胶囊。

### ${subjectIndex * 2 + 2}. ${name}｜预习线与作业线明细

**Key Concept**: 以日期为主轴准确呈现本科双轨计划。

**Content**:

${scheduleGuides.get(name)}

**Visual Element**: 高密度日期卡；数理化生采用上下双轨，语文俄语明确无预习线；旅行自主使用单独标签。`).join("\n\n---\n\n")}

## Data Points (Verbatim)

- 语文：预习 0 节，学校作业 46 项，作业块 13 个。
- 数学：预习 11 节，学校作业 31 项，作业块 14 个。
- 俄语：预习 0 节，学校作业 30 项，作业块 15 个。
- 物理：预习 10 节，学校作业 43 项，作业块 13 个。
- 化学：预习 11 节，学校作业 31 项，作业块 14 个。
- 生物：预习 11 节，学校作业 22 项，作业块 12 个。

## Design Instructions

- Layout: dense-modules.
- Style: custom iOS teacher manual.
- Aspect: portrait 9:16.
- Language: Simplified Chinese.
- White canvas, grouped light-gray surfaces, rounded cards, system blue actions and subject accents.
- Exact task names must not be paraphrased, merged, reordered or omitted.
`;

writeWithBackup(path.join(outputRoot, "source-system-guide.md"), sourceSystemGuide);
writeWithBackup(path.join(outputRoot, "source-subject-schedules.md"), sourceSchedules);
writeWithBackup(path.join(outputRoot, "analysis.md"), analysis);
writeWithBackup(path.join(outputRoot, "structured-content.md"), structuredContent);

const indexRows = [];
let imageIndex = 1;
for (const meta of subjects) {
  const usageName = `${String(imageIndex).padStart(2, "0")}-${meta.name}-系统使用说明.png`;
  const scheduleName = `${String(imageIndex + 1).padStart(2, "0")}-${meta.name}-预习线与作业线明细.png`;
  const usageGuidePath = path.join(guideRoot, `${meta.name}家教使用说明.md`);
  const scheduleGuidePath = path.join(guideRoot, `${meta.name}双线明细.md`);
  const usagePromptPath = path.join(promptRoot, `${String(imageIndex).padStart(2, "0")}-${meta.slug}-usage.md`);
  const schedulePromptPath = path.join(promptRoot, `${String(imageIndex + 1).padStart(2, "0")}-${meta.slug}-schedule.md`);

  writeWithBackup(usageGuidePath, usageGuides.get(meta.name));
  writeWithBackup(scheduleGuidePath, scheduleGuides.get(meta.name));
  writeWithBackup(usagePromptPath, renderPrompt({ subject: meta.name, type: "usage", index: imageIndex, source: usageGuides.get(meta.name), outputName: usageName }));
  writeWithBackup(schedulePromptPath, renderPrompt({ subject: meta.name, type: "schedule", index: imageIndex + 1, source: scheduleGuides.get(meta.name), outputName: scheduleName }));

  indexRows.push(`## ${meta.name}\n\n- 系统使用说明文字稿：\`teacher-guides/${meta.name}家教使用说明.md\`\n- 双线明细文字稿：\`teacher-guides/${meta.name}双线明细.md\`\n- 系统使用说明图片：\`images/${usageName}\`\n- 双线明细图片：\`images/${scheduleName}\``);
  imageIndex += 2;
}

writeWithBackup(path.join(outputRoot, "六科家教说明索引.md"), `# 六科家教说明索引\n\n${indexRows.join("\n\n")}`);

const summary = subjects.map(({ name }) => {
  const data = subjectData(name);
  return { subject: name, prestudy: data.lessons.length, tasks: data.tasks.length, blocks: data.blocks.length, dates: data.rows.length };
});

console.log(JSON.stringify({ outputRoot, prompts: subjects.length * 2, guides: subjects.length * 2, summary }, null, 2));
