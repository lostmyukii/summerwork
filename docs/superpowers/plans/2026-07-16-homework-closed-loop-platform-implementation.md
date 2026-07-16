# 私有在线作业闭环平台——实施计划

## 文档信息

| 项目 | 内容 |
|---|---|
| 计划版本 | 1.0 |
| 日期 | 2026-07-16 |
| 状态 | 待按阶段实施 |
| 依据规格 | `docs/superpowers/specs/2026-07-16-homework-closed-loop-platform-design.md` |
| 第一交付目标 | 2026 年暑假作业闭环 MVP |
| 实施原则 | 先权限与状态机，后页面与统计；每阶段均可独立验收 |

## 1. 实施结论

第一版采用一个响应式 Web 应用、一个托管 Postgres 数据库和一套统一身份认证。家长、家教、孩子共用数据模型，通过服务端鉴权与数据库行级权限看到不同范围的数据和操作。

推荐技术栈：

- Next.js App Router + TypeScript：承载移动端和桌面端页面、服务端渲染、Server Actions 与 Route Handlers。
- Supabase：Postgres、Auth、Row Level Security、Realtime；关键状态流转使用数据库函数保证事务一致性。
- Tailwind CSS + 自有 iOS 设计令牌 + Radix 无障碍原语：建立简洁、可复用的移动优先界面。
- Zod：统一校验服务端输入、导入文件和表单数据。
- Vitest + Testing Library：测试状态机、知识点计算和组件行为。
- Playwright：覆盖家长、分科家教、孩子三角色端到端闭环。
- pgTAP 或等价 SQL 测试：验证 RLS、数据库约束和关键事务函数。

为减少第一版复杂度，不引入独立后端服务、微服务、复杂消息队列或 ORM 双重模型。数据库结构以版本化 SQL migration 为唯一事实来源，并生成 TypeScript 类型。

参考能力边界：

