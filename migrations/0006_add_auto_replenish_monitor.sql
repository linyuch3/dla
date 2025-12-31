-- Migration: 0006_add_auto_replenish_monitor.sql
-- Description: Add monitoring targets and template selection to auto-replenish config

-- 为自动补机配置表添加监控对象和模板选择字段
ALTER TABLE auto_replenish_config ADD COLUMN monitor_type TEXT DEFAULT 'instances';
-- monitor_type: 'instances' (监控机器) 或 'api_keys' (监控API密钥)

ALTER TABLE auto_replenish_config ADD COLUMN monitored_instances TEXT DEFAULT '[]';
-- monitored_instances: JSON数组，存储要监控的机器ID列表

ALTER TABLE auto_replenish_config ADD COLUMN monitored_api_keys TEXT DEFAULT '[]';
-- monitored_api_keys: JSON数组，存储要监控的API密钥ID列表

ALTER TABLE auto_replenish_config ADD COLUMN instance_key_mapping TEXT DEFAULT '[]';
-- instance_key_mapping: JSON数组，存储机器ID与API密钥ID的映射关系

ALTER TABLE auto_replenish_config ADD COLUMN template_id INTEGER;
-- template_id: 补机时使用的模板ID

-- 注释说明:
-- 双重保险机制工作流程:
-- 1. 用户选择要监控的API密钥
-- 2. 系统显示这些密钥下的机器供选择
-- 3. 定时检查机器状态
-- 4. 发现机器失效后，检查对应的API密钥是否健康
-- 5. 如果密钥健康，使用该密钥 + 模板创建新机器
-- 6. 如果密钥不健康，从备用分组(key_group)中选择其他可用密钥
--
-- instance_key_mapping 格式: [{"id": "instance_id", "apiKeyId": "1"}, ...]
-- 这样可以知道每台机器属于哪个API密钥，便于补机时优先使用原密钥
