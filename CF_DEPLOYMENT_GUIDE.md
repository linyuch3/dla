# CloudPanel Cloudflare Pages 部署指南

## 前提条件

1. **Cloudflare 账户** - [注册免费账户](https://cloudflare.com/)
2. **Node.js** - 版本 18+ 
3. **Git** - 代码版本控制

## 第一步：准备项目

### 1. 安装依赖

```bash
npm install
```

### 2. 生成密钥

```bash
# 生成加密密钥
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"

# 生成会话密钥  
node -e "console.log('ADMIN_PASSWORD=' + require('crypto').randomBytes(16).toString('hex'))"
```

保存生成的密钥，稍后配置时需要。

## 第二步：创建 Cloudflare 资源

### 1. 创建 D1 数据库

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create cloudpanel
```

记录返回的数据库 ID，例如：
```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 创建 KV 存储

```bash
# 创建 KV 命名空间
wrangler kv:namespace create cloudpanel

# 如果需要预览环境
wrangler kv:namespace create cloudpanel --preview
```

记录返回的 KV ID，例如：
```
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## 第三步：配置项目

### 1. 更新 wrangler.toml

编辑 `wrangler.toml` 文件，填入实际的 ID：

```toml
name = "cloudpanel"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENCRYPTION_KEY = "your-generated-encryption-key-here"
ADMIN_USER = "admin"
ADMIN_PASSWORD = "your-generated-admin-password"

[[d1_databases]]
binding = "DB"
database_name = "cloudpanel"
database_id = "your-actual-d1-database-id"

[[kv_namespaces]]
binding = "KV"
id = "your-actual-kv-namespace-id"
```

### 2. 运行数据库迁移

```bash
# 应用数据库迁移
wrangler d1 migrations apply cloudpanel
```

## 第四步：本地开发测试

### 1. 启动开发服务器

```bash
npm run dev
```

### 2. 测试 API

访问 `http://localhost:8788/health` 检查服务状态。

### 3. 测试前端

将前端文件放在项目根目录，通过开发服务器访问。

## 第五步：部署到 Cloudflare Pages

### 方法 A：通过 Git 集成（推荐）

1. **创建 Git 仓库**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/cloudpanel.git
git push -u origin main
```

2. **连接 Cloudflare Pages**
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - 进入 **Workers & Pages** > **Create application** > **Pages**
   - 选择 **Connect to Git**
   - 选择你的 GitHub 仓库
   - 配置构建设置：
     - **Framework preset**: None
     - **Build command**: `npm run build`
     - **Build output directory**: `dist`

3. **配置环境变量**
   在 Pages 项目设置中添加环境变量：
   - `ENCRYPTION_KEY`: 你生成的加密密钥
   - `ADMIN_USER`: `admin`
   - `ADMIN_PASSWORD`: 你生成的管理员密码

4. **配置绑定**
   在 Pages 项目设置的 **Functions** 标签中：
   - **D1 database bindings**: 
     - Variable name: `DB`
     - D1 database: 选择你创建的数据库
   - **KV namespace bindings**:
     - Variable name: `KV` 
     - KV namespace: 选择你创建的命名空间

### 方法 B：直接部署

```bash
# 构建项目
npm run build

# 部署到 Cloudflare Pages
wrangler pages deploy
```

## 第六步：配置自定义域名（可选）

1. 在 Cloudflare Pages 项目中点击 **Custom domains**
2. 添加你的域名
3. 按照提示配置 DNS 记录

## 第七步：验证部署

### 1. 检查健康状态

访问 `https://your-site.pages.dev/health` 应该返回：

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "status": "healthy",
  "services": {
    "database": "connected",
    "kv": "connected", 
    "encryption": "available"
  }
}
```

### 2. 测试认证

- 访问主页面
- 使用管理员账户登录（用户名：admin，密码：你设置的密码）
- 测试基本功能

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查 D1 数据库 ID 是否正确
   - 确认数据库迁移已执行
   - 查看 Functions 日志

2. **KV 存储错误**
   - 检查 KV 命名空间 ID 是否正确
   - 确认 KV 绑定配置正确

3. **加密服务错误**
   - 检查 ENCRYPTION_KEY 是否设置
   - 确认密钥长度至少 32 字符

4. **权限错误**
   - 检查环境变量是否正确设置
   - 确认管理员用户已创建

### 查看日志

```bash
# 查看实时日志
wrangler pages deployment tail

# 查看特定部署的日志
wrangler pages deployment tail --project-name=cloudpanel
```

### 调试模式

在开发环境中，可以设置更详细的日志：

```bash
# 设置调试环境变量
export DEBUG=true
npm run dev
```

## 性能优化

### 1. 缓存策略

- API 响应使用适当的缓存头
- 静态资源启用长期缓存
- 使用 Cloudflare CDN 加速

### 2. 数据库优化

- 使用索引优化查询
- 避免 N+1 查询问题
- 合理使用数据库连接池

### 3. KV 存储优化

- 设置合适的 TTL
- 避免频繁的小数据写入
- 使用批量操作

## 安全建议

1. **密钥管理**
   - 使用强密码和复杂密钥
   - 定期轮换密钥
   - 不要在代码中硬编码密钥

2. **访问控制**
   - 启用 Cloudflare Access（可选）
   - 配置 IP 白名单（如需要）
   - 使用 HTTPS 强制加密

3. **监控**
   - 设置错误告警
   - 监控异常访问
   - 定期检查日志

## 扩展功能

### 1. 添加更多云服务商

在 `functions/shared/cloud-providers.ts` 中添加新的云服务商支持。

### 2. 自定义认证

扩展认证系统支持 OAuth、SAML 等。

### 3. 监控仪表板

集成 Grafana、Prometheus 等监控工具。

## 支持

如果遇到问题：

1. 查看 [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
2. 检查 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
3. 查看项目 Issues 页面
4. 联系技术支持

---

**恭喜！** 你已经成功部署了 CloudPanel 到 Cloudflare Pages。现在可以享受免费、快速、全球分布的云服务器管理面板了！ 