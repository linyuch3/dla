# 密钥分组功能移除总结

## 更改日期
2026-01-01

## 更改原因
密钥分组功能（自用/租机）已被更灵活的任务密钥池功能取代。在补机任务中可以直接勾选需要使用的密钥，无需通过分组来区分。

## 已删除的文件

### API路由文件
- `functions/api/apikeys/groups.ts` - 分组列表API
- `functions/api/apikeys/groups/[id].ts` - 单个分组操作API

### 数据库迁移文件
- `migrations/0008_add_api_key_groups.sql` - 分组表创建迁移

### 新增迁移文件
- `migrations/0009_remove_key_groups.sql` - 删除分组相关字段和表

## 已修改的数据库表

### 删除的表
- `api_key_groups` - API密钥分组表

### 删除的字段
- `api_keys.key_group` - API密钥分组字段
- `auto_replenish_config.key_group` - 自动补机配置分组字段
- `replenish_tasks.backup_group` - 补机任务备用密钥分组字段

### 删除的索引
- `idx_api_keys_key_group`
- `idx_api_key_groups_name`

## 已修改的TypeScript类型

### `functions/shared/types.ts`
- 从 `ApiKey` 接口删除 `key_group` 字段
- 从 `AutoReplenishConfig` 接口删除 `key_group` 字段

## 已修改的后端代码

### `functions/shared/db.ts`
- 删除 `updateApiKeyGroup()` 函数
- 删除 `getHealthyApiKeysByGroup()` 函数
- 修改 `createApiKey()` - 删除 `keyGroup` 参数
- 修改 `upsertAutoReplenishConfig()` - 删除 `key_group` 字段

### `functions/api/apikeys/index.ts`
- 从 `AddApiKeyRequest` 接口删除 `key_group` 字段
- 修改 `validateAddApiKeyRequest()` - 删除分组验证逻辑
- 修改 GET 和 POST 请求处理 - 删除 `key_group` 相关代码

### `functions/api/apikeys/[id]/index.ts`
- 简化 PUT 端点 - 删除分组更新功能

### `functions/api/auto-replenish/config.ts`
- 从 `UpdateConfigRequest` 接口删除 `key_group` 字段
- 删除 `key_group` 验证逻辑
- 删除配置默认值中的 `key_group`

### `functions/api/auto-replenish/tasks.ts`
- 从 `CreateTaskRequest` 接口删除 `backup_group` 字段
- 修改 INSERT 语句删除 `backup_group`

### `functions/api/auto-replenish/task.ts`
- 从 `UpdateTaskRequest` 接口删除 `backup_group` 字段
- 删除 UPDATE 语句中的 `backup_group`

### `functions/api/auto-replenish/trigger.ts`
- 删除 `getHealthyApiKeysByGroup` 调用
- 改用 `getApiKeysByUserId` + 过滤方式获取健康密钥

## 已修改的前端代码

### `index.html`

#### 删除的UI组件
1. **添加密钥表单** (行 3944-3954)
   - 删除分组选择器 `<select id="api-key-group">`

2. **补机任务表单** (原有位置)
   - 删除备用密钥分组输入框 `<input id="task-backup-group">`
   - 删除分组数据列表 `<datalist id="existing-groups-list">`

3. **密钥列表表格**
   - 删除分组列表头
   - 删除分组数据单元格
   - 调整表格列宽从6列改为5列

#### 删除的CSS样式
- `.key-group-tag` 及其变体样式 (`.self-use`, `.rental`, `.custom`)
- 表格列宽调整（从6列优化为5列）

#### 删除的JavaScript代码
1. **全局变量**
   - `cachedKeyGroups` - 分组缓存数组

2. **函数**
   - `loadCachedKeyGroups()` - 加载分组列表
   - `loadTaskKeyGroups()` - 加载任务表单分组

3. **修改的函数**
   - `addApiKey()` - 删除 `keyGroup` 参数
   - `loadTaskApiKeys()` - 删除任务API密钥列表中的分组显示
   - `loadTaskForEdit()` - 删除 `backup_group` 字段加载
   - `saveReplenishTask()` - 删除 `backup_group` 字段保存
   - 表单重置代码 - 删除分组相关重置

## 已修改的文档

### `README.md`
- 从功能特性中删除"密钥分组"描述
- 从使用指南中删除设置分组的说明
- 从更新日志中删除"新增 API 密钥自定义分组"

## 迁移指南

### 对现有用户的影响
1. **现有分组数据**：执行 `0009_remove_key_groups.sql` 迁移后，所有分组数据将被删除
2. **补机任务**：需要重新配置补机任务，勾选需要使用的API密钥
3. **API兼容性**：旧的API端点（如 `/api/apikeys/groups`）将不再可用

### 数据库迁移步骤
1. 备份数据库
2. 执行 `migrations/0009_remove_key_groups.sql`
3. 验证迁移成功

### 功能替代方案
- **原分组功能**：通过密钥分组区分自用和租机
- **新功能**：在补机任务中直接勾选需要使用的密钥池，更灵活且直观

## 测试建议

### 需要测试的功能
1. ✅ 添加API密钥（不再需要选择分组）
2. ✅ 创建补机任务（使用密钥池而非分组）
3. ✅ 编辑补机任务（密钥池的增删改）
4. ✅ 触发补机（从密钥池中选择可用密钥）
5. ✅ API密钥健康检查（不受分组影响）

### 回归测试
- 验证所有API端点正常工作
- 验证密钥加密/解密功能正常
- 验证补机流程完整性
- 验证UI显示正确（无分组相关元素）

## 完成状态
✅ 所有分组相关代码已成功移除
✅ 数据库迁移文件已创建
✅ TypeScript类型定义已更新
✅ 前端UI已清理
✅ 文档已更新
