// run-migration.js - 执行特定迁移文件
import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = '/app/data/cloudpanel.db';
const migrationFile = process.argv[2] || '/app/migrations/0004_add_auto_replenish.sql';

console.log(`Running migration: ${migrationFile}`);
console.log(`Database: ${dbPath}`);

try {
  const db = new Database(dbPath);
  const sql = fs.readFileSync(migrationFile, 'utf8');
  
  // 使用 exec 执行多条语句
  try {
    db.exec(sql);
    console.log('✓ Migration executed successfully');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('duplicate')) {
      console.log('✓ Tables/columns already exist, skipping');
    } else {
      throw e;
    }
  }
  
  db.close();
  console.log('✓ Migration complete');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
