// db.ts - 数据库操作服务
import { User, ApiKey, SocksProxy, DatabaseError, Env } from './types';

export class DatabaseService {
  constructor(private db: D1Database) {}

  // ========== 用户操作 ==========

  /**
   * 创建用户
   */
  async createUser(username: string, passwordHash: string, isAdmin: boolean = false): Promise<number> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO users (username, password_hash, is_admin)
        VALUES (?, ?, ?)
      `).bind(username, passwordHash, isAdmin).run();
      
      if (!result.success) {
        throw new DatabaseError('创建用户失败');
      }
      
      return result.meta.last_row_id as number;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError('创建用户时发生数据库错误', error as Error);
    }
  }

  /**
   * 根据用户名获取用户
   */
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM users WHERE username = ?
      `).bind(username).first();
      
      return result as User | null;
    } catch (error) {
      throw new DatabaseError('查询用户时发生数据库错误', error as Error);
    }
  }

  /**
   * 根据 ID 获取用户
   */
  async getUserById(id: number): Promise<User | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM users WHERE id = ?
      `).bind(id).first();
      
      return result as User | null;
    } catch (error) {
      throw new DatabaseError('查询用户时发生数据库错误', error as Error);
    }
  }

  /**
   * 更新用户信息
   */
  async updateUser(id: number, updates: Partial<Pick<User, 'username' | 'password_hash' | 'is_admin' | 'telegram_bot_token' | 'telegram_user_id' | 'telegram_enabled' | 'telegram_notification_time' | 'telegram_timezone' | 'telegram_last_notification'>>): Promise<boolean> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      
      if (updates.username !== undefined) {
        setParts.push('username = ?');
        values.push(updates.username);
      }
      if (updates.password_hash !== undefined) {
        setParts.push('password_hash = ?');
        values.push(updates.password_hash);
      }
      if (updates.is_admin !== undefined) {
        setParts.push('is_admin = ?');
        values.push(updates.is_admin);
      }
      if (updates.telegram_bot_token !== undefined) {
        setParts.push('telegram_bot_token = ?');
        values.push(updates.telegram_bot_token);
      }
      if (updates.telegram_user_id !== undefined) {
        setParts.push('telegram_user_id = ?');
        values.push(updates.telegram_user_id);
      }
      if (updates.telegram_enabled !== undefined) {
        setParts.push('telegram_enabled = ?');
        values.push(updates.telegram_enabled);
      }
      if (updates.telegram_notification_time !== undefined) {
        setParts.push('telegram_notification_time = ?');
        values.push(updates.telegram_notification_time);
      }
      if (updates.telegram_timezone !== undefined) {
        setParts.push('telegram_timezone = ?');
        values.push(updates.telegram_timezone);
      }
      if (updates.telegram_last_notification !== undefined) {
        setParts.push('telegram_last_notification = ?');
        values.push(updates.telegram_last_notification);
      }
      
      if (setParts.length === 0) {
        return false;
      }
      
      values.push(id);
      
      const result = await this.db.prepare(`
        UPDATE users SET ${setParts.join(', ')} WHERE id = ?
      `).bind(...values).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('更新用户时发生数据库错误', error as Error);
    }
  }

  /**
   * 删除用户
   */
  async deleteUser(id: number): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM users WHERE id = ?
      `).bind(id).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      console.error("DB: deleteUser raw error:", error);
      throw new DatabaseError('删除用户时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取所有用户（管理员功能）
   */
  async getAllUsers(): Promise<User[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM users ORDER BY id
      `).all();
      
      return result.results as unknown as User[];
    } catch (error) {
      throw new DatabaseError('查询用户列表时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取启用了Telegram通知的用户
   */
  async getTelegramEnabledUsers(): Promise<User[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM users 
        WHERE telegram_enabled = 1 
        AND telegram_bot_token IS NOT NULL 
        AND telegram_user_id IS NOT NULL
        ORDER BY id
      `).all();
      
      return result.results as unknown as User[];
    } catch (error) {
      throw new DatabaseError('查询启用Telegram通知的用户时发生数据库错误', error as Error);
    }
  }

  // ========== API 密钥操作 ==========

  /**
   * 创建 API 密钥
   */
  async createApiKey(name: string, encryptedKey: string, userId: number, provider: 'digitalocean' | 'linode' | 'azure'): Promise<number> {
    try {
      // 添加密钥时，由于已经验证过了，直接设置为 healthy 状态
      const now = new Date().toISOString();
      const result = await this.db.prepare(`
        INSERT INTO api_keys (name, encrypted_key, user_id, provider, health_status, last_checked)
        VALUES (?, ?, ?, ?, 'healthy', ?)
      `).bind(name, encryptedKey, userId, provider, now).run();
      
      if (!result.success) {
        throw new DatabaseError('创建 API 密钥失败');
      }
      
      return result.meta.last_row_id as number;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError('创建 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取用户的 API 密钥列表
   */
  async getApiKeysByUserId(userId: number): Promise<ApiKey[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM api_keys WHERE user_id = ? ORDER BY provider, name
      `).bind(userId).all();
      
      return result.results as unknown as ApiKey[];
    } catch (error) {
      throw new DatabaseError('查询 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 根据 ID 获取 API 密钥
   */
  async getApiKeyById(id: number): Promise<ApiKey | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM api_keys WHERE id = ?
      `).bind(id).first();
      
      console.log(`[DATABASE-DEBUG] Raw D1 result for key ID ${id}:`, JSON.stringify(result));
      console.log(`[DATABASE-DEBUG] Type of D1 result:`, typeof result);

      return result as ApiKey | null;
    } catch (error) {
      console.error(`[DATABASE-ERROR] Error fetching key from D1 for key ID ${id}:`, error);
      throw new DatabaseError('查询 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 删除 API 密钥
   */
  async deleteApiKey(id: number): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM api_keys WHERE id = ?
      `).bind(id).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      console.error("DB: deleteApiKey raw error:", error);
      throw new DatabaseError('删除 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 检查用户是否已有同名同提供商的密钥
   */
  async checkApiKeyExists(userId: number, name: string, provider: string): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        SELECT id FROM api_keys WHERE user_id = ? AND name = ? AND provider = ?
      `).bind(userId, name, provider).first();
      
      return result !== null;
    } catch (error) {
      throw new DatabaseError('检查 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 统计用户的 API 密钥数量
   */
  async countApiKeysByUserId(userId: number): Promise<number> {
    try {
      const result = await this.db.prepare(`
        SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?
      `).bind(userId).first() as { count: number };
      
      return result.count;
    } catch (error) {
      throw new DatabaseError('统计 API 密钥时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取所有 API 密钥（管理员功能）
   */
  async getAllApiKeys(): Promise<ApiKey[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM api_keys ORDER BY created_at DESC
      `).all();
      
      return result.results as unknown as ApiKey[];
    } catch (error) {
      throw new DatabaseError('查询所有 API 密钥时发生数据库错误', error as Error);
    }
  }

  // ========== SOCKS 代理操作 ==========

  /**
   * 创建 SOCKS 代理
   */
  async createSocksProxy(proxy: Omit<SocksProxy, 'id' | 'created_at'>): Promise<number> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO socks_proxies 
        (host, port, proxy_type, username, encrypted_password, status, added_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        proxy.host,
        proxy.port,
        proxy.proxy_type,
        proxy.username || null,
        proxy.encrypted_password || null,
        proxy.status,
        proxy.added_by_user_id || null
      ).run();
      
      if (!result.success) {
        throw new DatabaseError('创建 SOCKS 代理失败');
      }
      
      return result.meta.last_row_id as number;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError('创建 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取所有 SOCKS 代理
   */
  async getAllSocksProxies(): Promise<SocksProxy[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM socks_proxies ORDER BY created_at DESC
      `).all();
      
      return result.results as unknown as SocksProxy[];
    } catch (error) {
      throw new DatabaseError('查询 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取工作状态的 SOCKS 代理
   */
  async getWorkingSocksProxies(): Promise<SocksProxy[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM socks_proxies WHERE status = 'working' ORDER BY host, port
      `).all();
      
      return result.results as unknown as SocksProxy[];
    } catch (error) {
      throw new DatabaseError('查询工作状态的 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  /**
   * 根据 ID 获取 SOCKS 代理
   */
  async getSocksProxyById(id: number): Promise<SocksProxy | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM socks_proxies WHERE id = ?
      `).bind(id).first();
      
      return result as SocksProxy | null;
    } catch (error) {
      throw new DatabaseError('查询 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  /**
   * 更新 SOCKS 代理状态
   */
  async updateSocksProxyStatus(id: number, status: 'unknown' | 'working' | 'failed'): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        UPDATE socks_proxies SET status = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(status, id).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('更新 SOCKS 代理状态时发生数据库错误', error as Error);
    }
  }

  /**
   * 删除 SOCKS 代理
   */
  async deleteSocksProxy(id: number): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM socks_proxies WHERE id = ?
      `).bind(id).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('删除 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  /**
   * 检查代理是否已存在
   */
  async checkSocksProxyExists(host: string, port: number): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        SELECT id FROM socks_proxies WHERE host = ? AND port = ?
      `).bind(host, port).first();
      
      return result !== null;
    } catch (error) {
      throw new DatabaseError('检查 SOCKS 代理时发生数据库错误', error as Error);
    }
  }

  // ========== 数据库维护操作 ==========

  /**
   * 初始化数据库（创建默认管理员用户）
   */
  async initializeDatabase(env: Env): Promise<void> {
    try {
      const adminUsername = env.ADMIN_USER || 'admin';
      const adminPassword = env.ADMIN_PASSWORD;
      
      if (!adminPassword) {
        console.warn('未设置 ADMIN_PASSWORD 环境变量，跳过创建默认管理员');
        return;
      }
      
      // 检查管理员是否已存在
      const existingAdmin = await this.getUserByUsername(adminUsername);
      if (existingAdmin) {
        console.log('默认管理员用户已存在');
        return;
      }
      
      // 创建默认管理员用户
      const { PasswordService } = await import('./crypto');
      const passwordHash = await PasswordService.hashPassword(adminPassword);
      
      await this.createUser(adminUsername, passwordHash, true);
      console.log(`已创建默认管理员用户: ${adminUsername}`);
    } catch (error) {
      console.error('初始化数据库失败:', error);
      throw new DatabaseError('初始化数据库失败', error as Error);
    }
  }

  /**
   * 清理过期会话（如果存储在数据库中）
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      // 这里可以添加清理过期会话的逻辑
      // 目前会话存储在 KV 中，会自动过期
      return 0;
    } catch (error) {
      throw new DatabaseError('清理过期会话时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取数据库统计信息
   */
  async getStats(): Promise<{
    userCount: number;
    apiKeyCount: number;
    proxyCount: number;
    workingProxyCount: number;
  }> {
    try {
      const [userCount, apiKeyCount, proxyCount, workingProxyCount] = await Promise.all([
        this.db.prepare('SELECT COUNT(*) as count FROM users').first() as Promise<{ count: number }>,
        this.db.prepare('SELECT COUNT(*) as count FROM api_keys').first() as Promise<{ count: number }>,
        this.db.prepare('SELECT COUNT(*) as count FROM socks_proxies').first() as Promise<{ count: number }>,
        this.db.prepare('SELECT COUNT(*) as count FROM socks_proxies WHERE status = "working"').first() as Promise<{ count: number }>
      ]);
      
      return {
        userCount: userCount.count,
        apiKeyCount: apiKeyCount.count,
        proxyCount: proxyCount.count,
        workingProxyCount: workingProxyCount.count
      };
    } catch (error) {
      throw new DatabaseError('获取数据库统计信息时发生错误', error as Error);
    }
  }

  // 为 API 密钥健康检查添加新方法
  async getApiKeysByUser(userId: number): Promise<ApiKey[]> {
    return this.getApiKeysByUserId(userId);
  }

  async updateApiKeyHealth(
    keyId: number, 
    healthStatus: 'healthy' | 'unhealthy' | 'limited' | 'unknown',
    lastChecked: string,
    errorMessage?: string
  ): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('UPDATE api_keys SET health_status = ?, last_checked = ?, error_message = ? WHERE id = ?')
        .bind(healthStatus, lastChecked, errorMessage || null, keyId)
        .run();

      return result.success;
    } catch (error) {
      console.error("DB: updateApiKeyHealth raw error:", error);
      throw new DatabaseError(`更新 API 密钥健康状态失败 (ID: ${keyId})`, error as Error);
    }
  }
}

/**
 * 数据库服务工厂函数
 */
export function createDatabaseService(env: Env): DatabaseService {
  return new DatabaseService(env.DB);
} 
