// 统一账户概览API
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';
import { RequestContext } from '../../shared/types';

export async function onRequest(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    
    // 检查是否选择了API密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个API密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取API密钥
    const apiKey = await db.getApiKeyById(session.selectedApiKeyId);
    if (!apiKey || apiKey.user_id !== session.userId) {
      return createErrorResponse('API密钥不存在或无权限访问', 403, 'INVALID_API_KEY');
    }

    // 创建云服务商实例
    const provider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    // 获取账户概览
    const overview = await provider.getAccountOverview();

    return createSuccessResponse(overview, '账户概览获取成功');

  } catch (error: any) {
    console.error('获取账户概览失败:', error);
    
    return createErrorResponse(
      error.message || '获取账户概览失败',
      500,
      'OVERVIEW_FETCH_FAILED'
    );
  }
}
