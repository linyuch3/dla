# Worker 代码使用说明

## ✅ 已修复的问题

所有 TypeScript 语法错误已完全修复：
- ❌ `Unexpected token 'export'` - 已修复
- ❌ `Unexpected token ':'` - 已修复
- ✅ 现在使用纯 JavaScript ES6 模块格式

## 📁 文件说明

- `scheduled-health-check.js` - **使用这个文件**（纯 JavaScript）
- `scheduled-health-check.ts` - 可以删除（旧的 TypeScript 版本）

## 🚀 部署到 Cloudflare Dashboard

### 方法 1: 直接复制粘贴（推荐）

1. **打开文件**: `workers/scheduled-health-check.js`
2. **复制全部代码**
3. **粘贴到 Cloudflare Dashboard Worker 编辑器中**
4. **点击 "Save and Deploy"**

### 方法 2: 使用 Git 仓库

如果你在 Cloudflare Dashboard 中看到代码：
1. 确保使用的是 `scheduled-health-check.js` 而不是 `.ts`
2. 代码应该是纯 JavaScript，没有任何 `:type` 这样的类型注解

## 🔍 验证代码正确性

正确的代码应该是这样的：

```javascript
// ✅ 正确 - 纯 JavaScript
async function sendErrorNotification(error, env) {
  // ...
}

export default {
  async scheduled(controller, env, ctx) {
    // ...
  },
  
  async fetch(request, env) {
    // ...
  }
};
```

**不应该**包含：
```javascript
// ❌ 错误 - TypeScript 语法
async function sendErrorNotification(error: any, env: any): Promise<void> {
  // ...
}
```

## 🧪 测试步骤

部署后测试（**支持 GET 和 POST 请求**）：

**方式一: 浏览器直接访问**
```
https://cloudpanel-scheduler.YOUR-SUBDOMAIN.workers.dev/trigger
```

**方式二: curl GET 请求**
```bash
curl https://cloudpanel-scheduler.YOUR-SUBDOMAIN.workers.dev/trigger
```

**方式三: curl POST 请求**
```bash
curl -X POST https://cloudpanel-scheduler.YOUR-SUBDOMAIN.workers.dev/trigger
```

预期响应：
```json
{
  "success": true,
  "message": "定时任务已手动触发",
  "method": "GET",
  "timestamp": "2025-10-10T..."
}
```

## 🔧 配置检查清单

- [ ] Worker 名称: `cloudpanel-scheduler`
- [ ] 代码: 使用 `scheduled-health-check.js` 的内容
- [ ] 环境变量: `PAGES_URL` = `https://cloudpanel-c02.pages.dev`
- [ ] Cron Trigger: `0 0 * * *` (每天 UTC 00:00，北京时间 08:00)
- [ ] 测试: 手动触发成功

## 📖 完整部署指南

详细步骤请参考: `SCHEDULED_DEPLOYMENT_GUIDE.md`

## ❓ 常见问题

**Q: 还是看到语法错误？**
A: 请确保：
1. 使用的是 `scheduled-health-check.js` 而不是 `.ts`
2. 代码中没有任何 `: type` 这样的类型注解
3. 清除浏览器缓存后重新粘贴代码

**Q: 如何更新已部署的 Worker？**
A: 
1. 打开 Cloudflare Dashboard
2. 进入 Workers & Pages -> cloudpanel-scheduler
3. 点击 "Quick Edit"
4. 粘贴最新的 `scheduled-health-check.js` 代码
5. 点击 "Save and Deploy"

**Q: 定时任务什么时候执行？**
A: 
- 默认: 每天 UTC 00:00 (北京时间 08:00)
- 可在 Triggers -> Cron Triggers 中修改时间
