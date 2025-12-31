-- Migration: 0004_add_auto_replenish.sql
-- Description: Add API key grouping, instance templates, and auto-replenish functionality

-- 为API密钥表添加分组字段
ALTER TABLE api_keys ADD COLUMN key_group TEXT DEFAULT 'personal' NOT NULL;
-- key_group: 'personal' (自用) 或 'rental' (租机)

-- 创建索引
CREATE INDEX idx_api_keys_key_group ON api_keys(key_group);

-- 创建开机模板表
CREATE TABLE instance_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    region TEXT NOT NULL,
    plan TEXT NOT NULL,
    image TEXT NOT NULL,
    disk_size INTEGER,
    enable_ipv6 BOOLEAN DEFAULT FALSE,
    root_password TEXT,
    ssh_keys TEXT,
    tags TEXT,
    user_data TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_instance_templates_user_id ON instance_templates(user_id);
CREATE INDEX idx_instance_templates_provider ON instance_templates(provider);
CREATE UNIQUE INDEX idx_instance_templates_unique_name ON instance_templates(user_id, name);

-- 创建自动补机配置表
CREATE TABLE auto_replenish_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT FALSE NOT NULL,
    key_group TEXT DEFAULT 'personal' NOT NULL,
    check_interval INTEGER DEFAULT 300,
    notify_telegram BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_auto_replenish_enabled ON auto_replenish_config(enabled);

-- 创建自动补机日志表
CREATE TABLE replenish_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trigger_type TEXT NOT NULL,
    original_instance_id TEXT,
    original_instance_name TEXT,
    original_api_key_id INTEGER,
    new_instance_id TEXT,
    new_instance_name TEXT,
    new_api_key_id INTEGER,
    template_id INTEGER,
    new_ipv4 TEXT,
    new_ipv6 TEXT,
    root_password TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES instance_templates(id) ON DELETE SET NULL
);

CREATE INDEX idx_replenish_logs_user_id ON replenish_logs(user_id);
CREATE INDEX idx_replenish_logs_status ON replenish_logs(status);
CREATE INDEX idx_replenish_logs_created_at ON replenish_logs(created_at);

-- 注释说明:
-- instance_templates: 存储开机模板配置
--   - ssh_keys: JSON数组存储SSH密钥ID
--   - tags: JSON数组存储标签
--   - user_data: 自定义启动脚本
--   - is_default: 是否为默认模板
--
-- auto_replenish_config: 自动补机配置
--   - enabled: 是否启用自动补机
--   - key_group: 使用哪个分组的API密钥进行补机
--   - check_interval: 检查间隔(秒)
--   - notify_telegram: 是否通过Telegram通知
--
-- replenish_logs: 补机日志
--   - trigger_type: 'instance_down' (机器失效), 'api_invalid' (API失效), 'manual' (手动触发)
--   - status: 'pending', 'success', 'failed'
--   - details: JSON格式的详细信息
