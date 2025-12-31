// shared/db-init.ts - 数据库初始化
import fs from 'fs';
import path from 'path';
import { getDatabase } from './db-adapter';
import { createDatabaseService } from './db';
import { config } from '../config';
import bcrypt from 'bcryptjs';

export async function initializeDatabase() {
  const db = getDatabase(config.database.path);
  
  // 检查数据库是否已初始化
  try {
    const result = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
    
    if (!result) {
      console.log('数据库未初始化，正在执行迁移...');
      await runMigrations(db);
    } else {
      console.log('数据库已存在，跳过初始化');
    }
    
    // 确保管理员账户存在
    await ensureAdminUser();
    
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}

async function runMigrations(db: any) {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.error('迁移目录不存在:', migrationsDir);
    throw new Error('Migration directory not found');
  }
  
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
  
  console.log(`找到 ${migrationFiles.length} 个迁移文件`);
  
  for (const file of migrationFiles) {
    console.log(`执行迁移: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    
    // 执行整个SQL文件（better-sqlite3支持多条语句）
    try {
      db.exec(sql);
      console.log(`✓ ${file} 执行完成`);
    } catch (error: any) {
      // 忽略"表已存在"等错误
      if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
        console.error(`执行迁移失败 ${file}:`, error.message);
        throw error;
      } else {
        console.log(`✓ ${file} 已跳过（对象已存在）`);
      }
    }
  }
  
  console.log('所有迁移执行完成');
}

async function ensureAdminUser() {
  const dbService = createDatabaseService({
    DB: getDatabase(config.database.path),
    ENCRYPTION_KEY: config.encryption.key
  } as any);
  
  const adminUser = await dbService.getUserByUsername(config.admin.username);
  
  if (!adminUser) {
    console.log('创建管理员账户...');
    const passwordHash = await bcrypt.hash(config.admin.password, 10);
    await dbService.createUser(config.admin.username, passwordHash, true);
    console.log(`管理员账户创建成功: ${config.admin.username}`);
  } else {
    console.log('管理员账户已存在');
  }
}
