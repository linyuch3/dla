// functions/api/user/notification-settings.ts - 用户通知设置 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { CryptoService } from '../../shared/crypto';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface NotificationSettingsRequest {
  telegram_bot_token?: string;
  telegram_user_id?: string;
  telegram_enabled: boolean;
  telegram_notification_time: string;
  telegram_timezone: string;
}

function validateNotificationSettingsRequest(data: any): NotificationSettingsRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { 
    telegram_bot_token, 
    telegram_user_id, 
    telegram_enabled, 
    telegram_notification_time, 
    telegram_timezone 
  } = data;

  if (typeof telegram_enabled !== 'boolean') {
    throw new ValidationError('通知启用状态必须是布尔值', 'telegram_enabled');
  }

  if (telegram_enabled) {
    // 如果提供了Bot Token，验证格式
    if (telegram_bot_token) {
      if (typeof telegram_bot_token !== 'string') {
        throw new ValidationError('Bot Token必须是字符串', 'telegram_bot_token');
      }
      // 验证Bot Token格式
      if (!/^\d+:[A-Za-z0-9_-]{35}$/.test(telegram_bot_token.trim())) {
        throw new ValidationError('Bot Token格式无效', 'telegram_bot_token');
      }
    }

    // 用户ID是必需的
    if (!telegram_user_id || typeof telegram_user_id !== 'string') {
      throw new ValidationError('启用通知时用户ID不能为空', 'telegram_user_id');
    }

    // 验证用户ID格式
    if (!/^\d+$/.test(telegram_user_id.trim())) {
      throw new ValidationError('用户ID必须是数字', 'telegram_user_id');
    }
  }

  if (!telegram_notification_time || typeof telegram_notification_time !== 'string') {
    throw new ValidationError('通知时间不能为空', 'telegram_notification_time');
  }

  // 验证时间格式 HH:MM
  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(telegram_notification_time)) {
    throw new ValidationError('通知时间格式无效，应为HH:MM', 'telegram_notification_time');
  }

  if (!telegram_timezone || typeof telegram_timezone !== 'string') {
    throw new ValidationError('时区不能为空', 'telegram_timezone');
  }

  return {
    telegram_bot_token: telegram_enabled ? telegram_bot_token?.trim() : undefined,
    telegram_user_id: telegram_enabled ? telegram_user_id?.trim() : undefined,
    telegram_enabled,
    telegram_notification_time: telegram_notification_time.trim(),
    telegram_timezone: telegram_timezone.trim()
  };
}

// GET /api/user/notification-settings - 获取用户通知设置
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    const db = createDatabaseService(env);

    const user = await db.getUserById(session.userId);
    if (!user) {
      return createErrorResponse('用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 返回通知设置
    const settings: any = {
      telegram_enabled: user.telegram_enabled || false,
      telegram_user_id: user.telegram_user_id || '',
      telegram_notification_time: user.telegram_notification_time || '08:00',
      telegram_timezone: user.telegram_timezone || 'Asia/Shanghai',
      telegram_has_token: !!user.telegram_bot_token,
      telegram_last_notification: user.telegram_last_notification
    };

    // 如果有Token，解密并返回部分明文（前12位+...+后4位）
    if (user.telegram_bot_token) {
      try {
        const decryptedToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
        // 显示格式：123456789012...ABCD （前12位 + ... + 后4位）
        if (decryptedToken && decryptedToken.length > 16) {
          settings.telegram_bot_token_display = decryptedToken.substring(0, 12) + '...' + decryptedToken.substring(decryptedToken.length - 4);
        }
      } catch (error) {
        console.error('解密Token用于显示失败:', error);
        // 解密失败时仍然显示有Token的标志
      }
    }

    return createSuccessResponse(settings, '获取通知设置成功');

  } catch (error) {
    console.error('获取通知设置失败:', error);
    return createErrorResponse('获取通知设置失败', 500, 'GET_NOTIFICATION_SETTINGS_FAILED');
  }
}

// PUT /api/user/notification-settings - 更新用户通知设置
export async function onRequestPut(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 调试：记录请求数据
    const rawData = await request.json();
    console.log('🔍 收到的通知设置数据:', JSON.stringify(rawData, null, 2));

    // 验证请求数据
    const settings = validateNotificationSettingsRequest(rawData);
    console.log('✅ 验证通过的设置:', JSON.stringify(settings, null, 2));

    const db = createDatabaseService(env);
    
    // 如果启用通知但没有提供新Token，检查是否已有Token
    if (settings.telegram_enabled && !settings.telegram_bot_token) {
      const user = await db.getUserById(session.userId);
      if (!user || !user.telegram_bot_token) {
        return createErrorResponse('启用通知时必须提供Bot Token', 400, 'TOKEN_REQUIRED');
      }
      console.log('✅ 用户已有保存的Token，继续使用');
    }

    // 准备更新数据
    const updateData: any = {
      telegram_enabled: settings.telegram_enabled,
      telegram_notification_time: settings.telegram_notification_time,
      telegram_timezone: settings.telegram_timezone
    };

    // 如果启用了通知，更新Token和用户ID
    if (settings.telegram_enabled) {
      // 如果提供了新的Bot Token，加密存储
      if (settings.telegram_bot_token) {
        updateData.telegram_bot_token = await CryptoService.encrypt(
          settings.telegram_bot_token, 
          env.ENCRYPTION_KEY
        );
        console.log('🔐 更新Bot Token');
      }
      // 更新用户ID（如果提供了）
      if (settings.telegram_user_id) {
        updateData.telegram_user_id = settings.telegram_user_id;
        console.log('👤 更新用户ID');
      }
    } else if (!settings.telegram_enabled) {
      // 如果禁用通知，清空相关数据
      updateData.telegram_bot_token = null;
      updateData.telegram_user_id = null;
      console.log('🚫 禁用通知，清空Token和用户ID');
    }

    // 调试：记录要更新的数据
    console.log('💾 准备更新用户数据:', JSON.stringify(updateData, null, 2));
    console.log('👤 用户ID:', session.userId);

    // 更新用户设置
    const updateResult = await db.updateUser(session.userId, updateData);
    console.log('📊 数据库更新结果:', updateResult);

    if (!updateResult) {
      return createErrorResponse('更新通知设置失败', 500, 'UPDATE_FAILED');
    }

    return createSuccessResponse(
      { 
        message: '通知设置更新成功',
        telegram_enabled: settings.telegram_enabled
      },
      '通知设置已保存'
    );

  } catch (error) {
    console.error('更新通知设置失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('更新通知设置失败，请稍后重试', 500, 'UPDATE_NOTIFICATION_SETTINGS_FAILED');
  }
}
