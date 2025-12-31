// functions/api/apikeys/[id]/index.ts - 单个API密钥操作端点
import { RequestContext, ValidationError } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, AuthService } from '../../../shared/auth';
import { CryptoService } from '../../../shared/crypto';

// GET /api/apikeys/{id} - 获取单个API密钥详情（包含解密后的密钥）
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取API密钥ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const keyIdStr = pathParts[pathParts.length - 1]; // /api/apikeys/{id}
    const keyId = parseInt(keyIdStr);

    if (!keyId || isNaN(keyId)) {
      return createErrorResponse('无效的API密钥ID', 400, 'INVALID_API_KEY_ID');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取API密钥
    const apiKey = await db.getApiKeyById(keyId);
    if (!apiKey) {
      return createErrorResponse('API密钥不存在', 404, 'API_KEY_NOT_FOUND');
    }

    // 验证权限
    if (apiKey.user_id !== session.userId) {
      return createErrorResponse('无权限访问此API密钥', 403, 'ACCESS_DENIED');
    }

    // 解密API密钥
    const decryptedKey = await CryptoService.decrypt(apiKey.encrypted_key, env.ENCRYPTION_KEY);

    // 返回密钥信息（包含解密后的密钥）
    return createSuccessResponse({
      id: apiKey.id,
      name: apiKey.name,
      key: decryptedKey, // 解密后的密钥
      provider: apiKey.provider,
      created_at: apiKey.created_at,
      health_status: apiKey.health_status,
      last_checked: apiKey.last_checked,
      error_message: apiKey.error_message
    });

  } catch (error) {
    console.error('获取API密钥失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('获取API密钥失败', 500, 'GET_API_KEY_FAILED');
  }
}

// DELETE /api/apikeys/{id} - 删除API密钥
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取API密钥ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const keyIdStr = pathParts[pathParts.length - 1]; // /api/apikeys/{id}
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

    // 删除API密钥
    const deleteSuccess = await db.deleteApiKey(keyId);
    if (!deleteSuccess) {
      return createErrorResponse('删除API密钥失败', 500, 'DELETE_FAILED');
    }

    // 如果删除的是当前选中的API密钥，需要清除选中状态
    if (session.selectedApiKeyId === keyId) {
      const sessionId = context.request.headers.get('cookie')
        ?.split(';')
        .find(c => c.trim().startsWith('session_id='))
        ?.split('=')[1];

      if (sessionId) {
        await AuthService.clearSelectedApiKey(sessionId, env);
      }
    }

    return createSuccessResponse({
      deletedApiKeyId: keyId,
      apiKeyName: apiKey.name,
      message: 'API密钥已删除'
    }, `已删除API密钥: ${apiKey.name}`);

  } catch (error) {
    console.error('删除API密钥失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('删除API密钥失败', 500, 'DELETE_API_KEY_FAILED');
  }
}

// PUT /api/apikeys/{id} - 更新API密钥（分组等）
export async function onRequestPut(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取API密钥ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const keyIdStr = pathParts[pathParts.length - 1];
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

    // 获取请求体
    const body = await request.json() as { key_group?: string };

    // 更新分组（允许任意自定义标签）
    if (body.key_group !== undefined) {
      const groupName = body.key_group.trim();
      if (groupName.length > 50) {
        return createErrorResponse('分组名称不能超过50个字符', 400, 'INVALID_KEY_GROUP');
      }
      await db.updateApiKeyGroup(keyId, groupName);
    }

    return createSuccessResponse({
      id: keyId,
      key_group: body.key_group || apiKey.key_group,
      message: 'API密钥已更新'
    }, 'API密钥已更新');

  } catch (error) {
    console.error('更新API密钥失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('更新API密钥失败', 500, 'UPDATE_API_KEY_FAILED');
  }
} 