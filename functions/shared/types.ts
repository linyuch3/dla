// types.ts - 全局类型定义

// 导入适配器类型
import { D1Database } from './db-adapter';
import { KVNamespace } from './kv-adapter';

export interface Env {
  // 数据库和存储绑定（兼容Cloudflare和本地）
  DB: D1Database;
  KV?: KVNamespace;
  
  // 环境变量
  ENCRYPTION_KEY: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
  SESSION_DURATION?: string;
  CACHE_TTL?: string;
  
  // Telegram Bot 配置 (可选)
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ADMIN_ID?: string;
}

// 数据库模型类型
export interface User {
  id: number;
  username: string;
  password_hash: string;
  is_admin: boolean;
  created_at: string;
  
  // Telegram 通知配置
  telegram_bot_token?: string;
  telegram_user_id?: string;
  telegram_enabled: boolean;
  telegram_notification_time: string;
  telegram_timezone: string;
  telegram_last_notification?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  encrypted_key: string;
  user_id: number;
  provider: 'digitalocean' | 'linode' | 'azure';
  created_at: string;
  health_status: 'unknown' | 'healthy' | 'unhealthy' | 'checking' | 'limited';
  last_checked?: string;
  error_message?: string;
}

// 开机模板类型
export interface InstanceTemplate {
  id: number;
  user_id: number;
  name: string;
  provider: 'digitalocean' | 'linode' | 'azure';
  region: string;
  plan: string;
  image: string;
  region_display?: string;
  plan_display?: string;
  image_display?: string;
  disk_size?: number;
  enable_ipv6: boolean;
  root_password?: string;
  ssh_keys?: string;
  tags?: string;
  user_data?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// 自动补机配置类型
export interface AutoReplenishConfig {
  id: number;
  user_id: number;
  enabled: boolean;
  monitor_type: 'instances' | 'api_keys';
  monitored_instances: string; // JSON数组
  monitored_api_keys: string;  // JSON数组
  instance_key_mapping: string; // JSON数组，存储机器与密钥的映射
  template_id: number | null;
  check_interval: number;
  notify_telegram: boolean;
  created_at: string;
  updated_at: string;
}

// 补机日志类型
export interface ReplenishLog {
  id: number;
  user_id: number;
  trigger_type: 'instance_down' | 'api_invalid' | 'manual';
  original_instance_id?: string;
  original_instance_name?: string;
  original_api_key_id?: number;
  new_instance_id?: string;
  new_instance_name?: string;
  new_api_key_id?: number;
  template_id?: number;
  new_ipv4?: string;
  new_ipv6?: string;
  root_password?: string;
  status: 'pending' | 'success' | 'failed';
  error_message?: string;
  details?: string;
  created_at: string;
}

export interface SocksProxy {
  id: number;
  host: string;
  port: number;
  proxy_type: 'socks4' | 'socks5';
  username?: string;
  encrypted_password?: string;
  status: 'unknown' | 'working' | 'failed';
  last_checked?: string;
  added_by_user_id?: number;
  created_at: string;
}

// 会话类型
export interface Session {
  userId: number;
  username: string;
  isAdmin: boolean;
  selectedApiKeyId?: number;
  createdAt: number;
  expiresAt: number;
}

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// CPU架构类型
export type CpuArchitecture = 'x64' | 'arm64' | 'both';

// 云服务商相关类型
export interface CloudInstance {
  id: string | number;
  name: string;
  status: string;
  provider: 'digitalocean' | 'linode' | 'azure';
  region: string;
  image: string;
  size: string;
  ip_address?: string;
  ipv6_address?: string;
  private_ip?: string;
  vcpus: number;
  memory: number;
  disk: number;
  created_at: string;
  tags?: string[];
  transfer?: {
    quota?: number;  // 流量配额 (GB)
    // 注意：不显示used字段，因为云服务商API不提供准确的实例级别流量使用数据
  };
}

export interface CloudRegion {
  slug: string;
  name: string;
  available?: boolean;
}

export interface CloudImage {
  id: string | number;
  slug?: string;
  name: string;
  distribution?: string;
  status?: string;
  supportedArchitectures?: CpuArchitecture[];  // 支持的CPU架构
}

export interface CloudPlan {
  slug: string;
  description: string;
  memory: number;
  vcpus: number;
  disk: number;
  price_monthly: number;
  price_hourly: number;
  regions?: string[];
  architecture?: CpuArchitecture;  // CPU架构类型
}

// 账户信息类型
export interface AccountInfo {
  email: string;
  status?: string;
  email_verified?: boolean;
  uuid?: string;
  active?: boolean;
  active_since?: string;
  droplet_limit?: number;
  [key: string]: any; // 允许其他云服务商特定字段
}

// 余额信息类型
export interface BalanceInfo {
  balance: number;
  currency: string;
  account_balance?: number;
  month_to_date_usage?: number;
  credits_remaining?: number;
  is_credit_account?: boolean; // 是否为信用账户（如有优惠码）
}

// 统一账户概览类型
export interface UnifiedAccountOverview {
  provider: 'digitalocean' | 'linode' | 'azure';
  account: {
    name: string;
    email?: string;
    status: 'active' | 'warning' | 'inactive';
    plan: string;
  };
  money: {
    currency: string;
    balance: number;
    monthly_used?: number;
    credits_remaining?: number;
  };
  quotas: Array<{
    key: string;
    label: string;
    used: number;
    limit: number;
  }>;
  resources: {
    instances: number;
    floating_ips?: number;
    volumes?: number;
    public_ipv4?: number;
    ipv6_prefixes?: number;
  };
  linode_promo?: {
    balance_uninvoiced: number;
    promo_code: string;
    promo_expire: string;
    promo_remaining: number;
  };
  linode_details?: {
    balance: number; // 账户余额
    credit_card?: string; // 信用卡后四位和过期时间
    created_at?: string; // 账户创建时间
  };
  meta: {
    region_focus?: string;
    last_sync: string;
  };
}

// 请求上下文类型
export interface RequestContext {
  request: Request;
  env: Env;
  params?: Record<string, string>;
  session?: Session;
  user?: User;
  next: () => Promise<Response>;
}

// 中间件类型
export type MiddlewareHandler = (
  context: RequestContext
) => Promise<Response | null>;

// KV 键名规则
export const KV_KEYS = {
  SESSION: (sessionId: string) => `session:${sessionId}`,
  USER: (userId: number) => `user:${userId}`,
  API_KEY: (keyId: number) => `apikey:${keyId}`,
  PROVIDER_DATA: (provider: string, type: string) => `provider:${provider}:${type}`,
  PROXY_STATUS: (proxyId: number) => `proxy:${proxyId}:status`,
} as const;

// 错误类型
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 云服务商 API 错误
export class CloudProviderError extends ApiError {
  constructor(
    message: string,
    public provider: string,
    statusCode: number = 500
  ) {
    super(message, statusCode, 'CLOUD_PROVIDER_ERROR');
    this.name = 'CloudProviderError';
  }
}

// 认证错误
export class AuthError extends ApiError {
  constructor(message: string = 'Unauthorized', statusCode: number = 401) {
    super(message, statusCode, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

// 验证错误
export class ValidationError extends ApiError {
  constructor(message: string, public field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

// 数据库错误
export class DatabaseError extends ApiError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

// 加密错误
export class CryptoError extends ApiError {
  constructor(message: string) {
    super(message, 500, 'CRYPTO_ERROR');
    this.name = 'CryptoError';
  }
}

// 工具函数类型
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RouteHandler {
  method: HttpMethod;
  path: string;
  handler: (context: RequestContext) => Promise<Response>;
  middleware?: MiddlewareHandler[];
}

// 常量定义
export const CONSTANTS = {
  SESSION_DURATION: 24 * 60 * 60 * 1000, // 24小时
  CACHE_TTL: 60 * 60, // 1小时
  MAX_API_KEYS_PER_USER: Number.MAX_SAFE_INTEGER,
  MAX_INSTANCES_PER_REQUEST: 10,
  SUPPORTED_PROVIDERS: ['digitalocean', 'linode', 'azure'] as const,
  PROXY_TYPES: ['socks4', 'socks5'] as const,
  INSTANCE_ACTIONS: ['power_on', 'power_off', 'reboot', 'shutdown'] as const,
} as const;

// 配置类型
export interface AppConfig {
  sessionDuration: number;
  cacheTtl: number;
  maxApiKeysPerUser: number;
  supportedProviders: readonly string[];
  encryptionKeyLength: number;
  passwordMinLength: number;
  usernameMinLength: number;
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  sessionDuration: CONSTANTS.SESSION_DURATION,
  cacheTtl: CONSTANTS.CACHE_TTL,
  maxApiKeysPerUser: CONSTANTS.MAX_API_KEYS_PER_USER,
  supportedProviders: CONSTANTS.SUPPORTED_PROVIDERS,
  encryptionKeyLength: 32,
  passwordMinLength: 6,
  usernameMinLength: 3,
};

// 扩展 Request 类型以包含会话信息
declare global {
  interface Request {
    session?: Session;
    user?: User;
  }
} 
