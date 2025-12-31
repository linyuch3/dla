import { RequestContext } from '../../../shared/types';
import { createDatabaseService } from '../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../../shared/auth';

export async function onRequest(context: RequestContext) {
    const { request, env } = context;
    
    if (request.method !== 'GET') {
        return createErrorResponse('Method not allowed', 405);
    }

    try {
        // 验证用户身份
        const authResult = await authMiddleware(context);
        if (authResult) return authResult;

        const session = context.session!;
        
        // 从URL路径中提取provider参数和region查询参数
        const url = new URL(request.url);
        const pathParts = url.pathname.split('/');
        const provider = pathParts[pathParts.length - 2]; // /api/providers/{provider}/plans
        const region = url.searchParams.get('region'); // 获取region参数

        // 检查是否有选中的 API 密钥
        if (!session.selectedApiKeyId) {
            return createErrorResponse('请先选择一个 API 密钥', 400, 'NO_SELECTED_API_KEY');
        }

        // 获取数据库服务
        const db = createDatabaseService(env);

        // 获取用户选中的 API 密钥
        const apiKey = await db.getApiKeyById(session.selectedApiKeyId);
        if (!apiKey || apiKey.user_id !== session.userId) {
            return createErrorResponse('API 密钥不存在或无权限访问', 403, 'INVALID_API_KEY');
        }

        // 验证provider是否匹配
        if (apiKey.provider !== provider) {
            return createErrorResponse('API密钥提供商与请求不匹配', 400, 'PROVIDER_MISMATCH');
        }

        // 创建云服务商客户端
        const cloudProvider = await createCloudProviderFromEncryptedKey(
            apiKey.provider,
            apiKey.encrypted_key,
            env.ENCRYPTION_KEY
        );

        // 获取真实的配置计划数据，传递region参数
        const plans = await cloudProvider.getPlans(region || undefined);
        
        // 格式化配置数据以匹配前端期望的格式
        const formattedPlans = plans.map(plan => ({
            id: plan.slug,
            label: plan.description,
            name: plan.description,
            memory: plan.memory,
            vcpus: plan.vcpus,
            disk: plan.disk,
            price_monthly: plan.price_monthly,
            price_hourly: plan.price_hourly,
            transfer: plan.transfer || 1000
        }));

        return createSuccessResponse(formattedPlans, '获取配置计划成功');
        
    } catch (error) {
        console.error('获取配置计划错误:', error);
        return createErrorResponse('获取配置计划失败', 500, 'GET_PLANS_FAILED');
    }
}

// 导出GET方法
export const onRequestGet = onRequest;
