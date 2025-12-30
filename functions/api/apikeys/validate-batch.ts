import { RequestContext, ApiKey } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

interface HealthCheckResult {
  keyId: number;
  status: 'healthy' | 'unhealthy' | 'limited';
  error?: string;
  checkedAt: string;
}

export async function checkApiKeyHealth(apiKey: ApiKey, encryptionKey: string): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    keyId: apiKey.id,
    status: 'unhealthy',
    checkedAt: new Date().toISOString()
  };

  try {
    console.log(`开始检查API密钥 ${apiKey.id} (${apiKey.provider})`);
    
    const provider = await createCloudProviderFromEncryptedKey(
      apiKey.provider, 
      apiKey.encrypted_key, 
      encryptionKey
    );
    
    // 尝试获取账户信息来验证密钥有效性
    const accountInfo = await provider.getAccountInfo();
    console.log(`API密钥 ${apiKey.id} 验证成功:`, accountInfo);
    
    // 检查账户状态，特别是锁定状态
    if (apiKey.provider === 'digitalocean') {
      if (accountInfo && accountInfo.status === 'locked') {
        result.status = 'unhealthy';
        result.error = '账户被锁定，请联系DigitalOcean支持';
        return result;
      }
    } else if (apiKey.provider === 'linode') {
      // Linode 的 inactive 状态通常是正常的，只要 API 能正常调用就认为是健康的
      // 如果需要检测特定问题，可以在这里添加其他条件
    } else if (apiKey.provider === 'azure') {
      if (accountInfo && accountInfo.status !== 'Enabled') {
        result.status = 'limited';
        result.error = `Azure订阅状态: ${accountInfo.status}`;
        return result;
      }
    }
    
    result.status = 'healthy';
    return result;

  } catch (error: any) {
    console.error(`API密钥 ${apiKey.id} 检查失败:`, error);
    const errorMessage = error.message || String(error);
    result.error = errorMessage;

    // 云服务商特定的错误处理
    if (apiKey.provider === 'digitalocean') {
      if (errorMessage.includes('422') && errorMessage.includes('unprocessable_entity')) {
        result.status = 'unhealthy';
        result.error = '账户被锁定，请联系DigitalOcean支持';
      } else if (errorMessage.includes('403') && errorMessage.includes('Forbidden')) {
        result.status = 'unhealthy';
        result.error = '权限不足或账户被封禁';
      } else if (errorMessage.includes('401')) {
        result.status = 'unhealthy';
        result.error = 'API密钥无效或已过期';
      } else if (errorMessage.includes('429')) {
        result.status = 'limited';
        result.error = 'API调用频率限制';
      }
    } else if (apiKey.provider === 'azure') {
      if (errorMessage.includes('401')) {
        result.status = 'unhealthy';
        result.error = '认证失败，检查客户端ID和密钥';
      } else if (errorMessage.includes('403')) {
        result.status = 'limited';
        result.error = '权限不足，检查订阅权限';
      }
    } else if (apiKey.provider === 'linode') {
      if (errorMessage.includes('401')) {
        result.status = 'unhealthy';
        result.error = 'API Token无效或已过期';
      } else if (errorMessage.includes('403')) {
        result.status = 'limited';
        result.error = 'Token权限不足';
      }
    }

    return result;
  }
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    const db = createDatabaseService(env);

    console.log('开始批量验证API密钥，用户ID:', session.userId);

    // 获取用户的所有API密钥
    const userApiKeys = await db.getApiKeysByUser(session.userId);
    console.log('找到API密钥数量:', userApiKeys.length);
    
    if (userApiKeys.length === 0) {
      return createSuccessResponse({
        total: 0,
        healthy: 0,
        unhealthy: 0,
        limited: 0,
        results: []
      }, '没有需要验证的 API 密钥');
    }

    // 批量检查密钥健康状态 - 使用并行批处理提高速度
    const results: HealthCheckResult[] = [];
    const batchSize = 2; // 每批并行处理2个密钥，避免 CPU 超时
    
    // 分批并行处理
    for (let i = 0; i < userApiKeys.length; i += batchSize) {
      const batch = userApiKeys.slice(i, i + batchSize);
      console.log(`处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(userApiKeys.length / batchSize)}，包含 ${batch.length} 个密钥`);
      
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
            console.log(`已更新密钥 ${result.keyId} 健康状态: ${result.status}`);
          } catch (updateError) {
            console.error(`更新密钥 ${result.keyId} 健康状态失败:`, updateError);
          }
          
          return result;
        })
      );
      
      results.push(...batchResults);
    }

    console.log('验证结果统计:', {
      total: results.length,
      healthy: results.filter(r => r.status === 'healthy').length,
      unhealthy: results.filter(r => r.status === 'unhealthy').length,
      limited: results.filter(r => r.status === 'limited').length
    });

    return createSuccessResponse({
      total: results.length,
      healthy: results.filter(r => r.status === 'healthy').length,
      unhealthy: results.filter(r => r.status === 'unhealthy').length,
      limited: results.filter(r => r.status === 'limited').length,
      results: results.map(r => ({
        keyId: r.keyId,
        status: r.status,
        error: r.error,
        checkedAt: r.checkedAt
      }))
    }, '批量验证完成');

  } catch (error) {
    console.error('批量验证API密钥失败:', error);
    const errorMessage = error instanceof Error ? error.message : '批量验证失败';
    return createErrorResponse(errorMessage, 500, 'BATCH_VALIDATION_ERROR');
  }
}

// GET /api/apikeys/validate-batch - 获取验证统计
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    const db = createDatabaseService(env);

    // 获取用户的所有API密钥及其健康状态
    const userKeys = await db.getApiKeysByUser(session.userId);
    
    const healthStats = {
      total: userKeys.length,
      healthy: userKeys.filter(k => k.health_status === 'healthy').length,
      unhealthy: userKeys.filter(k => k.health_status === 'unhealthy').length,
      limited: userKeys.filter(k => k.health_status === 'limited').length,
      unknown: userKeys.filter(k => !k.health_status || k.health_status === 'unknown').length,
      lastChecked: userKeys.reduce((latest, key) => {
        if (!key.last_checked) return latest;
        const keyTime = new Date(key.last_checked);
        return !latest || keyTime > latest ? keyTime : latest;
      }, null as Date | null)?.toISOString()
    };

    return createSuccessResponse(healthStats, '获取验证统计成功');

  } catch (error) {
    console.error('获取验证统计失败:', error);
    const errorMessage = error instanceof Error ? error.message : '获取验证统计失败';
    return createErrorResponse(errorMessage, 500, 'GET_VALIDATION_STATS_ERROR');
  }
}
