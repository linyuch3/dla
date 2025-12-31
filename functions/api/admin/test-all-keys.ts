// functions/api/admin/test-all-keys.ts - 测试所有API密钥
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { adminMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

interface KeyTestResult {
  id: number;
  name: string;
  provider: string;
  username: string;
  userId: number;
  success: boolean;
  error?: string;
  balance?: number;
}

// POST - 测试所有API密钥
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { env } = context;
    const db = createDatabaseService(env);

    // 获取所有用户和密钥
    const users = await db.getAllUsers();
    const allKeys: any[] = [];

    for (const user of users) {
      const keys = await db.getApiKeysByUserId(user.id);
      for (const key of keys) {
        allKeys.push({
          ...key,
          username: user.username,
          userId: user.id
        });
      }
    }

    if (allKeys.length === 0) {
      return createSuccessResponse({
        total: 0,
        valid: 0,
        invalid: 0,
        results: []
      }, '没有API密钥需要测试');
    }

    const results: KeyTestResult[] = [];
    let validCount = 0;
    let invalidCount = 0;

    // 测试每个密钥
    for (const key of allKeys) {
      try {
        const provider = await createCloudProviderFromEncryptedKey(
          key.provider,
          key.encrypted_key,
          env.ENCRYPTION_KEY
        );
        
        const accountInfo = await provider.getAccountInfo();
        
        if (accountInfo) {
          validCount++;
          await db.updateApiKeyHealth(key.id, 'healthy', null);
          results.push({
            id: key.id,
            name: key.name,
            provider: key.provider,
            username: key.username,
            userId: key.userId,
            success: true,
            balance: accountInfo.balance
          });
        } else {
          invalidCount++;
          await db.updateApiKeyHealth(key.id, 'unhealthy', 'Account info not available');
          results.push({
            id: key.id,
            name: key.name,
            provider: key.provider,
            username: key.username,
            userId: key.userId,
            success: false,
            error: '无法获取账户信息'
          });
        }
      } catch (error: any) {
        invalidCount++;
        await db.updateApiKeyHealth(key.id, 'unhealthy', error.message || 'Unknown error');
        results.push({
          id: key.id,
          name: key.name,
          provider: key.provider,
          username: key.username,
          userId: key.userId,
          success: false,
          error: error.message || '测试失败'
        });
      }
    }

    return createSuccessResponse({
      total: allKeys.length,
      valid: validCount,
      invalid: invalidCount,
      results
    }, `测试完成: ${validCount} 有效, ${invalidCount} 失效`);

  } catch (error: any) {
    console.error('测试API密钥失败:', error);
    return createErrorResponse(error.message || '测试API密钥失败', 500, 'TEST_KEYS_FAILED');
  }
}

export const onRequest = onRequestPost;
