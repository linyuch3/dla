// functions/api/auto-replenish/trigger.ts - 手动触发补机 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager, CreateInstanceConfig } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';
import { CryptoService } from '../../shared/crypto';

interface TriggerReplenishRequest {
  template_id: number;
  api_key_id?: number; // 可选，如果不提供则自动选择
}

function validateTriggerRequest(data: any): TriggerReplenishRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  if (!data.template_id || typeof data.template_id !== 'number') {
    throw new ValidationError('模板ID不能为空', 'template_id');
  }

  return {
    template_id: data.template_id,
    api_key_id: typeof data.api_key_id === 'number' ? data.api_key_id : undefined,
  };
}

// 生成随机密码
function generateRandomPassword(length: number = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// 生成实例名称
function generateInstanceName(provider: string): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  
  const prefixMap: { [key: string]: string } = {
    'digitalocean': 'do-auto',
    'linode': 'ln-auto',
    'azure': 'az-auto'
  };
  
  const prefix = prefixMap[provider] || 'auto';
  return `${prefix}-${timestamp}${random}`;
}

// POST /api/auto-replenish/trigger - 手动触发补机
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env, session } = context;
    const data = await validateRequestData(request, validateTriggerRequest);
    const db = createDatabaseService(env);

    // 获取模板
    const template = await db.getInstanceTemplateById(data.template_id);
    if (!template) {
      return createErrorResponse('模板不存在', 404, 'TEMPLATE_NOT_FOUND');
    }

    if (template.user_id !== session!.userId) {
      return createErrorResponse('无权使用此模板', 403, 'ACCESS_DENIED');
    }

    // 获取自动补机配置
    const replenishConfig = await db.getAutoReplenishConfig(session!.userId);
    const keyGroup = replenishConfig?.key_group || 'personal';

    // 获取可用的API密钥
    let apiKey;
    if (data.api_key_id) {
      apiKey = await db.getApiKeyById(data.api_key_id);
      if (!apiKey || apiKey.user_id !== session!.userId) {
        return createErrorResponse('API密钥不存在或无权访问', 403, 'INVALID_API_KEY');
      }
    } else {
      // 自动选择健康的API密钥
      const healthyKeys = await db.getHealthyApiKeysByGroup(session!.userId, keyGroup, template.provider);
      if (healthyKeys.length === 0) {
        return createErrorResponse(`没有可用的${keyGroup === 'personal' ? '自用' : '租机'}分组健康API密钥`, 400, 'NO_HEALTHY_API_KEY');
      }
      apiKey = healthyKeys[0];
    }

    // 创建补机日志
    const logId = await db.createReplenishLog({
      user_id: session!.userId,
      trigger_type: 'manual',
      template_id: template.id,
      status: 'pending',
    });

    try {
      // 创建云服务商客户端
      const cloudProvider = await createCloudProviderFromEncryptedKey(
        apiKey.provider,
        apiKey.encrypted_key,
        env.ENCRYPTION_KEY
      );

      const instanceManager = new CloudInstanceManager(cloudProvider);

      // 生成实例名称和密码
      const instanceName = generateInstanceName(template.provider);
      const rootPassword = template.root_password || generateRandomPassword();

      // 构建创建实例的配置
      const createConfig: CreateInstanceConfig = {
        name: instanceName,
        region: template.region,
        image: template.image,
        size: template.plan,
        diskSize: template.disk_size,
        ssh_keys: template.ssh_keys ? JSON.parse(template.ssh_keys) : undefined,
        tags: template.tags ? JSON.parse(template.tags) : undefined,
        user_data: template.user_data,
        enableIPv6: template.enable_ipv6,
      };

      // 创建实例
      const newInstance = await instanceManager.createInstance(createConfig);

      // 更新日志为成功
      await db.updateReplenishLogStatus(logId, 'success', {
        new_instance_id: String(newInstance.id),
        new_instance_name: newInstance.name,
        new_api_key_id: apiKey.id,
        new_ipv4: newInstance.ip_address || '等待分配',
        new_ipv6: newInstance.ipv6_address || '',
        root_password: rootPassword,
        details: JSON.stringify({
          provider: template.provider,
          region: template.region,
          plan: template.plan,
          image: template.image,
        }),
      });

      // 发送 Telegram 通知（如果启用）
      if (replenishConfig?.notify_telegram) {
        await sendTelegramNotification(env, session!.userId, db, {
          success: true,
          instanceName: newInstance.name,
          ipv4: newInstance.ip_address || '等待分配',
          ipv6: newInstance.ipv6_address || '无',
          rootPassword: rootPassword,
          provider: template.provider,
          region: template.region,
        });
      }

      return createSuccessResponse({
        log_id: logId,
        instance: {
          id: newInstance.id,
          name: newInstance.name,
          ip_address: newInstance.ip_address,
          ipv6_address: newInstance.ipv6_address,
          status: newInstance.status,
        },
        root_password: rootPassword,
        message: '补机成功'
      }, '补机成功');

    } catch (createError) {
      // 更新日志为失败
      await db.updateReplenishLogStatus(logId, 'failed', {
        error_message: createError instanceof Error ? createError.message : '未知错误',
      });

      // 发送失败通知
      if (replenishConfig?.notify_telegram) {
        await sendTelegramNotification(env, session!.userId, db, {
          success: false,
          error: createError instanceof Error ? createError.message : '未知错误',
          provider: template.provider,
        });
      }

      throw createError;
    }

  } catch (error) {
    console.error('手动触发补机失败:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    return createErrorResponse(
      `补机失败: ${error instanceof Error ? error.message : '未知错误'}`,
      500,
      'TRIGGER_REPLENISH_FAILED'
    );
  }
}

