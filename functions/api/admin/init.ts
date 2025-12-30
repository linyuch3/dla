// functions/api/admin/init.ts - 管理员初始化 API
import { Env, RequestContext } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { PasswordService } from '../../shared/crypto';
import { createErrorResponse, createSuccessResponse } from '../../shared/auth';

export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const { env } = context;
    
    // 获取管理员配置
    const adminUsername = env.ADMIN_USER || 'admin';
    const adminPassword = env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
      return createErrorResponse('管理员密码未在环境变量中配置', 500, 'ADMIN_PASSWORD_NOT_SET');
    }
    
    // 获取数据库服务
    const db = createDatabaseService(env);
    
    // 哈希密码
    const hashedPassword = await PasswordService.hashPassword(adminPassword);
    
    // 检查管理员用户是否存在
    const existingAdmin = await db.getUserByUsername(adminUsername);
    
    if (existingAdmin) {
      // 更新现有用户
      await db.updateUser(existingAdmin.id, { 
        password_hash: hashedPassword,
        is_admin: true 
      });
      
      return createSuccessResponse(
        { 
          message: '管理员用户已更新',
          username: adminUsername,
          action: 'updated'
        },
        '管理员用户更新成功'
      );
    } else {
      // 创建新的管理员用户
      const userId = await db.createUser(adminUsername, hashedPassword, true);
      
      return createSuccessResponse(
        { 
          message: '管理员用户已创建',
          username: adminUsername,
          userId: userId,
          action: 'created'
        },
        '管理员用户创建成功'
      );
    }
    
  } catch (error) {
    console.error('初始化管理员失败:', error);
    return createErrorResponse('初始化管理员失败', 500, 'ADMIN_INIT_FAILED');
  }
}

// GET 请求返回管理员状态信息
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const { env } = context;
    
    const adminUsername = env.ADMIN_USER || 'admin';
    const hasAdminPassword = !!env.ADMIN_PASSWORD;
    
    // 获取数据库服务
    const db = createDatabaseService(env);
    
    // 检查管理员用户是否存在
    const existingAdmin = await db.getUserByUsername(adminUsername);
    
    return createSuccessResponse({
      adminUsername,
      hasAdminPassword,
      adminExists: !!existingAdmin,
      isAdmin: existingAdmin?.is_admin || false,
      canInitialize: hasAdminPassword
    }, '管理员状态信息');
    
  } catch (error) {
    console.error('获取管理员状态失败:', error);
    return createErrorResponse('获取管理员状态失败', 500, 'ADMIN_STATUS_FAILED');
  }
} 