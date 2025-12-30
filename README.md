# ☁️ CloudPanel

> 一个运行在 Cloudflare Pages 的现代化多云服务器管理面板

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?logo=cloudflare)](https://pages.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ✨ 功能特性

### 🖥️ 多云管理
- 🌊 **DigitalOcean** - 完整的 Droplet 管理
- 🦈 **Linode** - Linode 实例管理
- ☁️ **Azure** - Azure 虚拟机管理
- 🔄 支持多个 API 密钥切换

### 🎨 现代化界面
- 🌓 **深色/浅色模式** - 自动适配系统主题
- 📱 **响应式设计** - 完美支持移动端
- 🎭 **动态背景** - 炫酷的渐变动画
- ⚡ **实时更新** - 自动刷新服务器状态

### 🤖 Telegram 集成
- 📬 **双Bot系统** - 管理员Bot + 用户个人Bot
- ⏰ **定时健康检查** - 每日自动检测 API 密钥状态
- 🔔 **实时通知** - 密钥失效即时提醒
- 🔍 **远程管理** - 通过 Telegram 管理服务器

### 🔒 安全特性
- 🔐 **密码强度检查** - 实时评分和提示
- 🔑 **API 密钥加密** - AES-256-GCM 加密存储
- 👤 **用户认证** - 基于 Session 的安全认证
- ⏱️ **频率限制** - 防止暴力破解

---

## 🚀 快速部署

### 📋 前置要求

- ✅ Cloudflare 账号（免费）
- ✅ GitHub 账号（用于代码托管）
- ✅ Git 仓库（Fork 本项目或上传代码）

### 🎯 一键部署到 Cloudflare Pages

#### 步骤 1: Fork 本项目

1. 点击 GitHub 页面右上角的 **Fork** 按钮
2. 等待 Fork 完成

#### 步骤 2: 创建 Cloudflare Pages 项目

<details>
<summary>📸 点击查看详细步骤</summary>

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application** → **Pages**
3. 点击 **Connect to Git**
4. 选择你 Fork 的仓库
5. 配置构建设置:
   ```
   Framework preset: None
   Build command: (留空)
   Build output directory: /
   ```
6. 点击 **Save and Deploy**

</details>

#### 步骤 3: 配置数据库和存储

<details>
<summary>🗄️ 创建 D1 数据库</summary>

1. 进入 **Workers & Pages** → **D1**
2. 点击 **Create database**
3. 数据库名称: `cloudpanel`（或任意名称）
4. 点击 **Create**

**运行数据库迁移:**

1. 进入刚创建的 D1 数据库
2. 点击 **Console** 标签
3. 依次执行以下 SQL 脚本:

```bash
# 第一步 - 基础表结构
migrations/0001_initial.sql

# 第二步 - Telegram 通知
migrations/0002_add_telegram_notifications.sql

# 第三步 - API 健康检查
migrations/0003_add_api_key_health_status.sql
```

复制每个文件的内容到 Console 中执行。

</details>

<details>
<summary>💾 创建 KV 命名空间</summary>

1. 进入 **Workers & Pages** → **KV**
2. 点击 **Create a namespace**
3. 命名空间名称: `cloudpanel-kv`（或任意名称）
4. 点击 **Add**

</details>

#### 步骤 4: 绑定资源到 Pages

<details>
<summary>🔗 添加数据库和 KV 绑定</summary>

1. 返回你的 Pages 项目
2. 进入 **Settings** → **Functions** → **Bindings**

**添加 D1 绑定:**
- 点击 **Add binding**
- 选择 **D1 database**
- Variable name: `DB` (必须是这个名称)
- D1 database: 选择刚创建的数据库
- 点击 **Save**

**添加 KV 绑定:**
- 点击 **Add binding**
- 选择 **KV namespace**
- Variable name: `KV` (必须是这个名称)
- KV namespace: 选择刚创建的命名空间
- 点击 **Save**

</details>

#### 步骤 5: 配置环境变量

进入 **Settings** → **Environment variables**

| 变量名 | 必需 | 说明 | 示例 |
|--------|------|------|------|
| `ENCRYPTION_KEY` | ✅ | API 密钥加密密钥 (≥32字符) | 使用 `openssl rand -hex 32` 生成 |
| `ADMIN_USER` | ✅ | 默认管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | ✅ | 默认管理员密码 | `SecurePass123!` |
| `TELEGRAM_BOT_TOKEN` | ❌ | 管理员 Bot Token | `123456:ABC...` |
| `TELEGRAM_ADMIN_ID` | ❌ | 管理员 Telegram ID | `123456789` |

💡 **提示:** 
- `ENCRYPTION_KEY` 必须至少 32 个字符，用于加密 API 密钥
- 可以使用这个命令生成: `openssl rand -hex 32`

#### 步骤 6: 触发重新部署

1. 进入 **Deployments** 标签
2. 点击最近的部署右侧的 **···** → **Retry deployment**
3. 等待部署完成（约 1-2 分钟）

#### 步骤 7: 访问你的面板 🎉

部署成功后，你会获得一个 URL:
```
https://your-project-name.pages.dev
```

使用你在环境变量中设置的 `ADMIN_USER` 和 `ADMIN_PASSWORD` 登录！

---

## 🤖 Telegram Bot 设置（可选）

<details>
<summary>📱 创建和配置 Telegram Bot</summary>

### 创建 Telegram Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新 Bot
3. 按提示设置名称和用户名
4. 获取 Bot Token (格式: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 获取 Telegram User ID

1. 找到 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 记录你的 User ID

### 用户个人 Bot 设置

1. 登录 CloudPanel
2. 点击右上角头像 → **用户设置**
3. 在 **Telegram 通知** 标签页:
   - 填写个人 Bot Token
   - 填写个人 User ID
   - 开启通知开关
   - 点击 **保存设置**

详细说明请参考: [用户 Bot 设置指南](./USER_BOT_SETUP.md)

</details>

---

## ⏰ 定时健康检查设置

<details>
<summary>⚙️ 部署 Cloudflare Worker 定时任务</summary>

### 方法 1: 使用 Wrangler CLI

1. 安装 Wrangler CLI:
```bash
npm install -g wrangler
```

2. 登录 Cloudflare:
```bash
wrangler login
```

3. 部署 Worker:
```bash
cd workers
wrangler deploy
```

4. Worker 会在每天北京时间 00:00 自动执行健康检查

### 方法 2: 通过 Dashboard 可视化部署

参考详细指南: [定时任务部署指南](./SCHEDULED_DEPLOYMENT_GUIDE.md)

### 手动触发测试

访问:
```
https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger
```

</details>

---

## 📚 完整文档

- 📖 [GUI 可视化部署指南](./GUI_DEPLOYMENT_GUIDE.md) - 通过 Cloudflare 仪表板部署
- 🛠️ [CLI 命令行部署指南](./CF_DEPLOYMENT_GUIDE.md) - 使用 Wrangler CLI 部署
- ⏰ [定时任务部署指南](./SCHEDULED_DEPLOYMENT_GUIDE.md) - 配置定时健康检查
- 🤖 [Telegram Bot 使用手册](./TELEGRAM_BOT_MANUAL.md) - Bot 命令和功能
- 👤 [用户 Bot 设置指南](./USER_BOT_SETUP.md) - 配置个人通知 Bot
- 📱 [Telegram 设置教程](./TELEGRAM_SETUP.md) - 创建和配置 Bot

---

## 📁 项目结构

```
cloudpanel/
├── functions/              # Cloudflare Pages Functions (后端 API)
│   ├── api/
│   │   ├── auth/          # 认证相关 (登录/注册/登出)
│   │   ├── instances/     # 实例管理
│   │   ├── apikeys/       # API 密钥管理
│   │   ├── telegram/      # Telegram Bot 接口
│   │   ├── admin/         # 管理功能 (定时任务等)
│   │   └── user/          # 用户设置
│   └── shared/            # 共享工具 (认证/加密/数据库)
├── workers/               # Cloudflare Workers (定时任务)
│   ├── scheduled-health-check.js
│   └── wrangler.toml
├── migrations/            # 数据库迁移脚本
│   ├── 0001_initial.sql
│   ├── 0002_add_telegram_notifications.sql
│   └── 0003_add_api_key_health_status.sql
├── index.html             # 前端单页应用
├── _headers               # Cloudflare Pages 头部配置
├── _routes.json           # 路由配置
└── README.md
```

---

## 🛠️ 技术栈

### 前端
- **纯 HTML/CSS/JavaScript** - 无框架依赖
- **现代 CSS** - CSS Variables, Flexbox, Grid
- **响应式设计** - 移动端友好

### 后端
- **Cloudflare Pages Functions** - Serverless 后端
- **TypeScript** - 类型安全
- **D1 Database** - Serverless SQL 数据库
- **KV Storage** - 键值存储

### 云服务 SDK
- **DigitalOcean API v2**
- **Linode API v4**
- **Azure SDK**

---

## 🐛 常见问题

<details>
<summary>❓ 无法登录</summary>

- 检查 `ADMIN_USER` 和 `ADMIN_PASSWORD` 环境变量是否正确设置
- 清除浏览器缓存和 Cookies
- 确认已触发重新部署

</details>

<details>
<summary>❓ API 密钥添加失败</summary>

- 验证 API 密钥是否正确
- 检查云服务商 API 访问权限
- 查看浏览器控制台错误信息

</details>

<details>
<summary>❓ Telegram 通知不工作</summary>

- 确认 Bot Token 正确
- 检查 User ID 是否正确
- 在用户设置中开启通知开关
- 查看 Worker 日志排查错误

</details>

<details>
<summary>❓ D1 数据库错误</summary>

- 确认已运行所有 3 个迁移脚本
- 检查 D1 绑定的 Variable name 是否为 `DB`
- 查看 Pages Functions 日志

</details>

<details>
<summary>❓ 访问 404 错误</summary>

- 确认 Pages 项目已部署到 Production 环境
- 检查 `_routes.json` 配置是否正确
- 确认 `functions/` 目录结构完整

</details>

---

## 🔧 高级配置

### 自定义域名

1. 进入 Pages 项目 → **Custom domains**
2. 点击 **Set up a custom domain**
3. 输入你的域名
4. 按照提示添加 DNS 记录

### 环境变量完整列表

| 变量名 | 必需 | 说明 | 默认值 |
|--------|------|------|--------|
| `ENCRYPTION_KEY` | ✅ | API 密钥加密密钥 (≥32字符) | - |
| `ADMIN_USER` | ✅ | 默认管理员用户名 | - |
| `ADMIN_PASSWORD` | ✅ | 默认管理员密码 | - |
| `SESSION_DURATION` | ❌ | Session 有效期 (毫秒) | `86400000` (24小时) |
| `TELEGRAM_BOT_TOKEN` | ❌ | 管理员 Bot Token | - |
| `TELEGRAM_ADMIN_ID` | ❌ | 管理员 Telegram ID | - |
| `PANEL_URL` | ❌ | 面板 URL (用于通知链接) | - |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**
