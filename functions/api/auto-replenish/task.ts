// functions/api/auto-replenish/task.ts - 单个补机任务 API
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface UpdateTaskRequest {
  name?: string;
  enabled?: boolean;
  template_id?: number | null;
  backup_group?: string;
  api_key_ids?: string;
  instance_ids?: string;
  instance_key_mapping?: string;
  auto_add_new_instance?: boolean;
  check_interval?: number;
}

function validateUpdateTaskRequest(data: any): UpdateTaskRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }
  return {
    name: data.name,
    enabled: data.enabled,
    template_id: data.template_id,
    backup_group: data.backup_group,
    api_key_ids: data.api_key_ids,
    instance_ids: data.instance_ids,
    instance_key_mapping: data.instance_key_mapping,
    auto_add_new_instance: data.auto_add_new_instance,
    check_interval: data.check_interval
  };
}

// GET /api/auto-replenish/task/:id - 获取单个任务
export async function onRequestGet(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const taskId = context.params?.id;
    if (!taskId) {
      return createErrorResponse('任务ID不能为空', 400);
    }

    const task = await context.env.DB.prepare(`
      SELECT rt.*, it.name as template_name, it.provider as template_provider
      FROM replenish_tasks rt
      LEFT JOIN instance_templates it ON rt.template_id = it.id
      WHERE rt.id = ?
    `).bind(taskId).first();

    if (!task) {
      return createErrorResponse('任务不存在', 404);
    }

    return createSuccessResponse(task);
  } catch (error: any) {
    console.error('Get replenish task error:', error);
    return createErrorResponse(error.message || '获取任务失败', 500);
  }
}

// PUT /api/auto-replenish/task/:id - 更新任务
export async function onRequestPut(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const taskId = context.params?.id;
    if (!taskId) {
      return createErrorResponse('任务ID不能为空', 400);
    }

    const data = await validateRequestData(context.request, validateUpdateTaskRequest);
    
    // 检查任务是否存在
    const existing = await context.env.DB.prepare('SELECT id FROM replenish_tasks WHERE id = ?').bind(taskId).first();
    if (!existing) {
      return createErrorResponse('任务不存在', 404);
    }

    // 构建更新语句
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }
    if (data.template_id !== undefined) {
      updates.push('template_id = ?');
      values.push(data.template_id);
    }
    if (data.backup_group !== undefined) {
      updates.push('backup_group = ?');
      values.push(data.backup_group);
    }
    if (data.api_key_ids !== undefined) {
      updates.push('api_key_ids = ?');
      values.push(data.api_key_ids);
    }
    if (data.instance_ids !== undefined) {
      updates.push('instance_ids = ?');
      values.push(data.instance_ids);
    }
    if (data.instance_key_mapping !== undefined) {
      updates.push('instance_key_mapping = ?');
      values.push(data.instance_key_mapping);
    }
    if (data.auto_add_new_instance !== undefined) {
      updates.push('auto_add_new_instance = ?');
      values.push(data.auto_add_new_instance ? 1 : 0);
    }
    if (data.check_interval !== undefined) {
      updates.push('check_interval = ?');
      values.push(data.check_interval);
    }

    updates.push("updated_at = datetime('now')");
    values.push(taskId);

    await context.env.DB.prepare(`
      UPDATE replenish_tasks SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    return createSuccessResponse({ message: '任务更新成功' });
  } catch (error: any) {
    console.error('Update replenish task error:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, 400);
    }
    return createErrorResponse(error.message || '更新任务失败', 500);
  }
}

// DELETE /api/auto-replenish/task/:id - 删除任务
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const taskId = context.params?.id;
    if (!taskId) {
      return createErrorResponse('任务ID不能为空', 400);
    }

    await context.env.DB.prepare('DELETE FROM replenish_tasks WHERE id = ?').bind(taskId).run();

    return createSuccessResponse({ message: '任务删除成功' });
  } catch (error: any) {
    console.error('Delete replenish task error:', error);
    return createErrorResponse(error.message || '删除任务失败', 500);
  }
}

// POST /api/auto-replenish/task/:id/toggle - 切换任务状态
export async function onRequestPostToggle(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const taskId = context.params?.id;
    if (!taskId) {
      return createErrorResponse('任务ID不能为空', 400);
    }

    const body = await context.request.json() as { enabled: boolean };

    // 检查任务是否存在
    const existing = await context.env.DB.prepare('SELECT id, name FROM replenish_tasks WHERE id = ?').bind(taskId).first();
    if (!existing) {
      return createErrorResponse('任务不存在', 404);
    }

    await context.env.DB.prepare(`
      UPDATE replenish_tasks SET enabled = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(body.enabled ? 1 : 0, taskId).run();

    return createSuccessResponse({
      message: body.enabled ? '任务已启用' : '任务已停用'
    });
  } catch (error: any) {
    console.error('Toggle replenish task error:', error);
    return createErrorResponse(error.message || '操作失败', 500);
  }
}
