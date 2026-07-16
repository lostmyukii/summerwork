# 学业闭环

家庭、分科家教与孩子共用的私有作业闭环平台。

当前开发批次已经完成工程基线和首个可交互纵向切片：

- 家长、家教、孩子三角色响应式应用壳。
- 家教日期级 90 分钟日历、周/月/变更视图。
- 勾选式批改、订正复做、掌握确认和学校提交双确认。
- 作业流程、知识掌握、学校提交三轨独立展示。
- 孩子开始、暂停、完成和不会题号交互。
- 家长全科风险、进度和变更总览。
- 核心状态机与服务端渲染自动化测试。
- 私有账号登录界面、Supabase 浏览器/服务端客户端边界。
- 家庭空间、成员、孩子、六科、分科家教、邀请和 RLS 的首批数据库迁移。

当前角色切换和数据属于开发预览，不是生产账号权限。正式家庭、家教、孩子登录及 Supabase RLS 已准备真实环境连接与自动权限验收，尚需本机 Supabase 项目凭据。

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run lint
npm test
```

## 连接 Supabase

1. 复制 `.env.example` 为 `.env.local`，填写项目 URL、anon key、service role key 和数据库连接 URI。
2. 应用数据库迁移：`npm run supabase:push`。
3. 验证真实密码登录、一次性邀请、分科隔离与撤销权限：`npm run supabase:verify`。

权限验收只创建带“权限验收”标记的合成账号和家庭，结束后自动清理，不使用孩子真实信息。service role key 与数据库 URI 只允许保存在服务端环境变量中。

产品规格与实施计划位于 `docs/superpowers/`。
