// functions/api/admin/stats.ts - 系统统计 API
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { adminMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

// GET - 获取系统统计
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { env } = context;
    const db = createDatabaseService(env);

    // 获取所有用户
    const users = await db.getAllUsers();
    const adminCount = users.filter(u => u.is_admin).length;
    const userCount = users.length - adminCount;

    // 获取所有API密钥
    let totalApiKeys = 0;
    let healthyKeys = 0;
    let unhealthyKeys = 0;
    const providerStats: { [key: string]: number } = {};

    for (const user of users) {
      const keys = await db.getApiKeysByUserId(user.id);
      totalApiKeys += keys.length;
      
      for (const key of keys) {
        // 统计健康状态
        if (key.health_status === 'healthy') {
          healthyKeys++;
        } else if (key.health_status === 'unhealthy') {
          unhealthyKeys++;
        }
        
        // 统计提供商
        providerStats[key.provider] = (providerStats[key.provider] || 0) + 1;
      }
    }

    // 获取Telegram启用的用户数
    const telegramUsers = await db.getTelegramEnabledUsers();

    const stats = {
      users: {
        total: users.length,
        admins: adminCount,
        regular: userCount,
        telegramEnabled: telegramUsers.length
      },
      apiKeys: {
        total: totalApiKeys,
        healthy: healthyKeys,
        unhealthy: unhealthyKeys,
        unknown: totalApiKeys - healthyKeys - unhealthyKeys
      },
      providers: providerStats,
      system: {
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'production',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    };

    return createSuccessResponse(stats, '获取系统统计成功');

  } catch (error: any) {
    console.error('获取系统统计失败:', error);
    return createErrorResponse(error.message || '获取系统统计失败', 500, 'GET_STATS_FAILED');
  }
}

export const onRequest = onRequestGet;
