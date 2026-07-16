# 腾讯云精简 Supabase 共存部署实施计划

## 文档信息

| 项目 | 内容 |
|---|---|
| 日期 | 2026-07-17 |
| 依据 | `docs/superpowers/specs/2026-07-17-tencent-self-hosted-supabase-design.md` |
| 起始检查点 | `ddc982d` |
| 目标 | 在不影响服务器现有项目的前提下，上线国内自建学业闭环系统 |
| 执行方式 | 本地资产先行；服务器分批、逐门验证；失败只回滚新项目 |

本计划不记录或输出服务器密码、JWT 密钥、数据库密码、API Secret Key、SSH 私钥和真实家庭信息。

## 1. 固定上游基线

为避免 `latest` 漂移，部署资产以 Supabase 官方仓库提交 `11fb71514905d73c006da32bdbcbcc0d3274ba31` 为参考基线，并固定以下业务必需镜像：

- `supabase/postgres:17.6.1.136`
- `supabase/gotrue:v2.189.0`
- `postgrest/postgrest:v14.12`
- `supabase/realtime:v2.102.3`
- `kong/kong:3.9.1`
- 应用基础镜像使用 `node:22.19.0-bookworm-slim`，实施时记录其不可变镜像摘要

部署脚本必须校验上游提交号和本地部署文件，不允许服务器执行时静默切换版本。

## 2. 批次和停止门

| 批次 | 内容 | 放行条件 | 回滚点 |
|---|---|---|---|
| 1 | 本地安全迁移与部署资产 | 本地完整门禁通过 | Git 起始检查点 |
| 2 | 服务器基线与 SSH 检查点 | 现有服务基线已记录，端口无冲突 | 不产生运行副作用 |
| 3 | loopback 精简 Supabase | 全部容器健康，资源未越限 | 只停止 `summerwork` Compose |
| 4 | 迁移、200任务同步、应用 | 本机 Auth/REST/Realtime/页面通过 | 保留新数据卷，停止应用 |
| 5 | 四账号合成权限闭环 | 权限、状态机、清理全部通过 | 清理合成家庭，保留栈 |
| 6 | 15分钟资源静置 | 现有项目无退化，资源门通过 | 停止新栈，不接公网 |
| 7 | Nginx、证书和公网 | HTTPS/WebSocket/手机桌面通过 | 禁用两个新站点 |
| 8 | 备份恢复与家长启动 | 恢复演练、单家庭启动通过 | 保留备份和数据库卷 |
| 9 | SSH 密钥与交接 | 新密钥会话验证成功 | 保留原认证直至用户换密 |

任一放行条件失败时停止在当前批次，不并行进入下一批，不调整或压缩服务器现有项目资源。

## 3. 任务 1：单家庭启动门与密码规则

### 文件

- 新增：`supabase/migrations/0017_single_family_bootstrap.sql`
- 修改：`tests/supabase-workflow.integration.sql`
- 修改：`app/login/login-form.tsx`
- 修改：`scripts/verify-supabase-permissions.mjs`
- 修改：`tests/supabase-schema.test.ts`

### 实现

1. 新增单例启动配置表，保存允许创建首个家庭的规范化家长邮箱、配置时间和认领时间。
2. 配置表不通过浏览器开放写权限；只允许数据库管理员在公网启用前写入允许邮箱。
3. 重定义 `create_family_space`：
   - 当前用户必须已登录。
   - 当前 Auth 邮箱必须匹配未认领的启动邮箱。
   - 数据库必须尚无有效家庭。
   - 创建家庭、家长成员关系和认领启动记录必须在一个事务内完成。
   - 重复点击使用幂等或现有成员安全返回，不得创建第二个家庭。
4. 首个家庭创建后，任何普通账号不能创建第二个家庭。
5. 登录/注册表单把密码前端最小长度提升到 12 位；服务端 Auth 同步设置 12 位。
6. 自动权限验收在创建测试家庭前以管理员身份配置合成家长邮箱，清理时删除合成启动配置。

### 测试

- 允许配置的首个家长创建家庭。
- 未配置邮箱不能创建家庭。
- 首个家庭建立后拒绝第二个家庭。
- 已创建的家长重复请求不产生第二个家庭。
- 家教和孩子注册后仍不能创建家庭。
- 原有邀请、跨科、撤权和完整闭环测试继续通过。

