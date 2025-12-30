# CloudPanel 定时健康检查 - Cloudflare Dashboard 可视化部署指南

## 📋 概述

为了实现每天自动的 API 密钥健康检查和 Telegram 通知，我们需要创建一个独立的 Cloudflare Worker 来处理定时任务。

## 🎯 方案优势

- ✅ 解决 Cloudflare Pages 不支持 Cron Triggers 的限制
- ✅ 独立的定时任务，不影响主应用性能
- ✅ 可自定义执行时间
- ✅ 完整的错误处理和通知机制

---

## 🚀 Step 1: 创建新的 Cloudflare Worker

### 1.1 访问 Cloudflare Dashboard
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 在左侧菜单选择 **"Workers & Pages"**
3. 点击 **"Create application"** 按钮
4. 选择 **"Create Worker"**

### 1.2 配置 Worker 基本信息
- **Worker 名称**: `cloudpanel-scheduler`
- **代码编辑器**: 选择 "Quick Edit"

### 1.3 复制代码
将以下代码复制到编辑器中，替换默认代码：

> **注意**: 直接复制以下 JavaScript 代码，不要修改任何内容。

```javascript
/**
 * Cloudflare Worker - 定时API密钥健康检查
 * 每天定时执行API密钥健康检查并发送通知
 */

// 发送错误通知
async function sendErrorNotification(error, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_ID) {
    return;
  }

  const message = `🚨 **定时任务执行失败**

⏰ 时间: ${new Date().toLocaleString('zh-CN')}
❌ 错误: ${error instanceof Error ? error.message : String(error)}

