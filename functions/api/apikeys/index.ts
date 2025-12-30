// functions/api/apikeys/index.ts - API 密钥管理端点
import { RequestContext, ValidationError, CONSTANTS } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { CryptoService } from '../../shared/crypto';
import { authMiddleware, createErrorResponse, createSuccessResponse, validateRequestData } from '../../shared/auth';

interface AddApiKeyRequest {
  name: string;
  key: string;
  provider: 'digitalocean' | 'linode' | 'azure';
}

function validateAddApiKeyRequest(data: any): AddApiKeyRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { name, key, provider } = data;

  if (!name || typeof name !== 'string') {
    throw new ValidationError('API 密钥名称不能为空', 'name');
  }

  if (!key || typeof key !== 'string') {
    throw new ValidationError('API 密钥值不能为空', 'key');
  }

  if (!provider || typeof provider !== 'string') {
    throw new ValidationError('云服务商不能为空', 'provider');
  }

  const trimmedName = name.trim();
  const trimmedKey = key.trim();

  if (trimmedName.length < 1 || trimmedName.length > 100) {
    throw new ValidationError('API 密钥名称长度应在 1-100 字符之间', 'name');
  }

  if (trimmedKey.length < 10) {
    throw new ValidationError('API 密钥长度过短', 'key');
  }

  if (!CONSTANTS.SUPPORTED_PROVIDERS.includes(provider as any)) {
    throw new ValidationError('不支持的云服务商', 'provider');
  }

  return {
    name: trimmedName,
    key: trimmedKey,
    provider: provider as 'digitalocean' | 'linode' | 'azure'
  };
}

