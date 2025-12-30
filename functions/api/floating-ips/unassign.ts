// functions/api/floating-ips/unassign.ts - 分离浮动IP API
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface UnassignFloatingIPRequest {
  ip: string;
}

function validateUnassignFloatingIPRequest(data: any): UnassignFloatingIPRequest {
  if (!data || typeof data !== 'object') {
    throw new Error('请求数据格式无效');
  }

  const { ip } = data;

  if (!ip || typeof ip !== 'string') {
    throw new Error('IP地址不能为空');
  }

  // 验证IP地址格式
  const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    throw new Error('IP地址格式无效');
  }

  return { ip };
}

// POST /api/floating-ips/unassign - 分离浮动IP
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
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
      return createErrorResponse('浮动IP分离功能仅支持DigitalOcean', 400, 'PROVIDER_NOT_SUPPORTED');
    }

    // 验证请求数据
    const { ip } = await validateRequestData(request, validateUnassignFloatingIPRequest);

    // 创建云服务商实例
    const provider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    const instanceManager = new CloudInstanceManager(provider);

    // 分离浮动IP
    const success = await instanceManager.unassignFloatingIP(ip);

    if (success) {
      return createSuccessResponse({
        ip: ip,
        unassigned: true
      }, `浮动IP ${ip} 分离成功`);
    } else {
      return createErrorResponse('分离浮动IP失败', 500, 'UNASSIGN_FAILED');
    }

  } catch (error: any) {
    console.error('分离浮动IP失败:', error);
    
    return createErrorResponse(
      error.message || '分离浮动IP失败',
      500,
      'FLOATING_IP_UNASSIGN_FAILED'
    );
  }
}

