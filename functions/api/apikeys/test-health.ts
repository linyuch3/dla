// functions/api/apikeys/test-health.ts - 用户测试自己的API密钥健康状态
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';
import { checkApiKeyHealth } from './validate-batch';

interface BatchTestProgress {
    total: number;
    current: number;
    completed: number;
    healthy: number;
    unhealthy: number;
    limited: number;
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
    try {
        const authResult = await authMiddleware(context);
        if (authResult) return authResult;

        const { env, request } = context;
        const session = context.session!;
        const db = createDatabaseService(env);

        // 获取请求参数
        const body: any = await request.json().catch(() => ({}));
        const { batchSize = 2 } = body; // 每批处理2个密钥，避免 CPU 超时

        console.log(`[用户 ${session.userId}] 开始测试API密钥，批量大小: ${batchSize}`);

        // 获取用户的所有API密钥
        const userApiKeys = await db.getApiKeysByUser(session.userId);
        
        if (userApiKeys.length === 0) {
            return createSuccessResponse({
                total: 0,
                healthy: 0,
                unhealthy: 0,
                limited: 0,
                results: [],
                message: '没有需要测试的 API 密钥'
            });
        }

        console.log(`[用户 ${session.userId}] 找到 ${userApiKeys.length} 个API密钥`);

        // 分批处理
        const results = [];
        const totalKeys = userApiKeys.length;
        let healthyCount = 0;
        let unhealthyCount = 0;
        let limitedCount = 0;

        // 将密钥分成批次
        for (let i = 0; i < userApiKeys.length; i += batchSize) {
            const batch = userApiKeys.slice(i, i + batchSize);
            
            // 并行处理当前批次
            const batchResults = await Promise.all(
                batch.map(async (apiKey) => {
                    const result = await checkApiKeyHealth(apiKey, env.ENCRYPTION_KEY);
                    
                    // 更新数据库中的健康状态
                    try {
                        await db.updateApiKeyHealth(
                            result.keyId,
                            result.status,
                            result.checkedAt,
                            result.error
                        );
                    } catch (updateError) {
                        console.error(`更新密钥 ${result.keyId} 状态失败:`, updateError);
                    }
                    
                    return result;
                })
            );

            results.push(...batchResults);

            // 统计当前进度
            healthyCount = results.filter(r => r.status === 'healthy').length;
            unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
            limitedCount = results.filter(r => r.status === 'limited').length;

            console.log(`[用户 ${session.userId}] 进度: ${results.length}/${totalKeys}, 健康: ${healthyCount}, 失效: ${unhealthyCount}, 受限: ${limitedCount}`);
        }

        const responseData = {
            total: totalKeys,
            healthy: healthyCount,
            unhealthy: unhealthyCount,
            limited: limitedCount,
            results: results.map(r => ({
                keyId: r.keyId,
                status: r.status,
                error: r.error,
                checkedAt: r.checkedAt
            })),
            message: `测试完成：健康 ${healthyCount}，失效 ${unhealthyCount}，受限 ${limitedCount}`
        };

        console.log(`[用户 ${session.userId}] 测试完成:`, responseData);

        return createSuccessResponse(responseData);

    } catch (error) {
        console.error('测试API密钥失败:', error);
        return createErrorResponse(
            error instanceof Error ? error.message : '测试API密钥时发生错误'
        );
    }
}
