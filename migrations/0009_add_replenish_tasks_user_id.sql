-- 为 replenish_tasks 表添加 user_id 字段
ALTER TABLE replenish_tasks ADD COLUMN user_id INTEGER;

-- 更新现有任务的 user_id 为管理员用户
UPDATE replenish_tasks SET user_id = (SELECT id FROM users WHERE is_admin = 1 LIMIT 1) WHERE user_id IS NULL;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_replenish_tasks_user ON replenish_tasks(user_id);

-- 添加外键约束（SQLite 3.6.19+ 支持）
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
