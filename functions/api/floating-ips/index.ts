// functions/api/floating-ips/index.ts - 浮动IP管理API
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

// GET /api/floating-ips - 获取浮动IP列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
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

    // 检查是否为DigitalOcean
    if (apiKey.provider !== 'digitalocean') {
      return createErrorResponse('浮动IP管理功能仅支持DigitalOcean', 400, 'PROVIDER_NOT_SUPPORTED');
    }

    // 创建云服务商实例
    const provider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    const instanceManager = new CloudInstanceManager(provider);

    // 获取浮动IP列表
    const floatingIPs = await instanceManager.listFloatingIPs();

    return createSuccessResponse({
      floating_ips: floatingIPs,
      total: floatingIPs.length,
      unassigned: floatingIPs.filter(ip => !ip.dropletId).length
    }, '浮动IP列表获取成功');

  } catch (error: any) {
    console.error('获取浮动IP列表失败:', error);
    
    return createErrorResponse(
      error.message || '获取浮动IP列表失败',
      500,
      'FLOATING_IPS_LIST_FAILED'
    );
  }
}

// DELETE /api/floating-ips - 批量清理未绑定的浮动IP
export async function onRequestDelete(context: RequestContext): Promise<Response> {
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

    // 检查是否为DigitalOcean
    if (apiKey.provider !== 'digitalocean') {
      return createErrorResponse('浮动IP管理功能仅支持DigitalOcean', 400, 'PROVIDER_NOT_SUPPORTED');
    }

    // 创建云服务商实例
    const provider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    const instanceManager = new CloudInstanceManager(provider);

    // 清理未绑定的浮动IP
    const deletedIPs = await instanceManager.cleanupUnassignedFloatingIPs();

    return createSuccessResponse({
      deleted_ips: deletedIPs,
      count: deletedIPs.length
    }, `成功清理${deletedIPs.length}个未绑定的浮动IP`);

  } catch (error: any) {
    console.error('清理未绑定浮动IP失败:', error);
    
    return createErrorResponse(
      error.message || '清理未绑定浮动IP失败',
      500,
      'FLOATING_IPS_CLEANUP_FAILED'
    );
  }
}
