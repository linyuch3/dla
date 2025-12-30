import type { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';
import { CryptoService } from '../../shared/crypto';

export async function onRequestPut(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    
    const { email } = await context.request.json() as { email: string };

    if (!email) {
      return createErrorResponse('缺少邮箱', 400);
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return createErrorResponse('邮箱格式不正确', 400);
    }

    // 检查是否有选中的API密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个API密钥', 400);
    }

    // 从数据库获取API密钥
    const db = createDatabaseService(env);
    const apiKey = await db.getApiKeyById(session.selectedApiKeyId);

    if (!apiKey || apiKey.user_id !== session.userId) {
      return createErrorResponse('API密钥不存在或无权限访问', 403);
    }

    if (apiKey.provider !== 'linode') {
      return createErrorResponse('此功能仅支持Linode API密钥', 400);
    }

    // 解密API密钥
    const decryptedKey = await CryptoService.decrypt(apiKey.encrypted_key, env.ENCRYPTION_KEY);

    // 调用Linode API更新邮箱
    const response = await fetch('https://api.linode.com/v4/account', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const error = await response.json() as any;
      return createErrorResponse(error.errors?.[0]?.reason || '更新邮箱失败', response.status);
    }

    const data = await response.json() as any;
    
    return createSuccessResponse({
      message: '邮箱更新成功',
      email: data.email
    });

  } catch (error: any) {
    console.error('Update email error:', error);
    return createErrorResponse(error.message || '更新邮箱时发生错误', 500);
  }
}
