// routes/handler-wrapper.ts - Cloudflare Functions到Express的处理器包装
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';

// 创建Express兼容的处理器
export function createHandler(cfHandler: Function) {
  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      // 构建Cloudflare Functions兼容的context
      const context = {
        request: convertToFetchRequest(req),
        env: (req.app as any).locals.env,
        params: req.params,
        next: async () => {
          // 对于Express，next()不需要返回Response
          next();
          return new Response('Next called', { status: 200 });
        }
      };
      
      // 调用原始处理器
      const response = await cfHandler(context);
      
      // 转换响应
      if (response) {
        await convertFromFetchResponse(response, res);
      } else {
        // 如果没有响应，返回500错误
        res.status(500).json({ error: 'No response from handler' });
      }
      
    } catch (error) {
      console.error('Handler error:', error);
      next(error);
    }
  };
}

// 将Express Request转换为Fetch API Request
function convertToFetchRequest(req: ExpressRequest): globalThis.Request {
  const url = `http://${req.get('host')}${req.originalUrl}`;
  
  const init: RequestInit = {
    method: req.method,
    headers: req.headers as any,
  };
  
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    // Express已经解析过body了，直接转为JSON字符串
    // 但需要确保Content-Type正确
    init.body = JSON.stringify(req.body);
    // 确保Content-Type头存在
    if (!init.headers) {
      init.headers = {};
    }
    (init.headers as any)['content-type'] = 'application/json';
  }
  
  return new globalThis.Request(url, init);
}

// 将Fetch API Response转换为Express Response
async function convertFromFetchResponse(fetchRes: globalThis.Response, expressRes: ExpressResponse) {
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
