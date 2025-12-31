// functions/api/apikeys/groups.ts - API密钥分组管理
import { RequestContext, ValidationError } from '../../shared/types';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface KeyGroup {
    id: string;
    name: string;
    description?: string;
}

interface CreateGroupRequest {
    id: string;
    name: string;
    description?: string;
}

function validateCreateGroupRequest(data: any): CreateGroupRequest {
    if (!data || typeof data !== 'object') {
        throw new ValidationError('请求数据无效');
    }
    if (!data.id || typeof data.id !== 'string') {
        throw new ValidationError('分组ID不能为空', 'id');
    }
    if (!data.name || typeof data.name !== 'string') {
        throw new ValidationError('分组名称不能为空', 'name');
    }
    return {
        id: data.id,
        name: data.name,
        description: data.description
    };
}

// GET /api/apikeys/groups - 获取分组列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
    const authError = await authMiddleware(context);
    if (authError) return authError;

    try {
        let groups: KeyGroup[] = [];
        
        try {
            const result = await context.env.DB.prepare(`
                SELECT * FROM api_key_groups ORDER BY created_at ASC
            `).all();
            
            groups = result.results?.map((g: any) => ({
                id: g.id,
                name: g.name,
                description: g.description
            })) || [];
        } catch (e: any) {
            // 表不存在时忽略
            if (!e.message?.includes('no such table')) {
                throw e;
            }
        }
        
        // 如果没有分组，返回默认分组
        if (groups.length === 0) {
            groups = [
                { id: 'personal', name: '自用密钥', description: '个人使用的密钥' },
                { id: 'rental', name: '租机密钥', description: '用于出租的密钥' }
            ];
        }

        return createSuccessResponse({ groups });
    } catch (error: any) {
        console.error('Get API key groups error:', error);
        return createErrorResponse(error.message || '获取分组失败', 500);
    }
}

// POST /api/apikeys/groups - 创建新分组
export async function onRequestPost(context: RequestContext): Promise<Response> {
    const authError = await authMiddleware(context);
    if (authError) return authError;

    try {
        const data = await validateRequestData(context, validateCreateGroupRequest);
        
        // 检查ID是否已存在
        try {
            const existing = await context.env.DB.prepare('SELECT id FROM api_key_groups WHERE id = ?').bind(data.id).first();
            if (existing) {
                return createErrorResponse('分组ID已存在', 400);
            }

            await context.env.DB.prepare(`
                INSERT INTO api_key_groups (id, name, description) VALUES (?, ?, ?)
            `).bind(data.id, data.name, data.description || null).run();
        } catch (e: any) {
            if (e.message?.includes('no such table')) {
                return createErrorResponse('分组功能尚未初始化，请先运行数据库迁移', 500);
            }
            throw e;
        }

        return createSuccessResponse({ message: '分组创建成功' });
    } catch (error: any) {
        console.error('Create API key group error:', error);
        if (error instanceof ValidationError) {
            return createErrorResponse(error.message, 400);
        }
        return createErrorResponse(error.message || '创建分组失败', 500);
    }
}
