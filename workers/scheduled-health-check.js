/**
 * Cloudflare Worker - 定时API密钥健康检查
 * 每天定时执行API密钥健康检查并发送通知
 */

// 发送错误通知
async function sendErrorNotification(error, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_ID) {
    return;
  }

  const message = `🚨 **定时任务执行失败**

⏰ 时间: ${new Date().toLocaleString('zh-CN')}
❌ 错误: ${error instanceof Error ? error.message : String(error)}

请检查系统状态和配置。`;

  const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_ADMIN_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (notifyError) {
    console.error('发送错误通知失败:', notifyError);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    console.log('🕐 定时任务开始: 每日API密钥健康检查...');
    
    try {
      // 调用 Pages 项目的内部 API 来执行健康检查
      let pagesUrl = env.PAGES_URL || 'https://cloudpanel-c02.pages.dev';
      // 移除尾部斜杠
      pagesUrl = pagesUrl.replace(/\/+$/, '');
      const healthCheckUrl = `${pagesUrl}/api/admin/scheduled-health-check`;
      
      console.log(`📡 调用健康检查 API: ${healthCheckUrl}`);
      
      const response = await fetch(healthCheckUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CloudPanel-Scheduler/1.0',
          'X-Scheduled-Task': 'true'
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          trigger: 'scheduled'
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`健康检查 API 响应失败: ${response.status} ${errorText}`);
      }
      
      const result = await response.json();
      console.log('✅ 定时健康检查完成:', result);
      
    } catch (error) {
      console.error('❌ 定时任务执行失败:', error);
      await sendErrorNotification(error, env);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 支持 GET 和 POST 请求触发定时任务
    if (url.pathname === '/trigger') {
      console.log(`🔧 手动触发定时任务 (${request.method})...`);
      
      const mockController = {};
      const mockContext = {
        waitUntil(promise) {
          return promise;
        }
      };
      
      await this.scheduled(mockController, env, mockContext);
      
      return new Response(JSON.stringify({
        success: true,
        message: '定时任务已手动触发',
        method: request.method,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 默认首页响应
    return new Response(`
CloudPanel Scheduled Health Check Worker

状态: ✅ 运行中

使用方法:
• GET  /trigger - 手动触发定时任务
• POST /trigger - 手动触发定时任务

定时执行: 每天 UTC 00:00 (北京时间 08:00)

部署时间: ${new Date().toISOString()}
    `.trim(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