// 发送 Telegram 通知
async function sendTelegramNotification(
  env: any,
  userId: number,
  db: any,
  data: {
    success: boolean;
    instanceName?: string;
    ipv4?: string;
    ipv6?: string;
    rootPassword?: string;
    provider?: string;
    region?: string;
    error?: string;
    originalInstance?: string;
    triggerType?: string;
  }
): Promise<void> {
  try {
    const user = await db.getUserById(userId);
    if (!user || !user.telegram_enabled || !user.telegram_bot_token || !user.telegram_user_id) {
      return;
    }

    let message = '';
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    if (data.success) {
      message = `🎉 *自动补机成功*\n\n` +
        `⏰ 时间: ${now}\n` +
        (data.triggerType ? `📋 触发类型: ${data.triggerType === 'instance_down' ? '机器失效' : data.triggerType === 'api_invalid' ? 'API失效' : '手动触发'}\n` : '') +
        (data.originalInstance ? `⚠️ 原机器: ${data.originalInstance}\n` : '') +
        `☁️ 云服务商: ${data.provider}\n` +
        `🌍 地区: ${data.region}\n` +
        `🖥️ 新机器: ${data.instanceName}\n` +
        `📍 IPv4: \`${data.ipv4}\`\n` +
        `📍 IPv6: \`${data.ipv6 || '无'}\`\n` +
        `🔐 Root密码: \`${data.rootPassword}\``;
    } else {
      message = `❌ *自动补机失败*\n\n` +
        `⏰ 时间: ${now}\n` +
        (data.triggerType ? `📋 触发类型: ${data.triggerType === 'instance_down' ? '机器失效' : data.triggerType === 'api_invalid' ? 'API失效' : '手动触发'}\n` : '') +
        (data.originalInstance ? `⚠️ 原机器: ${data.originalInstance}\n` : '') +
        `☁️ 云服务商: ${data.provider || '未知'}\n` +
        `❗ 错误: ${data.error}`;
    }

    // 解密 bot token
    const botToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

  } catch (error) {
    console.error('发送 Telegram 通知失败:', error);
  }
}
