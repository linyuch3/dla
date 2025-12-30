// functions/api/auth/reset-admin.ts - 重置管理员密码
import { Env, RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { createErrorResponse, createSuccessResponse } from '../../shared/auth';

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const { env } = context;
    
    // 获取数据库服务
    const db = createDatabaseService(env);
    
    // 使用环境变量中的密码
    const adminPassword = env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return createErrorResponse('管理员密码未配置', 500, 'ADMIN_PASSWORD_NOT_SET');
    }
    
    // 哈希密码
    const hashedPassword = await PasswordService.hashPassword(adminPassword);
    
    // 查找管理员用户
    const adminUser = await db.getUserByUsername(env.ADMIN_USER || 'yuchen');
    
    if (adminUser) {
      // 更新现有用户的密码
      await db.updateUser(adminUser.id, { 
        password_hash: hashedPassword,
        is_admin: true 
      });
    } else {
      // 创建新的管理员用户
      await db.createUser(env.ADMIN_USER || 'yuchen', hashedPassword, true);
    }
    
    return createSuccessResponse(
      { message: '管理员密码已重置' },
      '管理员密码重置成功'
    );
    
  } catch (error) {
    console.error('重置管理员密码失败:', error);
    return createErrorResponse('重置密码失败', 500, 'RESET_FAILED');
  }
} 