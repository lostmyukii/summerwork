# 旅行作业补位生产迁移记录

## 结果

2026-07-17 已在腾讯云 `summerwork` 独立 Supabase 栈完成数据库迁移、网页应用发布与合成账号验收。线上应用现使用提交 `7b1b468`，真实账号登录、邀请、分科权限和旅行补位闭环均已启用。

## 隔离与恢复检查点

- 服务器基线：`/srv/summerwork/checkpoints/20260717T041314Z`
- 首次应用切换检查点：`/srv/summerwork/checkpoints/20260717T043054Z`
- 自建登录修复检查点：`/srv/summerwork/checkpoints/20260717T044527Z`
- 迁移前数据库备份：`/srv/summerwork/backups/summerwork-postgres-20260717T041350Z.dump`
- 备份 SHA-256：已生成并校验
- 恢复演练：临时数据库恢复成功，结构检查通过，临时数据库已删除
- 服务器源码：从 `509de05` fast-forward 到 `7b1b468`
- 线上应用镜像：`sha256:23c8d4fd49a0d52801edfcfda50ec2c830aa53a48c758582ee072805fd75f389`
- 应用回滚标签：`summerwork_app:rollback-20260717-043054`、`summerwork_app:rollback-login-fix-20260717T044527Z`
- GitHub：未推送，本次通过增量 Git bundle 传入服务器

## 网页应用发布

- Docker 构建内完成 TypeScript 检查、57 项单元测试和生产构建
- 首次候选镜像发现自建 API 域名被旧的 `*.supabase.co` 限定误判为未配置，公网登录页仍显示开发预览，因此未作为最终结果放行
- 提交 `7b1b468` 改为接受任意 HTTPS 自建端点，仅允许 localhost、loopback 和 Docker 内部 `kong` 使用 HTTP，并新增 3 项配置回归测试
- 无端口候选容器验证结果：登录页 200、真实注册入口存在、开发预览提示不存在
- 最终只用 `--no-deps` 创建 `summerwork_app`；公网桌面与窄屏登录页均已实际渲染，显示家长、家教、孩子入口和“第一次使用？创建账号”

切换期间，服务器上的旧版 `docker-compose 1.29.2` 曾尝试连带重建 Auth、REST 和 Realtime，并触发 `ContainerConfig` 兼容错误。处置过程没有删除容器或数据卷：三个原容器改回正式名称后原地启动，应用改用 `--no-deps` 独立创建。恢复后六个项目容器均为健康、重启 0、OOM 0；其他项目容器未被停止或重建。

## 数据库迁移

- 迁移前：19 份，最新 `0019_plan_catalog_version_snapshots.sql`
- 迁移后：20 份，最新 `0020_travel_recovery_schedule.sql`
- 执行方式：项目专属 `apply-migrations.sh`，单迁移事务与 SHA-256 登记
- 新增能力：旅行补位关系、已完成/剩余分钟状态视图、完成后自动释放、幂等调整、审计历史和分科 RLS

## 家教到场与提交倒排门禁

验收依据：`docs/superpowers/specs/2026-07-17-tutor-attendance-homework-rescheduling-design.md`。

- 本地源溯源：203 个执行块、175 项作业本体、23 个课程日，7 月 5 日继续排除
- 旅行期规则：7 月 26 日至 8 月 12 日共 18 个每日单一软任务
- 线上代表任务：数学作业 6，7 月 29 日旅行软任务，8 月 14 日返程补位
- 幂等：重复配置不新增第二个补位或重复审计
- 分科权限：数学家教可配置本科补位；物理家教跨科修改被拒绝
- 孩子权限：可以完成旅行任务，不能直接修改计划
- 释放：孩子完成后剩余分钟归零，返程补位自动释放，不复制作业本体
- 学校原截止、作业流程、知识掌握和学校提交继续分轨

## 合成账号验收

最终应用镜像上线后重新完成 38 项：家长、数学家教、物理家教、孩子真实密码登录；一次性邀请；分科读取；跨科拒绝；孩子学习动作；家教批改；旅行补位配置、幂等与释放；撤权后当前会话立即失权。

验收结束后的清理结果：

| 对象 | 数量 |
|---|---:|
| `auth.users` | 0 |
| `family_spaces` | 0 |
| `students` | 0 |
| `platform_bootstrap` | 0 |
| `task_travel_recovery_schedules` | 0 |
| `task_travel_recovery_events` | 0 |

## 迁移后健康状态

- `summerwork` 六个容器均健康，重启数 0，OOM 0
- staging、MQTT 等既有容器仍运行，重启数 0，OOM 0
- 专用端口仍只监听 `127.0.0.1:3180` 和 `127.0.0.1:8180`
- Nginx 语法检查通过，未 reload、未修改站点配置
- `https://summerwork.ilelezhan.cn/login` 返回 200，真实注册入口存在，开发预览提示不存在
- API 健康检查带发布密钥返回 200
- 数据库仍为 20 份迁移；验收后家庭、账号资料、任务和邀请均清理为 0
- 发布后可用内存约 5.7 GiB，`/srv` 可用磁盘约 51 GiB

## 回滚边界

迁移 `0020` 为只增不删。应用级回滚只替换 `summerwork_app` 镜像，并必须使用 `--no-deps`；其中两个旧标签仅用于紧急恢复运行，会重新显示开发预览，不能作为可登录的长期版本。若发现数据库级问题，先停止新增旅行补位写入，再使用上述备份按项目恢复流程处理；不得执行 `docker compose down -v`、全局 Docker 清理、服务器重启或修改其他项目资源。
