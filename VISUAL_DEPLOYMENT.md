# 📸 CloudPanel 可视化部署指南

本指南通过图文结合的方式，帮助您快速在 Cloudflare Pages 上部署 CloudPanel。

---

## 🎯 部署流程概览

```
┌─────────────────────────────────────────────────────────────┐
│  1. Fork GitHub 仓库                                         │
│  ↓                                                          │
│  2. 创建 Cloudflare Pages 项目                               │
│  ↓                                                          │
│  3. 创建并配置 D1 数据库                                      │
│  ↓                                                          │
│  4. 创建并配置 KV 存储                                        │
│  ↓                                                          │
│  5. 绑定资源到 Pages                                         │
│  ↓                                                          │
│  6. 配置环境变量                                             │
│  ↓                                                          │
│  7. 重新部署并访问                                           │
│  ↓                                                          │
│  8. (可选) 配置 Telegram Bot                                │
│  ↓                                                          │
│  9. (可选) 部署定时任务 Worker                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 步骤 1: Fork GitHub 仓库

### 操作说明
1. 访问项目的 GitHub 仓库
2. 点击右上角的 **Fork** 按钮
3. 选择你的账号，点击 **Create fork**

### 视觉示意
```
┌───────────────────────────────────────┐
│  GitHub 仓库页面                       │
│  ┌─────────────────────────────────┐ │
│  │  your-username/cloudpanel       │ │
│  │  ┌─────┐  ┌────┐  ┌──────┐    │ │
│  │  │Watch│  │Star│  │Fork ▼│    │ │ <- 点击这里
│  │  └─────┘  └────┘  └──────┘    │ │
│  └─────────────────────────────────┘ │
└───────────────────────────────────────┘
```

### ✅ 检查点
- ✓ Fork 成功后，你的账号下会出现一个新仓库
- ✓ 仓库名称为：`your-username/cloudpanel`

---

## 📋 步骤 2: 创建 Cloudflare Pages 项目

### 操作说明
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单选择 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** 标签
5. 点击 **Connect to Git**

### 视觉示意
```
Cloudflare Dashboard 导航路径:

主页 → Workers & Pages → Create application

┌────────────────────────────────────────┐
│  Create an application                 │
│  ┌──────────┐  ┌──────────┐          │
│  │ Workers  │  │  Pages   │          │ <- 选择这个
│  └──────────┘  └──────────┘          │
│                                        │
│  Connect to Git                        │
│  ┌──────────────────────────────────┐│
│  │ 📦 GitHub                        ││
│  │ 🔗 GitLab                        ││ <- 选择 GitHub
│  └──────────────────────────────────┘│
└────────────────────────────────────────┘
```

### 配置设置
```
┌──────────────────────────────────────────┐
│ Set up builds and deployments            │
├──────────────────────────────────────────┤
│ Project name:                            │
│ ┌──────────────────────────────────────┐│
│ │ cloudpanel                           ││
│ └──────────────────────────────────────┘│
│                                          │
│ Production branch:                       │
│ ┌──────────────────────────────────────┐│
│ │ main                                 ││
│ └──────────────────────────────────────┘│
│                                          │
│ Framework preset:                        │
│ ┌──────────────────────────────────────┐│
│ │ None                          ▼     ││
│ └──────────────────────────────────────┘│
│                                          │
│ Build command:                           │
│ ┌──────────────────────────────────────┐│
│ │ (留空)                               ││
│ └──────────────────────────────────────┘│
│                                          │
│ Build output directory:                  │
│ ┌──────────────────────────────────────┐│
│ │ /                                    ││
│ └──────────────────────────────────────┘│
│                                          │
│          [Save and Deploy]               │
└──────────────────────────────────────────┘
```

### ✅ 检查点
- ✓ 部署开始，状态显示 "Building..."
- ✓ 等待 1-2 分钟后，状态变为 "Success"
- ✓ 获得一个 URL: `https://cloudpanel.pages.dev`

---

## 📋 步骤 3: 创建并配置 D1 数据库

### 操作说明
1. 在 Cloudflare Dashboard 左侧菜单选择 **Workers & Pages** → **D1**
2. 点击 **Create database**
3. 输入数据库名称：`cloudpanel`
4. 点击 **Create**

### 视觉示意
```
D1 Database 创建页面:

┌────────────────────────────────────────┐
│ Create a database                      │
├────────────────────────────────────────┤
│ Database name:                         │
│ ┌──────────────────────────────────┐  │
│ │ cloudpanel                       │  │
│ └──────────────────────────────────┘  │
│                                        │
│              [Create]                  │
└────────────────────────────────────────┘
```

### 运行迁移脚本

