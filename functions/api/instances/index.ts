// functions/api/instances/index.ts - 实例管理 API
import { RequestContext, ValidationError, CONSTANTS } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager, CreateInstanceConfig } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

// 根据云服务商生成实例名称
function generateInstanceName(provider: string): string {
  const timestamp = Date.now().toString().slice(-6); // 使用时间戳后6位
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0'); // 2位随机数
  
  const prefixMap: { [key: string]: string } = {
    'digitalocean': 'do-server',
    'linode': 'ln-server',
    'azure': 'az-server'
  };
  
  const prefix = prefixMap[provider] || 'server';
  return `${prefix}-${timestamp}${random}`;
}

interface CreateInstanceRequest {
  name?: string; // 名称变为可选，如果为空将自动生成
  region: string;
  plan: string;
  image: string;
  diskSize?: number;
  root_password?: string;
  ssh_keys?: string[];
  tags?: string[];
  user_data?: string;
  enableIPv6?: boolean; // 启用IPv6支持
}

function validateCreateInstanceRequest(data: any): CreateInstanceRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { name, region, plan, image, diskSize, root_password, ssh_keys, tags, user_data, enableIPv6 } = data;

  // 名称可以为空，如果为空将在后续自动生成
  if (name !== undefined && typeof name !== 'string') {
    throw new ValidationError('实例名称必须为字符串类型', 'name');
  }

  if (!region || typeof region !== 'string') {
    throw new ValidationError('地区不能为空', 'region');
  }

  if (!plan || typeof plan !== 'string') {
    throw new ValidationError('配置计划不能为空', 'plan');
  }

  if (!image || typeof image !== 'string') {
    throw new ValidationError('镜像不能为空', 'image');
  }

  let trimmedName = '';
  if (name) {
    trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      throw new ValidationError('实例名称长度应在 1-100 字符之间', 'name');
    }

    // 验证名称格式（允许字母、数字、横线、下划线、中文）
    if (!/^[a-zA-Z0-9\-_\u4e00-\u9fa5]+$/.test(trimmedName)) {
      throw new ValidationError('实例名称只能包含字母、数字、横线、下划线和中文', 'name');
    }
  }

  // 验证密码格式（如果提供了密码）
  if (root_password && typeof root_password === 'string') {
    const password = root_password.trim();
    if (password.length < 8) {
      throw new ValidationError('密码长度至少8个字符', 'root_password');
    }
  }

  return {
    name: trimmedName || undefined, // 如果为空则返回undefined
    region: region.trim(),
    plan: plan.trim(),
    image: image.trim(),
    diskSize: typeof diskSize === 'number' && diskSize > 0 ? diskSize : undefined,
    root_password: root_password ? root_password.trim() : undefined,
    ssh_keys: Array.isArray(ssh_keys) ? ssh_keys : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    user_data: typeof user_data === 'string' ? user_data : undefined,
    enableIPv6: typeof enableIPv6 === 'boolean' ? enableIPv6 : false
  };
}

// GET /api/instances - 获取实例列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, request } = context;
    const session = context.session!;

    // 获取 URL 参数中的 api_key_id（用于补机任务等场景）
    const url = new URL(request.url);
    const paramApiKeyId = url.searchParams.get('api_key_id');
    
    // 优先使用 URL 参数中的密钥ID，否则使用前端选中的密钥
    const targetApiKeyId = paramApiKeyId ? parseInt(paramApiKeyId) : session.selectedApiKeyId;

    // 检查是否有选中的 API 密钥
    if (!targetApiKeyId) {
      return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取指定的 API 密钥
    const apiKey = await db.getApiKeyById(targetApiKeyId);
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

    // 获取实例列表
    const instances = await instanceManager.listInstances();

    return createSuccessResponse({
      instances,
      provider: apiKey.provider,
      totalCount: instances.length
    }, '获取实例列表成功');

  } catch (error) {
    console.error('获取实例列表失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('获取实例列表失败', 500, 'GET_INSTANCES_FAILED');
  }
}

// POST /api/instances - 创建新实例
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env } = context;
    const session = context.session!;

    // 检查是否有选中的 API 密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
    }

    // 验证请求数据
    const instanceConfig = await validateRequestData(request, validateCreateInstanceRequest);

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

    // 如果名称为空，根据云服务商自动生成
    const instanceName = instanceConfig.name || generateInstanceName(apiKey.provider);

    // 构建创建实例的配置
    const createConfig: CreateInstanceConfig = {
      name: instanceName,
      region: instanceConfig.region,
      image: instanceConfig.image,
      size: instanceConfig.plan, // 使用plan作为size
      diskSize: instanceConfig.diskSize,
      ssh_keys: instanceConfig.ssh_keys,
      tags: instanceConfig.tags,
      user_data: instanceConfig.user_data, // 包含root密码设置脚本
      enableIPv6: instanceConfig.enableIPv6 // 传递IPv6配置
    };

    // 创建实例
    const newInstance = await instanceManager.createInstance(createConfig);

    return createSuccessResponse({
      instance: newInstance,
      ip_address: newInstance.ip_address || null,
      message: '实例创建成功，正在启动中...'
    }, '实例创建成功', 201);

  } catch (error) {
    console.error('创建实例失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('创建实例失败', 500, 'CREATE_INSTANCE_FAILED');
  }
} 
