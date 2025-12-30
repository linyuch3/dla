// functions/api/account/info.ts - 账号信息 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

// GET /api/account/info - 获取账号信息
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;

    // 检查是否有选中的 API 密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取用户选中的 API 密钥
    const apiKey = await db.getApiKeyById(session.selectedApiKeyId);
    if (!apiKey || apiKey.user_id !== session.userId) {
      return createErrorResponse('API 密钥不存在或无权限访问', 403, 'INVALID_API_KEY');
    }

    // 创建云服务商客户端
    const cloudProvider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    const instanceManager = new CloudInstanceManager(cloudProvider);

    // 获取账号信息、余额和实例列表
    const [accountInfo, balance, instances] = await Promise.all([
      instanceManager.getAccountInfo(),
      instanceManager.getBalance(),
      instanceManager.listInstances()
    ]);

    // 计算实例用量和配额
    const instanceUsage = instances.length;
    let instanceQuota = null;
    
    // DigitalOcean有droplet_limit配额
    if (apiKey.provider === 'digitalocean' && accountInfo.droplet_limit) {
      instanceQuota = accountInfo.droplet_limit;
    }
    // Linode目前没有明确的实例配额API，设为null表示无限制

    return createSuccessResponse({
      provider: apiKey.provider,
      account: accountInfo,
      balance: balance,
      apiKeyName: apiKey.name,
      instanceUsage: instanceUsage,
      instanceQuota: instanceQuota
    }, '获取账号信息成功');

  } catch (error) {
    console.error('获取账号信息失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('获取账号信息失败', 500, 'GET_ACCOUNT_INFO_FAILED');
  }
} 
