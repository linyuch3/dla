// functions/api/health.ts - 健康检查端点
import { RequestContext } from '../shared/types';

export async function onRequestGet(context: RequestContext): Promise<Response> {
  const { env } = context;
  
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: {
      hasEncryptionKey: !!env.ENCRYPTION_KEY,
      hasTelegramToken: !!env.TELEGRAM_BOT_TOKEN,
      hasTelegramAdminId: !!env.TELEGRAM_ADMIN_ID,
      hasDB: !!env.DB,
      hasKV: !!env.KV
    },
    endpoints: {
      telegram_webhook: '/api/telegram/webhook',
      telegram_test: '/api/telegram/test',
      health: '/api/health'
    }
  };

  return new Response(JSON.stringify(healthCheck, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
