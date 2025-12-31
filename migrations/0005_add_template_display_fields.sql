-- Migration: 0005_add_template_display_fields.sql
-- Description: Add display fields to instance_templates for better readability

-- 添加显示字段
ALTER TABLE instance_templates ADD COLUMN region_display TEXT;
ALTER TABLE instance_templates ADD COLUMN plan_display TEXT;
ALTER TABLE instance_templates ADD COLUMN image_display TEXT;
