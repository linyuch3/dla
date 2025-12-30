// functions/api/admin/test-api-keys.ts - 测试API密钥健康状态
import { RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

interface TestResult {
    keyId: number;
    keyName: string;
    provider: string;
    username: string;
    success: boolean;
    accountEmail?: string;
    error?: string;
}

// 测试单个用户的所有API密钥
export async function onRequestPost(context: RequestContext): Promise<Response> {
    try {
        const { request, env } = context;
        
        // 身份验证
        const authResponse = await authMiddleware(context);
        if (authResponse) return authResponse;

        // 检查管理员权限
        if (!context.user?.is_admin) {
            return createErrorResponse('权限不足', 403);
        }

        const body: any = await request.json();
        const { userId } = body;
        
        if (!userId) {
            throw new ValidationError('缺少用户ID参数');
        }

        const db = createDatabaseService(env);
        
        // 获取用户信息
        const user = await db.getUserById(userId);
        if (!user) {
            return createErrorResponse('用户不存在', 404);
        }

        // 获取用户的所有API密钥
        const apiKeys = await db.getApiKeysByUserId(userId);
        
        if (apiKeys.length === 0) {
            return createSuccessResponse({
                username: user.username,
                totalKeys: 0,
                validKeys: [],
                invalidKeys: [],
                message: '用户没有API密钥'
            });
        }

        // 分批并行测试密钥 - 避免 CPU 超时
        const results: TestResult[] = [];
        const batchSize = 2; // 每批处理2个密钥，避免 CPU 超时

        for (let i = 0; i < apiKeys.length; i += batchSize) {
            const batch = apiKeys.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (key) => {
                    try {
                        const provider = await createCloudProviderFromEncryptedKey(
                            key.provider, 
                            key.encrypted_key, 
                            env.ENCRYPTION_KEY
                        );
                        const accountInfo = await provider.getAccountInfo();
                        
                        return {
                            keyId: key.id,
                            keyName: key.name,
                            provider: key.provider,
                            username: user.username,
                            success: true,
                            accountEmail: accountInfo.email || '未知'
                        };
                    } catch (error) {
                        return {
                            keyId: key.id,
                            keyName: key.name,
                            provider: key.provider,
                            username: user.username,
                            success: false,
                            error: error instanceof Error ? error.message : '未知错误'
                        };
                    }
                })
            );
            
            results.push(...batchResults);
        }

        const validKeys = results.filter(r => r.success);
        const invalidKeys = results.filter(r => !r.success);

        return createSuccessResponse({
            username: user.username,
            totalKeys: apiKeys.length,
            validKeys,
            invalidKeys,
            healthRate: Math.round((validKeys.length / apiKeys.length) * 100)
        });

    } catch (error) {
        console.error('测试API密钥失败:', error);
        return createErrorResponse(
            error instanceof ValidationError 
                ? error.message 
                : '测试API密钥时发生错误'
        );
    }
}

// 测试所有用户的API密钥（GET请求） - 改为只测试管理员自己的密钥
export async function onRequestGet(context: RequestContext): Promise<Response> {
    try {
        const { env } = context;
        
        // 身份验证
        const authResponse = await authMiddleware(context);
        if (authResponse) return authResponse;

        // 检查管理员权限
        if (!context.user?.is_admin) {
            return createErrorResponse('权限不足', 403);
        }

        const db = createDatabaseService(env);
        
        // 只获取管理员自己的密钥
        const adminUserId = context.session!.userId;
        const apiKeys = await db.getApiKeysByUserId(adminUserId);
        
        if (apiKeys.length === 0) {
            return createSuccessResponse({
                totalKeys: 0,
                validKeys: [],
                invalidKeys: [],
                message: '您没有API密钥'
            });
        }

        const allResults: TestResult[] = [];

        // 分批并行测试 - 避免 CPU 超时
        const batchSize = 2; // 每批处理2个密钥，避免 CPU 超时
        for (let i = 0; i < apiKeys.length; i += batchSize) {
            const batch = apiKeys.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (key) => {
                    try {
                        const provider = await createCloudProviderFromEncryptedKey(
                            key.provider, 
                            key.encrypted_key, 
                            env.ENCRYPTION_KEY
                        );
                        const accountInfo = await provider.getAccountInfo();
                        
                        return {
                            keyId: key.id,
                            keyName: key.name,
                            provider: key.provider,
                            username: context.user!.username,
                            success: true,
                            accountEmail: accountInfo.email || '未知'
                        };
                    } catch (error) {
                        return {
                            keyId: key.id,
                            keyName: key.name,
                            provider: key.provider,
                            username: context.user!.username,
                            success: false,
                            error: error instanceof Error ? error.message : '未知错误'
                        };
                    }
                })
            );
            
            allResults.push(...batchResults);
        }

        const validKeys = allResults.filter(r => r.success);
        const invalidKeys = allResults.filter(r => !r.success);

        return createSuccessResponse({
            totalKeys: apiKeys.length,
            validKeys,
            invalidKeys,
            healthRate: apiKeys.length > 0 ? Math.round((validKeys.length / apiKeys.length) * 100) : 0,
            summary: {
                validCount: validKeys.length,
                invalidCount: invalidKeys.length,
                checkedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('测试API密钥失败:', error);
        return createErrorResponse('测试API密钥时发生错误');
    }
}
