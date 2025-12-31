// config.ts - 配置管理
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

export const config = {
  server: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  
  database: {
    path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'cloudpanel.db'),
  },
  
  kv: {
    path: process.env.KV_PATH || path.join(process.cwd(), 'data', 'kv'),
  },
  
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },
  
  session: {
    secret: process.env.SESSION_SECRET || 'default-session-secret',
    duration: parseInt(process.env.SESSION_DURATION || '86400000', 10),
  },
  
  admin: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    adminId: process.env.TELEGRAM_ADMIN_ID || '',
  },
  
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
  },
  
  scheduler: {
    checkTime: process.env.SCHEDULED_CHECK_TIME || '00:00',
  },
};

// 验证必需的配置
export function validateConfig() {
  const errors: string[] = [];
  
  if (!config.encryption.key || config.encryption.key.length !== 64) {
    errors.push('ENCRYPTION_KEY must be a 64-character hexadecimal string');
  }
  
  if (config.server.nodeEnv === 'production') {
    if (config.session.secret === 'default-session-secret') {
      errors.push('SESSION_SECRET must be set in production');
    }
    
    if (config.admin.password === 'admin123') {
      console.warn('⚠️  警告: 使用默认管理员密码，建议修改');
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`配置错误:\n${errors.join('\n')}`);
  }
}

// 初始化时验证配置
validateConfig();
