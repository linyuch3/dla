// functions/api/admin/scheduler.ts - 定时任务配置 API
import { RequestContext } from '../../shared/types';
import { adminMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';
import { config } from '../../config';

// GET - 获取定时任务配置
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const schedulerConfig = {
      checkTime: config.scheduler.checkTime,
      telegramConfigured: !!(config.telegram.botToken && config.telegram.adminId),
      enabled: !!(config.telegram.botToken && config.telegram.adminId)
    };

    return createSuccessResponse(schedulerConfig, '获取定时任务配置成功');

  } catch (error: any) {
    console.error('获取定时任务配置失败:', error);
    return createErrorResponse(error.message || '获取定时任务配置失败', 500, 'GET_SCHEDULER_CONFIG_FAILED');
  }
}

export const onRequest = onRequestGet;
