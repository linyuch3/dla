# CloudPanel Docker 版本 - 快速开始

这是CloudPanel的Docker版本，支持本地部署和自托管。

## 🚀 快速启动

### 使用自动化脚本（推荐）

```bash
# 给脚本添加执行权限
chmod +x start-docker.sh

# 运行启动脚本
./start-docker.sh
```

### 手动启动

```bash
# 1. 复制配置文件
cp .env.example .env

# 2. 编辑配置（必须修改密钥和管理员账户）
nano .env

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f
```

## 📝 访问面板

启动成功后，访问：**http://localhost:3000**

默认管理员账户（请在.env中修改）：
- 用户名: admin
- 密码: admin123

## 📚 完整文档

- [Docker部署指南](./DOCKER_DEPLOYMENT.md) - 详细的部署说明
- [更新日志](./DOCKER_CHANGELOG.md) - 版本更新说明
- [原README](./README.md) - 项目完整说明

## ✨ 主要特性

- 🐳 **Docker一键部署** - 无需复杂配置
- 💾 **数据持久化** - 使用Docker卷保存数据
- 🔒 **安全可靠** - 加密存储，Session管理
- 🌐 **多云支持** - DigitalOcean, Linode, Azure
- 🤖 **Telegram通知** - API密钥健康监控
- ⏰ **定时任务** - 自动健康检查

## 🛠️ 常用命令

```bash
# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose stop

# 完全删除（包括数据）
docker-compose down -v

# 更新应用
git pull && docker-compose up -d --build
```

## 🔧 故障排查

如果遇到问题：

1. 查看日志：`docker-compose logs -f cloudpanel`
2. 检查端口：`lsof -i :3000`
3. 重启服务：`docker-compose restart`

详见：[Docker部署指南 - 故障排查章节](./DOCKER_DEPLOYMENT.md#-故障排查)

## 📦 系统要求

- Docker 20.10+
- Docker Compose 2.0+
- 2GB+ 内存
- 10GB+ 磁盘空间

## 🔄 从Cloudflare迁移

如果你之前使用Cloudflare版本，查看[迁移指南](./DOCKER_DEPLOYMENT.md#-从cloudflare迁移)

## 📞 支持

- 提交Issue: GitHub Issues
- 查看文档: [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

---

**提示**: 首次启动时会自动创建数据库和管理员账户，请等待启动完成后再访问面板。
