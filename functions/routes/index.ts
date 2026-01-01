// routes/index.ts - 手动路由注册（修复动态加载问题）
import { Express, Request, Response } from 'express';
import { createHandler } from './handler-wrapper';

// Auth路由
import * as authLogin from '../api/auth/login';
import * as authRegister from '../api/auth/register';
import * as authLogout from '../api/auth/logout';
import * as authCheck from '../api/auth/check';
import * as authChangePassword from '../api/auth/change-password';
import * as authResetAdmin from '../api/auth/reset-admin';

// API Keys路由
import * as apikeysIndex from '../api/apikeys/index';
import * as apikeysValidateBatch from '../api/apikeys/validate-batch';
import * as apikeysTestHealth from '../api/apikeys/test-health';
import * as apikeysIdIndex from '../api/apikeys/[id]/index';
import * as apikeysIdSelect from '../api/apikeys/[id]/select';

// Instances路由
import * as instancesIndex from '../api/instances/index';
import * as instancesIdIndex from '../api/instances/[id]/index';
import * as instancesIdAction from '../api/instances/[id]/action';
import * as instancesIdChangeIp from '../api/instances/[id]/change-ip';

// Floating IPs路由
import * as floatingIpsIndex from '../api/floating-ips/index';
import * as floatingIpsAssign from '../api/floating-ips/assign';
import * as floatingIpsUnassign from '../api/floating-ips/unassign';
import * as floatingIpsIpIndex from '../api/floating-ips/[ip]/index';

// Providers路由
import * as providersRegions from '../api/providers/[provider]/regions';
import * as providersPlans from '../api/providers/[provider]/plans';
import * as providersImages from '../api/providers/[provider]/images';

// Network路由
import * as networkCheckIp from '../api/network/check-ip';

// Account路由
import * as accountInfo from '../api/account/info';
import * as accountOverview from '../api/account/overview';

// Linode路由
import * as linodeAccountDetails from '../api/linode/account-details';
import * as linodeApplyPromo from '../api/linode/apply-promo';
import * as linodeUpdateEmail from '../api/linode/update-email';

// Admin路由
import * as adminInit from '../api/admin/init';
import * as adminUsers from '../api/admin/users';
import * as adminScheduledHealthCheck from '../api/admin/scheduled-health-check';
import * as adminTestApiKeys from '../api/admin/test-api-keys';
import * as adminTestTelegram from '../api/admin/test-telegram';
import * as adminStats from '../api/admin/stats';
import * as adminTestAllKeys from '../api/admin/test-all-keys';
import * as adminScheduler from '../api/admin/scheduler';

// Telegram路由
import * as telegramBot from '../api/telegram/bot';
import * as telegramWebhook from '../api/telegram/webhook';

// User路由
import * as userNotificationSettings from '../api/user/notification-settings';
import * as userTestNotification from '../api/user/test-notification';
import * as userDebugSettings from '../api/user/debug-settings';

// Templates路由
import * as templatesIndex from '../api/templates/index';
import * as templatesIdIndex from '../api/templates/[id]/index';

// Auto-replenish路由
import * as autoReplenishConfig from '../api/auto-replenish/config';
import * as autoReplenishLogs from '../api/auto-replenish/logs';
import * as autoReplenishTrigger from '../api/auto-replenish/trigger';
import * as autoReplenishTasks from '../api/auto-replenish/tasks';
import * as autoReplenishTask from '../api/auto-replenish/task';
import * as autoReplenishTaskTest from '../api/auto-replenish/tasks/[id]/test';

// Health路由
import * as health from '../api/health';

