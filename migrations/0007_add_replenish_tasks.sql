-- 创建补机任务表
CREATE TABLE IF NOT EXISTS replenish_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 0,
    template_id INTEGER,
    backup_group TEXT,
    api_key_ids TEXT,
    instance_ids TEXT,
    instance_key_mapping TEXT,
    auto_add_new_instance BOOLEAN DEFAULT 0,
    check_interval INTEGER DEFAULT 5,
    last_check_at TEXT,
    last_trigger_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (template_id) REFERENCES instance_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_replenish_tasks_enabled ON replenish_tasks(enabled);
CREATE INDEX IF NOT EXISTS idx_replenish_tasks_template ON replenish_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_replenish_tasks_user ON replenish_tasks(user_id);

-- 补机日志表添加任务ID字段
ALTER TABLE replenish_logs ADD COLUMN task_id INTEGER REFERENCES replenish_tasks(id) ON DELETE SET NULL;
