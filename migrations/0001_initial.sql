-- Migration: 0001_initial.sql
-- Description: Create initial database schema for CloudPanel

-- 创建用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建 API 密钥表
CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'digitalocean',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建 SOCKS 代理表
CREATE TABLE socks_proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    proxy_type TEXT NOT NULL DEFAULT 'socks5',
    username TEXT,
    encrypted_password TEXT,
    status TEXT DEFAULT 'unknown' NOT NULL,
    last_checked DATETIME,
    added_by_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 创建索引以提高查询性能
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_provider ON api_keys(provider);
CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider);
CREATE INDEX idx_socks_proxies_status ON socks_proxies(status);
CREATE INDEX idx_socks_proxies_host_port ON socks_proxies(host, port);
CREATE INDEX idx_socks_proxies_added_by ON socks_proxies(added_by_user_id);

-- 创建唯一约束
CREATE UNIQUE INDEX idx_socks_proxies_unique_host_port ON socks_proxies(host, port);
CREATE UNIQUE INDEX idx_api_keys_unique_user_name_provider ON api_keys(user_id, name, provider); 