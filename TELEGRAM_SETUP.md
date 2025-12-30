# Telegram 通知配置指南

本指南将帮助您配置 CloudPanel 的 Telegram 每日通知功能。

## 功能说明

CloudPanel 支持每天早上 8:00（北京时间）自动检查所有用户的 API 密钥状态，并通过 Telegram 发送详细报告。

### 通知内容

1. **每日报告**: 包含所有 API 密钥的健康状况统计
2. **失效警报**: 当检测到失效密钥时的紧急通知
3. **错误通知**: 定时任务执行失败时的错误报告

## 配置步骤

### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 命令
3. 按提示设置 Bot 名称和用户名
4. 获取 Bot Token（格式如：`1234567890:ABCdefGHIjklMNOpqrSTUvwxyz`）

### 2. 获取您的 Telegram User ID

方法一：使用 `@userinfobot`
1. 在 Telegram 中搜索 `@userinfobot`
2. 发送任意消息，Bot 会返回您的用户信息
3. 记录 `Id` 字段的数值

方法二：使用 `@RawDataBot`
1. 在 Telegram 中搜索 `@RawDataBot`
2. 发送任意消息，在返回的 JSON 中找到 `"id"` 字段

### 3. 配置环境变量

#### 方法一：在 wrangler.toml 中配置

编辑 `wrangler.toml` 文件，取消注释并填入您的配置：

```toml
# 开发环境
[vars]
TELEGRAM_BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrSTUvwxyz"
TELEGRAM_ADMIN_ID = "123456789"

# 预览环境
[env.preview]
vars = { 
  # ... 其他配置
  TELEGRAM_BOT_TOKEN = "your_preview_bot_token"
  TELEGRAM_ADMIN_ID = "123456789"
}

# 生产环境
[env.production]
vars = { 
  # ... 其他配置
  TELEGRAM_BOT_TOKEN = "your_production_bot_token"
  TELEGRAM_ADMIN_ID = "123456789"
}
```

#### 方法二：在 Cloudflare Dashboard 中配置

1. 登录 Cloudflare Dashboard
2. 进入您的 Pages 项目
3. 转到 Settings > Environment variables
4. 添加以下变量：
   - `TELEGRAM_BOT_TOKEN`: 您的 Bot Token
   - `TELEGRAM_ADMIN_ID`: 您的 Telegram User ID

### 4. 测试配置

部署后，您可以通过以下方式测试：

1. **手动触发**: 在 Cloudflare Dashboard 的 Functions 页面手动触发定时任务
2. **等待自动执行**: 等到每天早上 8:00 查看是否收到通知
3. **查看日志**: 在 Cloudflare Dashboard 中查看函数执行日志

## 通知示例

### 每日报告通知

```
📊 CloudPanel 每日API密钥检查报告
🕐 检查时间: 2024/01/15 08:00

📈 总体状况:
• 总密钥数: 5
• ✅ 有效密钥: 4
• ❌ 失效密钥: 1
• 🎯 健康率: 80%

✅ 有效密钥详情:
👤 user1 (2个)
   • MyDO-Key (digitalocean) - user@example.com
   • Linode-Main (linode) - user@example.com

👤 user2 (2个)
   • DO-Backup (digitalocean) - user2@example.com
   • Linode-Test (linode) - user2@example.com

❌ 失效密钥详情:
👤 user3 (1个失效)
   • Old-Key (digitalocean)
     原因: 401 Unauthorized

🔄 下次检查时间: 明天 08:00 (北京时间)
```

### 紧急警报通知

```
🚨 紧急警报：API密钥失效 🚨

检测到 2 个API密钥失效，需要立即处理！

🔴 用户: user1
   • 密钥: MyDO-Key (digitalocean)
   • 错误: 401 Unauthorized

🔴 用户: user2
   • 密钥: Linode-Main (linode)
   • 错误: 403 Forbidden

⚡ 建议操作:
1. 检查密钥是否过期或被撤销
2. 联系相关用户更新密钥
3. 检查云服务商账户状态
```

## 定时任务配置

定时任务配置在 `wrangler.toml` 中：

```toml
# 每天早上8点北京时间执行 (UTC 0点 = 北京时间8点)
[triggers]
crons = ["0 0 * * *"]
```

如需修改执行时间，请参考 [Cron 表达式语法](https://developers.cloudflare.com/workers/platform/cron-triggers/)。

## 故障排除

### 1. 未收到通知

- 检查环境变量是否正确配置
- 确认 Bot Token 和 User ID 正确
- 检查 Cloudflare Functions 日志是否有错误

### 2. Bot 无法发送消息

- 确保您已经与 Bot 进行过对话（发送 `/start` 命令）
- 检查 Bot 是否被阻止或删除

### 3. 定时任务未执行

- 检查 `wrangler.toml` 中的 cron 配置
- 确认项目已正确部署
- 在 Cloudflare Dashboard 中查看 Cron Triggers 状态

## 安全注意事项

1. **保护敏感信息**: Bot Token 是敏感信息，请勿在公开代码库中暴露
2. **限制访问**: 只有配置的管理员 ID 能接收通知
3. **定期轮换**: 建议定期更新 Bot Token
4. **监控使用**: 定期检查 Bot 的使用情况和日志

## 高级配置

### 自定义通知时间

如需修改通知时间，编辑 `wrangler.toml` 中的 cron 表达式：

```toml
# 示例：每天下午2点（北京时间）执行
[triggers]
crons = ["0 6 * * *"]  # UTC 6点 = 北京时间14点

# 示例：每12小时执行一次
[triggers]
crons = ["0 0,12 * * *"]

# 示例：仅工作日执行
[triggers]
crons = ["0 0 * * 1-5"]
```

### 多环境配置

为不同环境配置不同的通知设置：

- **开发环境**: 可以使用测试 Bot
- **预览环境**: 发送到测试群组
- **生产环境**: 发送到正式管理员

这样可以避免开发测试时干扰生产通知。
