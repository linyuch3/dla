// functions/api/auth/logout.ts - 用户登出 API
import { RequestContext } from '../../shared/types';
import { AuthService, getCookie, deleteCookie, createSuccessResponse, createErrorResponse } from '../../shared/auth';

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const { request, env } = context;

    // 获取会话 ID
    const sessionId = getCookie(request, 'session_id');
    
    if (sessionId) {
      // 删除服务器端会话
      await AuthService.deleteSession(sessionId, env);
    }

    // 创建响应并删除客户端 Cookie
    const response = createSuccessResponse(
      { message: 'Logout successful' },
      '登出成功'
    );

    return deleteCookie(response, 'session_id');

  } catch (error) {
    console.error('登出失败:', error);
    
    // 即使出错也要删除客户端 Cookie
    const response = createSuccessResponse(
      { message: 'Logout successful' },
      '登出成功'
    );

    return deleteCookie(response, 'session_id');
  }
} 