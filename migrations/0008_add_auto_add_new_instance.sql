-- 添加自动将新机器加入监控的选项
ALTER TABLE replenish_tasks ADD COLUMN auto_add_new_instance BOOLEAN DEFAULT 1;

-- 添加检查间隔字段（单位：分钟）
ALTER TABLE replenish_tasks ADD COLUMN check_interval INTEGER DEFAULT 5;
