# 用户 Telegram Bot 设置指南

本指南将帮助您设置自己的 Telegram Bot，以便使用 CloudPanel 的一键测活功能。

## 📋 设置步骤

### 1. 创建您的 Telegram Bot

1. **打开 Telegram 应用**
2. **搜索并联系 @BotFather**
3. **发送命令** `/newbot`
4. **设置 Bot 名称**：
   - 显示名称：例如 "我的CloudPanel Bot"
   - 用户名：例如 "my_cloudpanel_bot"（必须以_bot结尾）
5. **保存 Bot Token**：BotFather 会给您一个类似这样的 Token：
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

### 2. 获取您的 Telegram User ID

**方法一：使用 @userinfobot**
1. 在 Telegram 中搜索 @userinfobot
2. 发送任意消息
3. Bot 会回复您的 User ID（纯数字）

**方法二：使用 @raw_data_bot**
1. 在 Telegram 中搜索 @raw_data_bot
2. 发送任意消息
3. 在返回的 JSON 中找到 `"id"` 字段

### 3. 设置 Bot Webhook

⚠️ **重要**：您需要为您的 Bot 设置 webhook，指向 CloudPanel 的处理端点。

**使用浏览器访问以下URL**（替换您的信息）：
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_CLOUDPANEL_DOMAIN>/api/telegram/webhook
```

例如：
```
https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/setWebhook?url=https://your-project.pages.dev/api/telegram/webhook
```

成功设置后会看到：
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 4. 在 CloudPanel 中配置

1. **登录 CloudPanel**
2. **进入用户设置**
3. **找到 "Telegram 通知" 部分**
4. **填写配置信息**：
   - **Bot Token**：步骤1中获得的完整Token
   - **User ID**：步骤2中获得的纯数字ID
   - **启用通知**：打开开关
   - **设置通知时间和时区**（可选）
5. **保存设置**

### 5. 测试您的 Bot

1. **在 Telegram 中找到您的 Bot**
2. **发送命令** `/start`
3. **应该看到用户菜单**：
   ```
   🤖 CloudPanel Bot 用户面板
   
   欢迎，您的用户名！请选择要执行的操作:
   
   [🔍 测活我的API密钥] [🔑 查看我的密钥] [⚙️ 通知设置]
   ```

## 🔧 故障排除

### Bot 没有响应
- ✅ 检查 Bot Token 是否正确
- ✅ 确认 webhook 设置成功
- ✅ 验证在 CloudPanel 中启用了 Telegram 通知
- ✅ 确认 User ID 格式正确（纯数字）

### 权限错误
- ✅ 确保您使用的是自己的 Bot Token
- ✅ 检查 CloudPanel 中的配置是否保存成功
- ✅ 确认 User ID 与您当前使用的 Telegram 账户匹配

### Webhook 设置失败
- ✅ 检查 CloudPanel 域名是否正确
- ✅ 确保域名支持 HTTPS
- ✅ 验证 Bot Token 格式正确

## 📝 配置示例

假设您的配置信息如下：
- **CloudPanel 域名**：`my-cloudpanel.pages.dev`
- **Bot Token**：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
- **User ID**：`987654321`

### Webhook 设置 URL：
```
https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/setWebhook?url=https://my-cloudpanel.pages.dev/api/telegram/webhook
```

### CloudPanel 配置：
- Bot Token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
- User ID: `987654321`
- 通知启用: ✅ 是
- 通知时间: `08:00`
- 时区: `Asia/Shanghai`

## 🔄 验证配置

设置完成后，您可以：
1. **发送** `/start` **命令测试菜单**
2. **点击 "🔍 测活我的API密钥"** 测试功能
3. **查看 "⚙️ 通知设置"** 确认配置

## 💡 提示

- 每个用户都需要自己的 Bot，不要共享 Bot Token
- Bot Token 是敏感信息，请妥善保管
- 如果需要更换 Bot，记得在 CloudPanel 中更新配置
- 定期测试 Bot 功能确保正常工作

## 🆘 需要帮助？

如果遇到问题：
1. 检查 CloudPanel 日志
2. 验证 Telegram Bot API 响应
3. 确认网络连接正常
4. 联系管理员获取技术支持

---

🎉 **恭喜！** 设置完成后，您就可以通过 Telegram Bot 一键测活您的 API 密钥了！

