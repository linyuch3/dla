// routes/api-loader.ts - 动态加载API路由
import { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadApiRoutes(app: Express) {
  const apiDir = path.join(__dirname, '../api');
  
  // 递归加载所有API文件
  loadRoutesFromDirectory(app, apiDir, '/api');
}

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
      // 处理动态路由 [param]
      const isDynamicRoute = item.startsWith('[') && item.endsWith(']');
      const routePath = isDynamicRoute 
        ? `${baseRoute}/:${item.slice(1, -1)}` 
        : `${baseRoute}/${item}`;
      
      loadRoutesFromDirectory(app, fullPath, routePath);
    } else if (item.endsWith('.ts') || item.endsWith('.js')) {
      // 跳过非index文件的特殊处理
      const routeName = item.replace(/\.(ts|js)$/, '');
      
      // 构建路由路径
      let routePath = baseRoute;
      if (routeName !== 'index') {
        routePath = `${baseRoute}/${routeName}`;
      }
      
      // 动态导入并注册路由
      registerRoute(app, fullPath, routePath);
    }
  }
}

async function registerRoute(app: Express, filePath: string, routePath: string) {
  try {
    const module = await import(filePath);
    
    // 支持不同的HTTP方法
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
    
    for (const method of methods) {
      const handler = module[`on${method}`] || module[`on${method.toLowerCase()}`];
      
      if (handler) {
        const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
        app[httpMethod](routePath, createHandler(handler));
        console.log(`✓ 注册路由: ${method} ${routePath}`);
      }
    }
    
    // 支持通用的onRequest处理器
    if (module.onRequest) {
      app.all(routePath, createHandler(module.onRequest));
      console.log(`✓ 注册路由: ALL ${routePath}`);
    }
    
  } catch (error) {
    console.error(`加载路由失败 ${filePath}:`, error);
  }
}

// 创建Express兼容的处理器
function createHandler(cfHandler: Function) {
  return async (req: any, res: any, next: any) => {
    try {
      // 构建Cloudflare Functions兼容的context
      const context = {
        request: convertToFetchRequest(req),
        env: req.app.locals.env,
        params: req.params,
        next: async () => {
          // 对于Express，next()不需要返回Response
          next();
          return new Response('Next called', { status: 200 });
        }
      };
      
      // 调用原始处理器
      const response = await cfHandler(context);
      
      // 如果next()被调用，跳过响应转换
      if (response && response.status !== 200 || response.headers.get('X-Next-Called')) {
        await convertFromFetchResponse(response, res);
      }
      
    } catch (error) {
      console.error('Handler error:', error);
      next(error);
    }
  };
}

// 将Express Request转换为Fetch API Request
function convertToFetchRequest(req: any): Request {
  const url = `http://${req.get('host')}${req.originalUrl}`;
  
  const init: RequestInit = {
    method: req.method,
    headers: req.headers as any,
  };
  
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    init.body = JSON.stringify(req.body);
  }
  
  return new Request(url, init);
}

// 将Fetch API Response转换为Express Response
async function convertFromFetchResponse(fetchRes: Response, expressRes: any) {
  // 设置状态码
  expressRes.status(fetchRes.status);
  
  // 设置响应头
  fetchRes.headers.forEach((value, key) => {
    expressRes.setHeader(key, value);
  });
  
  // 设置响应体
  const contentType = fetchRes.headers.get('content-type');
  
  if (contentType?.includes('application/json')) {
    const data = await fetchRes.json();
    expressRes.json(data);
  } else if (contentType?.includes('text/')) {
    const text = await fetchRes.text();
    expressRes.send(text);
  } else {
    const buffer = await fetchRes.arrayBuffer();
    expressRes.send(Buffer.from(buffer));
  }
}
