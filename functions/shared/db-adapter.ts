// shared/db-adapter.ts - SQLite适配器，模拟D1数据库接口
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// D1数据库接口定义
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): D1ExecResult;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: {
    duration?: number;
    size_after?: number;
    rows_read?: number;
    rows_written?: number;
    last_row_id?: number;
    changes?: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

// SQLite适配器类
class SQLiteAdapter implements D1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保数据目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 初始化SQLite数据库
    this.db = new Database(dbPath);
    
    // 启用外键约束
    this.db.pragma('foreign_keys = ON');
    
    // 性能优化
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  prepare(query: string): D1PreparedStatement {
    return new SQLitePreparedStatement(this.db, query);
  }

  exec(query: string): D1ExecResult {
    const start = Date.now();
    const result = this.db.exec(query);
    const duration = Date.now() - start;
    
    return {
      count: Array.isArray(result) ? result.length : 0,
      duration
    };
  }

  async dump(): Promise<ArrayBuffer> {
    const buffer = this.db.serialize();
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    
    this.db.transaction(() => {
      for (const stmt of statements) {
        results.push(stmt.run() as any);
      }
    })();
    
    return results;
  }

  close() {
    this.db.close();
  }
}

// SQLite预处理语句适配器
class SQLitePreparedStatement implements D1PreparedStatement {
  private db: Database.Database;
  private query: string;
  private params: any[] = [];

  constructor(db: Database.Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    try {
      const stmt = this.db.prepare(this.query);
      const result = stmt.get(...this.params) as any;
      
      if (!result) return null;
      
      if (colName) {
        return result[colName] ?? null;
      }
      
      return result as T;
    } catch (error) {
      console.error('SQLite first() error:', error);
      throw error;
    }
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    try {
      const stmt = this.db.prepare(this.query);
      const info = stmt.run(...this.params);
      
      return {
        success: true,
        meta: {
          last_row_id: info.lastInsertRowid as number,
          changes: info.changes,
          rows_written: info.changes,
        },
        results: [] as T[]
      };
    } catch (error) {
      console.error('SQLite run() error:', error);
      return {
        success: false,
        meta: {
          changes: 0
        }
      };
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    try {
      const stmt = this.db.prepare(this.query);
      const results = stmt.all(...this.params) as T[];
      
      return {
        success: true,
        meta: {
          rows_read: results.length
        },
        results
      };
    } catch (error) {
      console.error('SQLite all() error:', error);
      return {
        success: false,
        meta: {},
        results: []
      };
    }
  }

  async raw<T = unknown>(): Promise<T[]> {
    const stmt = this.db.prepare(this.query);
    return stmt.raw(...this.params).all() as T[];
  }
}

// 导出单例数据库实例
let dbInstance: SQLiteAdapter | null = null;

export function getDatabase(dbPath: string): D1Database {
  if (!dbInstance) {
    dbInstance = new SQLiteAdapter(dbPath);
  }
  return dbInstance;
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
