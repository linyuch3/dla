// crypto.ts - 加密服务
import { CryptoError } from './types';

export class CryptoService {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;
  private static readonly SALT_LENGTH = 16;
  private static readonly ITERATIONS = 100000;

  /**
   * 从密码派生密钥
   */
  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    
    // 导入密码作为原始密钥材料
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // 使用 PBKDF2 派生密钥
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 加密数据
   * @param data 要加密的数据
   * @param password 加密密码
   * @returns Base64 编码的加密数据
   */
  static async encrypt(data: string, password: string): Promise<string> {
    try {
      const encoder = new TextEncoder();
      
      // 生成随机盐和 IV
      const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      
      // 派生密钥
      const key = await this.deriveKey(password, salt);
      
      // 加密数据
      const encrypted = await crypto.subtle.encrypt(
        { name: this.ALGORITHM, iv },
        key,
        encoder.encode(data)
      );
      
      // 组合 salt + iv + encrypted 数据
      const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
      result.set(salt, 0);
      result.set(iv, salt.length);
      result.set(new Uint8Array(encrypted), salt.length + iv.length);
      
      // 返回 Base64 编码的结果
      return btoa(String.fromCharCode(...result));
    } catch (error) {
      throw new CryptoError(`加密失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 解密数据
   * @param encryptedData Base64 编码的加密数据
   * @param password 解密密码
   * @returns 解密后的原始数据
   */
  static async decrypt(encryptedData: string, password: string): Promise<string> {
    try {
      // 解码 Base64 数据
      const data = new Uint8Array(
        atob(encryptedData).split('').map(c => c.charCodeAt(0))
      );
      
      // 检查数据长度
      if (data.length < this.SALT_LENGTH + this.IV_LENGTH) {
        throw new CryptoError('加密数据格式无效');
      }
      
      // 提取 salt、iv 和加密数据
      const salt = data.slice(0, this.SALT_LENGTH);
      const iv = data.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
      const encrypted = data.slice(this.SALT_LENGTH + this.IV_LENGTH);
      
      // 派生密钥
      const key = await this.deriveKey(password, salt);
      
      // 解密数据
      const decrypted = await crypto.subtle.decrypt(
        { name: this.ALGORITHM, iv },
        key,
        encrypted
      );
      
      // 返回解密后的字符串
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError(`解密失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 生成随机密钥
   * @param length 密钥长度（字符数）
   * @returns 随机密钥字符串
   */
  static generateKey(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    
    return Array.from(array, byte => chars[byte % chars.length]).join('');
  }

  /**
   * 生成随机 UUID
   * @returns UUID 字符串
   */
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * 计算字符串的 SHA-256 哈希
   * @param data 要哈希的数据
   * @returns 十六进制哈希字符串
   */
  static async hash(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 验证密钥强度
   * @param key 要验证的密钥
   * @returns 是否符合强度要求
   */
  static validateKeyStrength(key: string): boolean {
    // 密钥长度至少 32 字符
    if (key.length < 32) {
      return false;
    }
    
    // 检查是否包含字母和数字
    const hasLetter = /[a-zA-Z]/.test(key);
    const hasNumber = /[0-9]/.test(key);
    
    return hasLetter && hasNumber;
  }

  /**
   * 安全比较两个字符串（防止时序攻击）
   * @param a 字符串 A
   * @param b 字符串 B
   * @returns 是否相等
   */
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }
}

/**
 * 密码哈希服务
 */
export class PasswordService {
  private static readonly SALT_ROUNDS = 12;

  /**
   * 哈希密码
   * @param password 原始密码
   * @returns 哈希后的密码
   */
  static async hashPassword(password: string): Promise<string> {
    try {
      // 使用 bcrypt 风格的密码哈希
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const encoder = new TextEncoder();
      
      // 创建密码 + 盐的组合
      const passwordBuffer = encoder.encode(password);
      const combined = new Uint8Array(passwordBuffer.length + salt.length);
      combined.set(passwordBuffer);
      combined.set(salt, passwordBuffer.length);
      
      // 多次哈希以增加计算成本
      let hash = await crypto.subtle.digest('SHA-256', combined);
      for (let i = 0; i < this.SALT_ROUNDS; i++) {
        hash = await crypto.subtle.digest('SHA-256', hash);
      }
      
      // 组合盐和哈希
      const result = new Uint8Array(salt.length + hash.byteLength);
      result.set(salt);
      result.set(new Uint8Array(hash), salt.length);
      
      return btoa(String.fromCharCode(...result));
    } catch (error) {
      throw new CryptoError(`密码哈希失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 验证密码
   * @param password 原始密码
   * @param hashedPassword 哈希后的密码
   * @returns 是否匹配
   */
  static async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    try {
      // 解码哈希密码
      const data = new Uint8Array(
        atob(hashedPassword).split('').map(c => c.charCodeAt(0))
      );
      
      // 提取盐和哈希
      const salt = data.slice(0, 16);
      const storedHash = data.slice(16);
      
      // 重新计算哈希
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      const combined = new Uint8Array(passwordBuffer.length + salt.length);
      combined.set(passwordBuffer);
      combined.set(salt, passwordBuffer.length);
      
      let hash = await crypto.subtle.digest('SHA-256', combined);
      for (let i = 0; i < this.SALT_ROUNDS; i++) {
        hash = await crypto.subtle.digest('SHA-256', hash);
      }
      
      // 比较哈希
      const newHash = new Uint8Array(hash);
      if (newHash.length !== storedHash.length) {
        return false;
      }
      
      let result = 0;
      for (let i = 0; i < newHash.length; i++) {
        result |= newHash[i] ^ storedHash[i];
      }
      
      return result === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证密码强度
   * @param password 密码
   * @returns 强度信息
   */
  static validatePasswordStrength(password: string): {
    isValid: boolean;
    score: number;
    feedback: string[];
  } {
    const feedback: string[] = [];
    let score = 0;

    // 长度检查
    if (password.length < 6) {
      feedback.push('密码长度至少6位');
    } else if (password.length >= 8) {
      score += 1;
    }

    // 包含小写字母
    if (/[a-z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('应包含小写字母');
    }

    // 包含大写字母
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('应包含大写字母');
    }

    // 包含数字
    if (/[0-9]/.test(password)) {
      score += 1;
    } else {
      feedback.push('应包含数字');
    }

    // 包含特殊字符
    if (/[^a-zA-Z0-9]/.test(password)) {
      score += 1;
    } else {
      feedback.push('应包含特殊字符');
    }

    return {
      isValid: password.length >= 6 && score >= 2,
      score,
      feedback
    };
  }
} 