export function setupRoutes(app: Express) {
  console.log('🔧 开始注册路由...');
  
  // Health check (no auth required)
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });
  
  // Auth routes
  registerRoute(app, 'POST', '/api/auth/login', authLogin.onRequestPost);
  registerRoute(app, 'POST', '/api/auth/register', authRegister.onRequestPost);
  registerRoute(app, 'POST', '/api/auth/logout', authLogout.onRequestPost);
  registerRoute(app, 'GET', '/api/auth/check', authCheck.onRequestGet);
  registerRoute(app, 'POST', '/api/auth/change-password', authChangePassword.onRequestPost);
  registerRoute(app, 'POST', '/api/auth/reset-admin', authResetAdmin.onRequestPost);
  
  // API Keys routes
  registerRoute(app, 'GET', '/api/apikeys', apikeysIndex.onRequestGet);
  registerRoute(app, 'POST', '/api/apikeys', apikeysIndex.onRequestPost);
  registerRoute(app, 'POST', '/api/apikeys/validate-batch', apikeysValidateBatch.onRequestPost);
  registerRoute(app, 'POST', '/api/apikeys/test-health', apikeysTestHealth.onRequestPost);
  registerRoute(app, 'GET', '/api/apikeys/:id', apikeysIdIndex.onRequestGet);
  registerRoute(app, 'PUT', '/api/apikeys/:id', apikeysIdIndex.onRequestPut);
  registerRoute(app, 'DELETE', '/api/apikeys/:id', apikeysIdIndex.onRequestDelete);
  registerRoute(app, 'POST', '/api/apikeys/:id/select', apikeysIdSelect.onRequestPost);
  
  // Instances routes
  registerRoute(app, 'GET', '/api/instances', instancesIndex.onRequestGet);
  registerRoute(app, 'POST', '/api/instances', instancesIndex.onRequestPost);
  registerRoute(app, 'GET', '/api/instances/:id', instancesIdIndex.onRequestGet);
  registerRoute(app, 'DELETE', '/api/instances/:id', instancesIdIndex.onRequestDelete);
  registerRoute(app, 'POST', '/api/instances/:id/action', instancesIdAction.onRequestPost);
  registerRoute(app, 'POST', '/api/instances/:id/change-ip', instancesIdChangeIp.onRequestPost);
  
  // Floating IPs routes
  registerRoute(app, 'GET', '/api/floating-ips', floatingIpsIndex.onRequestGet);
  registerRoute(app, 'POST', '/api/floating-ips', floatingIpsIndex.onRequestPost);
  registerRoute(app, 'POST', '/api/floating-ips/assign', floatingIpsAssign.onRequestPost);
  registerRoute(app, 'POST', '/api/floating-ips/unassign', floatingIpsUnassign.onRequestPost);
  registerRoute(app, 'GET', '/api/floating-ips/:ip', floatingIpsIpIndex.onRequestGet);
  registerRoute(app, 'DELETE', '/api/floating-ips/:ip', floatingIpsIpIndex.onRequestDelete);
  
  // Providers routes
  registerRoute(app, 'GET', '/api/providers/:provider/regions', providersRegions.onRequestGet);
  registerRoute(app, 'GET', '/api/providers/:provider/plans', providersPlans.onRequestGet);
  registerRoute(app, 'GET', '/api/providers/:provider/images', providersImages.onRequestGet);
  
  // Network routes
  registerRoute(app, 'POST', '/api/network/check-ip', networkCheckIp.onRequestPost);
  
  // Account routes
  registerRoute(app, 'GET', '/api/account/info', accountInfo.onRequestGet);
  registerRoute(app, 'GET', '/api/account/overview', accountOverview.onRequestGet);
  
  // Linode routes
  registerRoute(app, 'GET', '/api/linode/account-details', linodeAccountDetails.onRequestGet);
  registerRoute(app, 'POST', '/api/linode/apply-promo', linodeApplyPromo.onRequestPost);
  registerRoute(app, 'PUT', '/api/linode/update-email', linodeUpdateEmail.onRequestPut);
  
  // Admin routes
  registerRoute(app, 'POST', '/api/admin/init', adminInit.onRequestPost);
  registerRoute(app, 'GET', '/api/admin/users', adminUsers.onRequestGet);
  registerRoute(app, 'POST', '/api/admin/users', adminUsers.onRequestPost);
  registerRoute(app, 'POST', '/api/admin/scheduled-health-check', adminScheduledHealthCheck.onRequestPost);
  registerRoute(app, 'POST', '/api/admin/test-api-keys', adminTestApiKeys.onRequestPost);
  registerRoute(app, 'POST', '/api/admin/test-telegram', adminTestTelegram.onRequestPost);
  registerRoute(app, 'GET', '/api/admin/stats', adminStats.onRequestGet);
  registerRoute(app, 'POST', '/api/admin/test-all-keys', adminTestAllKeys.onRequestPost);
  registerRoute(app, 'GET', '/api/admin/scheduler', adminScheduler.onRequestGet);
  
  // Telegram routes
  registerRoute(app, 'POST', '/api/telegram/bot', telegramBot.onRequestPost);
  registerRoute(app, 'POST', '/api/telegram/webhook', telegramWebhook.onRequestPost);
  
  // User routes
  registerRoute(app, 'GET', '/api/user/notification-settings', userNotificationSettings.onRequestGet);
  registerRoute(app, 'PUT', '/api/user/notification-settings', userNotificationSettings.onRequestPut);
  registerRoute(app, 'POST', '/api/user/test-notification', userTestNotification.onRequestPost);
  registerRoute(app, 'GET', '/api/user/debug-settings', userDebugSettings.onRequestGet);
  
  // Templates routes
  registerRoute(app, 'GET', '/api/templates', templatesIndex.onRequestGet);
  registerRoute(app, 'POST', '/api/templates', templatesIndex.onRequestPost);
  registerRoute(app, 'GET', '/api/templates/:id', templatesIdIndex.onRequestGet);
  registerRoute(app, 'PUT', '/api/templates/:id', templatesIdIndex.onRequestPut);
  registerRoute(app, 'DELETE', '/api/templates/:id', templatesIdIndex.onRequestDelete);
  
  // Auto-replenish routes
  registerRoute(app, 'GET', '/api/auto-replenish/config', autoReplenishConfig.onRequestGet);
  registerRoute(app, 'POST', '/api/auto-replenish/config', autoReplenishConfig.onRequestPost);
  registerRoute(app, 'GET', '/api/auto-replenish/logs', autoReplenishLogs.onRequestGet);
  registerRoute(app, 'POST', '/api/auto-replenish/trigger', autoReplenishTrigger.onRequestPost);
  registerRoute(app, 'GET', '/api/auto-replenish/tasks', autoReplenishTasks.onRequestGet);
  registerRoute(app, 'POST', '/api/auto-replenish/tasks', autoReplenishTasks.onRequestPost);
  registerRoute(app, 'GET', '/api/auto-replenish/tasks/:id', autoReplenishTask.onRequestGet);
  registerRoute(app, 'PUT', '/api/auto-replenish/tasks/:id', autoReplenishTask.onRequestPut);
  registerRoute(app, 'DELETE', '/api/auto-replenish/tasks/:id', autoReplenishTask.onRequestDelete);
  registerRoute(app, 'POST', '/api/auto-replenish/tasks/:id/toggle', autoReplenishTask.onRequestPostToggle);
  registerRoute(app, 'POST', '/api/auto-replenish/tasks/:id/test', autoReplenishTaskTest.onRequestPost);
  
  // Frontend fallback (SPA support)
  app.get('*', (req: Request, res: Response) => {
    // If it's an API request but not matched, return 404
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    // Other requests return index.html
    res.sendFile('index.html', { root: '.' });
  });
  
  console.log('✅ 所有路由注册完成！');
}

function registerRoute(app: Express, method: string, path: string, handler: any) {
  if (!handler) {
    console.warn(`⚠️ 警告: ${method} ${path} 处理器不存在`);
    return;
  }
  
  const wrappedHandler = createHandler(handler);
  
  switch (method.toUpperCase()) {
    case 'GET':
      app.get(path, wrappedHandler);
      break;
    case 'POST':
      app.post(path, wrappedHandler);
      break;
    case 'PUT':
      app.put(path, wrappedHandler);
      break;
    case 'DELETE':
      app.delete(path, wrappedHandler);
      break;
    case 'PATCH':
      app.patch(path, wrappedHandler);
      break;
    default:
      app.all(path, wrappedHandler);
  }
  
  console.log(`✓ ${method} ${path}`);
}
