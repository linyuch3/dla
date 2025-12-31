# 🔧 路由问题快速修复指南

## 问题描述

当前Docker版本中，动态路由加载器只加载了部分API路由（4个），导致大多数API端点返回404。

## 根本原因

路由加载器使用动态import时，在Docker容器中的路径解析可能存在问题。

## 解决方案

### 方案1: 手动注册路由（推荐，快速）

在 `functions/routes/index.ts` 中手动导入和注册所有API路由。

```typescript
// routes/index.ts
import { Express } from 'express';
import { requireAuth } from '../middleware/auth';

export function setupRoutes(app: Express) {
  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // 手动导入所有API路由
  import('../api/auth/login').then(m => {
    app.post('/api/auth/login', m.onRequest);
  });

  import('../api/auth/check').then(m => {
    app.get('/api/auth/check', m.onRequest);
  });

  import('../api/auth/logout').then(m => {
    app.post('/api/auth/logout', m.onRequest);
  });

  // ... 继续添加其他路由
}
```

### 方案2: 使用同步导入

创建一个路由注册文件，使用同步导入：

```typescript
// routes/api-routes.ts
import * as authLogin from '../api/auth/login';
import * as authCheck from '../api/auth/check';
import * as authLogout from '../api/auth/logout';
// ... 导入所有API模块

export const routes = [
  { method: 'POST', path: '/api/auth/login', handler: authLogin.onRequest },
  { method: 'GET', path: '/api/auth/check', handler: authCheck.onRequest },
  { method: 'POST', path: '/api/auth/logout', handler: authLogout.onRequest },
  // ... 添加所有路由
];
```

然后在 `routes/index.ts` 中注册：

```typescript
import { routes } from './api-routes';

export function setupRoutes(app: Express) {
  routes.forEach(({ method, path, handler }) => {
    app[method.toLowerCase()](path, handler);
  });
}
```

### 方案3: 修复动态加载器

修改 `functions/routes/api-loader.ts`：

```typescript
function loadRoutesFromDirectory(app: Express, dir: string, baseRoute: string) {
  if (!fs.existsSync(dir)) {
    console.warn(`API目录不存在: ${dir}`);
    return;
  }
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      const isDynamicRoute = item.startsWith('[') && item.endsWith(']');
      const routePath = isDynamicRoute 
        ? `${baseRoute}/:${item.slice(1, -1)}` 
        : `${baseRoute}/${item}`;
      
      loadRoutesFromDirectory(app, fullPath, routePath);
    } else if (item.endsWith('.ts') || item.endsWith('.js')) {
      const routeName = item.replace(/\.(ts|js)$/, '');
      let routePath = baseRoute;
      if (routeName !== 'index') {
        routePath = `${baseRoute}/${routeName}`;
      }
      
      // 使用 file:// 协议的绝对路径
      const fileUrl = `file://${fullPath}`;
      registerRoute(app, fileUrl, routePath);
    }
  }
}
```

## 临时解决方案

在路由问题修复之前，可以直接修改原有的Cloudflare Functions文件，添加Express兼容层：

```typescript
// 在每个API文件顶部添加
import { Request, Response } from 'express';

export async function onRequest(context: any) {
  // 原有的Cloudflare Functions处理逻辑
}

// 添加Express处理器
export async function handler(req: Request, res: Response) {
  const context = {
    request: convertToFetchRequest(req),
    env: req.app.locals.env,
    // ...
  };
  
  const response = await onRequest(context);
  // 转换响应
}
```

## 验证修复

修复后运行：

```bash
# 重新构建
docker-compose build

# 启动服务
docker-compose up -d

# 查看路由注册日志
docker-compose logs cloudpanel | grep "注册路由"

# 测试登录API
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

应该看到更多路由被注册，并且API返回正常响应而不是404。

## 建议

优先使用**方案1（手动注册）**，因为：
1. 最简单直接
2. 不依赖动态导入
3. 在Docker环境中最稳定
4. 便于调试

后续可以优化为自动扫描，但手动注册能确保所有路由都正确加载。
