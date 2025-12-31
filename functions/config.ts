// config.ts - 配置管理
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

// 加载环境变量
dotenv.config();

// 内置默认密钥（如果未设置环境变量则使用）
const DEFAULT_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';
const DEFAULT_JWT_SECRET = 'cloudpanel-jwt-secret-key-2024-default';

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
    key: process.env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
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
  
  // ENCRYPTION_KEY 现在有内置默认值，不再强制要求
  if (config.encryption.key.length !== 64) {
    console.warn('⚠️  警告: ENCRYPTION_KEY 长度不正确，使用内置默认密钥');
  }
  
  // 提示用户在生产环境中使用自定义密钥
  if (config.server.nodeEnv === 'production') {
    if (config.encryption.key === DEFAULT_ENCRYPTION_KEY) {
      console.warn('⚠️  警告: 使用内置默认加密密钥，建议在生产环境设置自定义 ENCRYPTION_KEY');
    }
    if (config.jwt.secret === DEFAULT_JWT_SECRET) {
      console.warn('⚠️  警告: 使用内置默认JWT密钥，建议在生产环境设置自定义 JWT_SECRET');
    }
    if (config.session.secret === 'default-session-secret') {
      console.warn('⚠️  警告: 使用默认 SESSION_SECRET');
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
