# 腾讯云隔离部署手册

本目录部署 `summerwork` 应用、PostgreSQL、Auth、REST、Realtime 和 Kong。它不复用、不停止、不更新服务器上的任何既有项目。

## 固定边界

- 公网只使用现有 Nginx 的 TCP `80/443`。
- 新容器只向宿主机发布 `127.0.0.1:3180` 和 `127.0.0.1:8180`。
- PostgreSQL、Auth、REST、Realtime 只在 `summerwork_net` 内通信。
- 数据卷为 `summerwork_db_data`、`summerwork_db_config`，备份目录为 `/srv/summerwork/backups`。
- 禁止全局 Docker 清理、系统升级、服务器重启、UFW 变更和删除数据卷。

精简栈使用 `db/roles-minimal.sql`，只设置 Auth 与 PostgREST 实际使用的数据库角色。官方通用角色脚本还依赖本部署明确排除的 Storage、Functions 和连接池角色，因此不直接执行。

## 1. 本地门禁

```bash
npm run verify:local
npm run test:deploy
bash -n deploy/tencent/scripts/*.sh deploy/tencent/kong/entrypoint.sh
deploy/tencent/scripts/compose.sh --env-file deploy/tencent/env.example -f deploy/tencent/docker-compose.yml config --quiet
```

## 2. 服务器检查点

服务器上的源码位于 `/srv/summerwork/app`，已验证部署文件复制到 `/srv/summerwork/deploy`。在启动任何新容器前执行：

```bash
sudo install -d -o ubuntu -g ubuntu -m 0750 /srv/summerwork/{app,deploy,backups,checkpoints}
/srv/summerwork/deploy/scripts/checkpoint.sh
/srv/summerwork/deploy/scripts/fetch-supabase-db-assets.sh
/srv/summerwork/deploy/scripts/generate-secrets.sh
/srv/summerwork/deploy/scripts/preflight.sh
```

`preflight.sh` 在端口冲突、磁盘低于 45GB、可用内存低于 4GB、Nginx 原配置无效、密钥权限不为 `0600` 或固定资产缺失时停止。

## 3. 分门启动

以下命令均在服务器 `/srv/summerwork` 下执行：

```bash
COMPOSE='/srv/summerwork/deploy/scripts/compose.sh --project-name summerwork --env-file deploy/.env -f deploy/docker-compose.yml'
$COMPOSE pull db auth rest realtime kong
$COMPOSE up -d db
$COMPOSE ps
$COMPOSE up -d auth rest realtime kong
$COMPOSE ps
```

先确认数据库及四个 API 服务均为 `healthy`，再继续。失败时只运行 `$COMPOSE down`，保留命名卷供诊断。

## 4. 迁移、计划和应用

```bash
/srv/summerwork/deploy/scripts/apply-migrations.sh
$COMPOSE build app
$COMPOSE up -d app
/srv/summerwork/deploy/scripts/sync-plan.sh
/srv/summerwork/deploy/scripts/healthcheck.sh
/srv/summerwork/deploy/scripts/verify-workflow.sh
```

验收脚本使用合成家长、数学家教、物理家教和孩子账号完成邀请、跨科拒绝、学习、批改、订正、掌握、提交和撤权测试，并在结束时清理合成数据。

## 5. 资源静置

```bash
/srv/summerwork/deploy/scripts/resource-soak.sh
```

至少观察 15 分钟。若现有站点退化、新容器重启、发生 OOM、Swap 持续增长、可用内存持续低于 2GB，或 5 分钟负载持续接近 2 核上限，则停止新栈且不接入公网。

## 6. 仅新增 Nginx 站点

```bash
sudo install -d -m 0755 /var/www/summerwork-acme
sudo install -m 0644 /srv/summerwork/deploy/nginx/summerwork-rate-limit.conf /etc/nginx/conf.d/summerwork-rate-limit.conf
sudo install -m 0644 /srv/summerwork/deploy/nginx/summerwork-http.conf /etc/nginx/sites-available/summerwork-http
sudo ln -s /etc/nginx/sites-available/summerwork-http /etc/nginx/sites-enabled/summerwork-http
sudo nginx -t
sudo nginx -s reload
```

使用 Webroot 单独申请证书，禁止 Certbot 改写 Nginx：

```bash
sudo certbot certonly --webroot -w /var/www/summerwork-acme -d summerwork.ilelezhan.cn
sudo certbot certonly --webroot -w /var/www/summerwork-acme -d summerwork-api.ilelezhan.cn
sudo install -m 0644 /srv/summerwork/deploy/nginx/summerwork-https.conf /etc/nginx/sites-available/summerwork-https
sudo ln -s /etc/nginx/sites-available/summerwork-https /etc/nginx/sites-enabled/summerwork-https
sudo nginx -t
sudo nginx -s reload
```

最后验证两个域名 HTTPS、登录/刷新和 `/realtime/v1/websocket` WebSocket 升级。

## 7. 备份与恢复演练

```bash
/srv/summerwork/deploy/scripts/backup.sh
/srv/summerwork/deploy/scripts/restore-drill.sh /srv/summerwork/backups/summerwork-postgres-<时间>.dump
```

确认演练通过后，才为备份脚本增加项目专用定时任务。备份默认保留 14 天，清理表达式只匹配专用目录内的 `summerwork-postgres-*` 文件。

```bash
sudo install -m 0644 /srv/summerwork/deploy/cron/summerwork-backup /etc/cron.d/summerwork-backup
sudo install -m 0644 /srv/summerwork/deploy/logrotate/summerwork-backup /etc/logrotate.d/summerwork-backup
```

定时任务每天 03:17 低优先级备份，只写入项目专属备份目录和日志文件。

## 8. 单家庭正式启动

公网发布后，由家长在 HTTPS 页面自行注册至少 12 位密码。管理员只把该家长邮箱写入 `public.platform_bootstrap`，不接触或保存家长密码。首个家庭认领完成后，启动门自动关闭；家教和孩子仍必须持有一次性邀请链接才能获得家庭或科目权限。

## 9. 回滚

先删除本项目的两个 `sites-enabled` 软链接和项目限速文件，执行 `sudo nginx -t`，通过后平滑 reload。随后执行：

```bash
/srv/summerwork/deploy/scripts/compose.sh --project-name summerwork --env-file /srv/summerwork/deploy/.env -f /srv/summerwork/deploy/docker-compose.yml down
```

回滚保留 `/srv/summerwork`、证书、密钥、备份和两个数据库命名卷。不得使用删除卷参数，也不得清理其他项目的容器、镜像、网络或卷。
