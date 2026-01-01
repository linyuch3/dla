// telegram-notify.ts - Telegram 通知辅助函数
import { Env, User } from './types';
import { createDatabaseService } from './db';
import { CryptoService } from './crypto';

export interface TelegramNotification {
  type: 'instance_create' | 'instance_power_on' | 'instance_power_off' | 'instance_reboot' | 'instance_delete' | 'instance_change_ip' | 'auto_replenish' | 'api_key_failed' | 'api_key_limited';
  instanceName?: string;
  instanceId?: string;
  provider?: string;
  region?: string;
  ip?: string;
  ipv6?: string;
  oldIp?: string;
  newIp?: string;
  apiKeyName?: string;
  errorMessage?: string;
  rootPassword?: string;
  plan?: string;
  image?: string;
  details?: any;
}

/**
 * 发送 Telegram 通知给用户
 */
export async function sendTelegramNotification(
  env: Env,
  userId: number,
  notification: TelegramNotification
): Promise<void> {
  try {
    const db = createDatabaseService(env);
    const user = await db.getUserById(userId);
    
    if (!user || !user.telegram_enabled || !user.telegram_bot_token || !user.telegram_user_id) {
      console.log(`用户 ${userId} 未启用 Telegram 通知，跳过`);
      return;
    }

    // 解密 bot token
    const botToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
    
    const message = formatNotificationMessage(notification);
    
    await sendTelegramMessage(botToken, user.telegram_user_id, message);
    
    console.log(`✅ Telegram 通知已发送给用户 ${userId}: ${notification.type}`);
  } catch (error) {
    console.error(`❌ 发送 Telegram 通知失败:`, error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 格式化通知消息
 */
function formatNotificationMessage(notification: TelegramNotification): string {
  const { type, instanceName, instanceId, provider, region, ip, oldIp, newIp, apiKeyName, errorMessage, details } = notification;
  
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const icon = getNotificationIcon(type);
  
  let message = `${icon} *CloudPanel 通知*\n\n`;
  message += `⏰ 时间: ${timestamp}\n`;
  
  switch (type) {
    case 'instance_create':
      message += `📦 操作: 创建实例\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (region) message += `🌍 区域: ${region}\n`;
      if (ip) message += `🌐 IP: \`${ip}\`\n`;
      break;
      
    case 'instance_power_on':
      message += `▶️ 操作: 开机\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (ip) message += `🌐 IP: \`${ip}\`\n`;
      break;
      
    case 'instance_power_off':
      message += `⏹️ 操作: 关机\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (ip) message += `🌐 IP: \`${ip}\`\n`;
      break;
      
    case 'instance_reboot':
      message += `🔄 操作: 重启\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (ip) message += `🌐 IP: \`${ip}\`\n`;
      break;
      
    case 'instance_delete':
      message += `🗑️ 操作: 删除实例\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (ip) message += `🌐 IP: \`${ip}\`\n`;
      break;
      
    case 'instance_change_ip':
      message += `🔀 操作: 更换IP\n`;
      message += `🏷️ 实例: ${instanceName || instanceId}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (oldIp) message += `🔴 旧IP: \`${oldIp}\`\n`;
      if (newIp) message += `🟢 新IP: \`${newIp}\`\n`;
      break;
      
    case 'auto_replenish':
      message += `🤖 操作: 自动补机\n`;
      if (details?.taskName) message += `📋 任务: ${details.taskName}\n`;
      if (instanceName) message += `🏷️ 新实例: ${instanceName}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (region) message += `🌍 区域: ${region}\n`;
      if (notification.plan) message += `💻 套餐: ${notification.plan}\n`;
      if (notification.image) message += `📀 镜像: ${notification.image}\n`;
      if (ip) message += `🌐 IPv4: \`${ip}\`\n`;
      if (notification.ipv6) message += `🌐 IPv6: \`${notification.ipv6}\`\n`;
      if (notification.rootPassword) message += `🔐 Root密码: \`${notification.rootPassword}\`\n`;
      if (details?.replacedInstance) message += `♻️ 替换机器: ${details.replacedInstance}\n`;
      break;
      
    case 'api_key_failed':
      message += `❌ 操作: API密钥失效\n`;
      if (apiKeyName) message += `🔑 密钥: ${apiKeyName}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (errorMessage) message += `⚠️ 错误: ${errorMessage}\n`;
      break;
      
    case 'api_key_limited':
      message += `⚠️ 操作: API密钥受限\n`;
      if (apiKeyName) message += `🔑 密钥: ${apiKeyName}\n`;
      if (provider) message += `☁️ 提供商: ${provider}\n`;
      if (errorMessage) message += `📝 详情: ${errorMessage}\n`;
      break;
  }
  
  return message;
}

/**
 * 获取通知图标
 */
function getNotificationIcon(type: string): string {
  const icons: { [key: string]: string } = {
    'instance_create': '🆕',
    'instance_power_on': '✅',
    'instance_power_off': '🛑',
    'instance_reboot': '♻️',
    'instance_delete': '💥',
    'instance_change_ip': '🔄',
    'auto_replenish': '🚀',
    'api_key_failed': '🔴',
    'api_key_limited': '🟡'
  };
  return icons[type] || '📢';
}

/**
 * 发送 Telegram 消息
 */
async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API 错误: ${error}`);
  }
}
