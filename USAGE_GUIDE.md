# 🎯 CloudPanel Docker版本 - 完整使用指南

## 📚 目录

1. [快速开始](#快速开始)
2. [部署步骤](#部署步骤)
3. [配置说明](#配置说明)
4. [使用说明](#使用说明)
5. [常见问题](#常见问题)
6. [文档索引](#文档索引)

---

## 🚀 快速开始

### 最快部署方式（3步）

```bash
# 1. 环境检查
./check-environment.sh

# 2. 快速启动（自动配置）
./start-docker.sh

# 3. 访问面板
# 打开浏览器访问: http://localhost:3000
```

就这么简单！🎉

---

## 📋 部署步骤

### 步骤1：准备环境

**系统要求**：
- Docker 20.10+
- Docker Compose 2.0+
- 2GB+ 内存
- 10GB+ 磁盘

**验证安装**：
```bash
docker --version
docker-compose --version
```

### 步骤2：获取代码

```bash
# 如果是Git仓库
git clone <your-repo-url>
cd cloudpanel

# 或者直接使用已有代码
cd /path/to/cloudpanel
```

### 步骤3：配置环境

#### 方式A：自动配置（推荐）
```bash
./start-docker.sh
# 脚本会自动：
# - 创建.env文件
# - 生成随机密钥
# - 提示你设置管理员账户
```

#### 方式B：手动配置
```bash
# 1. 复制配置模板
cp .env.example .env

# 2. 生成加密密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. 编辑.env文件
nano .env

# 必须修改的配置：
ENCRYPTION_KEY=<生成的64字符密钥>
SESSION_SECRET=<生成的随机字符串>
ADMIN_USER=your_username
ADMIN_PASSWORD=your_strong_password
```

### 步骤4：启动服务

```bash
# 后台启动
docker-compose up -d

# 查看启动日志
docker-compose logs -f
```

等待提示"CloudPanel 服务器已启动"

### 步骤5：访问面板

1. 打开浏览器
2. 访问：`http://localhost:3000`
3. 使用配置的管理员账户登录

---

## ⚙️ 配置说明

### 核心配置（必须）

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `ENCRYPTION_KEY` | API密钥加密（64字符hex） | `3d4d51...95a394` |
| `SESSION_SECRET` | Session加密 | `random-secret-key` |
| `ADMIN_USER` | 管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理员密码 | `YourStr0ngP@ss!` |

### 可选配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `DATABASE_PATH` | 数据库路径 | `/app/data/cloudpanel.db` |
| `SESSION_DURATION` | Session有效期(ms) | `86400000` (24小时) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `TELEGRAM_ADMIN_ID` | Telegram管理员ID | - |
| `SCHEDULED_CHECK_TIME` | 定时检查时间 | `00:00` |

### Telegram配置（可选）

如需启用Telegram通知：

1. 与[@BotFather](https://t.me/BotFather)对话创建Bot
2. 获取Bot Token
3. 获取你的Chat ID（可以使用[@userinfobot](https://t.me/userinfobot)）
4. 配置到.env：
   ```bash
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   TELEGRAM_ADMIN_ID=123456789
   ```

---

## 📖 使用说明

### 首次登录

1. 访问 `http://localhost:3000`
2. 输入管理员账户
3. 建议立即修改密码

### 添加云服务商API密钥

1. 点击"API密钥管理"
2. 选择云服务商（DigitalOcean/Linode/Azure）
3. 输入API密钥
4. 系统会自动验证和加密存储

### 管理服务器实例

1. 选择API密钥
2. 查看现有实例
3. 创建新实例：
   - 选择区域
   - 选择镜像
   - 选择配置
   - 设置名称和标签
4. 管理实例：
   - 启动/停止/重启
   - 查看详情
   - 删除实例

### 配置Telegram通知

1. 在用户设置中配置个人Bot
2. 设置通知时间
3. 启用通知
4. 系统会定时检查API密钥健康状态并通知

---

## 🔧 常用操作

### 日志管理

```bash
# 实时查看所有日志
docker-compose logs -f

# 只看最近100行
docker-compose logs --tail=100

# 只看错误日志
docker-compose logs | grep -i error
```

### 服务管理

```bash
# 重启服务
docker-compose restart

# 停止服务
docker-compose stop

# 启动服务
docker-compose start

# 查看状态
docker-compose ps
```

### 数据管理

```bash
# 备份数据
docker run --rm \
  -v cloudpanel_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/cloudpanel-backup.tar.gz -C /data .

# 恢复数据
docker run --rm \
  -v cloudpanel_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar xzf /backup/cloudpanel-backup.tar.gz -C /data

# 查看数据
docker run --rm \
  -v cloudpanel_data:/data \
  alpine ls -lah /data
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 查看日志确认
docker-compose logs -f
```

### 清理重置

```bash
# 完全重置（会删除所有数据！）
docker-compose down -v
rm -f .env

# 重新开始
./start-docker.sh
```

---

## ❓ 常见问题

### Q1: 端口3000已被占用怎么办？

**答**：修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "8080:3000"  # 改为使用8080端口
```
然后访问 `http://localhost:8080`

### Q2: 忘记管理员密码怎么办？

**答**：
```bash
# 1. 停止服务
docker-compose stop

# 2. 修改.env中的ADMIN_PASSWORD
nano .env

# 3. 删除用户数据库（会重新创建管理员）
docker run --rm \
  -v cloudpanel_data:/data \
  alpine sh -c "rm /data/cloudpanel.db*"

# 4. 重启服务
docker-compose up -d
```

### Q3: API密钥显示为"失效"？

**答**：
1. 检查API密钥是否正确
2. 检查云服务商API是否可访问
3. 查看详细错误日志
4. 如需要，删除后重新添加

### Q4: 如何配置HTTPS？

**答**：使用反向代理（详见[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)）：
- Nginx
- Caddy（自动HTTPS）
- Traefik

### Q5: 数据存储在哪里？

**答**：
- Docker卷：`cloudpanel_data`
- 包含：数据库、Session、缓存
- 删除容器不会删除数据
- 使用 `docker-compose down -v` 会删除数据

### Q6: 如何从Cloudflare版本迁移？

**答**：查看[迁移指南](./DOCKER_DEPLOYMENT.md#-从cloudflare迁移)

### Q7: 服务无法启动？

**答**：
```bash
# 查看详细日志
docker-compose logs cloudpanel

# 常见原因：
# 1. 端口被占用
# 2. .env配置错误
# 3. Docker资源不足

# 检查环境
./check-environment.sh
```

### Q8: 如何修改数据库路径？

**答**：不建议修改。如必须修改，需要：
1. 修改.env中的`DATABASE_PATH`
2. 修改docker-compose.yml中的卷挂载
3. 重新创建容器

---

## 📚 文档索引

### 核心文档

- **[DOCKER_README.md](./DOCKER_README.md)** - 快速入门
- **[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)** - 详细部署指南
- **[DOCKER_MIGRATION_REPORT.md](./DOCKER_MIGRATION_REPORT.md)** - 重构完整报告
- **[DOCKER_CHANGELOG.md](./DOCKER_CHANGELOG.md)** - 版本变更记录

### 配置文件

- **[.env.example](./.env.example)** - 环境变量模板
- **[docker-compose.yml](./docker-compose.yml)** - Docker编排配置
- **[Dockerfile](./Dockerfile)** - Docker镜像构建

### 脚本工具

- **[start-docker.sh](./start-docker.sh)** - 快速启动脚本
- **[check-environment.sh](./check-environment.sh)** - 环境检查脚本

### 原项目文档

- **[README.md](./README.md)** - 原完整说明（包含Cloudflare部署）
- **[migrations/](./migrations/)** - 数据库迁移文件

---

## 🎯 快速命令参考

```bash
# 环境检查
./check-environment.sh

# 快速启动
./start-docker.sh

# 查看日志
docker-compose logs -f

# 重启
docker-compose restart

# 停止
docker-compose stop

# 更新
git pull && docker-compose up -d --build

# 备份
docker run --rm -v cloudpanel_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/backup-$(date +%Y%m%d).tar.gz -C /data .

# 完全重置（危险！）
docker-compose down -v
```

---

## 💡 最佳实践

### 安全

1. ✅ 使用强密码
2. ✅ 定期备份数据
3. ✅ 配置HTTPS
4. ✅ 限制访问IP（通过防火墙）
5. ✅ 妥善保管ENCRYPTION_KEY

### 性能

1. ✅ 配置资源限制
2. ✅ 启用日志轮转
3. ✅ 定期清理旧数据
4. ✅ 使用SSD存储

### 维护

1. ✅ 定期更新镜像
2. ✅ 监控日志
3. ✅ 定期测试备份恢复
4. ✅ 关注安全公告

---

## 🆘 获取帮助

如果遇到问题：

1. 📖 查看本文档
2. 📋 查看详细日志：`docker-compose logs -f`
3. 🔍 搜索已知问题
4. 💬 提交Issue（包含日志和环境信息）

---

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE)

---

**祝使用愉快！** 🎉

如有问题，请参考文档或提交Issue。
