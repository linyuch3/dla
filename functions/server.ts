// server.ts - Express服务器主文件
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config';
import { initializeDatabase } from './shared/db-init';
import { setupRoutes } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { corsMiddleware } from './middleware/cors';
import { sessionMiddleware } from './middleware/session';
import { scheduleHealthCheck, scheduleApiKeyTest } from './scheduler';
import { getDatabase } from './shared/db-adapter';
import { getKV } from './shared/kv-adapter';
import { Env } from './shared/types';

// ES模块环境变量设置
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 设置环境变量（模拟Cloudflare Workers的env对象）
const env: Env = {
  DB: getDatabase(config.database.path),
  KV: getKV(config.kv.path),
  ENCRYPTION_KEY: config.encryption.key,
  SESSION_SECRET: config.session.secret,
  TELEGRAM_BOT_TOKEN: config.telegram.botToken,
  TELEGRAM_ADMIN_ID: config.telegram.adminId
};

// 将env存储到app.locals供中间件使用
app.locals.env = env;

// 基础中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS中间件
app.use(corsMiddleware);

// Session中间件
app.use(sessionMiddleware);

// 请求日志
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// 静态文件服务
const publicPath = path.join(__dirname, '..');
app.use(express.static(publicPath, {
  index: 'index.html',
  extensions: ['html']
}));

// 管理员面板路由 - 返回 admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin.html'));
});

// API路由
setupRoutes(app);

// 404处理
app.use(notFoundHandler);

// 错误处理
app.use(errorHandler);

// 服务器启动
async function startServer() {
  try {
    // 初始化数据库
    console.log('正在初始化数据库...');
    await initializeDatabase();
    console.log('数据库初始化完成');

    // 启动定时任务
    if (config.telegram.botToken && config.telegram.adminId) {
      console.log('正在启动定时健康检查任务...');
      scheduleHealthCheck();
      console.log('正在启动定时API密钥测试任务...');
      scheduleApiKeyTest();
      console.log('定时任务已启动');
    } else {
      console.log('Telegram未配置，跳过定时任务');
    }

    // 启动HTTP服务器
    const port = config.server.port;
    const host = config.server.host;
    
    app.listen(port, host, () => {
      console.log('');
      console.log('═══════════════════════════════════════════════');
      console.log('  ☁️  CloudPanel 服务器已启动');
      console.log('═══════════════════════════════════════════════');
      console.log(`  环境: ${config.server.nodeEnv}`);
      console.log(`  地址: http://${host}:${port}`);
      console.log(`  数据库: ${config.database.path}`);
      console.log('═══════════════════════════════════════════════');
      console.log('');
    });

  } catch (error) {
    console.error('启动服务器失败:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n收到SIGINT信号，正在关闭服务器...');
  process.exit(0);
});

// 启动
startServer();
