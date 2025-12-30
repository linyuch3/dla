// functions/api/apikeys/[id]/select.ts - 选择API密钥端点
import { RequestContext, ValidationError } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, AuthService } from '../../../shared/auth';

// POST /api/apikeys/{id}/select - 选择API密钥
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取API密钥ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const keyIdStr = pathParts[pathParts.length - 2]; // /api/apikeys/{id}/select
    const keyId = parseInt(keyIdStr);

    if (!keyId || isNaN(keyId)) {
      return createErrorResponse('无效的API密钥ID', 400, 'INVALID_API_KEY_ID');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 验证API密钥是否存在且属于当前用户
    const apiKey = await db.getApiKeyById(keyId);
    if (!apiKey) {
      return createErrorResponse('API密钥不存在', 404, 'API_KEY_NOT_FOUND');
    }

    if (apiKey.user_id !== session.userId) {
      return createErrorResponse('无权限访问此API密钥', 403, 'ACCESS_DENIED');
    }

    // 获取会话ID
    const sessionId = context.request.headers.get('cookie')
      ?.split(';')
      .find(c => c.trim().startsWith('session_id='))
      ?.split('=')[1];

    if (!sessionId) {
      return createErrorResponse('会话ID不存在', 401, 'SESSION_ID_MISSING');
    }

    // 更新会话中的选中API密钥
    const updateSuccess = await AuthService.setSelectedApiKey(sessionId, keyId, env);
    if (!updateSuccess) {
      return createErrorResponse('更新选中API密钥失败', 500, 'UPDATE_SELECTED_KEY_FAILED');
    }

    return createSuccessResponse({
      selectedApiKeyId: keyId,
      apiKeyName: apiKey.name,
      provider: apiKey.provider,
      message: 'API密钥已选择'
    }, `已选择API密钥: ${apiKey.name}`);

  } catch (error) {
    console.error('选择API密钥失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('选择API密钥失败', 500, 'SELECT_API_KEY_FAILED');
  }
} 