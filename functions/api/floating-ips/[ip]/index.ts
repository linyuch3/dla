// functions/api/floating-ips/[ip]/index.ts - 单个浮动IP操作API
import { RequestContext } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../../shared/auth';

// DELETE /api/floating-ips/{ip} - 删除指定的浮动IP
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取IP地址
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const ip = pathParts[pathParts.length - 1]; // /api/floating-ips/{ip}

    if (!ip) {
      return createErrorResponse('IP地址不能为空', 400, 'INVALID_IP_ADDRESS');
    }

    // 验证IP地址格式（简单验证）
    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return createErrorResponse('IP地址格式无效', 400, 'INVALID_IP_FORMAT');
    }

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

    // 验证IP是否存在
    const floatingIPs = await instanceManager.listFloatingIPs();
    const targetIP = floatingIPs.find(fip => fip.ip === ip);
    
    if (!targetIP) {
      return createErrorResponse('指定的浮动IP不存在', 404, 'FLOATING_IP_NOT_FOUND');
    }

    // 删除浮动IP
    const success = await instanceManager.deleteFloatingIP(ip);

    if (success) {
      return createSuccessResponse({
        ip: ip,
        was_assigned: !!targetIP.dropletId,
        droplet_id: targetIP.dropletId || null
      }, `浮动IP ${ip} 删除成功`);
    } else {
      return createErrorResponse('删除浮动IP失败', 500, 'DELETE_FAILED');
    }

  } catch (error: any) {
    console.error('删除浮动IP失败:', error);
    
    return createErrorResponse(
      error.message || '删除浮动IP失败',
      500,
      'FLOATING_IP_DELETE_FAILED'
    );
  }
}

