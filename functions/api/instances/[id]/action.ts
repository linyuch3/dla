// functions/api/instances/[id]/action.ts - 实例操作 API
import { RequestContext, ValidationError, CONSTANTS } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../../shared/auth';
import { sendTelegramNotification } from '../../../shared/telegram-notify';

interface InstanceActionRequest {
  action: string;
}

function validateInstanceActionRequest(data: any): InstanceActionRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { action } = data;

  if (!action || typeof action !== 'string') {
    throw new ValidationError('操作类型不能为空', 'action');
  }

  const validActions = CONSTANTS.INSTANCE_ACTIONS;
  if (!validActions.includes(action as any)) {
    throw new ValidationError(`不支持的操作类型: ${action}。支持的操作: ${validActions.join(', ')}`, 'action');
  }

  return { action: action.trim() };
}

// POST /api/instances/{id}/action - 执行实例操作
export async function onRequestPost(context: RequestContext): Promise<Response> {
  // 从URL路径中获取实例ID
  const url = new URL(context.request.url);
  const pathParts = url.pathname.split('/');
  const instanceId = pathParts[pathParts.length - 2]; // /api/instances/{id}/action
  
  let actionData: InstanceActionRequest | undefined;
  let apiKey: any;
  
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    if (!instanceId) {
      return createErrorResponse('实例ID不能为空', 400, 'INVALID_INSTANCE_ID');
    }

    // 检查是否有选中的 API 密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 验证请求数据
    actionData = await validateRequestData(request, validateInstanceActionRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取用户选中的 API 密钥
    apiKey = await db.getApiKeyById(session.selectedApiKeyId);
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

    // 执行实例操作
    let result = false;
    let actionDescription = '';
    let notificationType: 'instance_power_on' | 'instance_power_off' | 'instance_reboot' | null = null;

    switch (actionData.action) {
      case 'power_on':
        result = await instanceManager.startInstance(instanceId);
        actionDescription = '启动实例';
        notificationType = 'instance_power_on';
        break;
      case 'power_off':
        result = await instanceManager.stopInstance(instanceId);
        actionDescription = '关闭实例';
        notificationType = 'instance_power_off';
        break;
      case 'reboot':
        result = await instanceManager.rebootInstance(instanceId);
        actionDescription = '重启实例';
        notificationType = 'instance_reboot';
        break;
      case 'shutdown':
        result = await instanceManager.stopInstance(instanceId);
        actionDescription = '关闭实例';
        notificationType = 'instance_power_off';
        break;
      default:
        return createErrorResponse(`不支持的操作: ${actionData.action}`, 400, 'UNSUPPORTED_ACTION');
    }

    if (!result) {
      return createErrorResponse(`${actionDescription}失败`, 500, 'ACTION_FAILED');
    }

    // 发送 Telegram 通知
    if (notificationType) {
      sendTelegramNotification(env, session.userId, {
        type: notificationType,
        instanceName: instanceId,
        instanceId: instanceId,
        provider: apiKey.provider
      }).catch(err => console.error('发送实例操作通知失败:', err));
    }

    return createSuccessResponse({
      instanceId,
      action: actionData.action,
      success: true,
      message: `${actionDescription}操作已提交，请稍后查看状态`
    }, `${actionDescription}成功`);

  } catch (error) {
    console.error('实例操作失败:', {
      instanceId,
      action: actionData?.action,
      provider: apiKey?.provider,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    // 提供更具体的错误信息
    const errorMessage = error instanceof Error ? error.message : '实例操作失败';
    return createErrorResponse(errorMessage, 500, 'INSTANCE_ACTION_FAILED');
  }
} 