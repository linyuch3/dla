// functions/api/admin/test-telegram.ts - 发送 Telegram 测试消息
import { RequestContext } from '../../shared/types';
import { adminMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

async function telegramApi(botToken: string, methodName: string, params: object) {
    const url = `https://api.telegram.org/bot${botToken}/${methodName}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        const errorData = await response.json();
        console.error(`Telegram API Error:`, errorData);
        throw new Error(`Telegram API a an error: ${errorData.description}`);
    }
    return response.json();
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 1. 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;

    // 2. 检查 Telegram 环境变量是否配置
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_ID) {
      return createErrorResponse('Telegram Bot Token 或 Admin ID 未在环境��量中配置', 400, 'TELEGRAM_NOT_CONFIGURED');
    }

    // 3. 准备并发送测试消息
    const message = `✅ **Hello from CloudPanel!**\n\n` +
                    `This is a test message to confirm your Telegram notification setup is working correctly.\n\n` +
                    `You will receive alerts for invalid API keys here.\n\n` +
                    `*Timestamp:* ${new Date().toISOString()}`;

    await telegramApi(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: env.TELEGRAM_ADMIN_ID,
      text: message,
      parse_mode: 'Markdown'
    });

    // 4. 返回成功响应
    return createSuccessResponse({ message: 'Test message sent successfully.' }, '测试消息已发送');

  } catch (error) {
    console.error('发送 Telegram 测试消息失败:', error);
    return createErrorResponse(
        `发送 Telegram 测试消息失败: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        500, 
        'TELEGRAM_TEST_FAILED'
    );
  }
}