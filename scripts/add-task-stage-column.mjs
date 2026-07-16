import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = process.env.SUMMER_PLAN_SOURCE_DIR || path.resolve(projectRoot, "..", "系统搭建");
const sourceFiles = ["语文.csv", "数学.csv", "物理.csv", "化学.csv", "生物俄语.csv"];

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
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function encodeCell(value) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function taskStage(subject, title) {
  if (subject === "语文") {
    if (/平板提交/.test(title)) return "submission";
    if (/机动缓冲|错题复盘|总复盘|总抽查/.test(title)) return "review";
    if (/红楼.*阅读|带读/.test(title)) return "reading";
    return "practice";
  }
  if (subject === "数学") {
    if (/^批次\d提交/.test(title)) return "submission";
    if (/^错题|^开学前自查/.test(title)) return "review";
    return "practice";
  }
  if (subject === "俄语") return "practice";
  if (subject === "物理") {
    if (/^批次\d/.test(title)) return "submission";
    if (/^作业\d+/.test(title)) return "practice";
    if (/^本周|不排物理新作业|缓冲|错题重做|开学前综合复盘/.test(title)) return "review";
    return "practice";
  }
  if (subject === "化学") {
    if (/^批次\d.*提交/.test(title)) return "submission";
    if (/错题复盘|阶段小结|全期错题/.test(title)) return "review";
    return "practice";
  }
  if (subject === "生物") {
    if (/教材浏览/.test(title)) return "reading";
    if (/^机动日/.test(title)) return "review";
    return "practice";
  }
  throw new Error(`未知科目：${subject}`);
}

function normalizeSubmission(value) {
  if (!value || /^(—|-|无|无需提交|不回传)$/.test(value.trim()) || /本系统仅/.test(value)) return value;
  let normalized = value
    .replaceAll("系统标记+拍照上传批改痕迹", "学校指定平台拍照提交批改痕迹")
    .replaceAll("系统标记+拍照上传", "学校指定平台拍照提交")
    .replaceAll("系统标记+上传", "学校指定平台提交")
    .replaceAll("当天批改后拍照上传系统", "当天批改后拍照提交学校指定平台")
    .replaceAll("阅读批注拍照上传", "阅读批注拍照提交学校指定平台")
    .replaceAll("复盘记录上传", "复盘记录提交学校指定平台")
    .replaceAll("视情况上传", "如学校要求则提交学校指定平台")
    .replaceAll("错题记录在系统标记", "本系统记录错题完成")
    .replaceAll("系统标记", "本系统记录");
  if (/提交|上传|回传|本系统记录/.test(normalized)) normalized += "；本系统仅标记";
  return normalized;
}

for (const sourceFile of sourceFiles) {
  const sourcePath = path.join(sourceDir, sourceFile);
  const rows = parseCsv((await fs.readFile(sourcePath, "utf8")).replace(/^\uFEFF/, ""));
  const header = rows.shift();
  const isNineColumnSource = header?.length === 9 && header.at(-1) === "备注";
  const isMigratedSource = header?.length === 10 && header.at(-1) === "任务阶段";
  if (!isNineColumnSource && !isMigratedSource) throw new Error(`${sourceFile} 表头不符合九列或十列源表契约`);
  const migrated = [
    isNineColumnSource ? [...header, "任务阶段"] : header,
    ...rows.map((row, index) => {
      const sourceRow = isNineColumnSource ? row : row.slice(0, 9);
      if (sourceRow.length !== 9) throw new Error(`${sourceFile} 第 ${index + 2} 行不是九列源数据`);
      sourceRow[7] = normalizeSubmission(sourceRow[7]);
      sourceRow[8] = sourceRow[8].replaceAll("系统标记+上传", "学校平板App上传并在本系统标记");
      return [...sourceRow, taskStage(sourceRow[3], sourceRow[4])];
    }),
  ];
  await fs.writeFile(sourcePath, `${migrated.map((row) => row.map(encodeCell).join(",")).join("\n")}\n`, "utf8");
  console.log(`${sourceFile}: ${rows.length} 条任务已写入显式阶段`);
}
