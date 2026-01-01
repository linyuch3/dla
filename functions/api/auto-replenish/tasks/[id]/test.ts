// functions/api/auto-replenish/tasks/[id]/test.ts - 手动测试补机任务
import { RequestContext } from '../../../../shared/types';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../../../shared/auth';
import { createDatabaseService } from '../../../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../../../shared/cloud-providers';
import { sendTelegramNotification } from '../../../../shared/telegram-notify';

// POST /api/auto-replenish/tasks/:id/test - 手动触发补机测试
export async function onRequestPost(context: RequestContext): Promise<Response> {
  const authError = await authMiddleware(context);
  if (authError) return authError;

  try {
    const taskId = parseInt(context.params?.id as string);
    if (!taskId) {
      return createErrorResponse('任务ID无效', 400);
    }

    const db = createDatabaseService(context.env);

    // 获取任务详情
    const task = await context.env.DB.prepare(`
      SELECT * FROM replenish_tasks WHERE id = ?
    `).bind(taskId).first() as any;

    if (!task) {
      return createErrorResponse('任务不存在', 404);
    }

    if (!task.enabled) {
      return createErrorResponse('任务已停用，请先启用任务', 400);
    }

    // 检查模板是否存在
    if (!task.template_id) {
      return createErrorResponse('任务未配置补机模板', 400);
    }

    const template = await db.getInstanceTemplateById(task.template_id);
    if (!template) {
      return createErrorResponse(`补机模板不存在(ID:${task.template_id})，请重新配置任务`, 400);
    }

    // 解析配置
    const apiKeyIds = JSON.parse(task.api_key_ids || '[]');
    const instanceKeyMapping = JSON.parse(task.instance_key_mapping || '[]');
    const replenishApiKeyIds = JSON.parse(task.backup_group || '[]');

    if (instanceKeyMapping.length === 0) {
      return createErrorResponse('任务未配置监控的机器', 400);
    }

    console.log('🧪 [补机测试] 开始测试任务:', {
      taskId,
      taskName: task.name,
      templateId: task.template_id,
      templateName: template.name,
      monitorInstances: instanceKeyMapping.length
    });

    // 检查每台机器是否存在
    const missingInstances: any[] = [];
    const existingInstances: any[] = [];
    let checkedCount = 0;

    for (const mapping of instanceKeyMapping) {
      const instanceId = mapping.id;
      const apiKeyId = mapping.apiKeyId;

      checkedCount++;

      // 获取API密钥
      const apiKey = await db.getApiKeyById(apiKeyId);
      if (!apiKey) {
        console.log(`⚠️ [补机测试] API密钥不存在: ${apiKeyId}`);
        continue;
      }

      try {
        // 创建云服务商客户端
        const cloudProvider = await createCloudProviderFromEncryptedKey(
          apiKey.provider,
          apiKey.encrypted_key,
          context.env.ENCRYPTION_KEY
        );

        const instanceManager = new CloudInstanceManager(cloudProvider);
        
        // 检查实例是否存在
        try {
          const allInstances = await instanceManager.listInstances();
          // 使用String转换确保类型一致（inst.id可能是数字，instanceId可能是字符串）
          const instance = allInstances.find(inst => String(inst.id) === String(instanceId));
          
          if (instance) {
            console.log(`✅ [补机测试] 机器存在: ${instance.name || instanceId} (ID: ${instanceId}, 状态: ${instance.status})`);
            existingInstances.push({ id: instanceId, name: instance.name, status: instance.status, apiKeyId });
          } else {
            console.log(`❌ [补机测试] 机器不存在: ${instanceId} (列表中共 ${allInstances.length} 台机器)`);
            missingInstances.push({ id: instanceId, apiKeyId, apiKeyName: apiKey.name });
          }
        } catch (error: any) {
          console.error(`❌ [补机测试] 检查机器失败: ${instanceId}`, error);
          // API调用失败时也视为机器可能不存在
          missingInstances.push({ id: instanceId, apiKeyId, apiKeyName: apiKey.name, error: error.message });
        }
      } catch (error) {
        console.error(`❌ [补机测试] 检查机器失败: ${instanceId}`, error);
      }
    }

    // 如果有缺失的机器，使用补机密钥创建新机器
    const createdInstances: any[] = [];

    if (missingInstances.length > 0) {
      console.log(`🔧 [补机测试] 发现 ${missingInstances.length} 台缺失机器，开始补机...`);

      // 获取补机密钥（如果没有配置，使用监控密钥）
      const replenishKeyIds = replenishApiKeyIds.length > 0 ? replenishApiKeyIds : apiKeyIds;
      
      // 记录新创建机器与密钥的映射关系，用于更新监控列表
      const newInstanceMappings: Array<{id: string, apiKeyId: number, replacedId: string}> = [];
      
      for (const missing of missingInstances) {
        // 轮询使用补机密钥
        const replenishKeyId = replenishKeyIds[createdInstances.length % replenishKeyIds.length];
        const replenishKey = await db.getApiKeyById(parseInt(replenishKeyId));

        if (!replenishKey) {
          console.log(`⚠️ [补机测试] 补机密钥不存在: ${replenishKeyId}`);
          continue;
        }

        // 验证云服务商是否匹配
        if (replenishKey.provider !== template.provider) {
          console.log(`⚠️ [补机测试] 补机密钥提供商(${replenishKey.provider})与模板提供商(${template.provider})不匹配`);
          continue;
        }

        try {
          // 创建云服务商客户端
          const cloudProvider = await createCloudProviderFromEncryptedKey(
            replenishKey.provider,
            replenishKey.encrypted_key,
            context.env.ENCRYPTION_KEY
          );

          const instanceManager = new CloudInstanceManager(cloudProvider);

          // 生成实例名称（使用英文，避免云服务商不支持中文）
          const instanceName = `${template.provider.substring(0, 2)}-auto-${Date.now().toString().slice(-6)}`;

          // 创建实例 - 使用模板中的root密码
          console.log(`🚀 [补机测试] 创建新机器: ${instanceName}`);
          const newInstance = await instanceManager.createInstance({
            name: instanceName,
            region: template.region,
            image: template.image,
            size: template.plan,
            diskSize: template.disk_size || undefined,
            ssh_keys: template.ssh_keys ? JSON.parse(template.ssh_keys) : undefined,
            tags: template.tags ? JSON.parse(template.tags) : undefined,
            user_data: template.user_data || undefined,
            enableIPv6: !!template.enable_ipv6,
            root_password: template.root_password || undefined
          });

          console.log(`✅ [补机测试] 创建成功: ${newInstance.name} (ID: ${newInstance.id})`);
          
          // 等待IP分配（最多轮询60秒）
          let finalInstance = newInstance;
          let waitTime = 0;
          const maxWait = 60000; // 60秒
          const pollInterval = 5000; // 5秒轮询一次
          
          while (!finalInstance.ip_address && waitTime < maxWait) {
            console.log(`⏳ [补机测试] 等待IP分配... (${waitTime/1000}s)`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            waitTime += pollInterval;
            
            try {
              // 重新获取实例列表查找新实例
              const allInstances = await instanceManager.listInstances();
              const updated = allInstances.find(inst => String(inst.id) === String(newInstance.id));
              if (updated && updated.ip_address) {
                finalInstance = updated;
                console.log(`✅ [补机测试] IP已分配: ${finalInstance.ip_address}`);
                break;
              }
            } catch (e) {
              console.log(`⚠️ [补机测试] 查询实例状态失败，继续等待...`);
            }
          }
          
          createdInstances.push(finalInstance);
          
          // 记录新机器映射，用于更新监控列表
          newInstanceMappings.push({
            id: String(finalInstance.id),
            apiKeyId: parseInt(replenishKeyId),
            replacedId: missing.id
          });
          
          // 发送Telegram通知 - 包含完整配置信息（等待IP分配后发送）
          sendTelegramNotification(context.env, context.session!.userId, {
            type: 'auto_replenish',
            instanceName: finalInstance.name,
            instanceId: String(finalInstance.id),
            provider: template.provider,
            region: template.region,
            ip: finalInstance.ip_address || '(分配中)',
            ipv6: finalInstance.ipv6_address || undefined,
            rootPassword: template.root_password || '(随机生成，请查看实例详情)',
            plan: template.plan,
            image: template.image,
            details: { 
              taskName: task.name,
              replacedInstance: missing.id
            }
          }).catch(err => console.error('发送补机通知失败:', err));

        } catch (error: any) {
          console.error(`❌ [补机测试] 创建机器失败:`, error);
        }
      }
      
      // 更新任务的监控机器列表：用新机器替换缺失的机器
      if (newInstanceMappings.length > 0) {
        // 构建新的映射列表
        const updatedMapping = instanceKeyMapping
          .filter((m: any) => !newInstanceMappings.some(n => n.replacedId === m.id))
          .concat(newInstanceMappings.map(n => ({ id: n.id, apiKeyId: n.apiKeyId })));
        
        // 同时更新 instance_ids（前端使用此字段勾选机器）
        const updatedInstanceIds = updatedMapping.map((m: any) => m.id);
        
        await context.env.DB.prepare(`
          UPDATE replenish_tasks 
          SET instance_key_mapping = ?,
              instance_ids = ?
          WHERE id = ?
        `).bind(JSON.stringify(updatedMapping), JSON.stringify(updatedInstanceIds), taskId).run();
        
        console.log(`✅ [补机测试] 已更新监控列表，新增 ${newInstanceMappings.length} 台机器，更新后共 ${updatedMapping.length} 台`);
      }
    }

    // 更新任务的最后检查时间
    await context.env.DB.prepare(`
      UPDATE replenish_tasks 
      SET last_check_at = datetime('now')
      WHERE id = ?
    `).bind(taskId).run();

    return createSuccessResponse({
      checked_instances: checkedCount,
      existing_instances: existingInstances.length,
      missing_instances: missingInstances.length,
      created_instances: createdInstances,
      message: createdInstances.length > 0 
        ? `成功补充 ${createdInstances.length} 台机器` 
        : missingInstances.length > 0 
          ? '发现缺失机器但补机失败，请检查补机密钥和模板配置'
          : '所有机器正常运行，无需补机'
    }, '补机测试完成');

  } catch (error: any) {
    console.error('补机测试失败:', error);
    return createErrorResponse(error.message || '补机测试失败', 500);
  }
}
