// scheduler.ts - 定时任务调度器
import { CronJob } from 'cron';
import { config } from './config';
import { getDatabase } from './shared/db-adapter';
import { createDatabaseService } from './shared/db';
import { createCloudProviderFromEncryptedKey } from './shared/cloud-providers';
import { sendTelegramNotification } from './shared/telegram-notify';
import { checkApiKeyHealth } from './api/apikeys/validate-batch';

export function scheduleHealthCheck() {
  // 解析配置的时间 (格式: HH:MM)
  const [hours, minutes] = config.scheduler.checkTime.split(':').map(Number);
  
  // 创建cron表达式: 秒 分 时 日 月 周
  const cronExpression = `0 ${minutes} ${hours} * * *`;
  
  console.log(`定时健康检查已配置: ${cronExpression} (UTC)`);
  
  // 创建定时任务
  const job = new CronJob(
    cronExpression,
    async () => {
      console.log('执行定时健康检查...');
      await runHealthCheck();
    },
    null,
    true,
    'UTC'
  );
  
  // 可选：启动时立即执行一次
  // runHealthCheck();
  
  return job;
}

// 定时测试所有API密钥（每6小时一次）
export function scheduleApiKeyTest() {
  // 每6小时测试一次: 00:00, 06:00, 12:00, 18:00
  const cronExpression = '0 0 */6 * * *';
  
  console.log(`定时API密钥测试已配置: ${cronExpression} (UTC)`);
  
  const job = new CronJob(
    cronExpression,
    async () => {
      console.log('执行定时API密钥测试...');
      await runApiKeyTest();
    },
    null,
    true,
    'UTC'
  );
  
  return job;
}

async function runApiKeyTest() {
  try {
    const env = {
      DB: getDatabase(config.database.path),
      ENCRYPTION_KEY: config.encryption.key,
      TELEGRAM_BOT_TOKEN: config.telegram.botToken,
      TELEGRAM_ADMIN_ID: config.telegram.adminId
    };
    
    const db = createDatabaseService(env as any);
    
    // 获取所有用户
    const users = await db.getAllUsers();
    console.log(`开始测试所有用户的API密钥，共 ${users.length} 个用户`);
    
    for (const user of users) {
      try {
        // 获取用户的所有API密钥
        const apiKeys = await db.getUserApiKeys(user.id);
        if (apiKeys.length === 0) continue;
        
        console.log(`测试用户 ${user.username} 的 ${apiKeys.length} 个API密钥...`);
        
        let failedCount = 0;
        let limitedCount = 0;
        
        // 测试每个密钥
        for (const key of apiKeys) {
          try {
            const result = await checkApiKeyHealth(key, config.encryption.key);
            
            // 更新数据库中的健康状态
            await db.updateApiKeyHealth(key.id, result.status, result.error);
            
            // 如果失效或受限，发送通知
            if (result.status === 'unhealthy') {
              failedCount++;
              if (user.telegram_enabled) {
                await sendTelegramNotification(env as any, user.id, {
                  type: 'api_key_failed',
                  apiKeyName: key.name,
                  provider: key.provider,
                  errorMessage: result.error || '未知错误'
                });
              }
            } else if (result.status === 'limited') {
              limitedCount++;
              if (user.telegram_enabled) {
                await sendTelegramNotification(env as any, user.id, {
                  type: 'api_key_limited',
                  apiKeyName: key.name,
                  provider: key.provider,
                  errorMessage: result.error || 'API调用受限'
                });
              }
            }
            
            // 延迟避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`测试密钥 ${key.name} 失败:`, error);
          }
        }
        
        console.log(`用户 ${user.username} 测试完成: 失效 ${failedCount}, 受限 ${limitedCount}`);
      } catch (error) {
        console.error(`测试用户 ${user.username} 的密钥时出错:`, error);
      }
    }
    
    console.log('所有用户的API密钥测试完成');
  } catch (error) {
    console.error('定时API密钥测试失败:', error);
  }
}

