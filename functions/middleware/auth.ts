// middleware/auth.ts - 认证中间件
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'AUTH_REQUIRED',
      message: '请先登录'
    });
  }
  
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'AUTH_REQUIRED',
      message: '请先登录'
    });
  }
  
  if (!req.session.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'ADMIN_REQUIRED',
      message: '需要管理员权限'
    });
  }
  
  next();
}
