// functions/api/instances/[id]/change-ip.ts - 更换实例IP地址 API
import { RequestContext, ValidationError } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../../shared/auth';
import { sendTelegramNotification } from '../../../shared/telegram-notify';

interface ChangeIPRequest {
  ipVersion: 'IPv4' | 'IPv6';
}

function validateChangeIPRequest(data: any): ChangeIPRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { ipVersion } = data;

  if (!ipVersion || typeof ipVersion !== 'string') {
    throw new ValidationError('IP版本不能为空', 'ipVersion');
  }

  if (!['IPv4', 'IPv6'].includes(ipVersion)) {
    throw new ValidationError('IP版本必须为 IPv4 或 IPv6', 'ipVersion');
  }

  return { ipVersion: ipVersion as 'IPv4' | 'IPv6' };
}

// POST /api/instances/{id}/change-ip - 更换实例IP地址
export async function onRequestPost(context: RequestContext): Promise<Response> {
  const { request, env } = context;
  let apiKey: any = null;
  let instanceId: string = '';
  
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const session = context.session!;

    // 从URL路径中获取实例ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    instanceId = pathParts[pathParts.length - 2]; // /api/instances/{id}/change-ip

    if (!instanceId) {
      return createErrorResponse('实例ID不能为空', 400, 'INVALID_INSTANCE_ID');
    }

    // 检查是否有选中的 API 密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 验证请求数据
    const changeIPData = await validateRequestData(request, validateChangeIPRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取用户选中的 API 密钥
    apiKey = await db.getApiKeyById(session.selectedApiKeyId);
    if (!apiKey || apiKey.user_id !== session.userId) {
      return createErrorResponse('API 密钥不存在或无权限访问', 403, 'INVALID_API_KEY');
    }

    // 所有支持changeInstanceIP方法的云服务商都可以使用IP更换功能
    // DigitalOcean、Linode和Azure都已实现此功能

    // 创建云服务商客户端
    const cloudProvider = await createCloudProviderFromEncryptedKey(
      apiKey.provider,
      apiKey.encrypted_key,
      env.ENCRYPTION_KEY
    );

    const instanceManager = new CloudInstanceManager(cloudProvider);

    // 执行更换IP操作
    console.log(`开始更换实例IP: ${instanceId}, 版本: ${changeIPData.ipVersion}`);
    
    // 获取旧IP用于通知
    const instances = await instanceManager.listInstances();
    const instance = instances.find(i => i.id === instanceId);
    const oldIP = changeIPData.ipVersion === 'ipv4' ? instance?.ipv4 : instance?.ipv6;
    
    const newIP = await instanceManager.changeInstanceIP(instanceId, changeIPData.ipVersion);

    // 发送 Telegram 通知
    sendTelegramNotification(env, session.userId, {
      type: 'instance_change_ip',
      instanceName: instanceId,
      instanceId: instanceId,
      provider: apiKey.provider,
      oldIp: oldIP,
      newIp: newIP
    }).catch(err => console.error('发送更换IP通知失败:', err));

    return createSuccessResponse({
      instanceId,
      ipVersion: changeIPData.ipVersion,
      newIP,
      success: true,
      message: `${changeIPData.ipVersion}地址更换成功`
    }, `${changeIPData.ipVersion}地址更换成功`);

  } catch (error) {
    console.error('更换IP失败:', {
      instanceId: instanceId,
      provider: apiKey?.provider || 'unknown',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    // 提供更具体的错误信息
    const errorMessage = error instanceof Error ? error.message : '更换IP失败';
    return createErrorResponse(errorMessage, 500, 'CHANGE_IP_FAILED');
  }
}