#### 进入 Console
```
数据库详情页 → Console 标签

┌────────────────────────────────────────┐
│ cloudpanel                             │
├────────────────────────────────────────┤
│ Overview  Console  Settings            │ <- 选择 Console
├────────────────────────────────────────┤
│ SQL Console                            │
│ ┌──────────────────────────────────┐  │
│ │ -- 在此输入 SQL 命令              │  │
│ │                                  │  │
│ │                                  │  │
│ └──────────────────────────────────┘  │
│                                        │
│              [Execute]                 │
└────────────────────────────────────────┘
```

#### 迁移顺序
```
第一步: 基础表结构
┌─────────────────────────────────────┐
│ 复制 migrations/0001_initial.sql    │
│ 内容到 Console                       │
│ ↓                                   │
│ 点击 [Execute]                      │
│ ↓                                   │
│ ✓ 成功创建用户表、API密钥表、实例表  │
└─────────────────────────────────────┘

第二步: Telegram 通知
┌─────────────────────────────────────┐
│ 复制 migrations/                     │
│ 0002_add_telegram_notifications.sql │
│ 内容到 Console                       │
│ ↓                                   │
│ 点击 [Execute]                      │
│ ↓                                   │
│ ✓ 添加 Telegram 相关字段            │
└─────────────────────────────────────┘

第三步: API 健康检查
┌─────────────────────────────────────┐
│ 复制 migrations/                     │
│ 0003_add_api_key_health_status.sql  │
│ 内容到 Console                       │
│ ↓                                   │
│ 点击 [Execute]                      │
│ ↓                                   │
│ ✓ 添加健康检查相关字段               │
└─────────────────────────────────────┘
```

### ✅ 检查点
- ✓ 数据库创建成功
- ✓ 所有 3 个迁移脚本执行完成
- ✓ 在 Console 中运行 `SELECT * FROM users;` 不报错

---

## 📋 步骤 4: 创建 KV 命名空间

### 操作说明
1. 在 Cloudflare Dashboard 左侧菜单选择 **Workers & Pages** → **KV**
2. 点击 **Create a namespace**
3. 输入命名空间名称：`cloudpanel-kv`
4. 点击 **Add**

### 视觉示意
```
KV Namespace 创建页面:

┌────────────────────────────────────────┐
│ Create a namespace                     │
├────────────────────────────────────────┤
│ Namespace Name:                        │
│ ┌──────────────────────────────────┐  │
│ │ cloudpanel-kv                    │  │
│ └──────────────────────────────────┘  │
│                                        │
│              [Add]                     │
└────────────────────────────────────────┘
```

### ✅ 检查点
- ✓ KV 命名空间创建成功
- ✓ 在 KV 列表中可以看到 `cloudpanel-kv`

---

## 📋 步骤 5: 绑定资源到 Pages

### 操作说明
1. 返回你的 Pages 项目（`cloudpanel`）
2. 进入 **Settings** → **Functions**
3. 在 **Bindings** 部分添加资源

### 视觉示意

#### D1 数据库绑定
```
┌────────────────────────────────────────┐
│ Bindings                               │
├────────────────────────────────────────┤
│ D1 databases                           │
│ ┌──────────────────────────────────┐  │
│ │ Variable name: DB                │  │ <- 必须是 DB
│ │ D1 database: cloudpanel          │  │
│ │                                  │  │
│ │              [Save]              │  │
│ └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

#### KV 命名空间绑定
```
┌────────────────────────────────────────┐
│ KV namespace bindings                  │
│ ┌──────────────────────────────────┐  │
│ │ Variable name: KV                │  │ <- 必须是 KV
│ │ KV namespace: cloudpanel-kv      │  │
│ │                                  │  │
│ │              [Save]              │  │
│ └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### ✅ 检查点
- ✓ D1 绑定显示: `DB → cloudpanel`
- ✓ KV 绑定显示: `KV → cloudpanel-kv`

---

## 📋 步骤 6: 配置环境变量

### 操作说明
1. 在 Pages 项目的 **Settings** 中选择 **Environment variables**
2. 点击 **Add variable**
3. 添加所需的环境变量

### 环境变量配置表

```
┌──────────────────────┬────────┬───────────────────────────┐
│ 变量名               │ 必需   │ 说明                      │
├──────────────────────┼────────┼───────────────────────────┤
│ ENCRYPTION_KEY       │ ✅     │ 32+ 字符随机字符串        │
│ ADMIN_USER           │ ✅     │ 管理员用户名              │
│ ADMIN_PASSWORD       │ ✅     │ 管理员密码                │
│ TELEGRAM_BOT_TOKEN   │ ❌     │ Telegram Bot Token        │
│ TELEGRAM_ADMIN_ID    │ ❌     │ Telegram 用户 ID          │
└──────────────────────┴────────┴───────────────────────────┘
```

### 生成加密密钥

在本地终端运行:
```bash
openssl rand -hex 32
```

