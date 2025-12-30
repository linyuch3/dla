// functions/api/user/test-notification.ts - 测试Telegram通知 API
import { RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { CryptoService } from '../../shared/crypto';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

// Telegram API 辅助函数
async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      }),
    });

    const result = await response.json();
    
    if (!response.ok) {
      console.error('Telegram API Error:', result);
      return false;
    }

    return true;
  } catch (error) {
    console.error('发送Telegram消息失败:', error);
    return false;
  }
}

// POST /api/user/test-notification - 发送测试通知
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env } = context;
    const session = context.session!;
    const db = createDatabaseService(env);

    // 获取用户信息
    const user = await db.getUserById(session.userId);
    if (!user) {
      return createErrorResponse('用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 检查是否配置了Telegram通知
    if (!user.telegram_enabled || !user.telegram_bot_token || !user.telegram_user_id) {
      return createErrorResponse('请先配置并启用Telegram通知', 400, 'NOTIFICATION_NOT_CONFIGURED');
    }

    try {
      // 解密Bot Token
      const botToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
      
      // 获取用户的所有API密钥并进行健康检查
      const userKeys = await db.getApiKeysByUser(session.userId);
      console.log(`🔍 开始检查用户 ${user.username} 的 ${userKeys.length} 个API密钥`);
      
      const healthyKeys: any[] = [];
      const unhealthyKeys: any[] = [];
      const limitedKeys: any[] = [];
      
      // 导入健康检查函数
      const { checkApiKeyHealth } = await import('../apikeys/validate-batch');
      
      // 🚀 使用与刷新按钮相同的批量处理逻辑
      const batchSize = 3; // 适中的批量大小，平衡速度和稳定性
      const results = [];
      
      // 分批处理，避免CPU超时
      for (let i = 0; i < userKeys.length; i += batchSize) {
        const batch = userKeys.slice(i, i + batchSize);
        
        // 并行处理当前批次
        const batchResults = await Promise.all(
          batch.map(async (key) => {
            try {
              console.log(`检查密钥: ${key.name} (${key.provider})`);
              
              // 使用批量验证中的健康检查逻辑
              const result = await checkApiKeyHealth(key, env.ENCRYPTION_KEY);
              
              const keyInfo = {
                name: key.name,
                provider: key.provider,
                created_at: key.created_at,
                error: result.error,
                status: result.status
              };
              
              // 更新数据库中的健康状态
              try {
                await db.updateApiKeyHealth(
                  key.id,
                  result.status,
                  result.checkedAt,
                  result.error
                );
              } catch (updateError) {
                console.error(`更新密钥 ${key.id} 健康状态失败:`, updateError);
              }
              
              return { keyInfo, result };
              
            } catch (error) {
              const keyInfo = {
                name: key.name,
                provider: key.provider,
                error: error instanceof Error ? error.message : '检查失败',
                created_at: key.created_at,
                status: 'unhealthy'
              };
              
              console.log(`❌ 密钥 ${key.name} 检查失败: ${error}`);
              return { keyInfo, result: { status: 'unhealthy', error: keyInfo.error } };
            }
          })
        );
        
        results.push(...batchResults);
        console.log(`批量处理进度: ${results.length}/${userKeys.length}`);
      }
      
      // 分类结果
      results.forEach(({ keyInfo, result }) => {
        if (result.status === 'healthy') {
          healthyKeys.push(keyInfo);
          console.log(`✅ 密钥 ${keyInfo.name} 正常`);
        } else if (result.status === 'limited') {
          limitedKeys.push(keyInfo);
          console.log(`⚠️ 密钥 ${keyInfo.name} 受限: ${result.error}`);
        } else {
          unhealthyKeys.push(keyInfo);
          console.log(`❌ 密钥 ${keyInfo.name} 失效: ${result.error}`);
        }
      });
      
      // 构建完整的测试报告消息
      const now = new Date();
      const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const timeStr = beijingTime.toLocaleString('zh-CN', { 
        timeZone: user.telegram_timezone || 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const totalKeys = userKeys.length;
      const validCount = healthyKeys.length;
      const invalidCount = unhealthyKeys.length + limitedKeys.length;
      const healthRate = totalKeys > 0 ? Math.round((validCount / totalKeys) * 100) : 100;
      
      let testMessage = `🧪 **CloudPanel 完整测试报告**\n\n`;
      testMessage += `👋 你好，${user.username}！\n\n`;
      testMessage += `📊 **API密钥健康检查结果:**\n`;
      testMessage += `• 总密钥数量: ${totalKeys}\n`;
      testMessage += `• 正常密钥: ${healthyKeys.length}\n`;
      testMessage += `• 受限密钥: ${limitedKeys.length}\n`;
      testMessage += `• 失效密钥: ${unhealthyKeys.length}\n`;
      testMessage += `• 健康率: ${healthRate}%\n\n`;
      
      if (healthyKeys.length > 0) {
        testMessage += `✅ **正常密钥列表:**\n`;
        healthyKeys.forEach(key => {
          testMessage += `• ${key.name} (${key.provider})\n`;
        });
        testMessage += `\n`;
      }
      
      if (limitedKeys.length > 0) {
        testMessage += `⚠️ **受限密钥列表:**\n`;
        limitedKeys.forEach(key => {
          testMessage += `• ${key.name} (${key.provider})\n  状态: ${key.error}\n`;
        });
        testMessage += `\n`;
      }
      
      if (unhealthyKeys.length > 0) {
        testMessage += `❌ **失效密钥列表:**\n`;
        unhealthyKeys.forEach(key => {
          testMessage += `• ${key.name} (${key.provider})\n  错误: ${key.error}\n`;
        });
        testMessage += `\n`;
      }
      
      testMessage += `⏰ **通知配置:**\n`;
      testMessage += `• 通知时间: ${user.telegram_notification_time}\n`;
      testMessage += `• 时区: ${user.telegram_timezone}\n`;
      testMessage += `• 测试时间: ${timeStr}\n\n`;
      testMessage += `✅ 如果你收到这条消息，说明Telegram通知配置成功！\n`;
      testMessage += `🔔 系统将在每天 ${user.telegram_notification_time} 向你发送类似的密钥检查报告。`;

      // 发送完整的测试报告
      const success = await sendTelegramMessage(botToken, user.telegram_user_id, testMessage);

      if (success) {
        return createSuccessResponse(
          { 
            message: '完整测试报告发送成功',
            sent_time: timeStr,
            chat_id: user.telegram_user_id,
            api_keys_checked: totalKeys,
            healthy_keys: healthyKeys.length,
            limited_keys: limitedKeys.length,
            unhealthy_keys: unhealthyKeys.length,
            health_rate: healthRate
          },
          `测试报告已发送！检查了${totalKeys}个密钥，健康率${healthRate}%`
        );
      } else {
        return createErrorResponse('发送测试报告失败，请检查Bot Token和用户ID是否正确', 400, 'SEND_TEST_FAILED');
      }

    } catch (decryptError) {
      console.error('解密Bot Token失败:', decryptError);
      return createErrorResponse('配置数据解密失败，请重新配置通知设置', 500, 'DECRYPT_FAILED');
    }

  } catch (error) {
    console.error('发送测试通知失败:', error);
    return createErrorResponse('发送测试通知失败，请稍后重试', 500, 'TEST_NOTIFICATION_FAILED');
  }
}
