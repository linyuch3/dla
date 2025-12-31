// functions/api/templates/[id]/index.ts - 单个模板操作 API
import { RequestContext, ValidationError } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../../shared/auth';

interface UpdateTemplateRequest {
  name?: string;
  provider?: 'digitalocean' | 'linode' | 'azure';
  region?: string;
  plan?: string;
  image?: string;
  disk_size?: number;
  enable_ipv6?: boolean;
  root_password?: string;
  ssh_keys?: string[];
  tags?: string[];
  user_data?: string;
  is_default?: boolean;
}

function validateUpdateTemplateRequest(data: any): UpdateTemplateRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const updates: UpdateTemplateRequest = {};

  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || data.name.trim().length < 1) {
      throw new ValidationError('模板名称无效', 'name');
    }
    updates.name = data.name.trim();
  }

  if (data.provider !== undefined) {
    if (!['digitalocean', 'linode', 'azure'].includes(data.provider)) {
      throw new ValidationError('无效的云服务商', 'provider');
    }
    updates.provider = data.provider;
  }

  if (data.region !== undefined) updates.region = data.region;
  if (data.plan !== undefined) updates.plan = data.plan;
  if (data.image !== undefined) updates.image = data.image;
  if (data.disk_size !== undefined) updates.disk_size = data.disk_size;
  if (data.enable_ipv6 !== undefined) updates.enable_ipv6 = data.enable_ipv6;
  if (data.root_password !== undefined) updates.root_password = data.root_password;
  if (data.ssh_keys !== undefined) updates.ssh_keys = data.ssh_keys;
  if (data.tags !== undefined) updates.tags = data.tags;
  if (data.user_data !== undefined) updates.user_data = data.user_data;
  if (data.is_default !== undefined) updates.is_default = data.is_default;

  return updates;
}

// GET /api/templates/:id - 获取单个模板
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session, params } = context;
    const templateId = parseInt(params?.id || '0');

    if (!templateId) {
      return createErrorResponse('无效的模板ID', 400, 'INVALID_TEMPLATE_ID');
    }

    const db = createDatabaseService(env);
    const template = await db.getInstanceTemplateById(templateId);

    if (!template) {
      return createErrorResponse('模板不存在', 404, 'TEMPLATE_NOT_FOUND');
    }

    if (template.user_id !== session!.userId) {
      return createErrorResponse('无权访问此模板', 403, 'ACCESS_DENIED');
    }

    // 解析 JSON 字段
    const formattedTemplate = {
      ...template,
      ssh_keys: template.ssh_keys ? JSON.parse(template.ssh_keys) : [],
      tags: template.tags ? JSON.parse(template.tags) : [],
    };

    return createSuccessResponse(formattedTemplate, '获取模板成功');

  } catch (error) {
    console.error('获取模板失败:', error);
    return createErrorResponse('获取模板失败', 500, 'GET_TEMPLATE_FAILED');
  }
}

// PUT /api/templates/:id - 更新模板
export async function onRequestPut(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env, session, params } = context;
    const templateId = parseInt(params?.id || '0');

    if (!templateId) {
      return createErrorResponse('无效的模板ID', 400, 'INVALID_TEMPLATE_ID');
    }

    const db = createDatabaseService(env);
    const template = await db.getInstanceTemplateById(templateId);

    if (!template) {
      return createErrorResponse('模板不存在', 404, 'TEMPLATE_NOT_FOUND');
    }

    if (template.user_id !== session!.userId) {
      return createErrorResponse('无权修改此模板', 403, 'ACCESS_DENIED');
    }

    const updates = await validateRequestData(request, validateUpdateTemplateRequest);

    // 处理 JSON 字段
    const dbUpdates: any = { ...updates };
    if (updates.ssh_keys !== undefined) {
      dbUpdates.ssh_keys = JSON.stringify(updates.ssh_keys);
    }
    if (updates.tags !== undefined) {
      dbUpdates.tags = JSON.stringify(updates.tags);
    }

    // 如果设置为默认，先清除同provider的其他默认模板
    if (updates.is_default) {
      const provider = updates.provider || template.provider;
      await db.setDefaultInstanceTemplate(session!.userId, templateId, provider);
    } else {
      await db.updateInstanceTemplate(templateId, dbUpdates);
    }

    return createSuccessResponse({ id: templateId }, '模板更新成功');

  } catch (error) {
    console.error('更新模板失败:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    return createErrorResponse('更新模板失败', 500, 'UPDATE_TEMPLATE_FAILED');
  }
}

// DELETE /api/templates/:id - 删除模板
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session, params } = context;
    const templateId = parseInt(params?.id || '0');

    if (!templateId) {
      return createErrorResponse('无效的模板ID', 400, 'INVALID_TEMPLATE_ID');
    }

    const db = createDatabaseService(env);
    const template = await db.getInstanceTemplateById(templateId);

    if (!template) {
      return createErrorResponse('模板不存在', 404, 'TEMPLATE_NOT_FOUND');
    }

    if (template.user_id !== session!.userId) {
      return createErrorResponse('无权删除此模板', 403, 'ACCESS_DENIED');
    }

    await db.deleteInstanceTemplate(templateId);

    return createSuccessResponse({ id: templateId }, '模板删除成功');

  } catch (error) {
    console.error('删除模板失败:', error);
    return createErrorResponse('删除模板失败', 500, 'DELETE_TEMPLATE_FAILED');
  }
}
