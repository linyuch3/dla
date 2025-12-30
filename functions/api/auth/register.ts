// functions/api/auth/register.ts - 用户注册 API
import { Env, RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { createErrorResponse, createSuccessResponse, validateRequestData, checkRateLimit } from '../../shared/auth';

interface RegisterRequest {
  username: string;
  password: string;
  passwordConfirm?: string;
}

function validateRegisterRequest(data: any): RegisterRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { username, password, passwordConfirm } = data;

  if (!username || typeof username !== 'string') {
    throw new ValidationError('用户名不能为空', 'username');
  }

  if (!password || typeof password !== 'string') {
    throw new ValidationError('密码不能为空', 'password');
  }

  const trimmedUsername = username.trim();

  // 用户名验证
  if (trimmedUsername.length < 3) {
    throw new ValidationError('用户名至少3个字符', 'username');
  }

  if (trimmedUsername.length > 50) {
    throw new ValidationError('用户名不能超过50个字符', 'username');
  }

  if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(trimmedUsername)) {
    throw new ValidationError('用户名只能包含字母、数字、下划线、横线和中文', 'username');
  }

  // 密码强度验证
  const passwordStrength = PasswordService.validatePasswordStrength(password);
  if (!passwordStrength.isValid) {
    throw new ValidationError(
      `密码强度不足: ${passwordStrength.feedback.join(', ')}`,
      'password'
    );
  }

  // 确认密码验证（如果提供）
  if (passwordConfirm !== undefined && password !== passwordConfirm) {
    throw new ValidationError('两次输入的密码不一致', 'passwordConfirm');
  }

  return {
    username: trimmedUsername,
    password,
    passwordConfirm
  };
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const { request, env } = context;

    // 频率限制：每小时最多3次注册尝试
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `register:${clientIP}`;
    
    const isAllowed = await checkRateLimit(rateLimitKey, 3, 60 * 60 * 1000, env);
    if (!isAllowed) {
      return createErrorResponse('注册尝试过于频繁，请稍后再试', 429, 'RATE_LIMIT_EXCEEDED');
    }

    // 验证请求数据
    const { username, password } = await validateRequestData(request, validateRegisterRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 检查用户名是否已存在
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return createErrorResponse('用户名已存在', 409, 'USERNAME_EXISTS');
    }

    // 哈希密码
    const passwordHash = await PasswordService.hashPassword(password);

    // 创建用户
    const userId = await db.createUser(username, passwordHash, false);

    // 准备响应数据
    const responseData = {
      message: 'User registered successfully',
      user: {
        id: userId,
        username: username,
        isAdmin: false
      }
    };

    return createSuccessResponse(responseData, '注册成功', 201);

  } catch (error) {
    console.error('注册失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    // 检查是否是数据库唯一约束错误
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return createErrorResponse('用户名已存在', 409, 'USERNAME_EXISTS');
    }

    return createErrorResponse('注册失败，请稍后重试', 500, 'REGISTRATION_FAILED');
  }
} 