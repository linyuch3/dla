-- Migration: 0002_add_telegram_notifications.sql
-- Description: Add Telegram notification settings to users table

-- 为用户表添加 Telegram 通知配置字段
ALTER TABLE users ADD COLUMN telegram_bot_token TEXT;
ALTER TABLE users ADD COLUMN telegram_user_id TEXT;
ALTER TABLE users ADD COLUMN telegram_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN telegram_notification_time TEXT DEFAULT '08:00';
ALTER TABLE users ADD COLUMN telegram_timezone TEXT DEFAULT 'Asia/Shanghai';
ALTER TABLE users ADD COLUMN telegram_last_notification DATETIME;

-- 创建索引以提高查询性能
CREATE INDEX idx_users_telegram_enabled ON users(telegram_enabled);
CREATE INDEX idx_users_telegram_notification_time ON users(telegram_notification_time);

-- 添加注释说明
-- telegram_bot_token: 用户的 Telegram Bot Token（加密存储）
-- telegram_user_id: 用户的 Telegram User ID
-- telegram_enabled: 是否启用 Telegram 通知
-- telegram_notification_time: 通知时间（HH:MM 格式）
-- telegram_timezone: 时区设置
-- telegram_last_notification: 上次通知时间（用于避免重复通知）
