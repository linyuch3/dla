// functions/api/auth/check.ts - 检查登录状态 API
import { RequestContext } from '../../shared/types';
import { AuthService, getCookie, createSuccessResponse, createErrorResponse } from '../../shared/auth';

export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const { request, env } = context;

    // 获取会话 ID
    const sessionId = getCookie(request, 'session_id');
    
    if (!sessionId) {
      return createSuccessResponse({
        logged_in: false,
        user: null
      }, '未登录');
    }

    // 获取会话信息
    const session = await AuthService.getSession(sessionId, env);
    
    if (!session) {
      return createSuccessResponse({
        logged_in: false,
        user: null
      }, '会话已过期');
    }

    // 返回用户信息
    return createSuccessResponse({
      logged_in: true,
      user: {
        id: session.userId,
        username: session.username,
        isAdmin: session.isAdmin
      },
      selectedApiKeyId: session.selectedApiKeyId || null,
      sessionInfo: {
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString()
      }
    }, '已登录');

  } catch (error) {
    console.error('检查登录状态失败:', error);
    
    return createSuccessResponse({
      logged_in: false,
      user: null
    }, '检查登录状态失败');
  }
} 