import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the homework closed-loop platform", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>学业闭环 · 暑假作业管理<\/title>/i);
  assert.match(html, /学业闭环/);
  assert.match(html, /数学家教/);
  assert.match(html, /闭环状态/);
  assert.match(html, /学校提交/);
  assert.match(html, /真实计划已导入/);
  assert.match(html, /203(?:<!-- -->)?条/);
  assert.match(html, /本体已核对/);
  assert.match(html, /作业1、2、10按子卷拆/);
  assert.match(html, /提交后解锁答案/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders the private account login boundary", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>登录 · 学业闭环<\/title>/i);
  assert.match(html, /私有家庭空间/);
  assert.match(html, /家长/);
  assert.match(html, /家教/);
  assert.match(html, /孩子/);
  assert.match(html, /当前是开发预览/);
});

test("server-renders parent setup and invitation boundaries", async () => {
  const [setupResponse, inviteResponse] = await Promise.all([
    render("/setup"),
    render("/invite/test-token"),
  ]);
  assert.equal(setupResponse.status, 200);
  assert.equal(inviteResponse.status, 200);
  assert.match(await setupResponse.text(), /家庭、孩子与分科家教/);
  assert.match(await inviteResponse.text(), /加入学业闭环/);
});

test("removes all disposable starter and fake homework artifacts", async () => {
  const [page, layout, packageJson, platform, demoData] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/homework-platform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/demo-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /HomeworkPlatform/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter/);
  assert.match(platform, /Record<string, TaskProgress>/);
  assert.match(platform, /planOverrides/);
  assert.doesNotMatch(`${platform}\n${demoData}`, /TUTOR_TASKS|WEEK_DAYS|vector-review/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