- [Next.js App Router](https://nextjs.org/docs/app)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Playwright](https://playwright.dev/docs/intro)

## 2. 架构边界

### 2.1 单体应用内的六个业务域

1. 身份与授权域：家庭空间、用户、邀请、分科授权。
2. 作业本体域：作业版本、知识点、题号范围、学校截止和提交节点。
3. 执行计划域：日期级 90 分钟任务块、容量、冲突、变更历史。
4. 学习执行域：孩子开始、暂停、继续、完成和不会题号。
5. 批改闭环域：批改、订正、独立复做、掌握确认、学校提交确认。
6. 证据与看板域：知识点证据、当前点亮、站内通知、周报和导出。

每个业务域都应包含自己的输入校验、查询、命令、状态规则和测试；页面只能调用域公开的查询或命令，不能直接拼接核心状态更新。

### 2.2 数据流

`页面操作 → 服务端输入校验 → 权限检查 → 数据库事务函数 → 当前状态与事件记录 → 站内通知/实时刷新 → 三角色视图`

以下操作必须走事务函数：

- 接受邀请并创建成员关系。
- 移动任务块并记录变更、风险和通知。
- 孩子完成首做并把作业推进到待批改。
- 家教确认批改、订正、复做和掌握等级。
- 确认或撤销学校提交节点。
- 重新打开已闭环作业。

### 2.3 实时同步范围

Realtime 只用于对当前操作有即时价值的变化：

- 任务块日期或状态变化。
- 孩子完成后出现的待批改任务。
- 家教验收后孩子端知识点状态变化。
- 站内通知未读数。

报表、历史审计和完整知识证据按需查询，不做全量实时订阅。

## 3. 目标代码结构

```text
summerwork/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (parent)/parent/
│   │   ├── (tutor)/tutor/
│   │   ├── (student)/student/
│   │   ├── invite/[token]/
│   │   └── api/
│   ├── components/
│   │   ├── ios/
│   │   ├── calendar/
│   │   ├── workflow/
│   │   └── knowledge/
│   ├── features/
│   │   ├── auth/
│   │   ├── homework/
│   │   ├── planning/
│   │   ├── study/
│   │   ├── review/
│   │   ├── mastery/
│   │   ├── notification/
│   │   └── reporting/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── validation/
│   │   ├── time/
│   │   └── observability/
│   └── styles/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── tests/
├── scripts/
│   └── import-homework/
├── tests/
│   ├── e2e/
│   ├── fixtures/
│   └── accessibility/
└── docs/
```

约束：

- 单个业务文件只处理一个明确职责。
- UI 组件不包含权限判断和状态机规则。
- `features/*/commands` 承担写操作，`features/*/queries` 承担读操作。
- 数据库中保存权威时间，界面统一以 `Asia/Shanghai` 显示。
- 原始学校 PDF、音频、孩子姓名和作业照片不进入 Git 仓库。

## 4. 数据库实施模型

### 4.1 身份与范围

核心表：

- `profiles`：关联 Auth 用户，保存显示名和账号状态。
- `family_spaces`：家庭空间、时区、默认每日容量。
- `family_memberships`：用户在家庭空间内的角色。
- `students`：孩子档案，与家庭空间关联。
- `subjects`：语文、数学、俄语、物理、化学、生物。
- `tutor_assignments`：家教、孩子、科目、生效与失效时间。
- `invitations`：一次性邀请 token 摘要、角色、科目范围、到期时间和使用时间。

账号实施默认：家长和家教使用电子邮箱登录；孩子账户由家长创建并管理登录凭据。若实际使用中孩子没有独立邮箱，再把“孩子账号标识”作为一个独立认证子项目处理，不在核心闭环中临时自建密码系统。

### 4.2 作业与知识点

核心表：

- `knowledge_nodes`：科目、模块、单元、知识点和能力标签的树结构。
- `homeworks`：稳定作业标识、当前版本和归档状态。
- `homework_versions`：标题、来源、要求、题号范围、必选属性、答案状态。
- `homework_knowledge_links`：作业版本与知识点映射、关联类型和权重。
- `submission_checkpoints`：学校提交节点、截止、是否必需和当前确认状态。

孩子开始后不覆盖旧作业版本。计划块、学习记录和证据都指向具体 `homework_version_id`。

### 4.3 计划与执行

核心表：

- `plan_blocks`：日期、90 分钟、类型、序号、负责家教、状态和 `version`。
- `plan_dependencies`：首做、续做、批改、订正、复做、提交确认之间的前后依赖。
- `study_sessions`：开始、暂停、继续、结束和累计实际分钟。
- `study_session_events`：学习动作的追加式事件记录。
- `unknown_questions`：孩子填写的不会题号，关联学习记录。

`plan_blocks` 不保存具体钟点。学校截止保存带时区的时间戳，风险计算同时考虑日期块和精确截止。

### 4.4 批改、提交与掌握

核心表：

- `reviews`：正确率区间、错题号、错误标签、简短评语和确认时间。
- `correction_attempts`：订正轮次、通过与否、复做要求和结果。
- `mastery_evidence`：每次作业对每个知识点产生的不可覆盖证据。
- `mastery_snapshots`：知识点当前等级、历史最高等级和最近证据时间。
- `submission_confirmations`：提交确认或撤销事件、操作者、时间和原因。
- `change_events`：计划、批改、提交、权限和作业版本的审计事件。
- `notifications`：站内通知、接收人和已读时间。

`mastery_snapshots` 是可重建的查询加速结果，`mastery_evidence` 才是长期事实。

### 4.5 一致性字段

所有可修改的核心表统一包含：

- `id`、`created_at`、`updated_at`。
- `created_by`、必要时的 `updated_by`。
- `version`：乐观锁版本号。
- `deleted_at`、`deleted_by`：软删除。

关键命令接受 `idempotency_key`，重复点击只返回第一次成功结果，不重复生成批改、证据或提交记录。

## 5. 权限实施矩阵

| 数据/操作 | 家长 | 本科家教 | 其他科家教 | 孩子 |
|---|---:|---:|---:|---:|
| 查看全部作业 | 是 | 仅本科 | 否 | 自己的全部任务 |
| 修改作业本体 | 是 | 否 | 否 | 否 |
| 修改执行计划 | 查看 | 仅本科 | 否 | 否 |
| 学习动作 | 查看 | 查看 | 否 | 自己 |
| 批改与验收 | 查看 | 仅本科 | 否 | 否 |
| 提交确认 | 查看 | 仅本科 | 否 | 否 |
| 知识证据 | 全部 | 仅本科 | 否 | 精简结果 |
| 邀请与授权 | 是 | 否 | 否 | 否 |

实现要求：

1. 每张业务表启用 RLS，默认拒绝。
2. 浏览器端只使用用户会话，不暴露 service-role key。
3. 写操作同时通过 RLS 与服务端业务权限检查。
4. 家教授权以 `student_id + subject_id + active period` 为边界。
5. 移除家教后，RLS 立即不再匹配；历史记录保留原署名。
6. 权限测试必须直接调用数据库和 HTTP 接口，不能只验证按钮是否隐藏。

## 6. 状态机实施规则

### 6.1 作业流程轨

权威状态：

`unscheduled → ready → in_progress → awaiting_review → awaiting_correction → awaiting_redo → awaiting_acceptance → closed_loop`

界面映射为规格中的中文状态。所有状态迁移使用明确命令，不提供“任意更新 status”的通用接口。

关键规则：

- 有错误且要求订正时，不允许从待批改直接闭环。
- 要求独立复做时，没有通过记录就不能点亮“已掌握”。
- 作业闭环依赖全部必需学校提交节点确认完成。
- 重新打开闭环必须记录原因，并生成新的审计事件。

### 6.2 学校提交轨

每个节点独立维护：`not_due / awaiting_confirmation / confirmed / revoked`。

家教的“已批改”和“已在学校平台提交”是两个命令、两个时间、两组审计，不允许一个按钮同时确认。

### 6.3 知识点点亮

点亮计算优先级：

1. 没有练习证据：未练习。
2. 完成首做且没有完成批改证据：已练习。
3. 有错题、订正未通过或新证据回落：有待巩固。
4. 订正通过但被要求的独立复做未通过：基本掌握。
5. 订正与被要求的独立复做通过：已掌握。

每次新增或撤销证据后重算受影响知识点，不全量重算整棵知识树。

## 7. 分阶段实施

### 阶段 0：工程基线与设计令牌

目标：建立可运行、可测试、可部署的空壳，不实现业务功能。

计划文件：

- `package.json`、锁文件、TypeScript/ESLint/测试配置。
- `src/app/layout.tsx`、全局错误页和加载页。
- `src/styles/tokens.css`、`src/components/ios/*`。
- `.env.example`、`README.md`、CI 工作流。

任务：

- 初始化 Next.js TypeScript App Router。
- 配置 Supabase 本地开发与环境变量校验。
- 从两份已确认 HTML 视觉稿提取颜色、圆角、间距、字体和底部导航令牌。
- 建立 390 像素手机与桌面断点基线。
- 配置 lint、typecheck、unit、e2e 四类命令。

验收门槛：

- 本地应用可启动，空白角色壳在手机和桌面正确显示。
- CI 能执行 lint、类型检查和一个冒烟测试。
- 不含任何真实家庭或作业数据。

### 阶段 1：数据库、认证与 RLS

目标：先证明三角色隔离有效。

计划文件：

- `supabase/migrations/0001_identity.sql`
- `supabase/migrations/0002_homework_core.sql`
- `supabase/migrations/0003_rls.sql`
- `supabase/tests/rls_identity.test.sql`
- `src/lib/supabase/server.ts`、`client.ts`，以及项目根部 `proxy.ts`
- `src/features/auth/*`
- `src/app/(auth)/*`、`src/app/invite/[token]/*`

任务：

- 创建家庭、档案、成员、孩子、科目、授权和邀请表。
- 实现家长初始化家庭空间。
- 实现一次性限时邀请和接受流程。
- 实现家长、家教、孩子登录后的角色路由。
- 为所有初始业务表启用默认拒绝 RLS。
- 编写“本科可见、跨科拒绝、孩子只读”的数据库测试。

验收门槛：

- 家教不能通过 URL、接口或数据库 API 读取其他科目。
- 孩子不能调用批改、计划和提交写接口。
- 邀请过期或重复使用时被拒绝并显示清晰原因。
- 移除家教后重新请求立即失去本科访问权。

### 阶段 2：家长录入作业与知识体系

目标：让家长能够建立权威作业本体。

计划文件：

- `supabase/migrations/0004_homework_versions.sql`
- `supabase/migrations/0005_knowledge.sql`
- `src/features/homework/*`
- `src/features/mastery/knowledge-tree.ts`
- `src/app/(parent)/parent/homeworks/*`
- `src/app/(parent)/parent/knowledge/*`

任务：

- 实现作业创建、编辑、版本化、归档和恢复。
- 实现题号范围、学校截止、必做/选做/材料和答案状态。
- 实现多提交节点配置。
- 实现知识点树和作业多知识点映射。
- 孩子开始作业后，修改动作自动生成新版本。
- 实现家长桌面端高效录入与手机端查看。

验收门槛：

- 旧学习记录始终指向旧作业版本。
- 家教只能看本科作业，不能编辑本体或映射。
- 学校截止使用精确时间，计划仍只显示日期。

### 阶段 3：90 分钟日历与计划变更

目标：实现家教日历优先的核心工作台。

计划文件：

- `supabase/migrations/0006_plan_blocks.sql`
- `supabase/migrations/0007_change_events.sql`
- `src/features/planning/*`
- `src/components/calendar/*`
- `src/app/(tutor)/tutor/today/*`
- `src/app/(tutor)/tutor/calendar/*`
- `src/app/(parent)/parent/calendar/*`

任务：

- 实现周、月、变更三个视图和日期级任务块。
- 实现移动单块、移动后续链路、拆分、合并和追加任务块。
- 实现默认每天 2 块及家庭可配置容量。
- 实现截止前剩余容量、批改/订正/提交预留和跨科冲突检查。
- 红色风险允许家教强制保存，但必须选择原因。
- 变更自动写入审计并生成家长站内通知。

验收门槛：

- 所有块固定显示“90 分钟”，没有具体开始时刻字段。
- 已开始任务块不能被合并或改写历史。
- 移动计划不丢失学习进度。
- 7 月 5 日导入规则不会生成任何初始任务块。
- 390 像素手机上可完成查看、移动和风险确认。

### 阶段 4：孩子独立学习动作

目标：提供最少但完整的学习执行界面。

计划文件：

- `supabase/migrations/0008_study_sessions.sql`
- `src/features/study/*`
- `src/app/(student)/student/today/*`
- `src/app/(student)/student/week/*`
- `src/components/workflow/study-controls.tsx`

任务：

- 实现开始、暂停、继续、我已完成。
- 实现不会题号的快速输入与去重。
- 使用追加式学习事件计算实际时长。
- 完成后原子地生成待批改状态和家教通知。
- 网络短暂中断时保留未提交的题号草稿和操作意图。

验收门槛：

- 孩子无法进入答案、批改、计划编辑或提交确认页面。
- 重复点击“我已完成”只产生一次有效迁移。
- 暂停和继续后的时长计算可复核。
- 今日卡片文字精简，主要动作单手可达。

### 阶段 5：家教勾选式批改与双确认

目标：完成作业工作流闭环。

计划文件：

- `supabase/migrations/0009_reviews.sql`
- `supabase/migrations/0010_submissions.sql`
- `src/features/review/*`
- `src/components/workflow/review-checklist.tsx`
- `src/app/(tutor)/tutor/review/*`

任务：

- 实现正确率四档、错题号、错误类型多选和选填短评。
- 实现无错题直达掌握确认的分支。
- 实现一轮或多轮订正、独立复做要求和验收。
- 实现“已批改”与“已在学校平台提交”两个独立确认。
- 实现提交节点撤销、重新确认和原因记录。
- 以 IndexedDB 或等价本地存储恢复未提交批改草稿。

验收门槛：

- 常规批改必填操作不超过五组。
- 未通过订正不能绕过到已闭环。
- 必需提交节点未确认时，工作流不显示完整闭环。
- 截图和备注始终选填；无截图也能完成流程。
- 所有撤销动作都保留操作者、时间和原因。

### 阶段 6：知识证据、点亮和三角色看板

目标：把练习结果转成可追溯知识证据。

计划文件：

- `supabase/migrations/0011_mastery_evidence.sql`
- `supabase/migrations/0012_notifications_reports.sql`
- `src/features/mastery/*`
- `src/features/reporting/*`
- `src/components/knowledge/*`
- 三角色首页和知识页。

任务：

- 为首做、错题、订正、复做和家教评价生成不可覆盖证据。
- 实现灰、蓝、橙、浅绿、绿五档当前状态与历史最高等级。
- 新练习暴露问题时允许当前等级回落。
- 实现家长全科总览、家教本科看板和孩子精简反馈。
- 实现站内通知中心、未读数和基础周报。
- 状态颜色同时显示图标或文字。

验收门槛：

- 学校提交确认不会改变知识等级。
- 无错题作业经家教掌握确认后可显示绿色；有错题时，订正和被要求的独立复做通过后才能显示绿色。
- 每个当前等级可追溯到具体作业、题号和家教确认。
- 家长可看到全科风险，家教只看到本科，孩子不看到家教绩效。

### 阶段 7：暑假数据导入

目标：把已分析的真实作业和初始计划安全导入。

计划文件：

- `scripts/import-homework/schema.ts`
- `scripts/import-homework/validate.ts`
- `scripts/import-homework/import.ts`
- `tests/fixtures/homework-synthetic.json`
- 私有、被 `.gitignore` 排除的真实导入清单。

任务：

- 把《暑期作业本体分析（用于规划系统）》整理为结构化清单。
- 先执行校验和 dry-run，输出题数、批次、截止、知识点和任务块汇总。
- 导入语文、数学、俄语、物理、化学、生物。
- 排除英语、政治、历史、地理。
- 语文统一归类“考背”，为前四次截止补自主任务块，并提前启动第七、八套卷。
- 俄语创建 30 个任务壳，暂不伪造知识点。
- 化学第 45—62 页导入为拓展/材料，不设强制提交。
- 生物未提供材料和语文征文不创建正式提交节点。

验收门槛：

- 导入前后统计与规格中的作业规模及排除规则一致。
- 7 月 5 日任务块数量为 0。
- 每个正式截止都有可追溯提交节点。
- 重复运行导入不会重复创建任务。
- 仓库中没有原始文件、真实账户或孩子隐私数据。

### 阶段 8：可靠性、可访问性与上线

目标：完成真实家庭使用前的质量门槛。

计划文件：

- `tests/e2e/closed-loop.spec.ts`
- `tests/e2e/permissions.spec.ts`
- `tests/e2e/plan-conflicts.spec.ts`
- `tests/accessibility/*`
- 部署说明、恢复说明和上线检查表。

任务：

- 完成三角色完整闭环 E2E。
- 覆盖并发冲突、幂等、软删除、撤销和恢复。
- 覆盖手机 390 像素和桌面主流程。
- 对焦点、触控尺寸、对比度和状态文字做可访问性检查。
- 配置生产环境、私有域名、数据库备份和错误监控。
- 使用合成数据完成预发布验收，再导入真实数据。
- 可选：启用私有 Storage bucket 保存提交截图；未启用时保留备注功能。

验收门槛：

- 全部自动化检查通过。
- 权限绕过测试全部被服务端拒绝。
- 常用页面正常网络下 2 秒内可操作。
- 关键状态写入失败时界面不会显示虚假成功。
- 家长可以导出作业、计划、批改、提交和知识证据。

## 8. 测试策略

### 8.1 单元测试

优先覆盖纯规则：

- 作业流程轨合法迁移。
- 提交节点状态迁移。
- 知识点五档计算与回落。
- 日期块容量和截止风险。
- 题号输入标准化。
- 学习时长事件折算。

### 8.2 数据库与权限测试

每个角色至少覆盖允许和拒绝两面：

- 本科家教读写本科任务。
- 本科家教访问他科失败。
- 孩子修改计划、批改或提交失败。
- 家长访问其他家庭空间失败。
- 被移除家教使用旧会话访问失败。
- 直接更新权威状态列失败。

### 8.3 端到端测试

主链路：

`家长建作业 → 授权家教 → 家教排计划 → 孩子完成 → 家教批改 → 孩子订正 → 家教复做验收 → 家教确认提交 → 知识点变绿 → 家长周报更新`

异常链路：

- 无错题直接验收。
- 两轮订正。
- 计划移动导致容量冲突。
- 学校截止提前。
- 提交确认后撤销。
- 两端同时编辑出现版本冲突。
- 网络中断后恢复批改草稿。

### 8.4 验收追踪

每个自动化测试名称引用规格编号 `FR-001` 至 `FR-018`；发布检查表逐项对应规格第 20 节验收标准，避免“功能做了但核心要求未验”。

## 9. 数据迁移与隐私策略

1. 本地原始音频、PDF、转写和 Excel 只作为导入来源，不上传仓库。
2. Git 中只保存导入程序、结构定义和完全合成的测试样例。
3. 真实导入清单保存在加密或访问受限的位置，并写入 `.gitignore`。
4. 先导入知识点和作业本体，再导入提交节点，最后生成计划块。
5. 每批导入都生成校验报告和批次 ID，支持整批回滚。
6. 上线前使用合成家庭跑完整闭环；通过后再创建真实家庭空间。

## 10. 发布与回滚

发布环境：

- 本地：Supabase 本地实例 + Next.js。
- 预发布：独立 Supabase 项目和独立部署，只有合成数据。
- 生产：家庭真实数据，限制管理员和 service-role 凭据。

每次发布必须完成：

1. 数据库 migration 在空库和前一版本快照上均成功。
2. RLS、状态机和端到端测试通过。
3. 生成数据库备份或确认可恢复点。
4. 先部署兼容旧数据库的应用，再执行非破坏性 migration。
5. 发布后验证登录、日历、批改、提交确认和知识点亮。

回滚原则：应用可以回滚到前一部署；数据库 migration 默认只增不删。需要删除字段时至少跨两个发布周期，先停止写入，再迁移数据，最后删除。

## 11. 实施顺序与提交边界

建议严格按阶段 0 至 8 顺序实施。每一阶段独立提交，提交前满足本阶段验收门槛，不把数据库、三角色 UI 和真实数据导入混在一个大提交中。

推荐提交序列：

1. `chore: scaffold private homework web app`
2. `feat: add family roles invitations and rls`
3. `feat: add versioned homework and knowledge model`
4. `feat: add 90-minute planning calendar`
5. `feat: add student study workflow`
6. `feat: add tutor review and submission confirmations`
7. `feat: add mastery evidence and role dashboards`
8. `data: add validated summer homework importer`
9. `test: harden permissions workflows and release checks`

在任何阶段发现规格冲突时，先更新规格和本计划并获得确认，再继续实施；不在代码中悄悄改变产品规则。

## 12. 第一批实施完成定义

第一批不是“页面可以点”，而是以下结果全部成立：

- 三角色可以真实登录，权限在数据库和服务端生效。
- 家长可以创建作业、知识点和提交节点。
- 家教可以按日期维护本科 90 分钟计划并留下变更历史。
- 孩子可以开始、暂停、继续、完成并填写不会题号。
- 家教可以用勾选为主完成批改、订正、复做和掌握确认。
- “已批改”和“已在学校平台提交”必须分别确认。
- 知识点点亮由证据驱动，提交状态不影响掌握等级。
- 当前六科数据与提交计划通过校验后导入，7 月 5 日无安排。
- 手机和电脑均可完成各自主流程。
- 权限、状态机、并发、撤销、离线草稿和完整闭环均有自动化验证。

满足以上条件后，暑假 MVP 才可进入真实家庭使用；考试管理、长期能力曲线和智能建议继续保留在后续阶段。