输出示例:
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0
```

### 视觉示意
```
Environment variables 页面:

┌────────────────────────────────────────────────┐
│ Production                                     │
├────────────────────────────────────────────────┤
│ Variable name          │ Value                 │
├────────────────────────┼───────────────────────┤
│ ENCRYPTION_KEY         │ a1b2c3d4e5f6...       │
│ ADMIN_USER             │ admin                 │
│ ADMIN_PASSWORD         │ SecurePass123!        │
│ TELEGRAM_BOT_TOKEN     │ 123456:ABCdef...      │
│ TELEGRAM_ADMIN_ID      │ 123456789             │
└────────────────────────┴───────────────────────┘

                 [Add variable]
```

### ✅ 检查点
- ✓ `ENCRYPTION_KEY` 至少 32 个字符
- ✓ `ADMIN_USER` 和 `ADMIN_PASSWORD` 已设置
- ✓ 所有变量在 Production 环境下

---

## 📋 步骤 7: 重新部署并访问

### 操作说明
1. 进入 **Deployments** 标签
2. 找到最近的部署
3. 点击右侧的 **···** → **Retry deployment**
4. 等待部署完成

### 视觉示意
```
Deployments 页面:

┌────────────────────────────────────────────────┐
│ Production                                     │
├────────────────────────────────────────────────┤
│ ● Success  main@abc1234  2 min ago        ··· │ <- 点击菜单
│   ├─ Retry deployment                          │
│   ├─ View details                              │
│   └─ Rollback to this version                  │
└────────────────────────────────────────────────┘

部署进度:
┌────────────────────────────────────────────────┐
│ ⏳ Initializing build...                       │
│ ⏳ Building...                                  │
│ ⏳ Deploying...                                 │
│ ✅ Deployed                                     │
└────────────────────────────────────────────────┘
```

### 访问面板
```
URL: https://cloudpanel.pages.dev
      (或你的自定义域名)

┌────────────────────────────────────────┐
│  🔐 CloudPanel 登录                    │
│  ┌──────────────────────────────────┐ │
│  │ 用户名:                          │ │
│  │ ┌──────────────────────────────┐│ │
│  │ │ admin                        ││ │ <- 使用环境变量中的值
│  │ └──────────────────────────────┘│ │
│  │                                  │ │
│  │ 密码:                            │ │
│  │ ┌──────────────────────────────┐│ │
│  │ │ ••••••••••••                 ││ │
│  │ └──────────────────────────────┘│ │
│  │                                  │ │
│  │        [登录]                    │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### ✅ 检查点
- ✓ 部署状态显示 "Success"
- ✓ 可以访问面板 URL
- ✓ 可以使用管理员账号登录
- ✓ 登录后可以看到主界面

---

## 📋 步骤 8: (可选) 配置 Telegram Bot

### 创建 Bot
```
与 @BotFather 对话:

You: /newbot

BotFather: Alright, a new bot. How are we going to call it?

You: CloudPanel Admin Bot

BotFather: Good. Now let's choose a username for your bot.

You: cloudpanel_admin_bot

BotFather: Done! Your token is:
          123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### 获取 User ID
```
与 @userinfobot 对话:

You: /start

userinfobot: 
Your ID: 123456789
Username: @your_username
```

### 配置 Webhook
```
在浏览器访问:

https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://cloudpanel.pages.dev/api/telegram/webhook

返回:
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

### ✅ 检查点
- ✓ Bot 创建成功，获得 Token
- ✓ 获得 User ID
- ✓ Webhook 设置成功
- ✓ 在 Telegram 中向 Bot 发送 `/start` 有响应

---

## 📋 步骤 9: (可选) 部署定时任务 Worker

### 使用 Wrangler CLI
```bash
# 1. 安装 Wrangler
npm install -g wrangler

# 2. 登录
wrangler login

# 3. 进入 workers 目录
cd workers

# 4. 部署
wrangler deploy
```

### 部署进度
```
┌────────────────────────────────────────┐
│ $ wrangler deploy                      │
├────────────────────────────────────────┤
│ ⏳ Uploading...                         │
│ ⏳ Building...                          │
│ ✅ Deployed to:                         │
│    https://cloudpanel-scheduler.       │
│    your-subdomain.workers.dev          │
└────────────────────────────────────────┘
```

### Cron 触发时间
```
配置: 0 16 * * * (UTC)
     = 00:00 (北京时间)

每日执行流程:
┌────────────────────────────────────────┐
│ 00:00 北京时间                          │
│   ↓                                    │
│ Worker 定时触发                         │
│   ↓                                    │
│ 调用 Pages API                          │
│   ↓                                    │
│ 检查所有用户的 API 密钥                  │
│   ↓                                    │
│ 发送 Telegram 通知                      │
└────────────────────────────────────────┘
```

