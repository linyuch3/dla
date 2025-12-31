// functions/api/auto-replenish/config.ts - 自动补机配置 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface UpdateConfigRequest {
  enabled?: boolean;
  monitor_type?: 'instances' | 'api_keys';
  monitored_instances?: string;
  monitored_api_keys?: string;
  instance_key_mapping?: string;
  template_id?: number | null;
  key_group?: 'personal' | 'rental';
  check_interval?: number;
  notify_telegram?: boolean;
}

function validateUpdateConfigRequest(data: any): UpdateConfigRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const config: UpdateConfigRequest = {};

  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new ValidationError('enabled 必须为布尔值', 'enabled');
    }
    config.enabled = data.enabled;
  }

  if (data.monitor_type !== undefined) {
    if (!['instances', 'api_keys'].includes(data.monitor_type)) {
      throw new ValidationError('monitor_type 必须为 instances 或 api_keys', 'monitor_type');
    }
    config.monitor_type = data.monitor_type;
  }

  if (data.monitored_instances !== undefined) {
    if (typeof data.monitored_instances !== 'string') {
      throw new ValidationError('monitored_instances 必须为JSON字符串', 'monitored_instances');
    }
    config.monitored_instances = data.monitored_instances;
  }

  if (data.monitored_api_keys !== undefined) {
    if (typeof data.monitored_api_keys !== 'string') {
      throw new ValidationError('monitored_api_keys 必须为JSON字符串', 'monitored_api_keys');
    }
    config.monitored_api_keys = data.monitored_api_keys;
  }

  if (data.instance_key_mapping !== undefined) {
    if (typeof data.instance_key_mapping !== 'string') {
      throw new ValidationError('instance_key_mapping 必须为JSON字符串', 'instance_key_mapping');
    }
    config.instance_key_mapping = data.instance_key_mapping;
  }

  if (data.template_id !== undefined) {
    if (data.template_id !== null && typeof data.template_id !== 'number') {
      throw new ValidationError('template_id 必须为数字或null', 'template_id');
    }
    config.template_id = data.template_id;
  }

  if (data.key_group !== undefined) {
    if (!['personal', 'rental'].includes(data.key_group)) {
      throw new ValidationError('key_group 必须为 personal 或 rental', 'key_group');
    }
    config.key_group = data.key_group;
  }

  if (data.check_interval !== undefined) {
    if (typeof data.check_interval !== 'number' || data.check_interval < 60) {
      throw new ValidationError('check_interval 必须为大于等于60的数字', 'check_interval');
    }
    config.check_interval = data.check_interval;
  }

  if (data.notify_telegram !== undefined) {
    if (typeof data.notify_telegram !== 'boolean') {
      throw new ValidationError('notify_telegram 必须为布尔值', 'notify_telegram');
    }
    config.notify_telegram = data.notify_telegram;
  }

  return config;
}

// GET /api/auto-replenish/config - 获取自动补机配置
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session } = context;
    const db = createDatabaseService(env);
    
    let config = await db.getAutoReplenishConfig(session!.userId);

    // 如果没有配置，返回默认值
    if (!config) {
      config = {
        id: 0,
        user_id: session!.userId,
        enabled: false,
        monitor_type: 'instances',
        monitored_instances: '[]',
        monitored_api_keys: '[]',
        instance_key_mapping: '[]',
        template_id: null,
        key_group: 'personal',
        check_interval: 300,
        notify_telegram: true,
        created_at: '',
        updated_at: ''
      };
    }

    return createSuccessResponse(config, '获取自动补机配置成功');

  } catch (error) {
    console.error('获取自动补机配置失败:', error);
    return createErrorResponse('获取自动补机配置失败', 500, 'GET_CONFIG_FAILED');
  }
}

// POST /api/auto-replenish/config - 更新自动补机配置
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env, session } = context;
    const updates = await validateRequestData(request, validateUpdateConfigRequest);
    const db = createDatabaseService(env);

    // 获取当前配置
    let currentConfig = await db.getAutoReplenishConfig(session!.userId);

    // 合并更新
    const newConfig = {
      user_id: session!.userId,
      enabled: updates.enabled ?? currentConfig?.enabled ?? false,
      monitor_type: updates.monitor_type ?? currentConfig?.monitor_type ?? 'instances' as const,
      monitored_instances: updates.monitored_instances ?? currentConfig?.monitored_instances ?? '[]',
      monitored_api_keys: updates.monitored_api_keys ?? currentConfig?.monitored_api_keys ?? '[]',
      instance_key_mapping: updates.instance_key_mapping ?? currentConfig?.instance_key_mapping ?? '[]',
      template_id: updates.template_id !== undefined ? updates.template_id : (currentConfig?.template_id ?? null),
      key_group: updates.key_group ?? currentConfig?.key_group ?? 'personal' as const,
      check_interval: updates.check_interval ?? currentConfig?.check_interval ?? 300,
      notify_telegram: updates.notify_telegram ?? currentConfig?.notify_telegram ?? true,
    };

    const configId = await db.upsertAutoReplenishConfig(newConfig);

    return createSuccessResponse({
      id: configId,
      ...newConfig
    }, '自动补机配置已更新');

  } catch (error) {
    console.error('更新自动补机配置失败:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    return createErrorResponse('更新自动补机配置失败', 500, 'UPDATE_CONFIG_FAILED');
  }
}
