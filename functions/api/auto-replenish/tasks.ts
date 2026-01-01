// functions/api/auto-replenish/tasks.ts - 补机任务列表 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface CreateTaskRequest {
  name: string;
  enabled?: boolean;
  template_id?: number | null;
  api_key_ids: string;
  instance_ids: string;
  instance_key_mapping: string;
  auto_add_new_instance?: boolean;
  check_interval?: number;
}

function validateCreateTaskRequest(data: any): CreateTaskRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }
  if (!data.name || typeof data.name !== 'string') {
    throw new ValidationError('任务名称不能为空', 'name');
  }
  return {
    name: data.name,
    enabled: data.enabled ?? true,
    template_id: data.template_id || null,
    api_key_ids: data.api_key_ids || '[]',
    instance_ids: data.instance_ids || '[]',
    instance_key_mapping: data.instance_key_mapping || '[]',
    auto_add_new_instance: data.auto_add_new_instance !== false,
    check_interval: data.check_interval || 5
  };
}

// GET /api/auto-replenish/tasks - 获取任务列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const db = createDatabaseService(context.env);
    const session = context.session!;
    
    // 检查表是否存在
    try {
      const tasks = await context.env.DB.prepare(`
        SELECT rt.*, 
               it.name as template_name, 
               it.provider as template_provider,
               (SELECT COUNT(*) FROM json_each(rt.instance_ids)) as instance_count,
               (SELECT COUNT(*) FROM json_each(rt.api_key_ids)) as api_key_count
        FROM replenish_tasks rt
        LEFT JOIN instance_templates it ON rt.template_id = it.id
        WHERE rt.user_id = ?
        ORDER BY rt.created_at DESC
      `).bind(session.userId).all();

      return createSuccessResponse({
        tasks: tasks.results || []
      });
    } catch (e: any) {
      // 表不存在时返回空列表
      if (e.message?.includes('no such table')) {
        return createSuccessResponse({ tasks: [] });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('Get replenish tasks error:', error);
    return createErrorResponse(error.message || '获取任务列表失败', 500);
  }
}

// POST /api/auto-replenish/tasks - 创建新任务
export async function onRequestPost(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const data = await validateRequestData(context.request, validateCreateTaskRequest);
    const session = context.session!;
    
    const result = await context.env.DB.prepare(`
      INSERT INTO replenish_tasks (
        user_id, name, enabled, template_id,
        api_key_ids, instance_ids, instance_key_mapping,
        auto_add_new_instance, check_interval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.userId,
      data.name,
      data.enabled ? 1 : 0,
      data.template_id,
      data.api_key_ids,
      data.instance_ids,
      data.instance_key_mapping,
      data.auto_add_new_instance ? 1 : 0,
      data.check_interval
    ).run();

    return createSuccessResponse({
      id: result.meta?.last_row_id,
      message: '任务创建成功'
    });
  } catch (error: any) {
    console.error('Create replenish task error:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, 400);
    }
    return createErrorResponse(error.message || '创建任务失败', 500);
  }
}
