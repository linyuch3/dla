// middleware/session.ts - Session中间件
import { Request, Response, NextFunction } from 'express';
import { getKV } from '../shared/kv-adapter';
import { config } from '../config';
import path from 'path';

const SESSION_PREFIX = 'session:';

// 扩展Express Request类型
declare global {
  namespace Express {
    interface Request {
      session?: {
        userId: number;
        username: string;
        isAdmin: boolean;
      };
      sessionId?: string;
    }
  }
}

export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  // 从Cookie或Authorization头获取session token
  const token = getTokenFromRequest(req);
  
  if (token) {
    req.sessionId = token;
    
    // 异步加载session（不阻塞）
    loadSession(token).then(session => {
      if (session) {
        req.session = session;
      }
      next();
    }).catch(err => {
      console.error('Load session error:', err);
      next();
    });
  } else {
    next();
  }
}

function getTokenFromRequest(req: Request): string | null {
  // 从Authorization头获取
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // 从Cookie获取
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies['session-token'] || null;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length === 2) {
      cookies[parts[0]] = decodeURIComponent(parts[1]);
    }
  });
  
  return cookies;
}

async function loadSession(token: string): Promise<{ userId: number; username: string; isAdmin: boolean } | null> {
  try {
    const kvPath = path.join(path.dirname(config.database.path), 'kv');
    const kv = getKV(kvPath);
    
    const sessionData = await kv.get(`${SESSION_PREFIX}${token}`, { type: 'json' });
    
    if (!sessionData) {
      return null;
    }
    
    return {
      userId: sessionData.userId,
      username: sessionData.username,
      isAdmin: sessionData.isAdmin
    };
  } catch (error) {
    console.error('Error loading session:', error);
    return null;
  }
}

// Session辅助函数
export async function createSession(userId: number, username: string, isAdmin: boolean): Promise<string> {
  const token = generateSessionToken();
  const kvPath = path.join(path.dirname(config.database.path), 'kv');
  const kv = getKV(kvPath);
  
  await kv.put(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify({ userId, username, isAdmin }),
    { expirationTtl: Math.floor(config.session.duration / 1000) }
  );
  
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  const kvPath = path.join(path.dirname(config.database.path), 'kv');
  const kv = getKV(kvPath);
  await kv.delete(`${SESSION_PREFIX}${token}`);
}

function generateSessionToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
