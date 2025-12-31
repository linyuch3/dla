# 🐳 CloudPanel Docker 部署指南

本指南将帮助你使用Docker快速部署CloudPanel云服务器管理面板。

## 📋 系统要求

- Docker 20.10+
- Docker Compose 2.0+
- 2GB+ 可用内存
- 10GB+ 可用磁盘空间

## 🚀 快速开始

### 1. 克隆或下载项目

```bash
git clone <your-repo-url>
cd cloudpanel
```

### 2. 配置环境变量

复制示例配置文件并修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件，**必须修改**以下配置：

```bash
# 生成新的加密密钥（必须是64字符的十六进制字符串）
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 生成Session密钥
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 修改管理员账户
ADMIN_USER=your_admin_username
ADMIN_PASSWORD=your_strong_password
```

### 3. 启动服务

```bash
# 方式1: 使用 docker-compose（推荐）
docker-compose up -d

# 方式2: 使用 docker build + run
docker build -t cloudpanel .
docker run -d \
  --name cloudpanel \
  -p 3000:3000 \
  -v cloudpanel_data:/app/data \
  --env-file .env \
  cloudpanel
```

### 4. 访问面板

打开浏览器访问：`http://localhost:3000`

使用你在 `.env` 中设置的管理员账户登录。

## 📝 详细配置说明

### 环境变量配置

| 变量名 | 说明 | 默认值 | 必填 |
|--------|------|--------|------|
| `NODE_ENV` | 运行环境 | production | 否 |
| `PORT` | 服务端口 | 3000 | 否 |
| `DATABASE_PATH` | 数据库文件路径 | /app/data/cloudpanel.db | 否 |
| `ENCRYPTION_KEY` | API密钥加密密钥（64字符hex） | - | **是** |
| `SESSION_SECRET` | Session加密密钥 | - | **是** |
| `SESSION_DURATION` | Session有效期（毫秒） | 86400000 | 否 |
| `ADMIN_USER` | 管理员用户名 | admin | 否 |
| `ADMIN_PASSWORD` | 管理员密码 | admin123 | 否 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（可选） | - | 否 |
| `TELEGRAM_ADMIN_ID` | Telegram管理员ID（可选） | - | 否 |
| `SCHEDULED_CHECK_TIME` | 定时检查时间（HH:MM UTC） | 00:00 | 否 |

### 数据持久化

数据存储在Docker卷 `cloudpanel_data` 中，包括：

- SQLite数据库文件
- Session存储
- 其他临时数据

**备份数据：**

```bash
# 导出数据卷
docker run --rm \
  -v cloudpanel_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/cloudpanel-$(date +%Y%m%d).tar.gz -C /data .

# 恢复数据
docker run --rm \
  -v cloudpanel_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar xzf /backup/cloudpanel-20231215.tar.gz -C /data
```

## 🔧 常用命令

### 查看日志

```bash
# 实时查看日志
docker-compose logs -f

# 查看最近100行日志
docker-compose logs --tail=100

# 只看cloudpanel服务的日志
docker-compose logs -f cloudpanel
```

### 重启服务

```bash
docker-compose restart
```

### 停止服务

```bash
docker-compose stop
```

### 完全删除（包括数据）

```bash
docker-compose down -v  # 警告：会删除所有数据！
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build
```

### 进入容器

```bash
docker-compose exec cloudpanel sh
```

## 🌐 反向代理配置

### Nginx

```nginx
server {
    listen 80;
    server_name panel.yourdomain.com;

    # HTTPS重定向（可选）
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Caddy

```caddy
panel.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### Traefik

```yaml
version: '3.8'

services:
  cloudpanel:
    # ... 其他配置 ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.cloudpanel.rule=Host(`panel.yourdomain.com`)"
      - "traefik.http.services.cloudpanel.loadbalancer.server.port=3000"
      - "traefik.http.routers.cloudpanel.tls.certresolver=myresolver"
```

## 🔒 安全建议

1. **修改默认密码**
   - 首次登录后立即修改管理员密码
   - 使用强密码（至少12位，包含大小写字母、数字和特殊字符）

2. **加密密钥安全**
   - 妥善保管 `ENCRYPTION_KEY`，丢失将无法解密已存储的API密钥
   - 不要将 `.env` 文件提交到版本控制系统

3. **网络安全**
   - 建议使用反向代理并启用HTTPS
   - 可以限制访问IP（通过防火墙或反向代理）
   - 定期更新Docker镜像

4. **数据备份**
   - 定期备份数据卷
   - 备份文件加密存储

## 🐛 故障排查

### 容器无法启动

```bash
# 查看详细错误日志
docker-compose logs cloudpanel

# 检查端口是否被占用
lsof -i :3000

# 检查数据卷权限
docker-compose exec cloudpanel ls -la /app/data
```

### 数据库错误

```bash
# 进入容器
docker-compose exec cloudpanel sh

# 检查数据库文件
ls -lh /app/data/
sqlite3 /app/data/cloudpanel.db "PRAGMA integrity_check;"
```

### 重置管理员密码

```bash
# 停止容器
docker-compose stop

# 修改.env中的ADMIN_PASSWORD

# 删除现有管理员账户并重启（会自动创建新的）
docker-compose start
```

### Session问题

```bash
# 清除所有session
docker-compose exec cloudpanel rm -rf /app/data/kv/*
docker-compose restart
```

## 📊 性能优化

### 资源限制

在 `docker-compose.yml` 中配置资源限制：

```yaml
services:
  cloudpanel:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '1'
          memory: 512M
```

### 日志管理

限制日志大小：

```yaml
services:
  cloudpanel:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 🔄 从Cloudflare迁移

如果你之前使用Cloudflare Pages版本，迁移步骤：

1. **导出数据**（从Cloudflare D1）
   - 使用 Cloudflare Dashboard 导出D1数据库
   - 导出API密钥信息

2. **导入数据**
   ```bash
   # 将导出的SQL导入到SQLite
   docker-compose exec cloudpanel sqlite3 /app/data/cloudpanel.db < backup.sql
   ```

3. **更新配置**
   - 使用相同的 `ENCRYPTION_KEY`（重要！）
   - 配置其他环境变量

## 📞 支持

遇到问题？

- 查看日志：`docker-compose logs -f`
- 检查[Issues](https://github.com/your-repo/issues)
- 提交新Issue

## 📄 许可证

MIT License
