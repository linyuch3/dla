import { RequestContext, ValidationError, Env } from '../../../shared/types';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../../shared/auth';

interface UpdateGroupRequest {
    name?: string;
    description?: string;
}

function validateUpdateGroupRequest(data: any): UpdateGroupRequest {
    if (!data || typeof data !== 'object') {
        throw new ValidationError('请求数据无效');
    }
    return {
        name: data.name,
        description: data.description
    };
}

// PUT /api/apikeys/groups/:id - 更新分组名称
export async function onRequestPut(context: RequestContext): Promise<Response> {
    const { env, params, request } = context;
    const groupId = params.id as string;

    // 验证登录
    const authCheck = await authMiddleware(context);
    if (authCheck) return authCheck;

    try {
        const body = await validateRequestData<UpdateGroupRequest>(request, validateUpdateGroupRequest);
        
        if (!body.name || !body.name.trim()) {
            return createErrorResponse('分组名称不能为空', 400);
        }

        // 检查分组是否存在
        const existing = await env.DB.prepare(
            'SELECT id FROM api_key_groups WHERE id = ?'
        ).bind(groupId).first();

        if (!existing) {
            // 如果是默认分组但不存在于数据库，则创建
            if (groupId === 'personal' || groupId === 'rental') {
                await env.DB.prepare(
                    'INSERT INTO api_key_groups (id, name, description) VALUES (?, ?, ?)'
                ).bind(groupId, body.name.trim(), body.description || null).run();
            } else {
                return createErrorResponse('分组不存在', 404);
            }
        } else {
            // 更新分组
            await env.DB.prepare(
                'UPDATE api_key_groups SET name = ?, description = COALESCE(?, description), updated_at = datetime("now") WHERE id = ?'
            ).bind(body.name.trim(), body.description || null, groupId).run();
        }

        console.log('Updated API key group:', groupId, 'to', body.name);

        return createSuccessResponse({}, '分组名称已更新');
    } catch (error: any) {
        console.error('Update group error:', error);
        return createErrorResponse(error.message || '服务器错误', 500);
    }
}

// DELETE /api/apikeys/groups/:id - 删除分组
export async function onRequestDelete(context: RequestContext): Promise<Response> {
    const { env, params } = context;
    const groupId = params.id as string;

    // 验证登录
    const authCheck = await authMiddleware(context);
    if (authCheck) return authCheck;

    try {
        // 不允许删除默认分组
        if (groupId === 'personal' || groupId === 'rental') {
            return createErrorResponse('不能删除默认分组', 400);
        }

        // 检查是否有密钥使用此分组
        const keysUsingGroup = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM api_keys WHERE key_group = ?'
        ).bind(groupId).first();
        
        if (keysUsingGroup && (keysUsingGroup as any).count > 0) {
            return createErrorResponse('该分组下还有密钥，请先移动或删除这些密钥', 400);
        }

        // 删除分组
        await env.DB.prepare('DELETE FROM api_key_groups WHERE id = ?').bind(groupId).run();

        console.log('Deleted API key group:', groupId);

        return createSuccessResponse({}, '分组删除成功');
    } catch (error: any) {
        console.error('Delete group error:', error);
        return createErrorResponse(error.message || '服务器错误', 500);
    }
}

// GET /api/apikeys/groups/:id - 获取单个分组
export async function onRequestGet(context: RequestContext): Promise<Response> {
    const { env, params } = context;
    const groupId = params.id as string;

    // 验证登录
    const authCheck = await authMiddleware(context);
    if (authCheck) return authCheck;

    try {
        const group = await env.DB.prepare(
            'SELECT * FROM api_key_groups WHERE id = ?'
        ).bind(groupId).first();

        if (!group) {
            return createErrorResponse('分组不存在', 404);
        }

        return createSuccessResponse(group);
    } catch (error: any) {
        console.error('Get group error:', error);
        return createErrorResponse(error.message || '服务器错误', 500);
    }
}
