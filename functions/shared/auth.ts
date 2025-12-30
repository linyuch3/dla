// auth.ts - 认证服务和中间件
import { Session, User, AuthError, KV_KEYS, Env, RequestContext, CONSTANTS } from './types';
import { CryptoService } from './crypto';

export class AuthService {
  private static readonly SESSION_DURATION = CONSTANTS.SESSION_DURATION;

  /**
   * 创建用户会话
   */
  static async createSession(user: User, env: Env): Promise<string> {
    try {
      const sessionId = CryptoService.generateUUID();
      const session: Session = {
        userId: user.id,
        username: user.username,
        isAdmin: user.is_admin,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.SESSION_DURATION
      };

      await env.KV.put(
        KV_KEYS.SESSION(sessionId),
        JSON.stringify(session),
        { expirationTtl: Math.floor(this.SESSION_DURATION / 1000) }
      );

      return sessionId;
    } catch (error) {
      throw new AuthError('创建会话失败');
    }
  }

  /**
   * 获取用户会话
   */
  static async getSession(sessionId: string, env: Env): Promise<Session | null> {
    try {
      const sessionData = await env.KV.get(KV_KEYS.SESSION(sessionId));
      if (!sessionData) {
        return null;
      }

      const session: Session = JSON.parse(sessionData);
      
      // 检查会话是否过期
      if (Date.now() > session.expiresAt) {
        await env.KV.delete(KV_KEYS.SESSION(sessionId));
        return null;
      }

      return session;
    } catch (error) {
      console.error('获取会话失败:', error);
      return null;
    }
  }

  /**
   * 删除用户会话
   */
  static async deleteSession(sessionId: string, env: Env): Promise<void> {
    try {
      await env.KV.delete(KV_KEYS.SESSION(sessionId));
    } catch (error) {
      console.error('删除会话失败:', error);
    }
  }

  /**
   * 刷新会话过期时间
   */
  static async refreshSession(sessionId: string, env: Env): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId, env);
      if (!session) {
        return false;
      }

      // 更新过期时间
      session.expiresAt = Date.now() + this.SESSION_DURATION;

      await env.KV.put(
        KV_KEYS.SESSION(sessionId),
        JSON.stringify(session),
        { expirationTtl: Math.floor(this.SESSION_DURATION / 1000) }
      );

      return true;
    } catch (error) {
      console.error('刷新会话失败:', error);
      return false;
    }
  }

  /**
   * 设置选中的 API 密钥
   */
  static async setSelectedApiKey(sessionId: string, apiKeyId: number, env: Env): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId, env);
      if (!session) {
        return false;
      }

      session.selectedApiKeyId = apiKeyId;

      await env.KV.put(
        KV_KEYS.SESSION(sessionId),
        JSON.stringify(session),
        { expirationTtl: Math.floor(this.SESSION_DURATION / 1000) }
      );

      return true;
    } catch (error) {
      console.error('设置选中 API 密钥失败:', error);
      return false;
    }
  }

  /**
   * 清除选中的 API 密钥
   */
  static async clearSelectedApiKey(sessionId: string, env: Env): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId, env);
      if (!session) {
        return false;
      }

      delete session.selectedApiKeyId;

      await env.KV.put(
        KV_KEYS.SESSION(sessionId),
        JSON.stringify(session),
        { expirationTtl: Math.floor(this.SESSION_DURATION / 1000) }
      );

      return true;
    } catch (error) {
      console.error('清除选中 API 密钥失败:', error);
      return false;
    }
  }
}

/**
 * 工具函数：从请求中获取 Cookie
 */
export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [key, value] = cookie.split('=');
    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

/**
 * 工具函数：设置 Cookie
 */
export function setCookie(
  response: Response,
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    path?: string;
  } = {}
): Response {
  const {
    maxAge = 86400, // 24小时
    httpOnly = true,
    secure = true,
    sameSite = 'Lax',
    path = '/'
  } = options;

  const cookieValue = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}`;
  const cookieString = httpOnly ? `${cookieValue}; HttpOnly` : cookieValue;
  const finalCookieString = secure ? `${cookieString}; Secure` : cookieString;

  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  newResponse.headers.append('Set-Cookie', finalCookieString);
  return newResponse;
}

/**
 * 工具函数：删除 Cookie
 */
export function deleteCookie(response: Response, name: string, path: string = '/'): Response {
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  newResponse.headers.append(
    'Set-Cookie',
    `${name}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
  );

  return newResponse;
}

/**
 * 认证中间件：验证用户是否已登录
 */
export async function authMiddleware(context: RequestContext): Promise<Response | null> {
  const sessionId = getCookie(context.request, 'session_id');
  
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', code: 'NO_SESSION' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const session = await AuthService.getSession(sessionId, context.env);
  if (!session) {
    return new Response(
      JSON.stringify({ error: 'Invalid session', code: 'INVALID_SESSION' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // 将会话信息附加到请求上下文
  context.session = session;
  context.request.session = session;

  // 可选：刷新会话过期时间
  // await AuthService.refreshSession(sessionId, context.env);

  return null; // 继续处理请求
}

/**
 * 管理员权限中间件：验证用户是否为管理员
 */
export async function adminMiddleware(context: RequestContext): Promise<Response | null> {
  // 先执行认证中间件
  const authResult = await authMiddleware(context);
  if (authResult) {
    return authResult;
  }

  // 检查是否为管理员
  if (!context.session?.isAdmin) {
    return new Response(
      JSON.stringify({ error: 'Admin access required', code: 'NOT_ADMIN' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  return null; // 继续处理请求
}

/**
 * 可选认证中间件：不强制要求登录，但如果有会话则加载
 */
export async function optionalAuthMiddleware(context: RequestContext): Promise<Response | null> {
  const sessionId = getCookie(context.request, 'session_id');
  
  if (sessionId) {
    const session = await AuthService.getSession(sessionId, context.env);
    if (session) {
      context.session = session;
      context.request.session = session;
    }
  }

  return null; // 继续处理请求
}

/**
 * CORS 中间件：处理跨域请求
 */
export async function corsMiddleware(context: RequestContext): Promise<Response | null> {
  const { request } = context;
  
  // 处理预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  return null; // 继续处理请求
}

/**
 * 响应包装器：为响应添加 CORS 头
 */
export function wrapResponseWithCors(response: Response): Response {
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return newResponse;
}

/**
 * 错误响应辅助函数
 */
export function createErrorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      code: code || 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * 成功响应辅助函数
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string,
  statusCode: number = 200
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * 验证请求数据的辅助函数
 */
export async function validateRequestData<T>(
  request: Request,
  validator: (data: any) => T
): Promise<T> {
  try {
    const contentType = request.headers.get('Content-Type');
    
    if (!contentType || !contentType.includes('application/json')) {
      throw new AuthError('Content-Type 必须为 application/json', 400);
    }

    const data = await request.json();
    return validator(data);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('请求数据格式无效', 400);
  }
}

/**
 * 检查请求频率限制（简单实现）
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  env: Env
): Promise<boolean> {
  try {
    const key = `rate_limit:${identifier}`;
    const current = await env.KV.get(key);
    
    if (!current) {
      await env.KV.put(key, '1', { expirationTtl: Math.floor(windowMs / 1000) });
      return true;
    }

    const count = parseInt(current, 10);
    if (count >= limit) {
      return false;
    }

    await env.KV.put(key, (count + 1).toString(), { expirationTtl: Math.floor(windowMs / 1000) });
    return true;
  } catch (error) {
    console.error('检查频率限制失败:', error);
    return true; // 出错时允许通过
  }
} 