请检查系统状态和配置。`;

  const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_ADMIN_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (notifyError) {
    console.error('发送错误通知失败:', notifyError);
  }
}

const worker = {
  async scheduled(controller, env, ctx) {
    console.log('🕐 定时任务开始: 每日API密钥健康检查...');
    
    try {
      // 调用 Pages 项目的内部 API 来执行健康检查
      const pagesUrl = env.PAGES_URL || 'https://cloudpanel-c02.pages.dev';
      const healthCheckUrl = `${pagesUrl}/api/admin/scheduled-health-check`;
      
      console.log(`📡 调用健康检查 API: ${healthCheckUrl}`);
      
      const response = await fetch(healthCheckUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CloudPanel-Scheduler/1.0',
          // 添加认证头以确保安全
          'X-Scheduled-Task': 'true'
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          trigger: 'scheduled'
        })
      });
      
      if (!response.ok) {
        throw new Error(`健康检查 API 响应失败: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ 定时健康检查完成:', result);
      
    } catch (error) {
      console.error('❌ 定时任务执行失败:', error);
      
      // 发送错误通知（如果配置了Telegram）
      await sendErrorNotification(error, env);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 支持 GET 和 POST 请求触发定时任务
    if (url.pathname === '/trigger') {
      console.log(`🔧 手动触发定时任务 (${request.method})...`);
      
      const mockController = {};
      const mockContext = {
        waitUntil(promise) {
          return promise;
        }
      };
      
      await this.scheduled(mockController, env, mockContext);
      
      return new Response(JSON.stringify({
        success: true,
        message: '定时任务已手动触发',
        method: request.method,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 默认首页响应
    return new Response(`
CloudPanel Scheduled Health Check Worker

状态: ✅ 运行中

使用方法:
• GET  /trigger - 手动触发定时任务
• POST /trigger - 手动触发定时任务

定时执行: 每天 UTC 00:00 (北京时间 08:00)

部署时间: ${new Date().toISOString()}
    `.trim(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

export default worker;
```

### 1.4 保存和部署
1. 点击 **"Save and Deploy"** 按钮
2. 等待部署完成

---

## ⚙️ Step 2: 配置环境变量

### 2.1 进入 Worker 设置
1. 在 Worker 列表中找到 `cloudpanel-scheduler`
2. 点击进入 Worker 详情页
3. 选择 **"Settings"** 标签
4. 找到 **"Environment Variables"** 部分

### 2.2 添加必需的环境变量
点击 **"Add variable"** 添加以下变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `PAGES_URL` | `https://cloudpanel-c02.pages.dev` | 你的 Pages 项目 URL |

### 2.3 可选环境变量（用于错误通知）
如果希望定时任务失败时收到通知，可以添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `TELEGRAM_BOT_TOKEN` | `你的管理员机器人Token` | 管理员机器人Token |
| `TELEGRAM_ADMIN_ID` | `你的Telegram用户ID` | 接收错误通知的管理员ID |

---

## 🕐 Step 3: 配置定时触发器 (Cron Triggers)

### 3.1 添加 Cron Trigger
1. 在 Worker 详情页，选择 **"Triggers"** 标签
2. 在 **"Cron Triggers"** 部分，点击 **"Add Cron Trigger"**
3. 输入 Cron 表达式

### 3.2 推荐的 Cron 表达式

| 时间 | Cron 表达式 | 说明 |
|------|-------------|------|
| 每天北京时间 08:00 | `0 0 * * *` | UTC 00:00 |
| 每天北京时间 14:00 | `0 6 * * *` | UTC 06:00 |
| 每天北京时间 20:00 | `0 12 * * *` | UTC 12:00 |
| 每天两次 (08:00, 20:00) | `0 0,12 * * *` | UTC 00:00 和 12:00 |
| 仅工作日 08:00 | `0 0 * * 1-5` | 周一到周五 UTC 00:00 |

**推荐设置**: `0 0 * * *` (每天北京时间 08:00)

### 3.3 保存配置
点击 **"Add trigger"** 保存设置

---

## 🧪 Step 4: 测试定时任务

### 4.1 手动测试
1. 复制你的 Worker URL (例如: `https://cloudpanel-scheduler.your-subdomain.workers.dev`)
2. 使用以下任一方式测试：

**方式一: 浏览器直接访问（最简单）**
```
https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger
```
直接在浏览器地址栏粘贴上述 URL 并访问，即可触发测试。

**方式二: curl GET 请求**
```bash
curl https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger
```

**方式三: curl POST 请求**
```bash
curl -X POST https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger
```

**预期响应**:
```json
{
  "success": true,
  "message": "定时任务已手动触发",
  "method": "GET",
  "timestamp": "2025-10-10T13:45:06.706Z"
}
```

### 4.2 检查日志
1. 在 Worker 详情页，选择 **"Logs"** 标签
2. 点击 **"Begin log stream"**
3. 执行测试请求，观察日志输出

### 4.3 预期的成功日志
```
🕐 定时任务开始: 每日API密钥健康检查...
📡 调用健康检查 API: https://cloudpanel-c02.pages.dev/api/admin/scheduled-health-check
✅ 定时健康检查完成: {success: true, keysChecked: 25, validKeys: 20, invalidKeys: 5}
```

---

## 📈 Step 5: 监控和维护

### 5.1 监控执行情况
- **Analytics**: 在 Worker 详情页查看执行次数和成功率
- **Logs**: 定期查看执行日志，确认任务正常运行
- **Metrics**: 关注 CPU 使用情况和响应时间

### 5.2 Telegram 通知验证
如果配置正确，你应该每天收到：
1. **用户个人通知**: 每个启用 Telegram 的用户都会收到个人密钥报告
2. **管理员总览**: 管理员会收到系统整体健康报告
3. **失效警报**: 如果有密钥失效，会收到详细警报

### 5.3 故障排除

**问题**: 定时任务没有执行
- 检查 Cron Trigger 是否正确设置
- 查看 Worker 日志是否有错误
- 确认 Worker 状态为 "Active"

**问题**: 收不到 Telegram 通知
- 检查用户是否启用了 Telegram 通知
- 验证 Bot Token 和用户 ID 配置
- 查看 Pages 项目的 `/api/admin/scheduled-health-check` API 日志

**问题**: API 调用失败
- 确认 `PAGES_URL` 环境变量正确
- 检查 Pages 项目是否正常运行
- 验证 `/api/admin/scheduled-health-check` 端点是否存在

---

## 🔧 高级配置

### 自定义执行时间
如需修改执行时间，在 Cron Triggers 中编辑表达式：

```
# 每小时执行一次
0 * * * *

# 每6小时执行一次
0 */6 * * *

# 每周一、三、五 08:00 执行
0 0 * * 1,3,5

# 每月1号 08:00 执行
0 0 1 * *
```

### 多时区支持
所有 Cron 表达式都是 UTC 时间。要转换为其他时区：
- **北京时间 = UTC + 8小时**
- **纽约时间 = UTC - 5小时 (EST) 或 UTC - 4小时 (EDT)**
- **伦敦时间 = UTC + 0小时 (GMT) 或 UTC + 1小时 (BST)**

---

## ✅ 部署完成

恭喜！你已经成功设置了 CloudPanel 的定时健康检查功能。

**功能特点**:
- 🕐 每天自动执行 API 密钥健康检查
- 📱 自动发送 Telegram 通知给启用的用户
- 📊 管理员接收系统整体报告
- 🚨 失效密钥自动警报
- 🛡️ 错误处理和故障通知
- 📈 完整的日志和监控

**下一步**:
- 监控首次定时执行（等待设定的 Cron 时间）
- 根据需要调整通知内容和时间
- 定期检查系统健康状态