-- Migration: 0009_remove_key_groups.sql
-- Description: Remove API key grouping functionality - replaced by task-based API key pool

-- 删除API密钥表的分组字段
ALTER TABLE api_keys DROP COLUMN IF EXISTS key_group;

-- 删除索引
DROP INDEX IF EXISTS idx_api_keys_key_group;

-- 删除自动补机配置表的分组字段
ALTER TABLE auto_replenish_config DROP COLUMN IF EXISTS key_group;

-- 删除补机任务表的备用分组字段
ALTER TABLE replenish_tasks DROP COLUMN IF EXISTS backup_group;

-- 删除分组表（如果存在）
DROP TABLE IF EXISTS api_key_groups;

-- 删除分组表索引
DROP INDEX IF EXISTS idx_api_key_groups_name;

-- 注释说明:
-- 移除分组功能后，补机将直接使用任务中勾选的API密钥池
-- 不再需要通过分组来区分自用和租机密钥
