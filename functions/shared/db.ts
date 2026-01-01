// db.ts - 数据库操作服务
import { User, ApiKey, SocksProxy, DatabaseError, Env, InstanceTemplate, AutoReplenishConfig, ReplenishLog } from './types';
import { D1Database } from './db-adapter';

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
      `).bind(username, passwordHash, isAdmin ? 1 : 0).run();
      
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
      
      console.log('🔍 [DB] updateUser 被调用, ID:', id, 'updates:', JSON.stringify(updates, null, 2));
      
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
        values.push(updates.is_admin ? 1 : 0);
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
        values.push(updates.telegram_enabled ? 1 : 0);
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
        console.log('⚠️ [DB] setParts为空，返回false');
        return false;
      }
      
      values.push(id);
      
      const sql = `UPDATE users SET ${setParts.join(', ')} WHERE id = ?`;
      console.log('🔧 [DB] SQL:', sql, '参数:', values.length);
      
      const result = await this.db.prepare(sql).bind(...values).run();
      
      console.log('📊 [DB] 执行结果 success:', result.success, 'changes:', result.meta?.changes);
      
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

  // ========== 开机模板操作 ==========

  /**
   * 创建开机模板
   */
  async createInstanceTemplate(template: Omit<InstanceTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    try {
      const now = new Date().toISOString();
      const result = await this.db.prepare(`
        INSERT INTO instance_templates 
        (user_id, name, provider, region, plan, image, region_display, plan_display, image_display, disk_size, enable_ipv6, root_password, ssh_keys, tags, user_data, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        template.user_id,
        template.name,
        template.provider,
        template.region,
        template.plan,
        template.image,
        template.region_display || null,
        template.plan_display || null,
        template.image_display || null,
        template.disk_size || null,
        template.enable_ipv6 ? 1 : 0,
        template.root_password || null,
        template.ssh_keys || null,
        template.tags || null,
        template.user_data || null,
        template.is_default ? 1 : 0,
        now,
        now
      ).run();
      
      if (!result.success) {
        throw new DatabaseError('创建开机模板失败');
      }
      
      return result.meta.last_row_id as number;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('创建开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取用户的开机模板列表
   */
  async getInstanceTemplatesByUserId(userId: number): Promise<InstanceTemplate[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM instance_templates WHERE user_id = ? ORDER BY is_default DESC, created_at DESC
      `).bind(userId).all();
      
      return result.results as unknown as InstanceTemplate[];
    } catch (error) {
      throw new DatabaseError('查询开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 根据 ID 获取开机模板
   */
  async getInstanceTemplateById(id: number): Promise<InstanceTemplate | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM instance_templates WHERE id = ?
      `).bind(id).first();
      
      return result as InstanceTemplate | null;
    } catch (error) {
      throw new DatabaseError('查询开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取用户的默认模板
   */
  async getDefaultInstanceTemplate(userId: number, provider: string): Promise<InstanceTemplate | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM instance_templates WHERE user_id = ? AND provider = ? AND is_default = 1
      `).bind(userId, provider).first();
      
      return result as InstanceTemplate | null;
    } catch (error) {
      throw new DatabaseError('查询默认开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 更新开机模板
   */
  async updateInstanceTemplate(id: number, updates: Partial<Omit<InstanceTemplate, 'id' | 'user_id' | 'created_at'>>): Promise<boolean> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      
      if (updates.name !== undefined) { setParts.push('name = ?'); values.push(updates.name); }
      if (updates.provider !== undefined) { setParts.push('provider = ?'); values.push(updates.provider); }
      if (updates.region !== undefined) { setParts.push('region = ?'); values.push(updates.region); }
      if (updates.plan !== undefined) { setParts.push('plan = ?'); values.push(updates.plan); }
      if (updates.image !== undefined) { setParts.push('image = ?'); values.push(updates.image); }
      if (updates.disk_size !== undefined) { setParts.push('disk_size = ?'); values.push(updates.disk_size); }
      if (updates.enable_ipv6 !== undefined) { setParts.push('enable_ipv6 = ?'); values.push(updates.enable_ipv6 ? 1 : 0); }
      if (updates.root_password !== undefined) { setParts.push('root_password = ?'); values.push(updates.root_password); }
      if (updates.ssh_keys !== undefined) { setParts.push('ssh_keys = ?'); values.push(updates.ssh_keys); }
      if (updates.tags !== undefined) { setParts.push('tags = ?'); values.push(updates.tags); }
      if (updates.user_data !== undefined) { setParts.push('user_data = ?'); values.push(updates.user_data); }
      if (updates.is_default !== undefined) { setParts.push('is_default = ?'); values.push(updates.is_default ? 1 : 0); }
      
      if (setParts.length === 0) return false;
      
      setParts.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);
      
      const result = await this.db.prepare(`
        UPDATE instance_templates SET ${setParts.join(', ')} WHERE id = ?
      `).bind(...values).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('更新开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 删除开机模板
   */
  async deleteInstanceTemplate(id: number): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        DELETE FROM instance_templates WHERE id = ?
      `).bind(id).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('删除开机模板时发生数据库错误', error as Error);
    }
  }

  /**
   * 设置默认模板（会先清除同provider的其他默认模板）
   */
  async setDefaultInstanceTemplate(userId: number, templateId: number, provider: string): Promise<boolean> {
    try {
      // 先清除同provider的其他默认模板
      await this.db.prepare(`
        UPDATE instance_templates SET is_default = 0 WHERE user_id = ? AND provider = ?
      `).bind(userId, provider).run();
      
      // 设置新的默认模板
      const result = await this.db.prepare(`
        UPDATE instance_templates SET is_default = 1, updated_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), templateId).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('设置默认开机模板时发生数据库错误', error as Error);
    }
  }

  // ========== 自动补机配置操作 ==========

  /**
   * 获取用户的自动补机配置
   */
  async getAutoReplenishConfig(userId: number): Promise<AutoReplenishConfig | null> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM auto_replenish_config WHERE user_id = ?
      `).bind(userId).first();
      
      return result as AutoReplenishConfig | null;
    } catch (error) {
      throw new DatabaseError('查询自动补机配置时发生数据库错误', error as Error);
    }
  }

  /**
   * 创建或更新自动补机配置
   */
  async upsertAutoReplenishConfig(config: Omit<AutoReplenishConfig, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    try {
      const now = new Date().toISOString();
      
      // 先尝试更新
      const existingConfig = await this.getAutoReplenishConfig(config.user_id);
      
      if (existingConfig) {
        await this.db.prepare(`
          UPDATE auto_replenish_config 
          SET enabled = ?, monitor_type = ?, monitored_instances = ?, monitored_api_keys = ?, 
              instance_key_mapping = ?, template_id = ?, check_interval = ?, notify_telegram = ?, updated_at = ?
          WHERE user_id = ?
        `).bind(
          config.enabled ? 1 : 0,
          config.monitor_type || 'instances',
          config.monitored_instances || '[]',
          config.monitored_api_keys || '[]',
          config.instance_key_mapping || '[]',
          config.template_id || null,
          config.check_interval,
          config.notify_telegram ? 1 : 0,
          now,
          config.user_id
        ).run();
        
        return existingConfig.id;
      } else {
        const result = await this.db.prepare(`
          INSERT INTO auto_replenish_config 
          (user_id, enabled, monitor_type, monitored_instances, monitored_api_keys, instance_key_mapping, template_id, check_interval, notify_telegram, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          config.user_id,
          config.enabled ? 1 : 0,
          config.monitor_type || 'instances',
          config.monitored_instances || '[]',
          config.monitored_api_keys || '[]',
          config.instance_key_mapping || '[]',
          config.template_id || null,
          config.check_interval,
          config.notify_telegram ? 1 : 0,
          now,
          now
        ).run();
        
        return result.meta.last_row_id as number;
      }
    } catch (error) {
      throw new DatabaseError('保存自动补机配置时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取所有启用了自动补机的用户配置
   */
  async getEnabledAutoReplenishConfigs(): Promise<AutoReplenishConfig[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM auto_replenish_config WHERE enabled = 1
      `).all();
      
      return result.results as unknown as AutoReplenishConfig[];
    } catch (error) {
      throw new DatabaseError('查询启用的自动补机配置时发生数据库错误', error as Error);
    }
  }

  // ========== 补机日志操作 ==========

  /**
   * 创建补机日志
   */
  async createReplenishLog(log: Omit<ReplenishLog, 'id' | 'created_at'>): Promise<number> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO replenish_logs 
        (user_id, trigger_type, original_instance_id, original_instance_name, original_api_key_id, 
         new_instance_id, new_instance_name, new_api_key_id, template_id, new_ipv4, new_ipv6, 
         root_password, status, error_message, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        log.user_id,
        log.trigger_type,
        log.original_instance_id || null,
        log.original_instance_name || null,
        log.original_api_key_id || null,
        log.new_instance_id || null,
        log.new_instance_name || null,
        log.new_api_key_id || null,
        log.template_id || null,
        log.new_ipv4 || null,
        log.new_ipv6 || null,
        log.root_password || null,
        log.status,
        log.error_message || null,
        log.details || null,
        new Date().toISOString()
      ).run();
      
      if (!result.success) {
        throw new DatabaseError('创建补机日志失败');
      }
      
      return result.meta.last_row_id as number;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('创建补机日志时发生数据库错误', error as Error);
    }
  }

  /**
   * 更新补机日志状态
   */
  async updateReplenishLogStatus(logId: number, status: 'pending' | 'success' | 'failed', updates: Partial<ReplenishLog>): Promise<boolean> {
    try {
      const setParts: string[] = ['status = ?'];
      const values: any[] = [status];
      
      if (updates.new_instance_id !== undefined) { setParts.push('new_instance_id = ?'); values.push(updates.new_instance_id); }
      if (updates.new_instance_name !== undefined) { setParts.push('new_instance_name = ?'); values.push(updates.new_instance_name); }
      if (updates.new_api_key_id !== undefined) { setParts.push('new_api_key_id = ?'); values.push(updates.new_api_key_id); }
      if (updates.new_ipv4 !== undefined) { setParts.push('new_ipv4 = ?'); values.push(updates.new_ipv4); }
      if (updates.new_ipv6 !== undefined) { setParts.push('new_ipv6 = ?'); values.push(updates.new_ipv6); }
      if (updates.root_password !== undefined) { setParts.push('root_password = ?'); values.push(updates.root_password); }
      if (updates.error_message !== undefined) { setParts.push('error_message = ?'); values.push(updates.error_message); }
      if (updates.details !== undefined) { setParts.push('details = ?'); values.push(updates.details); }
      
      values.push(logId);
      
      const result = await this.db.prepare(`
        UPDATE replenish_logs SET ${setParts.join(', ')} WHERE id = ?
      `).bind(...values).run();
      
      return result.success && (result.meta?.changes || 0) > 0;
    } catch (error) {
      throw new DatabaseError('更新补机日志时发生数据库错误', error as Error);
    }
  }

  /**
   * 获取用户的补机日志
   */
  async getReplenishLogsByUserId(userId: number, limit: number = 50): Promise<ReplenishLog[]> {
    try {
      const result = await this.db.prepare(`
        SELECT * FROM replenish_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).bind(userId, limit).all();
      
      return result.results as unknown as ReplenishLog[];
    } catch (error) {
      throw new DatabaseError('查询补机日志时发生数据库错误', error as Error);
    }
  }
}

/**
 * 数据库服务工厂函数
 */
export function createDatabaseService(env: Env): DatabaseService {
  return new DatabaseService(env.DB);
} 
