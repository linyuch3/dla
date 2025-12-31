# CloudPanel Docker版本更新日志

## 🎉 v2.0.0 - Docker重构版本

### 重大变更

- ✨ **Docker化部署**：完全重构为支持Docker部署
  - 提供Dockerfile和docker-compose.yml
  - 支持一键启动和部署
  - 数据持久化到Docker卷

- 🔄 **运行时切换**：从Cloudflare Workers迁移到Node.js
  - 使用Express框架替代Cloudflare Functions
  - 完全兼容的API接口
  - 保持所有原有功能

- 💾 **存储适配**：本地化存储方案
  - SQLite替代D1数据库
  - 文件系统替代KV存储
  - 完全兼容的数据库接口

### 新增功能

- 🐳 Docker部署支持
  - 多阶段构建优化镜像大小
  - 健康检查配置
  - 资源限制支持

- 📝 环境变量配置
  - .env文件配置
  - 详细的配置文档
  - 安全的密钥管理

- 🔒 增强的安全性
  - Session管理优化
  - 非root用户运行
  - 完善的CORS策略

- 📊 定时任务
  - Cron调度器
  - API密钥健康检查
  - Telegram通知支持

### 技术栈更新

- **运行时**: Cloudflare Workers → Node.js 20
- **框架**: Cloudflare Functions → Express 4
- **数据库**: D1 → SQLite (better-sqlite3)
- **存储**: KV → 文件系统
- **构建**: Wrangler → TypeScript + TSX

### 保留功能

✅ 所有原有功能完整保留：
- 多云服务商支持（DigitalOcean, Linode, Azure）
- API密钥管理
- 服务器实例管理
- 用户认证和权限
- Telegram通知
- 定时健康检查
- 现代化UI界面

### 迁移指南

从Cloudflare版本迁移：

1. 导出Cloudflare D1数据库
2. 使用相同的ENCRYPTION_KEY
3. 导入数据到SQLite
4. 配置环境变量
5. 启动Docker容器

详见：[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

### 文件结构变化

```
新增文件:
├── Dockerfile                    # Docker镜像构建
├── docker-compose.yml            # Docker Compose配置
├── .dockerignore                 # Docker忽略文件
├── .env.example                  # 环境变量示例
├── start-docker.sh               # 快速启动脚本
├── DOCKER_DEPLOYMENT.md          # Docker部署文档
└── functions/
    ├── server.ts                 # Express服务器主文件
    ├── config.ts                 # 配置管理
    ├── scheduler.ts              # 定时任务调度
    ├── middleware/               # Express中间件
    │   ├── cors.ts
    │   ├── session.ts
    │   ├── auth.ts
    │   └── error-handler.ts
    ├── routes/                   # 路由系统
    │   ├── index.ts
    │   └── api-loader.ts
    └── shared/
        ├── db-adapter.ts         # SQLite适配器
        ├── kv-adapter.ts         # KV存储适配器
        └── db-init.ts            # 数据库初始化

保留文件:
- 所有API端点文件（functions/api/）
- 数据库迁移文件（migrations/）
- 前端文件（index.html）
- 共享模块（functions/shared/）
```

### 已知问题

- 暂时不支持Cloudflare Cron Triggers的精确时间配置
  - 解决方案：使用node-cron实现本地定时任务

### 未来计划

- [ ] 支持PostgreSQL/MySQL等数据库
- [ ] 集群部署支持
- [ ] Kubernetes部署配置
- [ ] 性能监控和指标收集
- [ ] API文档生成
- [ ] 自动备份功能

---

**完整文档**: [README.md](./README.md) | [部署指南](./DOCKER_DEPLOYMENT.md)
