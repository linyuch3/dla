-- Migration: 0003_add_api_key_health_status.sql
-- Description: Add health status tracking for API keys

-- 为API密钥表添加健康状态字段
ALTER TABLE api_keys ADD COLUMN health_status TEXT DEFAULT 'unknown' NOT NULL;
ALTER TABLE api_keys ADD COLUMN last_checked DATETIME;
ALTER TABLE api_keys ADD COLUMN error_message TEXT;

-- 创建索引以提高查询性能
CREATE INDEX idx_api_keys_health_status ON api_keys(health_status);
CREATE INDEX idx_api_keys_last_checked ON api_keys(last_checked);

-- 健康状态说明:
-- 'unknown': 未检测状态（默认）
-- 'healthy': 密钥有效，API调用正常
-- 'unhealthy': 密钥无效或API调用失败
-- 'checking': 正在检测中
-- 'limited': 部分限制（如权限不足但密钥有效）

-- 为现有记录设置默认状态
UPDATE api_keys SET health_status = 'unknown' WHERE health_status IS NULL;