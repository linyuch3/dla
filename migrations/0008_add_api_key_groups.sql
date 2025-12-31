-- 创建API密钥分组表
CREATE TABLE IF NOT EXISTS api_key_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 插入默认分组
INSERT OR IGNORE INTO api_key_groups (id, name, description) VALUES 
    ('personal', '自用密钥', '个人使用的API密钥'),
    ('rental', '租机密钥', '用于出租业务的API密钥');

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_api_key_groups_name ON api_key_groups(name);
