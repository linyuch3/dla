# 🚀 CloudPanel 快速参考卡片

---

## 📋 一分钟部署清单

```
☐ 1. Fork GitHub 仓库
☐ 2. 创建 Cloudflare Pages 项目
☐ 3. 创建 D1 数据库 → 运行 3 个迁移脚本
☐ 4. 创建 KV 命名空间
☐ 5. 绑定 D1 (变量名: DB) 和 KV (变量名: KV)
☐ 6. 配置环境变量 (ENCRYPTION_KEY, ADMIN_USER, ADMIN_PASSWORD)
☐ 7. 重新部署 → 访问面板
```

---

## 🔑 环境变量速查

| 变量 | 必需 | 生成方法 | 示例 |
|------|------|----------|------|
| `ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32` | `a1b2c3...` (64字符) |
| `ADMIN_USER` | ✅ | 自定义 | `admin` |
| `ADMIN_PASSWORD` | ✅ | 自定义（强密码） | `SecurePass123!` |
| `TELEGRAM_BOT_TOKEN` | ❌ | @BotFather | `123456:ABC...` |
| `TELEGRAM_ADMIN_ID` | ❌ | @userinfobot | `123456789` |

---

## 📊 数据库迁移顺序

```sql
-- 1️⃣ migrations/0001_initial.sql
-- 创建: users, api_keys, instances 表

-- 2️⃣ migrations/0002_add_telegram_notifications.sql
-- 添加: telegram_bot_token, telegram_user_id, notification_enabled 字段

-- 3️⃣ migrations/0003_add_api_key_health_status.sql
-- 添加: health_status, last_health_check 字段
```

---

## 🔗 资源绑定配置

| 类型 | 变量名 | 资源名称 | 说明 |
|------|--------|----------|------|
| D1 Database | `DB` | cloudpanel | 必须是这个名称 |
| KV Namespace | `KV` | cloudpanel-kv | 必须是这个名称 |

⚠️ **注意**: 变量名 `DB` 和 `KV` 必须严格匹配（区分大小写）

---

## 🤖 Telegram Bot 快速设置

### 创建 Bot
```
1. 找 @BotFather
2. 发送: /newbot
3. 设置名称和用户名
4. 保存 Token
```

### 获取 User ID
```
1. 找 @userinfobot
2. 发送: /start
3. 记录 ID
```

### 设置 Webhook
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-project.pages.dev/api/telegram/webhook
```

---

## ⏰ 定时任务快速部署

### CLI 方式
```bash
npm install -g wrangler
wrangler login
cd workers
wrangler deploy
```

### 执行时间
- **Cron**: `0 16 * * *`
- **北京时间**: 每天 00:00

---

## 🐛 故障排查速查表

| 问题 | 可能原因 | 解决方法 |
|------|----------|----------|
| 无法登录 | 环境变量未设置 | 检查 ADMIN_USER/PASSWORD |
| API 500 错误 | 绑定配置错误 | 检查 DB/KV 绑定 |
| Telegram 无通知 | Token 或 ID 错误 | 重新获取并配置 |
| 数据库错误 | 迁移未执行 | 执行所有 3 个 SQL 脚本 |
| 404 错误 | 未部署到生产环境 | Retry deployment |

---

## 📁 项目结构速览

```
cloudpanel/
├── index.html              # 前端 (单页应用)
├── functions/              # 后端 API
│   ├── api/               # API 端点
│   └── shared/            # 共享模块
├── workers/               # 定时任务 Worker
├── migrations/            # 数据库迁移
└── *.md                   # 文档
```

---

## 🔧 常用命令

### 本地开发
```bash
npm install
npm run dev          # 本地开发服务器
npm run build        # 构建项目
```

### 部署
```bash
wrangler deploy      # 部署 Worker
git push             # 触发 Pages 自动部署
```

### 数据库
```bash
wrangler d1 execute cloudpanel --file=migrations/0001_initial.sql
wrangler d1 execute cloudpanel --file=migrations/0002_add_telegram_notifications.sql
wrangler d1 execute cloudpanel --file=migrations/0003_add_api_key_health_status.sql
```

---

## 🌐 访问地址

| 服务 | URL 格式 | 用途 |
|------|----------|------|
| 面板 | `https://your-project.pages.dev` | 主面板 |
| Worker | `https://cloudpanel-scheduler.your-subdomain.workers.dev` | 定时任务 |
| Webhook | `https://your-project.pages.dev/api/telegram/webhook` | Telegram Bot |

---

## 📖 文档导航

| 文档 | 适用场景 |
|------|----------|
| [README.md](./README.md) | 项目概述、快速开始 |
| [VISUAL_DEPLOYMENT.md](./VISUAL_DEPLOYMENT.md) | 可视化部署指南 |
| [GUI_DEPLOYMENT_GUIDE.md](./GUI_DEPLOYMENT_GUIDE.md) | Dashboard 部署 |
| [CF_DEPLOYMENT_GUIDE.md](./CF_DEPLOYMENT_GUIDE.md) | CLI 部署 |
| [SCHEDULED_DEPLOYMENT_GUIDE.md](./SCHEDULED_DEPLOYMENT_GUIDE.md) | 定时任务配置 |
| [TELEGRAM_BOT_MANUAL.md](./TELEGRAM_BOT_MANUAL.md) | Bot 命令手册 |
| [USER_BOT_SETUP.md](./USER_BOT_SETUP.md) | 用户 Bot 配置 |
| [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) | Telegram 基础设置 |

---

## 🎯 核心功能速查

### 支持的云服务商
- 🌊 DigitalOcean
- 🦈 Linode
- ☁️ Azure

### 主要功能
- ✅ 实例管理 (创建/删除/重启/关机)
- ✅ API 密钥管理 (多密钥支持)
- ✅ 健康检查 (手动/定时)
- ✅ Telegram 通知 (双Bot系统)
- ✅ 浮动IP管理
- ✅ 网络检查工具

---

## 🔐 安全提示

```
✅ 定期更换管理员密码
✅ 使用强密码（≥12字符，包含大小写字母、数字、符号）
✅ ENCRYPTION_KEY 保密且长度≥32字符
✅ 限制云服务商 API 权限为最小必要权限
✅ 定期备份 D1 数据库
```

---

## 📞 获取帮助

- 📖 查看文档: [README.md](./README.md)
- 🔍 问题诊断: [VISUAL_DEPLOYMENT.md](./VISUAL_DEPLOYMENT.md)
- 💬 提交 Issue: GitHub Issues
- 🤖 Bot 问题: [TELEGRAM_BOT_MANUAL.md](./TELEGRAM_BOT_MANUAL.md)

---

**💡 提示**: 将此文件保存为书签，方便快速查找！