### 本地放行命令

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:local
```

## 4. 任务 2：部署资产和静态安全测试

### 文件

- 新增：`deploy/tencent/Dockerfile`
- 新增：`deploy/tencent/docker-compose.yml`
- 新增：`deploy/tencent/env.example`
- 新增：`deploy/tencent/kong/kong.yml`
- 新增：`deploy/tencent/kong/entrypoint.sh`
- 新增：`deploy/tencent/nginx/summerwork-http.conf`
- 新增：`deploy/tencent/nginx/summerwork-https.conf`
- 新增：`deploy/tencent/nginx/summerwork-rate-limit.conf`
- 新增：`deploy/tencent/scripts/generate-secrets.sh`
- 新增：`deploy/tencent/scripts/fetch-supabase-db-assets.sh`
- 新增：`deploy/tencent/scripts/preflight.sh`
- 新增：`deploy/tencent/scripts/healthcheck.sh`
- 新增：`deploy/tencent/scripts/backup.sh`
- 新增：`deploy/tencent/scripts/restore-drill.sh`
- 新增：`deploy/tencent/README.md`
- 新增：`tests/tencent-deployment.test.mjs`
- 修改：`package.json`

### Compose 要求

1. Compose 项目名固定为 `summerwork`，容器、网络和卷使用唯一前缀。
2. 只包含 `app`、`db`、`auth`、`rest`、`realtime`、`kong` 六个服务。
3. 不出现 Storage、imgproxy、Functions、Analytics、Logflare、Vector、Studio、Meta 或 Supavisor 服务。
4. 只有以下宿主机端口映射：
   - `127.0.0.1:3180` → 应用容器。
   - `127.0.0.1:8180` → Kong HTTP 8000。
5. PostgreSQL、Auth、REST 和 Realtime 只加入独立 Docker 网络，不映射宿主机端口。
6. 每个服务设置 healthcheck、`restart: unless-stopped`、日志轮换和资源限制。
7. 新栈总资源目标不超过约 3.5GB 内存；CPU 限额不得挤占服务器全部2核。
8. 应用构建只注入 API 公网 URL 和 Publishable Key，不注入 Secret Key 或数据库密码。
9. 数据库使用命名卷，停止和回滚脚本禁止传递 `-v`。

### 上游数据库资产

1. 数据库初始化 SQL 只从固定 Supabase 提交获取。
2. 下载到部署目录的资产记录 SHA-256；哈希不匹配即停止。
3. 只采用 Auth、REST 和 Realtime 所需的官方数据库初始化文件。
4. 不在服务器临时复制 `master` 或未固定版本。

### 密钥生成

1. 使用 `openssl` 和官方密钥脚本生成数据库密码、JWT/非对称签名密钥、Publishable Key、Secret Key、Realtime 加密密钥。
2. 生成结果仅写入服务器 `deploy/.env`，权限 `0600`。
3. 脚本只输出变量名和“已生成”状态，不输出值。
4. 示例环境文件全部使用明显占位符，静态测试拒绝默认 Supabase 演示密钥和弱密码。

### 应用容器

1. 使用 Node 22 构建现有 Vinext 应用。
2. 构建阶段运行 TypeScript、单元测试和生产构建。
3. 运行用户使用非 root UID。
4. 只监听容器应用端口，由 Compose 映射到 `127.0.0.1:3180`。
5. 配置 Docker healthcheck 请求应用首页。

### 静态测试

`tests/tencent-deployment.test.mjs` 必须验证：

- 只有两个 loopback 宿主机端口。
- 无 `0.0.0.0` 数据库/API 暴露。
- 不包含被排除组件。
- 两个 Nginx 域名准确，无 `default_server`。
- API 配置包含 WebSocket Upgrade。
- Nginx 模板不覆盖现有站点。
- 环境示例无真实密钥和默认演示密钥。
- 备份清理只匹配专用目录。
- Docker 停止命令不包含 `down -v` 或全局 prune。

## 5. 任务 3：本地部署资产验证

### 命令

```bash
npm run verify:local
npm run test:deploy
docker compose --env-file deploy/tencent/env.example -f deploy/tencent/docker-compose.yml config
```

### 验收

- 原始课表和五份 CSV 重新导入结果仍为200任务、173作业、23课程日。
- 32 位/64 位密钥字段和 URL 变量均有明确校验。
- Compose 可解析且服务依赖无环。
- Dockerfile 可以完成生产构建。
- `git diff --check` 无格式错误。
- 本批次形成独立 Git 提交并推送；服务器只部署该已知提交。

## 6. 任务 4：服务器检查点与 SSH 密钥

### 只读基线

记录到 `/srv/summerwork/checkpoints/<timestamp>/`：

- `docker ps`、`docker inspect` 中的健康摘要，不记录现有环境变量。
- 运行中的 systemd 服务。
- 监听端口。
- `free`、`df`、`uptime`、进程 RSS 摘要。
- `nginx -T` 的配置文本和语法结果；不复制证书私钥。
- 现有域名和已知本机端口的 HTTP 状态码。

### SSH 密钥

1. 在用户本机生成项目专用 Ed25519 密钥，不提交 Git。
2. 把公钥追加到 `ubuntu` 的 `authorized_keys`，不覆盖已有 key。
3. 用新密钥建立第二个 SSH 会话并执行只读命令验证。
4. 在密钥验证成功前不修改密码认证策略。

### 停止条件

- `3180` 或 `8180` 已被占用。
- 可用磁盘低于45GB或可用内存低于4GB。
- 现有容器或站点在变更前已经异常且无法建立可信基线。
- 无法生成可验证的 SSH 密钥会话。

## 7. 任务 5：loopback 精简栈

### 执行

1. 创建 `/srv/summerwork/{app,deploy,backups,checkpoints}`，使用独立所有者和严格权限。
2. 从 GitHub 检出已验证提交，不复制本地 `.env.local` 或原始学校资料。
3. 获取并校验固定 Supabase 数据库资产。
4. 在服务器内部生成 `.env`；通过脚本检查没有默认密钥。
5. 先启动 `db`，等待 healthcheck。
6. 再启动 `auth`、`rest`、`realtime`、`kong`，逐服务检查。
7. 用 `ss` 确认宿主机只新增 `127.0.0.1:8180`，没有公网数据库端口。
8. 请求本机 Auth health、REST、Realtime health 和 Kong 路由。

### 回滚

只执行该 Compose 项目的 stop/down，不带 `-v`；复核现有容器和端口恢复基线。若数据库初始化失败，保留卷供诊断，不在同一卷上反复手工修补。

## 8. 任务 6：数据库迁移、计划同步和应用

1. 对新 PostgreSQL 执行全部项目迁移。
2. 配置合成测试家长启动邮箱。
3. 同步 `summer-2026-family-tutoring` 目录。
4. 复核200任务、173作业、六科、23课程日和所有排除规则。
5. 构建应用镜像并启动 `app`，确认只新增 `127.0.0.1:3180`。
6. 通过 loopback 请求首页、登录页、设置页和邀请页。
7. 验证应用浏览器配置只包含公开 API URL/Publishable Key。

## 9. 任务 7：四账号合成验收

在公网 Nginx 启用前执行：

1. 合成家长真实邮箱密码登录并创建唯一测试家庭。
2. 创建合成孩子档案并实例化200任务/173作业。
3. 数学和物理家教分别注册并接受一次性邀请。
4. 验证邀请邮箱不匹配和重复使用被拒绝。
5. 验证数学家教只能访问数学，物理家教只能访问物理。
6. 孩子完成开始、暂停、不会题号和完成动作。
7. 数学家教完成批改、订正/复做、掌握和全部学校提交节点。
8. 验证提交不直接修改掌握等级，全部节点前不得闭环。
9. 撤销数学家教，验证原会话立即失权。
10. 清理合成家庭、用户和启动邮箱；确认数据库无合成残留。

任何越权请求成功、清理失败或计数异常都阻止公网发布。

## 10. 任务 8：资源静置和既有服务复核

1. 新栈保持运行至少15分钟。
2. 每分钟采集一次新容器 CPU、内存、重启次数和服务器 load/swap。
3. 每轮请求新系统 loopback health 和现有网站状态。
4. 比较部署前后 Docker 容器、systemd、端口和 Nginx 语法。
5. 稳态可用内存持续低于2GB、出现 OOM/重启循环、Swap 持续增长或现有站点退化即停止新栈。

输出不包含环境变量、请求令牌、Cookies 或家庭数据。

## 11. 任务 9：Nginx 与 HTTPS

1. 确认腾讯云安全组 TCP 80/443 可达，两个 A 记录仍正确。
2. 创建独立 ACME Webroot 目录。
3. 先安装只处理两个新域名和 ACME challenge 的 HTTP 配置。
4. `nginx -t` 成功后平滑 reload；复核所有现有域名。
5. 使用 `certbot certonly --webroot` 为两个域名申请证书，不使用 `--nginx` 自动改写。
6. 安装 HTTPS 配置：
   - 应用域名代理 `127.0.0.1:3180`。
   - API 域名代理 `127.0.0.1:8180`。
   - Realtime 路径支持 WebSocket Upgrade 和长连接超时。
   - 登录/注册 Auth 路径应用仅属于 `summerwork` 的限速区。
7. `nginx -t` 后平滑 reload，复核现有域名、TLS 和新域名。
8. 验证 HTTP 跳 HTTPS、证书链、Auth、REST 和 WSS。

### Nginx 回滚

删除/禁用仅有的两个新站点链接和专用限速文件，`nginx -t` 后平滑 reload；不编辑现有站点文件，不删除其他证书。

## 12. 任务 10：备份与恢复演练

1. `backup.sh` 通过 `docker exec` 调用新数据库的 `pg_dump`。
2. 使用 `nice`/`ionice`、压缩、临时文件和原子重命名降低影响。
3. 为最终备份生成 SHA-256，权限设置 `0600`。
4. 清理只删除专用目录中超过14天且命名匹配的文件。
5. 在临时容器/临时数据库中恢复首份备份，检查关键表和计数。
6. 删除临时恢复实例，不删除正式数据库卷。
7. 安装仅属于 `summerwork` 的 cron 文件并记录运行时间；与现有任务冲突时调整到低负载时段。

## 13. 任务 11：正式家长启动与交接

1. 用户只提供家长登录邮箱，不在聊天中提供密码。
2. 通过数据库管理员命令配置该邮箱为唯一启动家长。
3. 用户在 HTTPS 页面自行输入12位以上密码注册并创建家庭。
4. 复核真实家庭创建后第二家庭不可创建。
5. 生成第一份正式备份。
6. 验证 SSH 密钥登录后，用户在腾讯云控制台轮换已暴露密码。
7. 不自动关闭 SSH 密码登录；如需关闭，作为独立全局运维变更另行确认。
8. 更新运行手册，记录健康检查、日志、备份、恢复、升级和仅新系统回滚命令。

## 14. 最终验收命令与证据

### 本地

```bash
npm run verify:local
npm run test:deploy
git diff --check
git status --short
```

### 服务器

验收脚本必须汇总而不泄密：

- 固定 Git 提交号和固定 Supabase 上游提交号。
- 六个新服务健康状态和 loopback 端口。
- 新旧站点 HTTP/HTTPS 状态。
- WSS 握手。
- 200任务、173作业、23课程日。
- 四账号权限验收通过项数和合成数据清理结果。
- 15分钟资源峰值、最低可用内存和重启次数。
- 最近备份文件大小、SHA-256 校验通过和恢复演练结果。

## 15. 明确禁止动作

- 不执行 `docker system prune`、`docker volume prune` 或任何全局清理。
- 不执行 `docker compose down -v`。
- 不修改、停止或重启非 `summerwork` 容器。
- 不编辑现有 Nginx 站点文件，不使用 Certbot 自动改写模式。
- 不执行系统升级、不重启服务器、不切换 UFW。
- 不开放3180、8180、5432、9999、3000、4000或8000到公网。
- 不把服务端 Secret Key 写入 `NEXT_PUBLIC_` 变量或前端镜像。
- 不把服务器密码、私钥、`.env`、原始学校资料或真实家庭数据提交 Git。

## 16. 实施完成判定

只有同时满足以下条件才报告部署完成：

1. 两个新域名 HTTPS、Auth、REST、Realtime 和应用全部可用。
2. 本地与服务器权限/闭环验收全部通过。
3. 权威任务数据计数和排除规则一致。
4. 新栈稳态资源通过，现有项目基线无退化。
5. 备份真实生成并完成一次恢复演练。
6. 合成测试数据已清理，正式家长可安全启动唯一家庭。
7. SSH 密钥已验证，用户已被明确要求轮换暴露密码。
8. Git、服务器运行手册和回滚路径一致，无待处理的高风险步骤。
