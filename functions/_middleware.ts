// functions/_middleware.ts - 全局中间件
import { Env, RequestContext } from './shared/types';
import { wrapResponseWithCors } from './shared/auth'; // Keep wrapResponseWithCors
import { createDatabaseService } from './shared/db';
import { createCloudProviderFromEncryptedKey } from './shared/cloud-providers';

// Main fetch handler for requests
export async function onRequest(context: RequestContext): Promise<Response> {
  const { request, env, next } = context;

  try {
    // 1. CORS 处理 (直接在此处处理 OPTIONS 请求)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 2. 健康检查（跳过其他中间件）
    if (request.url.endsWith('/health')) {
      return handleHealthCheck(env);
    }

    // 3. 初始化数据库（如果需要）
    if (request.url.includes('/api/') && !request.url.includes('/health')) {
      await initializeDatabaseIfNeeded(env);
    }

    // 4. 继续到下一个处理器
    return await next();

  } catch (error) {
    console.error('中间件处理失败:', error);
    const errorResponse = new Response(
      JSON.stringify({
        error: 'Internal server error',
        code: 'MIDDLEWARE_ERROR',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    return wrapResponseWithCors(errorResponse);
  }
}

// Scheduled event handler for Cron Triggers
export async function onScheduled(context: { env: Env }): Promise<void> {
  const { env } = context;
  console.log('定时任务开始: 每日API密钥健康检查...');

  try {
    const db = createDatabaseService(env);
    
    // 获取所有启用了Telegram通知的用户
    const telegramUsers = await db.getTelegramEnabledUsers();
    console.log(`找到 ${telegramUsers.length} 个启用了Telegram通知的用户`);

    // 获取所有用户（包括未启用通知的，用于管理员统计）
    const allUsers = await db.getAllUsers();
    const allKeys = [];
    const userKeyMap = new Map(); // 按用户分组密钥

    // 收集所有用户的API密钥
    for (const user of allUsers) {
      const userKeys = await db.getApiKeysByUserId(user.id);
      if (userKeys.length > 0) {
        userKeyMap.set(user.id, { user, keys: userKeys });
        userKeys.forEach(key => allKeys.push({ ...key, username: user.username, userId: user.id }));
      }
    }

    if (allKeys.length === 0) {
      console.log('数据库中没有 API 密钥，发送空报告通知。');
      // 如果配置了管理员通知，发送空报告
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_ID) {
        await sendDailyReportNotification([], [], env);
      }
      return;
    }

    console.log(`开始检查 ${allKeys.length} 个API密钥...`);
    
    const validKeys = [];
    const invalidKeys = [];
    const userResults = new Map(); // 按用户存储结果

    // 检查每个API密钥
    for (const key of allKeys) {
      try {
        const provider = await createCloudProviderFromEncryptedKey(key.provider, key.encrypted_key, env.ENCRYPTION_KEY);
        const accountInfo = await provider.getAccountInfo();
        
        const validKey = {
          keyName: key.name,
          provider: key.provider,
          username: key.username,
          userId: key.userId,
          accountEmail: accountInfo.email || '未知',
          status: accountInfo.status || 'active'
        };
        
        validKeys.push(validKey);
        
        // 按用户分组
        if (!userResults.has(key.userId)) {
          userResults.set(key.userId, { user: userKeyMap.get(key.userId)?.user, valid: [], invalid: [] });
        }
        userResults.get(key.userId).valid.push(validKey);
        
      } catch (error) {
        const invalidKey = {
          keyName: key.name,
          provider: key.provider,
          username: key.username,
          userId: key.userId,
          error: error instanceof Error ? error.message : '未知错误'
        };
        
        invalidKeys.push(invalidKey);
        
        // 按用户分组
        if (!userResults.has(key.userId)) {
          userResults.set(key.userId, { user: userKeyMap.get(key.userId)?.user, valid: [], invalid: [] });
        }
        userResults.get(key.userId).invalid.push(invalidKey);
      }
    }

    // 发送用户个人通知
    for (const telegramUser of telegramUsers) {
      const userResult = userResults.get(telegramUser.id);
      if (userResult) {
        try {
          await sendUserPersonalNotification(telegramUser, userResult.valid || [], userResult.invalid || [], env);
          
          // 更新用户的最后通知时间
          await db.updateUser(telegramUser.id, {
            telegram_last_notification: new Date().toISOString()
          });
          
        } catch (error) {
          console.error(`发送用户 ${telegramUser.username} 的个人通知失败:`, error);
        }
      }
    }

    // 发送管理员总览通知（如果配置了）
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_ID) {
      await sendDailyReportNotification(validKeys, invalidKeys, env);
      
      // 如果有失效密钥，发送详细警报
      if (invalidKeys.length > 0) {
        await sendInvalidKeysAlert(invalidKeys, env);
      }
    }

    console.log(`定时任务完成: 检查了${allKeys.length}个密钥, 有效${validKeys.length}个, 失效${invalidKeys.length}个, 发送了${telegramUsers.length}个用户通知`);
    
  } catch (error) {
    console.error('执行定时任务失败:', error);
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_ID) {
      await sendTelegramErrorNotification(error, env);
    }
  }
}