async function runHealthCheck() {
  try {
    const env = {
      DB: getDatabase(config.database.path),
      ENCRYPTION_KEY: config.encryption.key,
      TELEGRAM_BOT_TOKEN: config.telegram.botToken,
      TELEGRAM_ADMIN_ID: config.telegram.adminId
    };
    
    const db = createDatabaseService(env as any);
    
    // 获取所有启用了Telegram通知的用户
    const telegramUsers = await db.getTelegramEnabledUsers();
    console.log(`找到 ${telegramUsers.length} 个启用了Telegram通知的用户`);

    // 获取所有用户
    const allUsers = await db.getAllUsers();
    const allKeys: any[] = [];
    const userKeyMap = new Map();

    // 收集所有用户的API密钥
    for (const user of allUsers) {
      const userKeys = await db.getApiKeysByUserId(user.id);
      if (userKeys.length > 0) {
        userKeyMap.set(user.id, { user, keys: userKeys });
        userKeys.forEach(key => allKeys.push({ ...key, username: user.username, userId: user.id }));
      }
    }

    if (allKeys.length === 0) {
      console.log('数据库中没有 API 密钥');
      return;
    }

    console.log(`开始检查 ${allKeys.length} 个API密钥...`);
    
    const validKeys: any[] = [];
    const invalidKeys: any[] = [];

    // 检查每个API密钥
    for (const key of allKeys) {
      try {
        const provider = await createCloudProviderFromEncryptedKey(
          key.provider, 
          key.encrypted_key, 
          env.ENCRYPTION_KEY
        );
        const accountInfo = await provider.getAccountInfo();
        
        if (accountInfo) {
          validKeys.push(key);
          // 更新健康状态
          await db.updateApiKeyHealth(key.id, 'healthy', null);
        } else {
          invalidKeys.push(key);
          await db.updateApiKeyHealth(key.id, 'unhealthy', 'Account info not available');
        }
      } catch (error) {
        console.error(`检查密钥 ${key.name} 失败:`, error);
        invalidKeys.push(key);
        await db.updateApiKeyHealth(key.id, 'unhealthy', error.message || 'Unknown error');
      }
    }

    console.log(`健康检查完成: ${validKeys.length} 有效, ${invalidKeys.length} 失效`);

    // 发送通知
    if (invalidKeys.length > 0) {
      await sendNotifications(env, telegramUsers, invalidKeys, userKeyMap);
    }

  } catch (error) {
    console.error('定时健康检查失败:', error);
  }
}

async function sendNotifications(env: any, telegramUsers: any[], invalidKeys: any[], userKeyMap: Map<any, any>) {
  // 为每个启用Telegram的用户发送个人通知
  for (const user of telegramUsers) {
    const userInvalidKeys = invalidKeys.filter(k => k.userId === user.id);
    
    if (userInvalidKeys.length > 0 && user.telegram_bot_token && user.telegram_user_id) {
      try {
        const message = formatUserNotification(userInvalidKeys);
        await sendTelegramMessage(user.telegram_bot_token, user.telegram_user_id, message);
        console.log(`已发送通知给用户: ${user.username}`);
      } catch (error) {
        console.error(`发送通知给 ${user.username} 失败:`, error);
      }
    }
  }

  // 发送管理员汇总通知
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_ID && invalidKeys.length > 0) {
    try {
      const message = formatAdminNotification(invalidKeys, userKeyMap);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_ADMIN_ID, message);
      console.log('已发送管理员汇总通知');
    } catch (error) {
      console.error('发送管理员通知失败:', error);
    }
  }
}

function formatUserNotification(invalidKeys: any[]): string {
  let message = '⚠️ API密钥健康检查警告\n\n';
  message += `检测到 ${invalidKeys.length} 个失效的API密钥:\n\n`;
  
  for (const key of invalidKeys) {
    message += `❌ ${key.name} (${key.provider})\n`;
  }
  
  message += '\n请及时检查并更新这些密钥。';
  return message;
}

function formatAdminNotification(invalidKeys: any[], userKeyMap: Map<any, any>): string {
  let message = '📊 每日API密钥健康检查报告\n\n';
  message += `时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
  message += `⚠️ 失效密钥: ${invalidKeys.length}\n\n`;
  
  // 按用户分组
  const byUser = new Map<number, any[]>();
  for (const key of invalidKeys) {
    if (!byUser.has(key.userId)) {
      byUser.set(key.userId, []);
    }
    byUser.get(key.userId)!.push(key);
  }
  
  for (const [userId, keys] of byUser) {
    message += `用户: ${keys[0].username}\n`;
    for (const key of keys) {
      message += `  ❌ ${key.name} (${key.provider})\n`;
    }
    message += '\n';
  }
  
  return message;
}

async function sendTelegramMessage(botToken: string, chatId: string, message: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }
}
