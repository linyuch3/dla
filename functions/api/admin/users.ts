// functions/api/admin/users.ts - 管理员用户管理 API
import { Env, RequestContext, ValidationError } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { createErrorResponse, createSuccessResponse, validateRequestData, adminMiddleware } from '../../shared/auth';

interface ResetPasswordRequest {
  userId: number;
  newPassword: string;
  confirmPassword: string;
}

function validateResetPasswordRequest(data: any): ResetPasswordRequest {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('请求数据无效');
  }

  const { userId, newPassword, confirmPassword } = data;

  if (!userId || typeof userId !== 'number') {
    throw new ValidationError('用户ID无效', 'userId');
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

  // 密码强度验证
  const passwordStrength = PasswordService.validatePasswordStrength(newPassword);
  if (!passwordStrength.isValid) {
    throw new ValidationError(
      `密码强度不足: ${passwordStrength.feedback.join(', ')}`,
      'newPassword'
    );
  }

  return {
    userId,
    newPassword,
    confirmPassword
  };
}

// GET - 获取用户列表
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { env } = context;
    const db = createDatabaseService(env);

    // 获取所有用户
    const users = await db.getAllUsers();

    // 移除敏感信息
    const safeUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      created_at: user.created_at
    }));

    return createSuccessResponse({
      users: safeUsers,
      total: safeUsers.length
    }, '获取用户列表成功');

  } catch (error) {
    console.error('获取用户列表失败:', error);
    return createErrorResponse('获取用户列表失败', 500, 'GET_USERS_FAILED');
  }
}

// POST - 重置用户密码
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { request, env } = context;
    const session = context.session!;

    // 验证请求数据
    const { userId, newPassword } = await validateRequestData(request, validateResetPasswordRequest);

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 检查目标用户是否存在
    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return createErrorResponse('目标用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 防止管理员重置自己的密码（应该使用普通的修改密码功能）
    if (targetUser.id === session.userId) {
      return createErrorResponse('不能重置自己的密码，请使用修改密码功能', 400, 'CANNOT_RESET_SELF');
    }

    // 哈希新密码
    const newPasswordHash = await PasswordService.hashPassword(newPassword);

    // 更新用户密码
    const updateResult = await db.updateUser(userId, {
      password_hash: newPasswordHash
    });

    if (!updateResult) {
      return createErrorResponse('密码重置失败', 500, 'RESET_FAILED');
    }

    return createSuccessResponse(
      { 
        message: '密码重置成功',
        userId: userId,
        username: targetUser.username
      },
      `用户 ${targetUser.username} 的密码已重置`
    );

  } catch (error) {
    console.error('重置用户密码失败:', error);

    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }

    return createErrorResponse('重置密码失败，请稍后重试', 500, 'RESET_PASSWORD_FAILED');
  }
}

// PUT - 更新用户信息（如管理员权限）
export async function onRequestPut(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { request, env } = context;
    const session = context.session!;

    const data = await request.json();
    const { userId, is_admin } = data;

    if (!userId || typeof userId !== 'number') {
      return createErrorResponse('用户ID无效', 400, 'INVALID_USER_ID');
    }

    if (typeof is_admin !== 'boolean') {
      return createErrorResponse('管理员权限值无效', 400, 'INVALID_ADMIN_FLAG');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 检查目标用户是否存在
    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return createErrorResponse('目标用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 防止管理员移除自己的管理员权限
    if (targetUser.id === session.userId && !is_admin) {
      return createErrorResponse('不能移除自己的管理员权限', 400, 'CANNOT_REMOVE_SELF_ADMIN');
    }

    // 更新用户权限
    const updateResult = await db.updateUser(userId, { is_admin });

    if (!updateResult) {
      return createErrorResponse('更新用户权限失败', 500, 'UPDATE_FAILED');
    }

    return createSuccessResponse(
      { 
        message: '用户权限更新成功',
        userId: userId,
        username: targetUser.username,
        is_admin: is_admin
      },
      `用户 ${targetUser.username} 的权限已更新`
    );

  } catch (error) {
    console.error('更新用户权限失败:', error);
    return createErrorResponse('更新用户权限失败，请稍后重试', 500, 'UPDATE_USER_FAILED');
  }
}

// DELETE - 删除用户
export async function onRequestDelete(context: RequestContext): Promise<Response> {
  try {
    // 验证管理员权限
    const authResult = await adminMiddleware(context);
    if (authResult) {
      return authResult;
    }

    const { request, env } = context;
    const session = context.session!;

    const url = new URL(request.url);
    const userId = parseInt(url.searchParams.get('userId') || '0');

    if (!userId) {
      return createErrorResponse('用户ID无效', 400, 'INVALID_USER_ID');
    }

    // 获取数据库服务
    const db = createDatabaseService(env);

    // 检查目标用户是否存在
    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return createErrorResponse('目标用户不存在', 404, 'USER_NOT_FOUND');
    }

    // 防止管理员删除自己
    if (targetUser.id === session.userId) {
      return createErrorResponse('不能删除自己的账户', 400, 'CANNOT_DELETE_SELF');
    }

    // 删除用户
    const deleteResult = await db.deleteUser(userId);

    if (!deleteResult) {
      return createErrorResponse('删除用户失败', 500, 'DELETE_FAILED');
    }

    return createSuccessResponse(
      { 
        message: '用户删除成功',
        userId: userId,
        username: targetUser.username
      },
      `用户 ${targetUser.username} 已删除`
    );

  } catch (error) {
    console.error('删除用户失败:', error);
    return createErrorResponse('删除用户失败，请稍后重试', 500, 'DELETE_USER_FAILED');
  }
} 