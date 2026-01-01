// functions/api/templates/index.ts - 开机模板管理 API
import { RequestContext, ValidationError, InstanceTemplate } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface CreateTemplateRequest {
  name: string;
  provider: 'digitalocean' | 'linode' | 'azure';
  region: string;
  region_display?: string;
  plan: string;
  plan_display?: string;
  image: string;
  image_display?: string;
  disk_size?: number;
  enable_ipv6?: boolean;
  root_password?: string;
  ssh_keys?: string[];
  tags?: string[];
  user_data?: string;
  is_default?: boolean;
}

function validateCreateTemplateRequest(data: any): CreateTemplateRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { name, provider, region, plan, image } = data;

  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    throw new ValidationError('模板名称不能为空', 'name');
  }

  if (!provider || !['digitalocean', 'linode', 'azure'].includes(provider)) {
    throw new ValidationError('无效的云服务商', 'provider');
  }

  if (!region || typeof region !== 'string') {
    throw new ValidationError('地区不能为空', 'region');
  }

  if (!plan || typeof plan !== 'string') {
    throw new ValidationError('配置不能为空', 'plan');
  }

  if (!image || typeof image !== 'string') {
    throw new ValidationError('镜像不能为空', 'image');
  }

  return {
    name: name.trim(),
    provider,
    region: region.trim(),
    region_display: typeof data.region_display === 'string' ? data.region_display.trim() : undefined,
    plan: plan.trim(),
    plan_display: typeof data.plan_display === 'string' ? data.plan_display.trim() : undefined,
    image: image.trim(),
    image_display: typeof data.image_display === 'string' ? data.image_display.trim() : undefined,
    disk_size: typeof data.disk_size === 'number' ? data.disk_size : undefined,
    enable_ipv6: typeof data.enable_ipv6 === 'boolean' ? data.enable_ipv6 : false,
    root_password: typeof data.root_password === 'string' ? data.root_password : undefined,
    ssh_keys: Array.isArray(data.ssh_keys) ? data.ssh_keys : undefined,
    tags: Array.isArray(data.tags) ? data.tags : undefined,
    user_data: typeof data.user_data === 'string' ? data.user_data : undefined,
    is_default: typeof data.is_default === 'boolean' ? data.is_default : false,
  };
}

// GET /api/templates - 获取用户的开机模板列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session } = context;
    const db = createDatabaseService(env);
    const templates = await db.getInstanceTemplatesByUserId(session!.userId);

    // 解析 JSON 字段
    const formattedTemplates = templates.map(t => ({
      ...t,
      ssh_keys: t.ssh_keys ? JSON.parse(t.ssh_keys) : [],
      tags: t.tags ? JSON.parse(t.tags) : [],
    }));

    return createSuccessResponse({
      templates: formattedTemplates,
      totalCount: formattedTemplates.length
    }, '获取开机模板列表成功');

  } catch (error) {
    console.error('获取开机模板列表失败:', error);
    return createErrorResponse('获取开机模板列表失败', 500, 'GET_TEMPLATES_FAILED');
  }
}

// POST /api/templates - 创建开机模板
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env, session } = context;
    const data = await validateRequestData(request, validateCreateTemplateRequest);
    const db = createDatabaseService(env);

    // 如果设置为默认，先清除同provider的其他默认模板
    if (data.is_default) {
      const existingTemplates = await db.getInstanceTemplatesByUserId(session!.userId);
      for (const t of existingTemplates) {
        if (t.provider === data.provider && t.is_default) {
          await db.updateInstanceTemplate(t.id, { is_default: false });
        }
      }
    }

    const templateId = await db.createInstanceTemplate({
      user_id: session!.userId,
      name: data.name,
      provider: data.provider,
      region: data.region,
      region_display: data.region_display,
      plan: data.plan,
      plan_display: data.plan_display,
      image: data.image,
      image_display: data.image_display,
      disk_size: data.disk_size,
      enable_ipv6: data.enable_ipv6 || false,
      root_password: data.root_password,
      ssh_keys: data.ssh_keys ? JSON.stringify(data.ssh_keys) : undefined,
      tags: data.tags ? JSON.stringify(data.tags) : undefined,
      user_data: data.user_data,
      is_default: data.is_default || false,
    });

    return createSuccessResponse({
      id: templateId,
      message: '开机模板创建成功'
    }, '开机模板创建成功', 201);

  } catch (error) {
    console.error('创建开机模板失败:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    return createErrorResponse('创建开机模板失败', 500, 'CREATE_TEMPLATE_FAILED');
  }
}