// 简单的 API 密钥验证函数
async function validateApiKey(key: string, provider: string): Promise<{ isValid: boolean; error?: string; completedKey?: string }> {
  try {
    if (provider === 'digitalocean') {
      const response = await fetch('https://api.digitalocean.com/v2/account', {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });
      return { isValid: response.ok, error: response.ok ? undefined : `DigitalOcean API 验证失败: ${response.status}` };
    } else if (provider === 'linode') {
      const response = await fetch('https://api.linode.com/v4/account', {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });
      return { isValid: response.ok, error: response.ok ? undefined : `Linode API 验证失败: ${response.status}` };
    } else if (provider === 'azure') {
      // Azure密钥格式验证，支持两种格式：
      // 3段: tenantId:clientId:clientSecret (自动获取订阅)
      // 4段: subscriptionId:tenantId:clientId:clientSecret
      const parts = key.split(':');
      if (parts.length !== 3 && parts.length !== 4) {
        return {
          isValid: false,
          error: 'Azure API密钥格式错误，应为: tenantId:clientId:clientSecret 或 subscriptionId:tenantId:clientId:clientSecret'
        };
      }
      
      let subscriptionId: string, tenantId: string, clientId: string, clientSecret: string;
      let isThreePartFormat = false;
      
      if (parts.length === 4) {
        // 4段格式: subscriptionId:tenantId:clientId:clientSecret
        [subscriptionId, tenantId, clientId, clientSecret] = parts;
      } else {
        // 3段格式: tenantId:clientId:clientSecret
        [tenantId, clientId, clientSecret] = parts;
        subscriptionId = ''; // 稍后会自动获取
        isThreePartFormat = true;
      }
      
      // 验证每个部分是否为有效的GUID格式（除了客户端密钥）
      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      // 如果有订阅ID，验证其格式
      if (subscriptionId && !guidRegex.test(subscriptionId)) {
        return { isValid: false, error: '订阅ID格式无效，应为GUID格式' };
      }
      if (!guidRegex.test(tenantId)) {
        return { isValid: false, error: '租户ID格式无效，应为GUID格式' };
      }
      if (!guidRegex.test(clientId)) {
        return { isValid: false, error: '客户端ID格式无效，应为GUID格式' };
      }
      if (!clientSecret || clientSecret.length < 10) {
        return { isValid: false, error: '客户端密钥无效，长度至少10个字符' };
      }
      
      // 尝试获取Azure访问令牌来验证凭据
      try {
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
        const formData = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          resource: 'https://management.azure.com/'
        });

        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        });

        if (!response.ok) {
          return { isValid: false, error: `Azure 认证失败: ${response.status}` };
        }

        const tokenData: any = await response.json();
        if (!tokenData.access_token) {
          return { isValid: false, error: 'Azure 认证失败: 无法获取访问令牌' };
        }

        // 如果是3段格式，需要获取订阅ID并返回完整密钥
        if (isThreePartFormat) {
          try {
            // 获取订阅列表
            const subscriptionsResponse = await fetch(
              'https://management.azure.com/subscriptions?api-version=2020-01-01',
              {
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            
            if (!subscriptionsResponse.ok) {
              return { isValid: false, error: `Azure 订阅列表获取失败: ${subscriptionsResponse.status}` };
            }
            
            const subscriptionsData: any = await subscriptionsResponse.json();
            const subscriptions = subscriptionsData.value || [];
            
            if (subscriptions.length === 0) {
              return { isValid: false, error: 'Azure账户下未找到可用订阅' };
            }
            
            // 选择第一个启用的订阅
            const activeSubscription = subscriptions.find((sub: any) => sub.state === 'Enabled') || subscriptions[0];
            subscriptionId = activeSubscription.subscriptionId;
            
            console.log(`自动获取Azure订阅ID: ${activeSubscription.displayName} (${subscriptionId})`);
            
            // 返回完整的4段密钥格式
            const completedKey = `${subscriptionId}:${tenantId}:${clientId}:${clientSecret}`;
            return { isValid: true, completedKey };
            
          } catch (subscriptionError) {
            return { isValid: false, error: `获取Azure订阅失败: ${subscriptionError instanceof Error ? subscriptionError.message : '未知错误'}` };
          }
        } else {
          // 4段格式，验证订阅访问权限
          const subscriptionResponse = await fetch(
            `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`,
            {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (!subscriptionResponse.ok) {
            return { isValid: false, error: `Azure 订阅访问验证失败: ${subscriptionResponse.status}` };
          }
          
          return { isValid: true };
        }

      } catch (azureError) {
        return { isValid: false, error: `Azure 验证错误: ${azureError instanceof Error ? azureError.message : '未知错误'}` };
      }
    } else {
      return { isValid: false, error: '不支持的云服务商' };
    }
  } catch (error) {
    return { isValid: false, error: `API 验证过程中发生错误: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// GET /api/apikeys - 获取用户的 API 密钥列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { env, session } = context;
    const db = createDatabaseService(env);
    const apiKeys = await db.getApiKeysByUserId(session!.userId);

    const formattedKeys = apiKeys.map(key => ({
      id: key.id,
      name: key.name,
      provider: key.provider,
      created_at: key.created_at,
      health_status: key.health_status,
      last_checked: key.last_checked,
      error_message: key.error_message
    }));

    return createSuccessResponse({
      keys: formattedKeys,
      selectedKeyId: session!.selectedApiKeyId || null,
      totalCount: formattedKeys.length
    }, '获取 API 密钥列表成功');

  } catch (error) {
    console.error('获取 API 密钥列表失败:', error);
    return createErrorResponse('获取 API 密钥列表失败', 500, 'GET_APIKEYS_FAILED');
  }
}

// POST /api/apikeys - 添加新的 API 密钥
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const { request, env, session } = context;
    const { name, key, provider } = await validateRequestData(request, validateAddApiKeyRequest);
    const db = createDatabaseService(env);


    const exists = await db.checkApiKeyExists(session!.userId, name, provider);
    if (exists) {
      return createErrorResponse(`名为 "${name}" 的 ${provider} API 密钥已存在`, 409, 'API_KEY_NAME_EXISTS');
    }

    const validation = await validateApiKey(key, provider);
    if (!validation.isValid) {
      return createErrorResponse(validation.error || 'API 密钥验证失败', 400, 'API_KEY_INVALID');
    }

    // 使用完整的密钥（如果验证时自动补全了订阅ID）
    const finalKey = validation.completedKey || key;
    
    // 如果密钥被补全，记录日志
    if (validation.completedKey && validation.completedKey !== key) {
      console.log(`Azure密钥自动补全: ${key} -> ${validation.completedKey}`);
    }

    // --- FINAL DEBUGGING --- 
    console.log('[ENCRYPT-DEBUG] Raw key received:', key);
    console.log('[ENCRYPT-DEBUG] Final key to encrypt:', finalKey);
    const encryptedKey = await CryptoService.encrypt(finalKey, env.ENCRYPTION_KEY);
    console.log('[ENCRYPT-DEBUG] Encrypted key generated:', encryptedKey);
    // --- END OF DEBUGGING ---

    if (!encryptedKey) {
        throw new Error('加密服务返回了空值，已阻止写入数据库。');
    }

    const keyId = await db.createApiKey(name, encryptedKey, session!.userId, provider);

    const now = new Date().toISOString();
    const responseData = {
      id: keyId,
      name,
      provider,
      created_at: now,
      health_status: 'healthy',
      last_checked: now,
      error_message: null,
      message: 'API 密钥添加成功并已验证'
    };

    return createSuccessResponse(responseData, 'API 密钥添加成功', 201);

  } catch (error) {
    console.error('添加 API 密钥失败:', error);
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    return createErrorResponse('添加 API 密钥失败', 500, 'ADD_APIKEY_FAILED');
  }
}