import type { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';
import { CryptoService } from '../../shared/crypto';

export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证用户身份
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;

    // 检查是否有选中的API密钥
    if (!session.selectedApiKeyId) {
      return createErrorResponse('请先选择一个API密钥', 400);
    }

    // 从数据库获取API密钥
    const db = createDatabaseService(env);
    const apiKey = await db.getApiKeyById(session.selectedApiKeyId);

    if (!apiKey || apiKey.user_id !== session.userId) {
      return createErrorResponse('API密钥不存在或无权限访问', 403);
    }

    if (apiKey.provider !== 'linode') {
      return createErrorResponse('此功能仅支持Linode API密钥', 400);
    }

    // 解密API密钥
    const decryptedKey = await CryptoService.decrypt(apiKey.encrypted_key, env.ENCRYPTION_KEY);

    // 并行获取账户信息和促销信息
    const [accountResponse, promosResponse] = await Promise.all([
      fetch('https://api.linode.com/v4/account', {
        headers: { 'Authorization': `Bearer ${decryptedKey}` }
      }),
      fetch('https://api.linode.com/v4/account/promotions', {
        headers: { 'Authorization': `Bearer ${decryptedKey}` }
      }).catch(() => null) // 容错处理
    ]);

    if (!accountResponse.ok) {
      const error = await accountResponse.json() as any;
      return createErrorResponse(error.errors?.[0]?.reason || '获取账户信息失败', accountResponse.status);
    }

    const accountData = await accountResponse.json() as any;
    let promosData = null;
    
    if (promosResponse && promosResponse.ok) {
      promosData = await promosResponse.json() as any;
    }

    return createSuccessResponse({
      email: accountData.email,
      active_since: accountData.active_since,
      balance: accountData.balance,
      balance_uninvoiced: accountData.balance_uninvoiced,
      credit_card: accountData.credit_card ? {
        last_four: accountData.credit_card.last_four,
        expiry: accountData.credit_card.expiry
      } : null,
      active_promotions: promosData?.data || [],
      euuid: accountData.euuid
    });

  } catch (error: any) {
    console.error('Get Linode account details error:', error);
    return createErrorResponse(error.message || '获取账户详情时发生错误', 500);
  }
}