// --- Helper Functions (for both onRequest and onScheduled) ---

// 健康检查处理
async function handleHealthCheck(env: Env): Promise<Response> {
  try {
    const checks: any = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      services: {}
    };

    // 检查数据库连接
    try {
      const db = createDatabaseService(env);
      await env.DB.prepare('SELECT 1').first();
      checks.services.database = 'connected';
    } catch (error) {
      checks.services.database = 'error';
      checks.status = 'unhealthy';
      console.error('数据库健康检查失败:', error);
    }

    // 检查 KV 存储
    try {
      await env.KV.get('health_check');
      checks.services.kv = 'connected';
    } catch (error) {
      checks.services.kv = 'error';
      checks.status = 'unhealthy';
      console.error('KV 健康检查失败:', error);
    }

    // 检查加密服务
    try {
      if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32) {
        checks.services.encryption = 'available';
      } else {
        checks.services.encryption = 'misconfigured';
        checks.status = 'unhealthy';
      }
    } catch (error) {
      checks.services.encryption = 'error';
      checks.status = 'unhealthy';
    }

    const statusCode = checks.status === 'healthy' ? 200 : 503;
    
    const response = new Response(JSON.stringify(checks), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    });

    return wrapResponseWithCors(response);

  } catch (error) {
    console.error('健康检查失败:', error);
    
    const response = new Response(
      JSON.stringify({
        status: 'unhealthy',
        error: 'Health check failed',
        timestamp: new Date().toISOString()
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return wrapResponseWithCors(response);
  }
}

// 数据库初始化（如果需要）
async function initializeDatabaseIfNeeded(env: Env): Promise<void> {
  try {
    const db = createDatabaseService(env);
    
    // 检查数据库是否已初始化（通过检查是否有用户表数据）
    const userCount = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first() as { count: number };
    
    if (userCount.count === 0) {
      // 数据库为空，进行初始化
      await db.initializeDatabase(env);
      console.log('数据库初始化完成');
    }
    
    // 无论数据库是否为空，都要确保管理员用户存在且配置正确
    await ensureAdminUser(env, db);
    
  } catch (error) {
    // 初始化失败不应该阻止请求处理
    console.error('数据库初始化检查失败:', error);
  }
}

// 确保管理员用户存在且配置正确
async function ensureAdminUser(env: Env, db: any): Promise<void> {
  try {
    const adminUsername = env.ADMIN_USER || 'admin';
    const adminPassword = env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
      console.warn('未设置 ADMIN_PASSWORD 环境变量，跳过管理员用户配置');
      return;
    }
    
    // 动态导入加密服务
    const { PasswordService } = await import('./shared/crypto');
    const hashedPassword = await PasswordService.hashPassword(adminPassword);
    
    // 检查管理员用户是否存在
    const existingAdmin = await db.getUserByUsername(adminUsername);
    
    if (existingAdmin) {
      // 管理员用户已存在，检查是否需要更新
      let needsUpdate = false;
      const updates: any = {};
      
      // 确保用户具有管理员权限
      if (!existingAdmin.is_admin) {
        updates.is_admin = true;
        needsUpdate = true;
      }
      
      // 检查密码是否需要更新（通过尝试验证来判断）
      const isPasswordValid = await PasswordService.verifyPassword(adminPassword, existingAdmin.password_hash);
      if (!isPasswordValid) {
        updates.password_hash = hashedPassword;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await db.updateUser(existingAdmin.id, updates);
        console.log(`管理员用户 ${adminUsername} 已更新`);
      } else {
        console.log(`管理员用户 ${adminUsername} 配置正确`);
      }
    } else {
      // 管理员用户不存在，创建新用户
      await db.createUser(adminUsername, hashedPassword, true);
      console.log(`已创建管理员用户: ${adminUsername}`);
    }
    
  } catch (error) {
    console.error('配置管理员用户失败:', error);
  }
}

// 发送用户个人通知
async function sendUserPersonalNotification(user: any, validKeys: any[], invalidKeys: any[], env: Env) {
  try {
    // 解密用户的Bot Token
    const { CryptoService } = await import('./shared/crypto');
    const botToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
    
    // 根据用户时区计算当前时间
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { 
      timeZone: user.telegram_timezone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const totalKeys = validKeys.length + invalidKeys.length;
    
    let message = `📊 **你的API密钥检查报告**\n`;
    message += `👋 ${user.username}，这是你的每日密钥健康报告\n\n`;
    message += `🕐 **检查时间:** ${timeStr}\n\n`;
    
    if (totalKeys === 0) {
      message += `ℹ️ 你还没有添加任何API密钥\n`;
      message += `💡 在CloudPanel中添加密钥后，将开始监控\n`;
    } else {
      message += `📈 **你的密钥状况:**\n`;
      message += `• 总密钥数: ${totalKeys}\n`;
      message += `• ✅ 有效密钥: ${validKeys.length}\n`;
      message += `• ❌ 失效密钥: ${invalidKeys.length}\n`;
      message += `• 🎯 健康率: ${totalKeys > 0 ? Math.round((validKeys.length / totalKeys) * 100) : 0}%\n\n`;
      
      if (validKeys.length > 0) {
        message += `✅ **有效密钥:**\n`;
        validKeys.forEach(key => {
          message += `   • ${key.keyName} (${key.provider}) - ${key.accountEmail}\n`;
        });
        message += `\n`;
      }
      
      if (invalidKeys.length > 0) {
        message += `❌ **失效密钥 - 需要处理:**\n`;
        invalidKeys.forEach(key => {
          message += `   • ${key.keyName} (${key.provider})\n`;
          message += `     原因: ${key.error}\n`;
        });
        message += `\n`;
        message += `⚡ **建议操作:**\n`;
        message += `1. 检查密钥是否过期或被撤销\n`;
        message += `2. 登录CloudPanel更新失效的密钥\n`;
        message += `3. 检查云服务商账户状态\n\n`;
      }
    }
    
    message += `🔄 下次检查时间: 明天 ${user.telegram_notification_time} (${user.telegram_timezone})\n`;
    message += `⚙️ 在CloudPanel用户设置中可以修改通知配置`;

    await telegramApi(botToken, 'sendMessage', {
      chat_id: user.telegram_user_id,
      text: message,
      parse_mode: 'Markdown'
    });
    
    console.log(`已向用户 ${user.username} 发送个人通知`);
    
  } catch (error) {
    console.error(`向用户 ${user.username} 发送个人通知失败:`, error);
    throw error;
  }
}

// 发送每日报告通知
async function sendDailyReportNotification(validKeys: any[], invalidKeys: any[], env: Env) {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const timeStr = beijingTime.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const totalKeys = validKeys.length + invalidKeys.length;
  
  let message = `📊 **CloudPanel 每日API密钥检查报告**\n`;
  message += `🕐 **检查时间:** ${timeStr}\n\n`;
  
  if (totalKeys === 0) {
    message += `ℹ️ 系统中暂无API密钥需要检查\n`;
  } else {
    message += `📈 **总体状况:**\n`;
    message += `• 总密钥数: ${totalKeys}\n`;
    message += `• ✅ 有效密钥: ${validKeys.length}\n`;
    message += `• ❌ 失效密钥: ${invalidKeys.length}\n`;
    message += `• 🎯 健康率: ${totalKeys > 0 ? Math.round((validKeys.length / totalKeys) * 100) : 0}%\n\n`;
    
    if (validKeys.length > 0) {
      message += `✅ **有效密钥详情:**\n`;
      const userValidMap = new Map();
      validKeys.forEach(key => {
        if (!userValidMap.has(key.username)) {
          userValidMap.set(key.username, []);
        }
        userValidMap.get(key.username).push(key);
      });
      
      userValidMap.forEach((keys, username) => {
        message += `👤 **${username}** (${keys.length}个)\n`;
        keys.forEach(key => {
          message += `   • ${key.keyName} (${key.provider}) - ${key.accountEmail}\n`;
        });
      });
      message += `\n`;
    }
    
    if (invalidKeys.length > 0) {
      message += `❌ **失效密钥详情:**\n`;
      const userInvalidMap = new Map();
      invalidKeys.forEach(key => {
        if (!userInvalidMap.has(key.username)) {
          userInvalidMap.set(key.username, []);
        }
        userInvalidMap.get(key.username).push(key);
      });
      
      userInvalidMap.forEach((keys, username) => {
        message += `👤 **${username}** (${keys.length}个失效)\n`;
        keys.forEach(key => {
          message += `   • ${key.keyName} (${key.provider})\n`;
          message += `     原因: ${key.error}\n`;
        });
      });
    }
  }
  
  message += `\n🔄 下次检查时间: 明天 08:00 (北京时间)`;

  await telegramApi(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

// 发送失效密钥紧急警报
async function sendInvalidKeysAlert(invalidKeys: any[], env: Env) {
  let message = `🚨 **紧急警报：API密钥失效** 🚨\n\n`;
  message += `检测到 ${invalidKeys.length} 个API密钥失效，需要立即处理！\n\n`;

  const userInvalidMap = new Map();
  invalidKeys.forEach(key => {
    if (!userInvalidMap.has(key.username)) {
      userInvalidMap.set(key.username, []);
    }
    userInvalidMap.get(key.username).push(key);
  });

  userInvalidMap.forEach((keys, username) => {
    message += `🔴 **用户: ${username}**\n`;
    keys.forEach(key => {
      message += `   • 密钥: ${key.keyName} (${key.provider})\n`;
      message += `   • 错误: ${key.error}\n`;
    });
    message += `\n`;
  });

  message += `⚡ **建议操作:**\n`;
  message += `1. 检查密钥是否过期或被撤销\n`;
  message += `2. 联系相关用户更新密钥\n`;
  message += `3. 检查云服务商账户状态\n`;

  await telegramApi(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    text: message,
    parse_mode: 'Markdown'
  });
}

async function sendTelegramErrorNotification(error: any, env: Env) {
    const message = `🔥 **CloudPanel 定时任务执行失败** 🔥\n\n` +
                    `在执行每日 API 密钥检查时遇到严重错误。\n\n` +
                    `**错误信息:**\n` +
                    `\`\`\`\n${error instanceof Error ? error.message : '未知错误'}\n\`\`\``;
    await telegramApi(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: env.TELEGRAM_ADMIN_ID,
        text: message,
        parse_mode: 'Markdown'
    });
}

async function telegramApi(botToken: string, methodName: string, params: object) {
    const url = `https://api.telegram.org/bot${botToken}/${methodName}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        console.error(`Telegram API Error:`, await response.json());
    }
}
