// functions/api/instances/[id]/index.ts - 单个实例操作 API
import { RequestContext, ValidationError } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../../shared/auth';

// DELETE /api/instances/{id} - 删除实例
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取实例ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.length - 1]; // /api/instances/{id}

    if (!instanceId) {
      return createErrorResponse('实例ID不能为空', 400, 'INVALID_INSTANCE_ID');
    }

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

    // 删除实例
    const result = await instanceManager.deleteInstance(instanceId);

    if (!result) {
      return createErrorResponse('删除实例失败', 500, 'DELETE_FAILED');
    }

    return createSuccessResponse({
      instanceId,
      success: true,
      message: '实例删除操作已提交，请稍后查看状态'
    }, '实例删除成功');

  } catch (error) {
    console.error('删除实例失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('删除实例失败', 500, 'DELETE_INSTANCE_FAILED');
  }
}

// GET /api/instances/{id} - 获取单个实例信息
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 从URL路径中获取实例ID
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.length - 1]; // /api/instances/{id}

    if (!instanceId) {
      return createErrorResponse('实例ID不能为空', 400, 'INVALID_INSTANCE_ID');
    }

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

    // 获取所有实例，然后查找指定ID的实例
    const instances = await instanceManager.listInstances();
    const targetInstance = instances.find(instance => instance.id.toString() === instanceId);

    if (!targetInstance) {
      return createErrorResponse('实例不存在', 404, 'INSTANCE_NOT_FOUND');
    }

    return createSuccessResponse({
      instance: targetInstance,
      provider: apiKey.provider
    }, '获取实例信息成功');

  } catch (error) {
    console.error('获取实例信息失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('获取实例信息失败', 500, 'GET_INSTANCE_FAILED');
  }
} 