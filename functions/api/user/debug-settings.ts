// functions/api/user/debug-settings.ts - 调试用户设置
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse } from '../../shared/auth';

// GET /api/user/debug-settings - 调试查看用户完整信息
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    const db = createDatabaseService(env);

    const user = await db.getUserById(session.userId);
    if (!user) {
      return new Response(JSON.stringify({
        error: '用户不存在'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 返回完整的用户信息（用于调试）
    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        telegram_enabled: user.telegram_enabled,
        telegram_user_id: user.telegram_user_id,
        telegram_has_token: !!user.telegram_bot_token,
        telegram_notification_time: user.telegram_notification_time,
        telegram_timezone: user.telegram_timezone,
        telegram_last_notification: user.telegram_last_notification,
        created_at: user.created_at
      }
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('调试查询失败:', error);
    return createErrorResponse('调试查询失败', 500, 'DEBUG_FAILED');
  }
}
