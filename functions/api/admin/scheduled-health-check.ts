/**
 * 定时健康检查 API 端点
 * 由独立的 Cloudflare Worker 调用
 */

import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { CryptoService } from '../../shared/crypto';

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  
  try {
    // 验证请求来源
    const userAgent = request.headers.get('User-Agent');
    const scheduledTask = request.headers.get('X-Scheduled-Task');
    
    if (!userAgent?.includes('CloudPanel-Scheduler') || scheduledTask !== 'true') {
      return new Response(JSON.stringify({
        error: '未授权的请求'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const body = await request.json();
    console.log('🕐 收到定时健康检查请求:', body);
    
    const db = createDatabaseService(env);
    
    // 获取所有启用了Telegram通知的用户
    const telegramUsers = await db.getTelegramEnabledUsers();
    console.log(`找到 ${telegramUsers.length} 个启用了Telegram通知的用户`);
    
    // 打印用户详情
    telegramUsers.forEach(user => {
      console.log(`用户: ${user.username}, telegram_enabled: ${user.telegram_enabled}, has_token: ${!!user.telegram_bot_token}, has_user_id: ${!!user.telegram_user_id}`);
    });

    if (telegramUsers.length === 0) {
      console.log('没有启用 Telegram 通知的用户');
      return new Response(JSON.stringify({
        success: true,
        message: '没有启用通知的用户',
        usersNotified: 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let totalUsersNotified = 0;
    let totalKeysChecked = 0;
    let totalValidKeys = 0;
    let totalInvalidKeys = 0;

    // 为每个用户分别检查密钥并发送通知
    for (const user of telegramUsers) {
      try {
        console.log(`\n📋 开始处理用户: ${user.username} (ID: ${user.id})`);
        
        // 获取该用户的所有密钥
        const userKeys = await db.getApiKeysByUserId(user.id);
        
        if (userKeys.length === 0) {
          console.log(`用户 ${user.username} 没有API密钥，跳过`);
          continue;
        }

        console.log(`用户 ${user.username} 有 ${userKeys.length} 个密钥`);
        
        // 限制每个用户最多检查 15 个密钥，避免超出资源限制
        const keysToCheck = userKeys.slice(0, 15);
        const hasMoreKeys = userKeys.length > 15;
        
        if (hasMoreKeys) {
          console.log(`⚠️ 用户有 ${userKeys.length} 个密钥，限制检查前 15 个`);
        }
        
        const validKeys = [];
        const invalidKeys = [];
        const limitedKeys = [];

        // 串行检查该用户的每个密钥
        for (const key of keysToCheck) {
          try {
            const provider = await createCloudProviderFromEncryptedKey(key.provider, key.encrypted_key, env.ENCRYPTION_KEY);
            const accountInfo = await provider.getAccountInfo();
            
            const keyInfo = {
              name: key.name,
              provider: key.provider,
              accountEmail: accountInfo.email || '未知',
              status: accountInfo.status || 'active'
            };
            
            validKeys.push(keyInfo);
            
            // 更新数据库
            await db.updateApiKeyHealth(key.id, 'healthy', new Date().toISOString(), undefined);
            
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            
            // 判断是否是受限状态
            if (errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('droplet_limit')) {
              limitedKeys.push({
                name: key.name,
                provider: key.provider,
                error: errorMsg
              });
              await db.updateApiKeyHealth(key.id, 'limited', new Date().toISOString(), errorMsg);
            } else {
              invalidKeys.push({
                name: key.name,
                provider: key.provider,
                error: errorMsg
              });
              await db.updateApiKeyHealth(key.id, 'unhealthy', new Date().toISOString(), errorMsg);
            }
          }
        }

        totalKeysChecked += keysToCheck.length;
        totalValidKeys += validKeys.length;
        totalInvalidKeys += invalidKeys.length + limitedKeys.length;

        // 发送该用户的个人通知
        await sendUserPersonalNotification(user, validKeys, invalidKeys, limitedKeys, env, hasMoreKeys, userKeys.length);
        
        // 更新用户的最后通知时间
        await db.updateUser(user.id, {
          telegram_last_notification: new Date().toISOString()
        });
        
        totalUsersNotified++;
        console.log(`✅ 已通知用户 ${user.username}: ${validKeys.length} 有效, ${invalidKeys.length} 失效, ${limitedKeys.length} 受限`);
        
      } catch (error) {
        console.error(`❌ 处理用户 ${user.username} 失败:`, error);
      }
    }
      // 如果配置了管理员通知，发送空报告
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      usersNotified: totalUsersNotified,
      totalKeysChecked,
      totalValidKeys,
      totalInvalidKeys
    };

    console.log(`\n✅ 定时任务完成:`, result);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ 定时健康检查失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 发送用户个人通知
async function sendUserPersonalNotification(
  user: any, 
  validKeys: any[], 
  invalidKeys: any[], 
  limitedKeys: any[], 
  env: any,
  hasMoreKeys: boolean = false,
  totalKeysCount: number = 0
): Promise<void> {
  const checkedKeysCount = validKeys.length + invalidKeys.length + limitedKeys.length;
  const healthRate = checkedKeysCount > 0 ? Math.round((validKeys.length / checkedKeysCount) * 100) : 0;
  
  let message = `🔍 **每日密钥健康检查报告**\n\n`;
  message += `👤 用户: ${user.username}\n`;
  
  if (hasMoreKeys) {
    message += `⚠️ 您有 ${totalKeysCount} 个密钥，本次检查前 15 个\n`;
  }
  
  message += `📊 检查: ${checkedKeysCount} 个 | ✅ ${validKeys.length} 有效 | ❌ ${invalidKeys.length} 失效`;
  if (limitedKeys.length > 0) {
    message += ` | ⚠️ ${limitedKeys.length} 受限`;
  }
  message += `\n📈 健康率: ${healthRate}%\n\n`;
  
  if (validKeys.length > 0) {
    message += `✅ **有效密钥 (${validKeys.length}个):**\n`;
    validKeys.slice(0, 5).forEach((key, index) => {
      const providerIcon = getProviderIcon(key.provider);
      message += `${index + 1}. ${providerIcon} ${key.name}\n`;
    });
    if (validKeys.length > 5) {
      message += `... 及其他 ${validKeys.length - 5} 个\n`;
    }
    message += `\n`;
  }
  
  if (limitedKeys.length > 0) {
    message += `⚠️ **受限密钥 (${limitedKeys.length}个):**\n`;
    limitedKeys.slice(0, 3).forEach((key, index) => {
      const providerIcon = getProviderIcon(key.provider);
      message += `${index + 1}. ${providerIcon} ${key.name}\n`;
      message += `   📌 ${key.error}\n\n`;
    });
    if (limitedKeys.length > 3) {
      message += `... 及其他 ${limitedKeys.length - 3} 个\n`;
    }
  }
  
  if (invalidKeys.length > 0) {
    message += `❌ **失效密钥 (${invalidKeys.length}个):**\n`;
    invalidKeys.slice(0, 3).forEach((key, index) => {
      const providerIcon = getProviderIcon(key.provider);
      message += `${index + 1}. ${providerIcon} ${key.name}\n`;
      message += `   ⚠️ ${key.error}\n\n`;
    });
    if (invalidKeys.length > 3) {
      message += `... 及其他 ${invalidKeys.length - 3} 个\n`;
    }
  }
  
  if (hasMoreKeys) {
    message += `\n💡 **提示**: 由于资源限制，定时任务最多检查 15 个密钥\n`;
    
    // 添加面板链接（如果配置了 PANEL_URL）
    const panelUrl = env.PANEL_URL || 'https://cloudpanel-c02.pages.dev';
    message += `请前往 [Web 界面](${panelUrl}) 检查所有密钥\n`;
  }
  
  message += `\n⏰ ${new Date().toLocaleString('zh-CN')}`;
  
  // 解密 Bot Token
  let botToken: string;
  try {
    botToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
  } catch (error) {
    console.error(`❌ 解密 Bot Token 失败 (${user.username}):`, error);
    throw new Error('无法解密 Bot Token');
  }
  
  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  console.log(`📤 准备发送通知给用户 ${user.username} (ID: ${user.telegram_user_id})`);
  console.log(`🔑 使用 Bot Token: ${botToken?.substring(0, 10)}...`);
  
  try {
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_user_id,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const result: any = await response.json();
    
    if (!result.ok) {
      console.error(`❌ Telegram 发送失败 (${user.username}):`, result);
      throw new Error(`Telegram API 错误: ${result.description || '未知错误'}`);
    }
    
    console.log(`✅ 成功发送通知给 ${user.username}`);
  } catch (error) {
    console.error(`❌ 发送通知失败 (${user.username}):`, error);
    throw error;
  }
}

// 发送管理员日报
async function sendDailyReportNotification(validKeys: any[], invalidKeys: any[], env: any): Promise<void> {
  const totalKeys = validKeys.length + invalidKeys.length;
  const healthRate = totalKeys > 0 ? Math.round((validKeys.length / totalKeys) * 100) : 0;
  
  let message = `📈 **系统每日健康报告**\n\n`;
  message += `📊 总体健康率: ${healthRate}% (${validKeys.length}/${totalKeys})\n`;
  message += `✅ 有效密钥: ${validKeys.length}个\n`;
  message += `❌ 失效密钥: ${invalidKeys.length}个\n\n`;
  
  if (invalidKeys.length > 0) {
    message += `⚠️ **需要关注的失效密钥:**\n`;
    const groupedByUser = new Map();
    invalidKeys.forEach(key => {
      if (!groupedByUser.has(key.username)) {
        groupedByUser.set(key.username, []);
      }
      groupedByUser.get(key.username).push(key);
    });
    
    Array.from(groupedByUser.entries()).slice(0, 5).forEach(([username, keys]) => {
      message += `👤 ${username}: ${keys.length}个失效\n`;
    });
    
    if (groupedByUser.size > 5) {
      message += `... 及其他 ${groupedByUser.size - 5} 个用户\n`;
    }
  }
  
  message += `\n⏰ ${new Date().toLocaleString('zh-CN')}`;
  
  const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_ADMIN_ID,
      text: message,
      parse_mode: 'Markdown'
    })
  });
}

// 发送失效密钥警报
async function sendInvalidKeysAlert(invalidKeys: any[], env: any): Promise<void> {
  let message = `🚨 **密钥失效警报**\n\n`;
  message += `发现 ${invalidKeys.length} 个失效密钥需要处理:\n\n`;
  
  invalidKeys.slice(0, 10).forEach((key, index) => {
    const providerIcon = getProviderIcon(key.provider);
    message += `${index + 1}. ${providerIcon} **${key.keyName}** (${key.username})\n`;
    message += `   ❌ ${key.error}\n\n`;
  });
  
  if (invalidKeys.length > 10) {
    message += `... 及其他 ${invalidKeys.length - 10} 个密钥\n\n`;
  }
  
  message += `请及时处理这些失效密钥。`;
  
  const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_ADMIN_ID,
      text: message,
      parse_mode: 'Markdown'
    })
  });
}

// 获取云服务商图标
function getProviderIcon(provider: string): string {
  switch (provider) {
    case 'digitalocean':
      return '🌊';
    case 'linode':
      return '🌍';
    case 'azure':
      return '☁️';
    default:
      return '🔑';
  }
}