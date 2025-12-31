// shared/kv-adapter.ts - KV存储适配器
import fs from 'fs';
import path from 'path';

// Cloudflare KV接口定义
export interface KVNamespace {
  get(key: string, options?: { type: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<any>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVListOptions): Promise<KVListResult>;
}

export interface KVPutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: any;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface KVListResult {
  keys: { name: string; expiration?: number; metadata?: any }[];
  list_complete: boolean;
  cursor?: string;
}

// 文件系统实现的KV存储
class FileSystemKV implements KVNamespace {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    
    // 确保存储目录存在
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    // 对key进行编码，避免文件系统问题
    const encodedKey = Buffer.from(key).toString('base64')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');
    return path.join(this.basePath, encodedKey + '.json');
  }

  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<any> {
    const filePath = this.getFilePath(key);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // 检查过期时间
      if (data.expiration && data.expiration < Date.now()) {
        fs.unlinkSync(filePath);
        return null;
      }

      const type = options?.type || 'text';
      
      switch (type) {
        case 'json':
          return JSON.parse(data.value);
        case 'arrayBuffer':
          return Buffer.from(data.value, 'base64');
        case 'stream':
          // 简化实现，不支持stream
          throw new Error('Stream type not supported in file-based KV');
        case 'text':
        default:
          return data.value;
      }
    } catch (error) {
      console.error(`Error reading KV key ${key}:`, error);
      return null;
    }
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions): Promise<void> {
    const filePath = this.getFilePath(key);

    let valueToStore: string;
    
    if (value instanceof ArrayBuffer) {
      valueToStore = Buffer.from(value).toString('base64');
    } else if (typeof value === 'string') {
      valueToStore = value;
    } else {
      throw new Error('Stream type not supported in file-based KV');
    }

    const data: any = {
      value: valueToStore,
      metadata: options?.metadata
    };

    // 设置过期时间
    if (options?.expiration) {
      data.expiration = options.expiration * 1000; // 转换为毫秒
    } else if (options?.expirationTtl) {
      data.expiration = Date.now() + (options.expirationTtl * 1000);
    }

    try {
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    } catch (error) {
      console.error(`Error writing KV key ${key}:`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Error deleting KV key ${key}:`, error);
      }
    }
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    const files = fs.readdirSync(this.basePath);
    const keys = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(this.basePath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // 检查过期
        if (data.expiration && data.expiration < Date.now()) {
          fs.unlinkSync(filePath);
          continue;
        }

        // 解码key
        const encodedKey = file.replace('.json', '');
        const key = Buffer.from(
          encodedKey.replace(/_/g, '/').replace(/-/g, '+'),
          'base64'
        ).toString('utf-8');

        // 前缀过滤
        if (options?.prefix && !key.startsWith(options.prefix)) {
          continue;
        }

        keys.push({
          name: key,
          expiration: data.expiration ? Math.floor(data.expiration / 1000) : undefined,
          metadata: data.metadata
        });

      } catch (error) {
        console.error(`Error reading KV file ${file}:`, error);
      }
    }

    // 限制返回数量
    const limit = options?.limit || 1000;
    const limitedKeys = keys.slice(0, limit);

    return {
      keys: limitedKeys,
      list_complete: keys.length <= limit
    };
  }
}

// 导出单例KV实例
let kvInstance: FileSystemKV | null = null;

export function getKV(basePath: string): KVNamespace {
  if (!kvInstance) {
    kvInstance = new FileSystemKV(basePath);
  }
  return kvInstance;
}
