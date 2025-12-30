// functions/api/network/check-ip.ts - IP检查API
import { RequestContext } from '../../shared/types';
import { authMiddleware, createErrorResponse, createSuccessResponse } from '../../shared/auth';

interface IpCheckRequest {
  // 简化为仅支持直接模式
}

interface IpInfo {
  ip: string;
  city?: string;
  country?: string;
  region?: string;
  asn?: string;
  org?: string;
  isp?: string;
  timezone?: string;
}

// 移除代理URL验证函数（不再需要）

// 通过多个IP查询服务获取IP信息
async function getIpInfo(): Promise<IpInfo> {
  const fetchOptions: RequestInit = {
    headers: {
      'User-Agent': 'CloudPanel/1.0'
    }
  };
  
  // 服务列表，按优先级排序
  const services = [
    {
      name: 'ping0.cc',
      url: 'https://ping0.cc/geo',
      parser: (text: string) => {
        // ping0.cc/geo 返回4行：IP、位置、AS号、商家名称
        const lines = text.trim().split('\n');
        if (lines.length >= 4) {
          const ip = lines[0].trim();
          const location = lines[1].trim();
          const asn = lines[2].trim();
          const org = lines[3].trim();
          
          // 解析位置信息（格式：国家 省份 城市 — 运营商）
          const locationParts = location.split(' — ');
          const geoInfo = locationParts[0] || location;
          const isp = locationParts[1] || org;
          
          // 尝试提取城市信息
          const geoParts = geoInfo.split(' ');
          const country = geoParts[0] || '未知';
          const city = geoParts.length > 2 ? geoParts.slice(-1)[0] : '未知';
          
          return {
            ip,
            city,
            country,
            region: geoInfo,
            asn,
            org,
            isp
          };
        } else {
          throw new Error('ping0.cc响应格式异常');
        }
      }
    },
    {
      name: 'cloudflare',
      url: 'https://1.1.1.1/cdn-cgi/trace',
      parser: (text: string) => {
        const lines = text.split('\n');
        const data: any = {};
        lines.forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) data[key] = value;
        });
        return {
          ip: data.ip || '未知',
          city: data.colo || '未知',
          country: data.loc || '未知',
          asn: `AS${data.asn || '未知'}`,
          org: 'Cloudflare',
          isp: 'Cloudflare'
        };
      }
    },
    {
      name: 'ipify-fallback',
      url: 'https://api.ipify.org?format=json',
      parser: (text: string) => {
        const data = JSON.parse(text);
        return {
          ip: data.ip || '未知',
          city: '未知',
          country: '未知',
          asn: '未知',
          org: '未知',
          isp: '未知'
        };
      }
    }
  ];
  
  for (const service of services) {
    try {
      console.log(`尝试使用 ${service.name} 服务...`);
      const response = await fetch(service.url, {
        ...fetchOptions,
        signal: AbortSignal.timeout(10000) // 10秒超时
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const text = await response.text();
      const ipInfo = service.parser(text);
      
      console.log(`${service.name} 服务成功返回IP信息:`, ipInfo);
      return ipInfo;
      
    } catch (error) {
      console.error(`${service.name} 服务失败:`, error);
      continue;
    }
  }
  
  // 如果所有服务都失败，返回基本信息
  console.warn('所有IP查询服务都失败，返回默认信息');
  return {
    ip: '无法获取',
    city: '未知',
    country: '未知',
    asn: '未知',
    org: '未知',
    isp: '未知'
  };
}

// POST /api/network/check-ip - 检查当前IP
export async function onRequestPost(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    // 直接获取IP信息，移除复杂的模式选择
    const ipInfo = await getIpInfo();
    
    return createSuccessResponse(ipInfo, 'IP信息获取成功');

  } catch (error) {
    console.error('检查IP失败:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : '检查IP失败', 
      500, 
      'CHECK_IP_FAILED'
    );
  }
}

// GET /api/network/check-ip - 快速检查IP
export async function onRequestGet(context: RequestContext): Promise<Response> {
  try {
    const authResult = await authMiddleware(context);
    if (authResult) return authResult;

    const ipInfo = await getIpInfo();
    
    return createSuccessResponse(ipInfo, 'IP信息获取成功');

  } catch (error) {
    console.error('检查IP失败:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : '检查IP失败', 
      500, 
      'CHECK_IP_FAILED'
    );
  }
}