### 手动触发测试
```
访问: https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger

返回:
{
  "success": true,
  "message": "Health check completed",
  "timestamp": "2024-01-15T00:00:00.000Z"
}
```

### ✅ 检查点
- ✓ Worker 部署成功
- ✓ 手动触发测试成功
- ✓ 收到 Telegram 测试通知
- ✓ 等待第二天 00:00 验证自动执行

---

## 🎉 部署完成检查清单

```
✅ 基础部署
  ✓ GitHub 仓库 Fork 成功
  ✓ Cloudflare Pages 项目创建
  ✓ D1 数据库创建并迁移
  ✓ KV 命名空间创建
  ✓ 资源绑定完成
  ✓ 环境变量配置
  ✓ 可以访问面板并登录

✅ Telegram 功能 (可选)
  ✓ Bot 创建成功
  ✓ Webhook 配置成功
  ✓ 用户 Bot 设置完成

✅ 定时任务 (可选)
  ✓ Worker 部署成功
  ✓ Cron 触发配置
  ✓ 通知功能正常

✅ 进阶配置 (可选)
  ✓ 自定义域名绑定
  ✓ SSL 证书配置
  ✓ CDN 加速设置
```

---

## 🔍 常见问题可视化诊断

### 问题 1: 登录失败

```
问题诊断流程:

登录失败
  ↓
检查环境变量
  ├─ ADMIN_USER 设置了吗? ────→ 否 → 去 Settings → Environment variables 添加
  └─ ADMIN_PASSWORD 设置了吗? ─→ 否 → 去 Settings → Environment variables 添加
  ↓
重新部署了吗?
  └─ 否 → 去 Deployments → Retry deployment
  ↓
清除浏览器缓存
  └─ Ctrl+Shift+Delete → 清除 Cookies
  ↓
✅ 应该可以登录了
```

### 问题 2: API 报 500 错误

```
问题诊断流程:

API 500 错误
  ↓
检查 D1 绑定
  ├─ Variable name 是 "DB" 吗? ───→ 否 → 修改为 "DB"
  └─ 选择的数据库正确吗? ────────→ 否 → 选择正确的数据库
  ↓
检查 KV 绑定
  ├─ Variable name 是 "KV" 吗? ───→ 否 → 修改为 "KV"
  └─ 选择的命名空间正确吗? ──────→ 否 → 选择正确的命名空间
  ↓
检查 ENCRYPTION_KEY
  └─ 长度 >= 32 字符吗? ────────→ 否 → 生成新的密钥
  ↓
检查数据库迁移
  └─ 3 个脚本都执行了吗? ───────→ 否 → 在 D1 Console 执行
  ↓
✅ 应该解决了
```

### 问题 3: Telegram 通知不工作

```
问题诊断流程:

Telegram 无通知
  ↓
检查 Bot Token
  ├─ 格式正确吗? (数字:字母) ────→ 否 → 重新从 @BotFather 获取
  └─ 设置为环境变量了吗? ────────→ 否 → 添加到环境变量
  ↓
检查 User ID
  ├─ 是纯数字吗? ──────────────→ 否 → 重新从 @userinfobot 获取
  └─ 设置为环境变量了吗? ────────→ 否 → 添加到环境变量
  ↓
检查 Webhook
  └─ 访问 setWebhook URL ───────→ 返回 {"ok": true} 吗?
  ↓
重新部署
  └─ Deployments → Retry deployment
  ↓
测试 Bot
  └─ 发送 /start 给 Bot ────────→ 有回复吗?
  ↓
✅ 应该可以收到通知了
```

---

## 📚 相关文档

- 📖 [README.md](./README.md) - 项目概述
- 🛠️ [CF_DEPLOYMENT_GUIDE.md](./CF_DEPLOYMENT_GUIDE.md) - CLI 部署指南
- ⏰ [SCHEDULED_DEPLOYMENT_GUIDE.md](./SCHEDULED_DEPLOYMENT_GUIDE.md) - 定时任务详细指南
- 🤖 [TELEGRAM_BOT_MANUAL.md](./TELEGRAM_BOT_MANUAL.md) - Bot 使用手册

---

## 💡 提示和技巧

### 加速部署
```
使用 Cloudflare Workers 镜像加速 npm 安装:

NPM_CONFIG_REGISTRY=https://registry.npmmirror.com npm install
```

### 查看实时日志
```
Pages 项目 → Functions → 
选择任意函数 → View logs

可以看到:
- API 调用记录
- 错误堆栈
- 性能指标
```

### 自定义域名
```
1. Pages 项目 → Custom domains
2. 添加你的域名: panel.example.com
3. 添加 DNS 记录:
   类型: CNAME
   名称: panel
   目标: cloudpanel.pages.dev
4. 等待 SSL 证书自动签发 (约 5-15 分钟)
```

---

**祝您部署成功！🎉**
