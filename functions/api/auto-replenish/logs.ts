// functions/api/auto-replenish/logs.ts - 补机日志 API
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

// GET /api/auto-replenish/logs - 获取补机日志
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session, request } = context;
    const db = createDatabaseService(env);
    
    // 获取查询参数
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const logs = await db.getReplenishLogsByUserId(session!.userId, Math.min(limit, 100));

    // 格式化日志
    const formattedLogs = logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details) : null,
      // 隐藏敏感信息
      root_password: log.root_password ? '******' : null,
    }));

    return createSuccessResponse({
      logs: formattedLogs,
      totalCount: formattedLogs.length
    }, '获取补机日志成功');

  } catch (error) {
    console.error('获取补机日志失败:', error);
    return createErrorResponse('获取补机日志失败', 500, 'GET_LOGS_FAILED');
  }
}
