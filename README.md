# ☁️ CloudPanel

> 现代化多云服务器管理面板 - 支持 Docker / Zeabur / Cloudflare Pages 部署


[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker)](https://github.com/7d653179z/dla/pkgs/container/dla)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?logo=cloudflare)](https://pages.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ✨ 功能特性

### 🖥️ 多云管理
- 🌊 **DigitalOcean** - 完整的 Droplet 管理
- 🦈 **Linode** - Linode 实例管理
- ☁️ **Azure** - Azure 虚拟机管理
- 🔄 支持多个 API 密钥切换

### 🔄 自动补机
- 🛡️ **双重保险机制** - 监控机器状态，失效自动补机
- 📋 **补机任务** - 创建任务绑定机器和密钥
- 📁 **开机模板** - 保存服务器配置快速部署
- 🔁 **自动监控** - 新机器自动加入监控列表
- 📊 **补机日志** - 查看历史补机记录

### 🎨 现代化界面
- 🌓 **深色/浅色模式** - 自动适配系统主题
- 📱 **响应式设计** - 完美支持移动端
- 🎭 **动态背景** - 炫酷的渐变动画
- ⚡ **实时更新** - 自动刷新服务器状态

### 🤖 Telegram 集成
- 📬 **双Bot系统** - 管理员Bot + 用户个人Bot
- ⏰ **定时健康检查** - 自动检测 API 密钥状态
- 🔔 **实时通知** - 密钥失效/补机结果即时提醒

### 🔒 安全特性
- 🔐 **密码强度检查** - 实时评分和提示
- 🔑 **API 密钥加密** - AES-256-GCM 加密存储
- 👤 **用户认证** - 基于 Session 的安全认证
- ⏱️ **频率限制** - 防止暴力破解

---

## 🚀 快速部署

### 方式一：Zeabur 部署（推荐）

1. 登录 [Zeabur Dashboard](https://dash.zeabur.com)
2. 创建新项目 → **Add Service** → **Prebuilt Image**
3. 输入镜像：`ghcr.io/7d653179z/dla:latest`
4. 配置端口 `3000`，添加持久化卷 `/app/data`
5. 生成域名访问

### 方式二：Docker 部署

\`\`\`bash
# 拉取镜像
docker pull ghcr.io/7d653179z/dla:latest

# 运行容器（开箱即用，无需配置环境变量）
docker run -d \\
  --name cloudpanel \\
  -p 3000:3000 \\
  -v cloudpanel_data:/app/data \\
  ghcr.io/7d653179z/dla:latest
\`\`\`

或使用 Docker Compose:

\`\`\`yaml
version: '3.8'
services:
  cloudpanel:
    image: ghcr.io/7d653179z/dla:latest
    container_name: cloudpanel
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
\`\`\`

### 方式三：Cloudflare Pages 部署

详见 [CF_DEPLOYMENT_GUIDE.md](CF_DEPLOYMENT_GUIDE.md)

---

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ENCRYPTION_KEY` | ❌ | API密钥加密密钥（64字符hex），已内置默认值 |
| `JWT_SECRET` | ❌ | JWT签名密钥，已内置默认值 |
| \`ADMIN_USERNAME\` | ❌ | 管理员用户名，默认 \`admin\` |
| \`ADMIN_PASSWORD\` | ❌ | 管理员初始密码 |

### 生成密钥

\`\`\`bash
# 生成 ENCRYPTION_KEY (32字符)
openssl rand -hex 16

# 生成 JWT_SECRET
openssl rand -hex 32
\`\`\`

---

## 📖 使用指南

### 添加 API 密钥

1. 登录后点击右上角用户菜单
2. 选择 "API密钥管理"
3. 点击 "添加 API 密钥"
4. 填写名称、选择云服务商、输入密钥

### 配置自动补机

1. 用户菜单 → "自动补机"
2. 点击 "添加任务"
3. 选择要监控的 API 密钥和机器
4. 选择补机模板
5. 设置检查间隔
6. 启用任务

### 保存开机模板

1. 在创建实例时配置好参数
2. 点击 "另存为模板"
3. 输入模板名称保存

---

## 🔧 开发

\`\`\`bash
# 克隆项目
git clone https://github.com/7d653179z/dla.git
cd dla

# 安装依赖
npm install

# 本地运行 (Docker)
docker-compose up -d

# 访问
open http://localhost:3000
\`\`\`

---

## 📁 项目结构

\`\`\`
├── functions/           # 后端 API
│   ├── api/            # API 端点
│   │   ├── apikeys/    # API 密钥管理
│   │   ├── instances/  # 实例管理
│   │   ├── auto-replenish/  # 自动补机
│   │   └── templates/  # 模板管理
│   ├── shared/         # 共享模块
│   └── server.ts       # 服务器入口
├── migrations/         # 数据库迁移
├── index.html          # 前端页面
├── Dockerfile          # Docker 构建
└── docker-compose.yml  # Docker Compose
\`\`\`

---

## 📄 文档

- [Zeabur 部署指南](ZEABUR_DEPLOY.md)
- [Docker 部署指南](DOCKER_DEPLOYMENT.md)
- [Cloudflare 部署指南](CF_DEPLOYMENT_GUIDE.md)
- [使用指南](USAGE_GUIDE.md)
- [Telegram Bot 设置](TELEGRAM_SETUP.md)

---

## 📝 更新日志

### v2.0.0 (2024-12-31)
- ✨ 新增 Docker 支持
- ✨ 新增自动补机功能
- ✨ 新增开机模板管理
- ✨ 新增 Zeabur 一键部署
- 🐛 修复多项 bug

---

## 📜 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

## 🙏 致谢

- [Cloudflare](https://cloudflare.com) - Pages & Workers 平台
- [Zeabur](https://zeabur.com) - 一键部署平台
- [DigitalOcean](https://digitalocean.com) - 云服务商
- [Linode](https://linode.com) - 云服务商
- [Azure](https://azure.microsoft.com) - 云服务商
