// functions/api/auth/login.ts - 用户登录 API
import { Env, RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { AuthService, setCookie, createErrorResponse, createSuccessResponse, validateRequestData, checkRateLimit } from '../../shared/auth';

interface LoginRequest {
  username: string;
  password: string;
}

function validateLoginRequest(data: any): LoginRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { username, password } = data;

  if (!username || typeof username !== 'string') {
    throw new ValidationError('用户名不能为空', 'username');
  }

  if (!password || typeof password !== 'string') {
    throw new ValidationError('密码不能为空', 'password');
  }

  if (username.trim().length < 3) {
    throw new ValidationError('用户名至少3个字符', 'username');
  }

  if (password.length < 6) {
    throw new ValidationError('密码至少6个字符', 'password');
  }

  return {
    username: username.trim(),
    password
  };
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const { request, env } = context;

    // 频率限制：每分钟最多5次登录尝试
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `login:${clientIP}`;
    
    const isAllowed = await checkRateLimit(rateLimitKey, 5, 60 * 1000, env);
    if (!isAllowed) {
      return createErrorResponse('登录尝试过于频繁，请稍后再试', 429, 'RATE_LIMIT_EXCEEDED');
    }

    // 验证请求数据
    const { username, password } = await validateRequestData(request, validateLoginRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 查找用户
    const user = await db.getUserByUsername(username);
    if (!user) {
      return createErrorResponse('用户名或密码错误', 401, 'INVALID_CREDENTIALS');
    }

    // 验证密码
    const isPasswordValid = await PasswordService.verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return createErrorResponse('用户名或密码错误', 401, 'INVALID_CREDENTIALS');
    }

    // 创建会话
    const sessionId = await AuthService.createSession(user, env);

    // 准备响应数据
    const responseData = {
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin
      },
      sessionId
    };

    // 创建响应并设置 Cookie
    const response = createSuccessResponse(responseData, '登录成功');
    
    return setCookie(response, 'session_id', sessionId, {
      maxAge: 24 * 60 * 60, // 24小时
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    });

  } catch (error) {
    console.error('登录失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('登录失败，请稍后重试', 500, 'LOGIN_FAILED');
  }
} 