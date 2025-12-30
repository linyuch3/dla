// functions/api/auth/change-password.ts - 用户修改密码 API
import { Env, RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { createErrorResponse, createSuccessResponse, validateRequestData, authMiddleware } from '../../shared/auth';

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function validateChangePasswordRequest(data: any): ChangePasswordRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { currentPassword, newPassword, confirmPassword } = data;

  if (!currentPassword || typeof currentPassword !== 'string') {
    throw new ValidationError('当前密码不能为空', 'currentPassword');
  }

  if (!newPassword || typeof newPassword !== 'string') {
    throw new ValidationError('新密码不能为空', 'newPassword');
  }

  if (!confirmPassword || typeof confirmPassword !== 'string') {
    throw new ValidationError('确认密码不能为空', 'confirmPassword');
  }

  if (newPassword !== confirmPassword) {
    throw new ValidationError('两次输入的密码不一致', 'confirmPassword');
  }

  if (newPassword.length < 6) {
    throw new ValidationError('新密码至少6个字符', 'newPassword');
  }

  if (currentPassword === newPassword) {
    throw new ValidationError('新密码不能与当前密码相同', 'newPassword');
  }

  // 密码强度验证
  const passwordStrength = PasswordService.validatePasswordStrength(newPassword);
  if (!passwordStrength.isValid) {
    throw new ValidationError(
      `密码强度不足: ${passwordStrength.feedback.join(', ')}`,
      'newPassword'
    );
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword
  };
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证用户已登录
    const authResult = await authMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { request, env } = context;
    const session = context.session!;

    // 验证请求数据
    const { currentPassword, newPassword } = await validateRequestData(request, validateChangePasswordRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 获取用户信息
    const user = await db.getUserById(session.userId);
    if (!user) {
      return createErrorResponse('用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 验证当前密码
    const isCurrentPasswordValid = await PasswordService.verifyPassword(currentPassword, user.password_hash);
    if (!isCurrentPasswordValid) {
      return createErrorResponse('当前密码错误', 400, 'INVALID_CURRENT_PASSWORD');
    }

    // 哈希新密码
    const newPasswordHash = await PasswordService.hashPassword(newPassword);

    // 更新用户密码
    const updateResult = await db.updateUser(user.id, {
      password_hash: newPasswordHash
    });

    if (!updateResult) {
      return createErrorResponse('密码更新失败', 500, 'UPDATE_FAILED');
    }

    return createSuccessResponse(
      { message: '密码修改成功' },
      '密码修改成功，请妥善保管新密码'
    );

  } catch (error) {
    console.error('修改密码失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('修改密码失败，请稍后重试', 500, 'CHANGE_PASSWORD_FAILED');
  }
} 