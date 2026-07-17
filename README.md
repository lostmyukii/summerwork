# 学业闭环

家庭、分科家教与孩子共用的私有作业闭环平台。家长维护权威作业本体，孩子独立完成，分科家教负责本科计划、批改、订正复做验收、知识掌握和学校平台提交确认。

## 当前实现

- 三类真实账号、一次性邀请、按孩子与科目隔离的 RLS 权限。
- 203 个日期任务块、175 项作业本体、6 科、23 个课程日；7 月 5 日、英语和政史地已排除，语文全部归入考背。
- 作业不可变版本、90 分钟任务块、移动/拆分/合并/追加/归档/恢复及完整变更留痕。
- 孩子开始、暂停、完成和不会题号；家教勾选式批改、订正、独立复做与掌握确认。
- 作业流程、知识掌握、学校提交三轨分离；所有必需提交节点确认后才闭环。
- 当前掌握与历史最高分开记录；重新打开任务会回落当前等级，但不抹去合法历史证据。
- 站内通知、风险提示、周报、完整 JSON 导出和带 SHA-256 校验的数据库备份快照。
- 手机与电脑响应式 iOS 风格页面；没有微信、短信、邮件或代替学校平台提交。

系统已部署到 [summerwork.ilelezhan.cn](https://summerwork.ilelezhan.cn/)，自建 API 位于 [summerwork-api.ilelezhan.cn](https://summerwork-api.ilelezhan.cn/)。截至 2026-07-17，本地发布门禁、19 份线上迁移、v2 计划同步、四账号真实密码与跨科权限回归、Realtime WebSocket、手机/桌面 HTTPS 和备份校验均已通过；合成验收数据已自动清理。

## 本地运行

```bash
npm install
npm run dev
```

## 完整本地发布门禁

```bash
npm run verify:local
```

该命令依次验证：原始课表与五份 CSV 的数据溯源、TypeScript、ESLint、单元测试、全新 PostgreSQL 上的全部迁移与多角色集成链路、生产构建、服务端渲染和生产依赖安全审计。

源课表验证默认读取 `/Users/yukii/Desktop/假期课表初排.xlsx`。换机器时可设置 `SUMMER_SCHEDULE_SOURCE` 指向原始文件。CI 不上传这份私人课表，因此只在本地发布门禁中做原件哈希核对。

## 连接或维护自建 Supabase

1. 本地维护时复制 `.env.example` 为 `.env.local`，填写项目 URL、anon key、service role key 和数据库连接 URI。
2. 应用数据库迁移：`npm run supabase:push`。
3. 同步权威暑期计划：`npm run supabase:sync-plan`。
4. 验证真实密码登录、一次性邀请、本科/跨科隔离、撤销即失权和清理：`npm run supabase:verify`。

远程权限验收只创建带“权限验收”标记的合成账号和家庭，结束后自动清理，不使用孩子真实信息。service role key 与数据库 URI 只能保存在服务端环境变量中，不得提交 Git。

需求规格、实施计划与逐项证据位于：

- `docs/superpowers/specs/2026-07-16-homework-closed-loop-platform-design.md`
- `docs/superpowers/plans/2026-07-16-homework-closed-loop-platform-implementation.md`
- `docs/release/2026-07-17-acceptance-traceability.md`
- `docs/release/2026-07-17-role-operation-guide.md`
