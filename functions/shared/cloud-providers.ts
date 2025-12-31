// cloud-providers.ts - 云服务商集成服务
import { CloudInstance, CloudRegion, CloudImage, CloudPlan, CloudProviderError, AccountInfo, BalanceInfo, UnifiedAccountOverview } from './types';
import { CryptoService } from './crypto';

export interface CloudProviderAPI {
  // 账户信息
  getAccountInfo(): Promise<AccountInfo>;
  getBalance(): Promise<BalanceInfo>;
  getAccountOverview(): Promise<UnifiedAccountOverview>; // 新增：统一账户概览
  
  // 实例管理
  getInstances(): Promise<CloudInstance[]>;
  createInstance(config: CreateInstanceConfig): Promise<CloudInstance>;
  deleteInstance(instanceId: string): Promise<boolean>;
  performInstanceAction(instanceId: string, action: string): Promise<boolean>;
  
  // IP管理
  changeInstanceIP?(instanceId: string, ipVersion?: 'IPv4' | 'IPv6'): Promise<string>;
  
  // 浮动IP管理（可选，主要用于DigitalOcean）
  listFloatingIPs?(): Promise<{ ip: string; dropletId?: number; region: string }[]>;
  deleteFloatingIP?(ip: string): Promise<boolean>;
  
  // 配置选项
  getRegions(): Promise<CloudRegion[]>;
  getImages(): Promise<CloudImage[]>;
  getPlans(): Promise<CloudPlan[]>;
}

export interface CreateInstanceConfig {
  name: string;
  region: string;
  image: string;
  size: string;
  ssh_keys?: string[];
  diskSize?: number; // 硬盘大小 (GB)
  enableIPv6?: boolean; // 是否启用IPv6 (仅Azure)
  tags?: string[];
  user_data?: string;
}

/**
 * DigitalOcean API 集成
 */
export class DigitalOceanProvider implements CloudProviderAPI {
  private readonly baseUrl = 'https://api.digitalocean.com/v2';
  
  constructor(private apiKey: string) {}

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new CloudProviderError(
        `DigitalOcean API 错误: ${response.status} - ${errorText}`,
        'digitalocean',
        response.status
      );
    }

    // 检查响应体是否为空（通常DELETE请求返回空响应）
    const responseText = await response.text();
    if (!responseText.trim()) {
      return {}; // 返回空对象而不是尝试解析空JSON
    }
    
    try {
      return JSON.parse(responseText);
    } catch (jsonError) {
      console.warn(`[DigitalOcean] JSON解析失败: ${responseText}`);
      throw new CloudProviderError(
        `DigitalOcean API 响应格式错误`,
        'digitalocean',
        500
      );
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const data = await this.makeRequest('/account');
    const account = data.account;
    return {
      email: account.email,
      status: account.status,
      email_verified: account.email_verified,
      uuid: account.uuid,
      droplet_limit: account.droplet_limit,
      // 注意：DigitalOcean API 不提供账号创建时间
      active_since: undefined // 显式标明不支持
    };
  }

  async getBalance(): Promise<BalanceInfo> {
    const data = await this.makeRequest('/account');
    return {
      balance: parseFloat(data.account.account_balance || '0'),
      currency: 'USD',
      account_balance: parseFloat(data.account.account_balance || '0')
    };
  }

  async getAccountOverview(): Promise<UnifiedAccountOverview> {
    // 并行获取所有需要的数据
    const [accountData, customerBalanceData, dropletsData, floatingIPsData, volumesData] = await Promise.all([
      this.makeRequest('/account'),
      this.makeRequest('/customers/my/balance'),
      this.makeRequest('/droplets'),
      this.makeRequest('/floating_ips').catch(() => ({ floating_ips: [] })), // 容错处理
      this.makeRequest('/volumes').catch(() => ({ volumes: [] })) // 容错处理
    ]);

    const account = accountData.account;
    const balance = customerBalanceData;
    const droplets = dropletsData.droplets || [];
    const floatingIPs = floatingIPsData.floating_ips || [];
    const volumes = volumesData.volumes || [];

    // 计算状态
    const status = account.status === 'active' ? 'active' : 
                   account.status === 'warning' ? 'warning' : 'inactive';

    return {
      provider: 'digitalocean',
      account: {
        name: account.email,
        email: account.email,
        status: status,
        plan: '—' // DigitalOcean没有明确的计划类型
      },
      money: {
        currency: 'USD',
        balance: parseFloat(account.account_balance || '0'),
        monthly_used: parseFloat(balance.month_to_date_usage || '0')
      },
      quotas: [
        {
          key: 'instances',
          label: '实例',
          used: droplets.length,
          limit: account.droplet_limit || 25
        }
      ],
      resources: {
        instances: droplets.length,
        floating_ips: floatingIPs.length,
        volumes: volumes.length
      },
      meta: {
        last_sync: new Date().toISOString()
      }
    };
  }

  async getInstances(): Promise<CloudInstance[]> {
    const [dropletsData, reservedIPsData] = await Promise.all([
      this.makeRequest('/droplets'),
      this.makeRequest('/reserved_ips')
    ]);
    
    return dropletsData.droplets.map((droplet: any): CloudInstance => {
      // 查找绑定到此Droplet的Reserved IP
      const reservedIP = reservedIPsData.reserved_ips.find((rip: any) => 
        rip.droplet && rip.droplet.id === droplet.id
      );
      
      // 优先使用Reserved IP，否则使用默认公网IP
      const publicIPv4 = reservedIP ? 
        reservedIP.ip : 
        droplet.networks.v4.find((net: any) => net.type === 'public')?.ip_address;
      
      // 获取IPv6地址
      const ipv6Network = droplet.networks.v6.find((net: any) => net.type === 'public');
      const ipv6Address = ipv6Network ? ipv6Network.ip_address : undefined;
      
      return {
      id: droplet.id,
      name: droplet.name,
      status: droplet.status,
      provider: 'digitalocean',
      region: droplet.region.slug,
      image: droplet.image.slug || droplet.image.name,
      size: droplet.size.slug,
        ip_address: publicIPv4,
        ipv6_address: ipv6Address,
      private_ip: droplet.networks.v4.find((net: any) => net.type === 'private')?.ip_address,
      vcpus: droplet.vcpus,
      memory: droplet.memory,
      disk: droplet.disk,
      created_at: droplet.created_at,
      tags: droplet.tags,
      transfer: {
        quota: droplet.size_gigabytes ? droplet.size_gigabytes * 1000 : 1000 // 根据套餐估算流量配额
        // 注意：DigitalOcean API 不提供实例级别的流量使用数据
      }
      };
    });
  }

  async createInstance(config: CreateInstanceConfig): Promise<CloudInstance> {
    const payload = {
      name: config.name,
      region: config.region,
      size: config.size,
      image: config.image,
      ssh_keys: config.ssh_keys || [],
      tags: config.tags || [],
      user_data: config.user_data,
      ipv6: config.enableIPv6 || false  // 添加IPv6支持
    };

    const data = await this.makeRequest('/droplets', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const droplet = data.droplet;
    
    // 获取IPv6地址（如果启用）
    const ipv6Network = droplet.networks?.v6?.find((net: any) => net.type === 'public');
    const ipv6Address = ipv6Network ? ipv6Network.ip_address : undefined;
    
    return {
      id: droplet.id,
      name: droplet.name,
      status: droplet.status,
      provider: 'digitalocean',
      region: droplet.region.slug,
      image: droplet.image.slug || droplet.image.name,
      size: droplet.size.slug,
      ip_address: undefined, // 新创建的实例暂时没有 IP
      ipv6_address: ipv6Address,
      private_ip: undefined,
      vcpus: droplet.vcpus,
      memory: droplet.memory,
      disk: droplet.disk,
      created_at: droplet.created_at,
      tags: droplet.tags || []
    };
  }

  // 新增：列出账号下全部 Reserved IP
  async listFloatingIPs(): Promise<{ ip: string; dropletId?: number; region: string }[]> {
    const data = await this.makeRequest('/floating_ips');
    return (data.floating_ips || []).map((f: any) => ({
      ip: f.ip,
      dropletId: f.droplet?.id,
      region: f.region?.slug,
    }));
  }

  // 新增：按 IP 释放 Reserved IP
  async deleteFloatingIP(ip: string): Promise<boolean> {
    try {
      console.log(`[DigitalOcean] 开始删除浮动IP: ${ip}`);
      
      // 若已绑定需要先解绑
      await this.makeRequest(`/floating_ips/${ip}/actions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'unassign' }),
      }).catch((e) => {
        console.log(`[DigitalOcean] 解绑浮动IP失败或已解绑: ${ip}`, e.message);
      });
      
      // 再删除
      await this.makeRequest(`/floating_ips/${ip}`, { method: 'DELETE' });
      console.log(`[DigitalOcean] 浮动IP删除成功: ${ip}`);
      return true;
    } catch (e) {
      console.error('[DigitalOcean] 删除浮动IP失败:', ip, e);
      throw e;
    }
  }

  // 新增：绑定浮动IP到Droplet
  async assignFloatingIP(ip: string, dropletId: number): Promise<boolean> {
    try {
      console.log(`[DigitalOcean] 开始绑定浮动IP ${ip} 到 Droplet ${dropletId}`);
      
      // Reserved IP 必须与 Droplet 在同一 region，否则 DO 会报错
      await this.makeRequest(`/floating_ips/${ip}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'assign',
          droplet_id: dropletId,  // DO 文档字段
        }),
      });
      
      console.log(`[DigitalOcean] 浮动IP绑定成功: ${ip} -> Droplet ${dropletId}`);
      return true;
    } catch (e) {
      console.error('[DigitalOcean] 绑定浮动IP失败:', ip, dropletId, e);
      throw e;
    }
  }

  // 新增：分离浮动IP
  async unassignFloatingIP(ip: string): Promise<boolean> {
    try {
      console.log(`[DigitalOcean] 开始分离浮动IP: ${ip}`);
      
      await this.makeRequest(`/floating_ips/${ip}/actions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'unassign' }),
      });
      
      console.log(`[DigitalOcean] 浮动IP分离成功: ${ip}`);
      return true;
    } catch (e) {
      console.error('[DigitalOcean] 分离浮动IP失败:', ip, e);
      throw e;
    }
  }

  // 新增：按 Droplet 清理其绑定的 Reserved IP（删除）
  private async cleanupFloatingIPsForDroplet(dropletId: number): Promise<void> {
    try {
      console.log(`[DigitalOcean] 开始清理Droplet(${dropletId})的浮动IP`);
      const all = await this.listFloatingIPs();
      const bound = all.filter(f => f.dropletId === dropletId);
      
      if (bound.length === 0) {
        console.log(`[DigitalOcean] Droplet(${dropletId})没有绑定的浮动IP`);
        return;
      }
      
      console.log(`[DigitalOcean] 发现${bound.length}个绑定的浮动IP:`, bound.map(f => f.ip));
      
      for (const f of bound) {
        try {
          console.log(`[DigitalOcean] 释放Droplet(${dropletId})的Reserved IP: ${f.ip}`);
          await this.deleteFloatingIP(f.ip);
        } catch (e) {
          console.warn(`[DigitalOcean] 清理浮动IP失败: ${f.ip}`, e);
          // 继续清理其他IP，不因单个失败而中断
        }
      }
    } catch (e) {
      console.warn(`[DigitalOcean] 获取浮动IP列表失败:`, e);
      // 不抛出错误，避免影响Droplet删除
    }
  }

  async deleteInstance(instanceId: string): Promise<boolean> {
    const dropletId = parseInt(instanceId);
    
    // 1) 先尝试清理与此 Droplet 绑定的 Reserved IP（避免删除 Droplet 后IP变成"未绑定"开始计费）
    try {
      await this.cleanupFloatingIPsForDroplet(dropletId);
    } catch (e) {
      console.warn('[DigitalOcean] 删除前清理浮动IP失败，继续执行删除Droplet:', e);
    }

    // 2) 删除 Droplet
    await this.makeRequest(`/droplets/${instanceId}`, {
      method: 'DELETE'
    });
    
    console.log(`[DigitalOcean] Droplet删除成功: ${instanceId}`);
    return true;
  }

  async performInstanceAction(instanceId: string, action: string): Promise<boolean> {
    const actionMap: { [key: string]: string } = {
      'power_on': 'power_on',
      'power_off': 'power_off',
      'reboot': 'reboot',
      'shutdown': 'shutdown'
    };

    const doAction = actionMap[action];
    if (!doAction) {
      throw new CloudProviderError(`不支持的操作: ${action}`, 'digitalocean', 400);
    }

    await this.makeRequest(`/droplets/${instanceId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: doAction })
    });

    return true;
  }

  async getRegions(): Promise<CloudRegion[]> {
    const data = await this.makeRequest('/regions');
    
    return data.regions
      .filter((region: any) => region.available)
      .map((region: any): CloudRegion => ({
        slug: region.slug,
        name: region.name,
        available: region.available
      }));
  }

  async getImages(): Promise<CloudImage[]> {
    const data = await this.makeRequest('/images?type=distribution');
    
    // 过滤和去重镜像
    const imageMap = new Map<string, any>();
    
    data.images
      .filter((image: any) => image.public && image.status === 'available')
      .forEach((image: any) => {
        // 使用slug作为唯一标识符，避免重复
        if (image.slug && !imageMap.has(image.slug)) {
          imageMap.set(image.slug, image);
        }
      });
    
    // 转换为CloudImage格式并排序
    return Array.from(imageMap.values())
      .map((image: any): CloudImage => {
        // 组合distribution和name生成更完整的镜像名称
        let displayName = image.name;
        if (image.distribution && image.name && !image.name.toLowerCase().includes(image.distribution.toLowerCase())) {
          displayName = `${image.distribution} ${image.name}`;
        }
        
        return {
          id: image.slug, // 使用slug作为ID，确保一致性
          slug: image.slug,
          name: displayName,
          distribution: image.distribution
        };
      })
      .sort((a, b) => {
        // 按发行版和名称排序
        if (a.distribution !== b.distribution) {
          return (a.distribution || '').localeCompare(b.distribution || '');
        }
        return a.name.localeCompare(b.name);
      });
  }

  async getPlans(): Promise<CloudPlan[]> {
    const data = await this.makeRequest('/sizes');
    
    return data.sizes
      .filter((size: any) => size.available)
      .map((size: any): CloudPlan => ({
        slug: size.slug,
        description: `${size.memory}MB / ${size.vcpus} CPU / ${size.disk}GB SSD`,
        memory: size.memory,
        vcpus: size.vcpus,
        disk: size.disk,
        price_monthly: size.price_monthly,
        price_hourly: size.price_hourly,
        regions: size.regions
      }));
  }

  async changeInstanceIP(instanceId: string, ipVersion: 'IPv4' | 'IPv6' = 'IPv4'): Promise<string> {
    console.log(`[DigitalOcean] 开始更换实例IP: ${instanceId}, 版本: ${ipVersion}`);
    
    try {
      if (ipVersion === 'IPv4') {
        return await this.changeIPv4(instanceId);
      } else {
        return await this.changeIPv6(instanceId);
      }
    } catch (error) {
      console.error(`[DigitalOcean] 更换IP失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async changeIPv4(instanceId: string): Promise<string> {
    try {
      // 1. 获取当前Droplet信息
      const droplet = await this.makeRequest(`/droplets/${instanceId}`);
      const region = droplet.droplet.region.slug;
      
      // 2. 创建新的Reserved IP
      console.log(`[DigitalOcean] 创建新的Reserved IP`);
      const reservedIPResponse = await this.makeRequest('/reserved_ips', {
        method: 'POST',
        body: JSON.stringify({
          region: region
        })
      });
      
      const newReservedIP = reservedIPResponse.reserved_ip.ip;
      console.log(`[DigitalOcean] 新Reserved IP创建成功: ${newReservedIP}`);
      
      // 3. 检查并解绑现有的Reserved IP
      const existingReservedIPs = await this.makeRequest('/reserved_ips');
      for (const rip of existingReservedIPs.reserved_ips) {
        if (rip.droplet && rip.droplet.id === parseInt(instanceId)) {
          console.log(`[DigitalOcean] 解绑现有Reserved IP: ${rip.ip}`);
          await this.makeRequest(`/reserved_ips/${rip.ip}/actions`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'unassign'
            })
          });
          
          // 等待解绑完成
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // 删除旧的Reserved IP
          await this.makeRequest(`/reserved_ips/${rip.ip}`, { method: 'DELETE' });
          console.log(`[DigitalOcean] 旧Reserved IP已删除: ${rip.ip}`);
        }
      }
      
      // 4. 绑定新的Reserved IP到Droplet
      console.log(`[DigitalOcean] 绑定新Reserved IP到Droplet: ${instanceId}`);
      await this.makeRequest(`/reserved_ips/${newReservedIP}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'assign',
          droplet_id: parseInt(instanceId)
        })
      });
      
      // 5. 等待绑定完成
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      console.log(`[DigitalOcean] IPv4更换成功: ${instanceId} -> ${newReservedIP}`);
      return newReservedIP;
      
    } catch (error) {
      console.error(`[DigitalOcean] IPv4更换失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async changeIPv6(instanceId: string): Promise<string> {
    try {
      // 1. 获取当前Droplet信息
      const droplet = await this.makeRequest(`/droplets/${instanceId}`);
      
      // 2. 检查是否已启用IPv6
      const hasIPv6 = droplet.droplet.networks.v6.some((net: any) => net.type === 'public');
      
      if (!hasIPv6) {
        // 3. 为Droplet启用IPv6
        console.log(`[DigitalOcean] 为Droplet启用IPv6: ${instanceId}`);
        await this.makeRequest(`/droplets/${instanceId}/actions`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'enable_ipv6'
          })
        });
        
        // 等待IPv6启用完成
        await this.waitForAction(instanceId, 'enable_ipv6');
        
        // 等待额外时间让IPv6地址分配完成
        console.log(`[DigitalOcean] 等待IPv6地址分配完成...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 重试获取IPv6地址，最多尝试3次
        let ipv6Address: string | undefined;
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log(`[DigitalOcean] 尝试获取IPv6地址 (第${attempt}次)`);
          
          const updatedDroplet = await this.makeRequest(`/droplets/${instanceId}`);
          const ipv6Network = updatedDroplet.droplet.networks.v6.find((net: any) => net.type === 'public');
          
          if (ipv6Network && ipv6Network.ip_address) {
            ipv6Address = ipv6Network.ip_address;
            console.log(`[DigitalOcean] IPv6启用成功: ${instanceId} -> ${ipv6Address}`);
            break;
          }
          
          if (attempt < 3) {
            console.log(`[DigitalOcean] 第${attempt}次未获取到IPv6地址，等待10秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }
        
        if (!ipv6Address) {
          throw new CloudProviderError('IPv6启用失败，未获取到IPv6地址。请稍后手动检查Droplet的IPv6配置。', 'digitalocean', 500);
        }
        
        return ipv6Address;
      } else {
        throw new CloudProviderError('DigitalOcean不支持更换已有的IPv6地址', 'digitalocean', 400);
      }
      
    } catch (error) {
      console.error(`[DigitalOcean] IPv6操作失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async waitForAction(dropletId: string, actionType: string): Promise<void> {
    console.log(`[DigitalOcean] 等待操作完成: ${actionType}`);
    
    for (let i = 0; i < 30; i++) { // 最多等待5分钟
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const actions = await this.makeRequest(`/droplets/${dropletId}/actions`);
      const targetAction = actions.actions.find((action: any) => 
        action.type === actionType && action.status === 'completed'
      );
      
      if (targetAction) {
        console.log(`[DigitalOcean] 操作完成: ${actionType}`);
        return;
      }
    }
    
    throw new CloudProviderError(`操作超时: ${actionType}`, 'digitalocean', 504);
  }
}

/**
 * Linode API 集成
 */
export class LinodeProvider implements CloudProviderAPI {
  private readonly baseUrl = 'https://api.linode.com/v4';
  
  constructor(private apiKey: string) {}

  private extractRootPassword(userData?: string): string | undefined {
    if (!userData) return undefined;
    
    // 从user_data脚本中提取root密码
    // 脚本格式：echo 'root:密码' | chpasswd
    const match = userData.match(/echo\s+['"](root:([^'"]+))['"].*chpasswd/);
    return match ? match[2] : undefined;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // 对于502/503/504等服务器错误，进行重试
        if ((response.status >= 502 && response.status <= 504) && retryCount < maxRetries) {
          console.warn(`[Linode] API ${response.status}错误，${retryDelay}ms后重试 (${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return this.makeRequest(endpoint, options, retryCount + 1);
        }
        
        // 针对502错误提供更友好的错误信息
        if (response.status === 502) {
          throw new CloudProviderError(
            `Linode服务暂时不可用，请稍后重试。如果问题持续存在，可能是Linode服务端故障。`,
            'linode',
            response.status
          );
        }
        
        throw new CloudProviderError(
          `Linode API 错误: ${response.status} - ${errorText}`,
          'linode',
          response.status
        );
      }

      // 检查响应体是否为空（通常DELETE请求返回空响应）
      const responseText = await response.text();
      if (!responseText.trim()) {
        return {}; // 返回空对象而不是尝试解析空JSON
      }
      
      try {
        return JSON.parse(responseText);
      } catch (jsonError) {
        console.warn(`[Linode] JSON解析失败: ${responseText}`);
        throw new CloudProviderError(
          `Linode API 响应格式错误`,
          'linode',
          500
        );
      }
    } catch (error) {
      // 网络错误处理
      if (error instanceof CloudProviderError) {
        throw error;
      }
      
      // 网络连接失败重试
      if (retryCount < maxRetries) {
        console.warn(`[Linode] 网络错误，${retryDelay}ms后重试 (${retryCount + 1}/${maxRetries}):`, error);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.makeRequest(endpoint, options, retryCount + 1);
      }
      
      throw new CloudProviderError(
        `网络连接失败，请检查网络状况或稍后重试`,
        'linode',
        0
      );
    }
  }

  /**
   * 格式化Linode API返回的时间为标准ISO格式
   * Linode API返回的时间格式通常是: "2025-10-06T10:30:00"
   * 需要确保时区正确处理
   */
  private formatLinodeTime(timeString: string): string {
    if (!timeString) return new Date().toISOString();
    
    try {
      // Linode API返回UTC时间，格式为 "2025-12-31T15:30:00"
      // 需要检查是否已经有时区标识
      let normalizedTime = timeString;
      
      // 检查字符串末尾是否有时区信息（Z 或 +/-HH:MM）
      const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(timeString);
      
      if (!hasTimezone) {
        // Linode返回的是UTC时间，添加Z后缀
        normalizedTime = timeString + 'Z';
      }
      
      const date = new Date(normalizedTime);
      
      // 验证日期是否有效
      if (isNaN(date.getTime())) {
        console.warn(`[Linode] 无效的时间格式: ${timeString}`);
        return new Date().toISOString();
      }
      
      return date.toISOString();
    } catch (error) {
      console.error(`[Linode] 时间格式化错误: ${timeString}`, error);
      return new Date().toISOString();
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const data = await this.makeRequest('/account');
    return {
      email: data.email,
      status: data.active ? 'active' : 'inactive',
      email_verified: data.email_verified || false,
      active: data.active,
      active_since: data.active_since
    };
  }

  async getBalance(): Promise<BalanceInfo> {
    const data = await this.makeRequest('/account');
    const balance = parseFloat(data.balance || '0');
    
    return {
      balance: balance,
      currency: 'USD',
      account_balance: balance,
      // 添加信用额度信息
      credits_remaining: data.credit_remaining ? parseFloat(data.credit_remaining) : undefined,
      // 如果余额为负数，可能是有优惠码信用
      is_credit_account: balance < 0
    };
  }

  async getAccountOverview(): Promise<UnifiedAccountOverview> {
    // 并行获取所有需要的数据
    const [accountData, transferData, instancesData, ipsData, profileData, promosData] = await Promise.all([
      this.makeRequest('/account'),
      this.makeRequest('/account/transfer'),
      this.makeRequest('/linode/instances'),
      this.makeRequest('/networking/ips').catch(() => ({ data: [] })), // 容错处理
      this.makeRequest('/profile').catch(() => ({ authentication_type: null })), // 容错处理
      this.makeRequest('/account/promotions').catch((err) => {
        console.error('[Linode] 获取促销信息失败:', err);
        return { data: [] };
      }) // 获取促销信息
    ]);

    // 调试信息：记录transfer数据
    console.log('[Linode] Transfer API 响应数据:', transferData);
    console.log('[Linode] Promotions API 响应数据:', promosData);
    console.log('[Linode] Account API 响应数据:', accountData);

    const instances = instancesData.data || [];
    const ips = ipsData.data || [];
    const promotions = promosData.data || [];
    
    console.log('[Linode] 促销数组长度:', promotions.length);
    console.log('[Linode] 促销数组内容:', JSON.stringify(promotions, null, 2));
    console.log('[Linode] accountData.active_promotions:', accountData.active_promotions);
    
    // 统计IPv4和IPv6地址
    const publicIPv4 = ips.filter((ip: any) => ip.type === 'ipv4' && ip.public).length;
    const ipv6Prefixes = ips.filter((ip: any) => ip.type === 'ipv6').length;

    // 检查2FA状态
    const has2FA = profileData.authentication_type === 'password' ? false : true;

    // 处理促销信息
    let linodePromo: any = null;
    
    // 优先使用 accountData.active_promotions（Linode API v4 的标准字段）
    const activePromotions = accountData.active_promotions || promotions;
    console.log('[Linode] 活跃促销列表:', JSON.stringify(activePromotions, null, 2));
    
    if (activePromotions && activePromotions.length > 0) {
      console.log('[Linode] 找到促销信息，处理中...');
      const activePromo = activePromotions[0]; // 获取第一个激活的促销
      console.log('[Linode] 活跃促销对象:', JSON.stringify(activePromo, null, 2));
      
      // Linode API的active_promotions数据结构：
      // { 
      //   summary: "$100 promotional credit", 
      //   credit_remaining: "100.00", 
      //   expire_dt: "2026-01-01T00:00:00",
      //   service_type: "all",
      //   ...
      // }
      let promoCode = '无';
      let promoExpire = '无';
      let promoRemaining = 0;
      
      // 提取促销码或描述
      if (activePromo.summary) {
        promoCode = activePromo.summary;
      } else if (activePromo.description) {
        promoCode = activePromo.description;
      }
      
      // 提取过期时间
      if (activePromo.expire_dt) {
        promoExpire = new Date(activePromo.expire_dt).toLocaleDateString('zh-CN');
      } else if (activePromo.expires_at) {
        promoExpire = new Date(activePromo.expires_at).toLocaleDateString('zh-CN');
      }
      
      // 提取剩余金额
      if (activePromo.credit_remaining) {
        promoRemaining = parseFloat(activePromo.credit_remaining);
      } else if (activePromo.this_month_so_far) {
        promoRemaining = parseFloat(activePromo.this_month_so_far);
      }
      
      linodePromo = {
        balance_uninvoiced: parseFloat(accountData.balance_uninvoiced || '0'),
        promo_code: promoCode,
        promo_expire: promoExpire,
        promo_remaining: promoRemaining
      };
      console.log('[Linode] 解析后的促销信息:', linodePromo);
    } else {
      console.log('[Linode] 没有找到活跃的促销信息');
      linodePromo = {
        balance_uninvoiced: parseFloat(accountData.balance_uninvoiced || '0'),
        promo_code: '无',
        promo_expire: '无',
        promo_remaining: 0
      };
    }

    // 提取信用卡和创建时间信息
    let linodeDetails;
    if (accountData.credit_card) {
      linodeDetails = {
        balance: parseFloat(accountData.balance || '0'),
        credit_card: `**** **** **** ${accountData.credit_card.last_four} (过期: ${accountData.credit_card.expiry})`,
        created_at: accountData.active_since
      };
    } else {
      linodeDetails = {
        balance: parseFloat(accountData.balance || '0'),
        created_at: accountData.active_since
      };
    }

    return {
      provider: 'linode',
      account: {
        name: accountData.email,
        email: accountData.email,
        status: 'active', // Linode账户通常都是active
        plan: '—'
      },
      money: {
        currency: 'USD',
        balance: parseFloat(accountData.balance || '0')
      },
      quotas: [
        {
          key: 'transfer',
          label: '流量池',
          used: transferData.used || 0,
          limit: transferData.quota || 1000
        }
      ],
      resources: {
        instances: instances.length,
        public_ipv4: publicIPv4,
        ipv6_prefixes: ipv6Prefixes
      },
      linode_promo: linodePromo,
      linode_details: linodeDetails,
      meta: {
        last_sync: new Date().toISOString()
      }
    };
  }

  async getInstances(): Promise<CloudInstance[]> {
    const data = await this.makeRequest('/linode/instances');
    
    // 获取镜像信息以显示友好名称
    let images: any[] = [];
    try {
      const imagesData = await this.makeRequest('/images');
      images = imagesData.data;
    } catch (error) {
      console.warn('[Linode] 获取镜像信息失败，将使用默认显示');
    }
    
    return data.data.map((linode: any): CloudInstance => {
      // 判断是否为私网地址的辅助函数
      const isPrivateIP = (ip: string): boolean => {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return false;
        
        // 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
        if (parts[0] === 10) return true;
        
        // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        
        // 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
        if (parts[0] === 192 && parts[1] === 168) return true;
        
        // 127.0.0.0/8 (localhost)
        if (parts[0] === 127) return true;
        
        return false;
      };
      
      // 获取公网IPv4地址（排除私网地址）
      const publicIPv4 = linode.ipv4?.find((ip: string) => !isPrivateIP(ip));
      
      // 获取私网IPv4地址
      const privateIPv4 = linode.ipv4?.find((ip: string) => isPrivateIP(ip));
      
      // 获取IPv6地址 - 只有在实际分配了IPv6时才显示
      const ipv6Address = linode.ipv6 && linode.ipv6 !== '' && linode.ipv6 !== 'fe80::/10' ? linode.ipv6 : undefined;
      
      // 获取友好的镜像名称
      let imageName = linode.image || 'unknown';
      if (images.length > 0 && linode.image) {
        const imageInfo = images.find(img => img.id === linode.image);
        if (imageInfo) {
          imageName = imageInfo.label || imageInfo.id;
        }
      }
      
      return {
        id: linode.id,
        name: linode.label,
        status: linode.status,
        provider: 'linode',
        region: linode.region,
        image: imageName,
        size: linode.type,
        ip_address: publicIPv4,
        ipv6_address: ipv6Address,
        private_ip: privateIPv4,
        vcpus: linode.specs?.vcpus || 0,
        memory: linode.specs?.memory || 0,
        disk: linode.specs?.disk || 0,
        created_at: this.formatLinodeTime(linode.created),
        tags: linode.tags || [],
        transfer: {
          quota: linode.specs?.transfer || 1000 // Linode套餐包含的流量配额
          // 注意：实例级别的流量使用数据不准确，请在Linode控制台查看账户级别的流量池使用情况
        }
      };
    });
  }

  async createInstance(config: CreateInstanceConfig): Promise<CloudInstance> {
    const payload: any = {
      label: config.name,
      region: config.region,
      type: config.size,
      image: config.image,
      authorized_keys: config.ssh_keys || [],
      tags: config.tags || [],
      root_pass: this.extractRootPassword(config.user_data)
    };
    
    // 如果启用IPv6，配置网络接口以确保IPv6支持
    if (config.enableIPv6) {
      payload.interfaces = [
        {
          purpose: 'public',
          ipam_address: null, // 让系统自动分配公网IPv4
          ipv4: {
            vpc: null
          }
        }
      ];
      payload.private_ip = false; // 确保获得公网IP
    }

    const data = await this.makeRequest('/linode/instances', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const linode = data;
    
    // Linode默认分配IPv6地址，但创建时可能还没有立即可用
    const ipv6Address = config.enableIPv6 ? '分配中...' : undefined;
    
    return {
      id: linode.id,
      name: linode.label,
      status: linode.status,
      provider: 'linode',
      region: linode.region,
      image: linode.image || 'unknown',
      size: linode.type,
      ip_address: undefined, // 新创建的实例暂时没有 IP
      ipv6_address: ipv6Address,
      private_ip: undefined,
      vcpus: linode.specs.vcpus,
      memory: linode.specs.memory,
      disk: linode.specs.disk,
      created_at: this.formatLinodeTime(linode.created),
      tags: linode.tags || [],
      transfer: {
        quota: linode.specs.transfer || 1000
        // 注意：实例级别不显示使用量，请查看账户级别的流量池
      }
    };
  }

  async deleteInstance(instanceId: string): Promise<boolean> {
    await this.makeRequest(`/linode/instances/${instanceId}`, {
      method: 'DELETE'
    });
    return true;
  }

  async performInstanceAction(instanceId: string, action: string): Promise<boolean> {
    const actionMap: { [key: string]: string } = {
      'power_on': 'boot',
      'power_off': 'shutdown',
      'reboot': 'reboot',
      'shutdown': 'shutdown'
    };

    const linodeAction = actionMap[action];
    if (!linodeAction) {
      throw new CloudProviderError(`不支持的操作: ${action}`, 'linode', 400);
    }

    await this.makeRequest(`/linode/instances/${instanceId}/${linodeAction}`, {
      method: 'POST'
    });

    return true;
  }

  async getRegions(): Promise<CloudRegion[]> {
    const data = await this.makeRequest('/regions');
    
    return data.data.map((region: any): CloudRegion => ({
      slug: region.id,
      name: `${region.label} (${region.country})`,
      available: region.status === 'ok'
    }));
  }

  async getImages(): Promise<CloudImage[]> {
    const data = await this.makeRequest('/images');
    
    return data.data
      .filter((image: any) => image.is_public && image.status === 'available')
      .map((image: any): CloudImage => ({
        id: image.id,
        name: image.label,
        distribution: image.vendor
      }));
  }

  async getPlans(): Promise<CloudPlan[]> {
    const data = await this.makeRequest('/linode/types');
    
    return data.data
      .filter((type: any) => type.class === 'standard' || type.class === 'nanode')
      .map((type: any): CloudPlan => ({
        slug: type.id,
        description: type.label,
        memory: type.memory,
        vcpus: type.vcpus,
        disk: type.disk,
        price_monthly: type.price.monthly,
        price_hourly: type.price.hourly
      }));
  }

  async changeInstanceIP(instanceId: string, ipVersion: 'IPv4' | 'IPv6' = 'IPv4'): Promise<string> {
    console.log(`[Linode] 开始更换实例IP: ${instanceId}, 版本: ${ipVersion}`);
    
    try {
      if (ipVersion === 'IPv4') {
        return await this.changeIPv4(instanceId);
      } else {
        return await this.changeIPv6(instanceId);
      }
    } catch (error) {
      console.error(`[Linode] 更换IP失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async changeIPv4(instanceId: string): Promise<string> {
    try {
      // 1. 获取账户的可用IPv4地址
      console.log(`[Linode] 检查账户可用IPv4资源`);
      const availableIPs = await this.makeRequest('/networking/ips');
      
      // 2. 查找未分配的IPv4地址
      const unassignedIPv4 = availableIPs.data.find((ip: any) => 
        ip.type === 'ipv4' && 
        ip.public === true && 
        ip.linode_id === null
      );
      
      if (!unassignedIPv4) {
        // 没有可用的IPv4地址，提供友好的错误提示
        throw new CloudProviderError(
          'Linode账户暂无可用的额外IPv4地址。' +
          '请通过Support Ticket申请新的IPv4地址（通常费用为$1/月/IP，需要提供使用说明）。' +
          '申请地址：https://cloud.linode.com/support/tickets',
          'linode', 
          400
        );
      }
      
      // 3. 获取当前Linode实例信息
      const linode = await this.makeRequest(`/linode/instances/${instanceId}`);
      const currentIPv4 = linode.ipv4.find((ip: string) => !ip.startsWith('192.168.'));
      
      console.log(`[Linode] 找到可用IPv4地址: ${unassignedIPv4.address}`);
      
      // 4. 将可用IP分配给Linode实例
      await this.makeRequest('/networking/ipv4/assign', {
        method: 'POST',
        body: JSON.stringify({
          region: linode.region,
          assignments: [
            {
              address: unassignedIPv4.address,
              linode_id: parseInt(instanceId)
            }
          ]
        })
      });
      
      console.log(`[Linode] IPv4地址分配成功: ${unassignedIPv4.address}`);
      
      // 5. 如果有旧的额外IPv4，释放回池中
      if (currentIPv4 && currentIPv4 !== linode.ipv4[0]) { // 不是默认IP
        try {
          await this.makeRequest('/networking/ipv4/assign', {
            method: 'POST',
            body: JSON.stringify({
              region: linode.region,
              assignments: [
                {
                  address: currentIPv4,
                  linode_id: null // 释放回池中
                }
              ]
            })
          });
          console.log(`[Linode] 旧IPv4地址已释放回池: ${currentIPv4}`);
        } catch (error) {
          console.warn(`[Linode] 释放旧IPv4失败: ${currentIPv4}`, error);
        }
      }
      
      // 6. 重启Linode以应用网络配置
      console.log(`[Linode] 重启实例以应用网络配置`);
      await this.makeRequest(`/linode/instances/${instanceId}/reboot`, { method: 'POST' });
      
      console.log(`[Linode] IPv4更换成功: ${instanceId} -> ${unassignedIPv4.address}`);
      return unassignedIPv4.address;
      
    } catch (error) {
      console.error(`[Linode] IPv4更换失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async changeIPv6(instanceId: string): Promise<string> {
    try {
      console.log(`[Linode] 开始为实例附加IPv6: ${instanceId}`);
      
      // 1. 获取当前Linode实例信息
      const linode = await this.makeRequest(`/linode/instances/${instanceId}`);
      console.log(`[Linode] 实例当前IPv6状态: ${linode.ipv6 || 'none'}`);
      
      // 2. 检查是否已有IPv6
      if (linode.ipv6 && linode.ipv6 !== '' && linode.ipv6 !== 'fe80::/10') {
        throw new CloudProviderError('Linode实例已有IPv6地址，不支持更换已有的IPv6地址', 'linode', 400);
      }
      
      // 3. Linode实例默认支持IPv6，尝试重新配置网络以获得IPv6地址
      console.log(`[Linode] 尝试为实例配置IPv6网络`);
      
      try {
        // 首先尝试检查账户是否有IPv6池资源
        let hasIPv6Pool = false;
        try {
          const availableIPv6 = await this.makeRequest('/networking/ipv6/pools');
          hasIPv6Pool = availableIPv6.data && availableIPv6.data.length > 0;
          if (hasIPv6Pool) {
            console.log(`[Linode] 账户有${availableIPv6.data.length}个IPv6池可用`);
          }
        } catch (poolError) {
          console.log(`[Linode] 无法获取IPv6池信息，将尝试SLAAC配置`);
        }
        
        // 重启实例以触发IPv6配置
        console.log(`[Linode] 重启实例以触发IPv6配置`);
        await this.makeRequest(`/linode/instances/${instanceId}/reboot`, { method: 'POST' });
        
        // 等待重启完成
        console.log(`[Linode] 等待实例重启完成...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // 重试获取IPv6地址，最多尝试3次
        let ipv6Address: string | undefined;
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log(`[Linode] 尝试获取IPv6地址 (第${attempt}次)`);
          
          const updatedLinode = await this.makeRequest(`/linode/instances/${instanceId}`);
          if (updatedLinode.ipv6 && updatedLinode.ipv6 !== '' && updatedLinode.ipv6 !== 'fe80::/10') {
            ipv6Address = updatedLinode.ipv6;
            console.log(`[Linode] IPv6配置成功: ${instanceId} -> ${ipv6Address}`);
            break;
          }
          
          if (attempt < 3) {
            console.log(`[Linode] 第${attempt}次未获取到IPv6地址，等待15秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 15000));
          }
        }
        
        if (!ipv6Address) {
          throw new CloudProviderError(
            'IPv6配置失败。' +
            (hasIPv6Pool ? 
              '请在Linode控制台手动配置IPv6路由，或联系支持获取帮助。' : 
              '该账户可能没有IPv6资源。请在Linode控制台申请IPv6 routed range，或通过Support Ticket申请。') +
            '申请地址：https://cloud.linode.com/support/tickets',
            'linode',
            500
          );
        }
        
        return ipv6Address;
        
      } catch (configError) {
        console.error(`[Linode] IPv6配置过程失败:`, configError);
        
        // 如果是我们抛出的CloudProviderError，直接重新抛出
        if (configError instanceof CloudProviderError) {
          throw configError;
        }
        
        // 其他错误，包装成友好的错误信息
        throw new CloudProviderError(
          'Linode IPv6配置失败。可能的原因：' +
          '1. 账户没有IPv6资源配额；' +
          '2. 数据中心不支持IPv6；' +
          '3. 网络配置需要手动设置。' +
          '请在Linode控制台检查网络配置或联系支持。' +
          '申请地址：https://cloud.linode.com/support/tickets',
          'linode',
          500
        );
      }
      
    } catch (error) {
      console.error(`[Linode] IPv6操作失败: ${instanceId}`, error);
      throw error;
    }
  }
}

/**
 * Azure API 集成
 */
export class AzureProvider implements CloudProviderAPI {
  private readonly baseUrl = 'https://management.azure.com';
  private subscriptionId: string;
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  
  // 简单的内存缓存
  private cache = new Map<string, { data: any; expiry: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟
  private tokenExpiry: number = 0;
  
  constructor(apiKey: string) {
    // Azure API Key格式支持两种:
    // 1. subscriptionId:tenantId:clientId:clientSecret (完整格式)
    // 2. tenantId:clientId:clientSecret (无订阅ID，将自动获取)
    const parts = apiKey.split(':');
    if (parts.length === 4) {
      // 完整格式：包含订阅ID
      [this.subscriptionId, this.tenantId, this.clientId, this.clientSecret] = parts;
    } else if (parts.length === 3) {
      // 简化格式：不包含订阅ID，将在认证后自动获取
      [this.tenantId, this.clientId, this.clientSecret] = parts;
      this.subscriptionId = ''; // 将在首次API调用时自动获取
    } else {
      throw new CloudProviderError('Azure API密钥格式无效，应为: tenantId:clientId:clientSecret 或 subscriptionId:tenantId:clientId:clientSecret', 'azure', 400);
    }
  }

  // 缓存辅助方法
  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + this.CACHE_TTL
    });
  }

  private async getAccessToken(): Promise<string> {
    // 如果token还有效，直接返回
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/token`;
    const formData = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      resource: 'https://management.azure.com/'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!response.ok) {
      throw new CloudProviderError(`Azure认证失败: ${response.status}`, 'azure', response.status);
    }

    const tokenData = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = tokenData.access_token;
    // 提前5分钟过期以避免边界问题
    this.tokenExpiry = Date.now() + (tokenData.expires_in - 300) * 1000;
    
    return this.accessToken!; // 此时accessToken已确保不为null
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.getAccessToken();
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // 尝试解析错误信息以提供更友好的中文提示
      let friendlyMessage = `Azure API请求失败: ${response.status} - ${errorText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        const errorCode = errorData.error?.code;
        const errorMessage = errorData.error?.message;
        
        // 针对常见错误提供友好的中文提示
        if (errorCode === 'PublicIPCountLimitReached') {
          friendlyMessage = `公网IP配额已满。Azure学生订阅在此区域最多只能创建3个公网IP地址。请删除未使用的公网IP或选择其他区域创建实例。`;
        } else if (errorCode === 'RequestDisallowedByAzure') {
          friendlyMessage = `区域访问受限。Azure学生订阅通常只允许在特定区域创建资源。请尝试其他区域或联系Azure支持。`;
        } else if (errorCode === 'QuotaExceeded') {
          friendlyMessage = `配额已超限。请检查您的Azure订阅配额限制，或尝试选择其他区域。`;
        } else if (errorCode === 'SkuNotAvailable') {
          friendlyMessage = `所选配置在此区域不可用。请选择其他配置或区域。`;
        } else if (errorMessage) {
          friendlyMessage = `Azure API错误: ${errorMessage}`;
        }
      } catch (parseError) {
        // 如果无法解析JSON，使用原始错误信息
      }
      
      throw new CloudProviderError(friendlyMessage, 'azure', response.status);
    }

    // 检查响应是否有内容
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    // 如果没有内容或者是204状态码，返回空对象
    if (response.status === 204 || contentLength === '0' || 
        (!contentType || !contentType.includes('application/json'))) {
      return {};
    }

    // 尝试解析JSON，如果失败则返回空对象
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      console.warn(`Azure API响应JSON解析失败: ${endpoint}`, error);
      return {};
    }
  }

  // 自动获取默认订阅ID
  private async getDefaultSubscriptionId(): Promise<string> {
    try {
      const subscriptions = await this.makeRequest('/subscriptions?api-version=2020-01-01');
      const subscriptionList = subscriptions.value || [];
      
      if (subscriptionList.length === 0) {
        throw new CloudProviderError('未找到可用的Azure订阅', 'azure', 404);
      }
      
      // 优先选择状态为Enabled的订阅
      const activeSubscription = subscriptionList.find((sub: any) => sub.state === 'Enabled') || subscriptionList[0];
      
      console.log(`自动选择Azure订阅: ${activeSubscription.displayName} (${activeSubscription.subscriptionId})`);
      return activeSubscription.subscriptionId;
    } catch (error) {
      throw new CloudProviderError(`获取Azure订阅列表失败: ${error instanceof Error ? error.message : '未知错误'}`, 'azure', 500);
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    // 如果没有订阅ID，自动获取
    if (!this.subscriptionId) {
      this.subscriptionId = await this.getDefaultSubscriptionId();
    }
    
    const data = await this.makeRequest(`/subscriptions/${this.subscriptionId}?api-version=2020-01-01`);
    return {
      email: data.subscriptionPolicies?.quotaId || 'N/A',
      name: data.displayName || 'Azure订阅',
      uuid: data.subscriptionId,
      status: data.state || 'active'
    };
  }

  async getBalance(): Promise<BalanceInfo> {
    // Azure没有直接的余额API，返回默认值
    return {
      balance: 0,
      currency: 'USD'
    };
  }

  async getAccountOverview(): Promise<UnifiedAccountOverview> {
    try {
      // 并行获取基础数据
      const [subscriptionData, vmsData] = await Promise.all([
        this.makeRequest(`/subscriptions/${this.subscriptionId}?api-version=2020-01-01`),
        this.makeRequest(`/subscriptions/${this.subscriptionId}/resources?$filter=resourceType eq 'Microsoft.Compute/virtualMachines'&api-version=2021-04-01`).catch(() => ({ value: [] }))
      ]);

      const vms = vmsData.value || [];

      // 尝试获取配额信息（选择一个常用区域）
      const focusRegion = 'japaneast'; // 或者根据用户的VM分布动态选择
      let quotas: Array<{ key: string; label: string; used: number; limit: number }> = [];

      try {
        const [computeUsages, networkUsages] = await Promise.all([
          this.makeRequest(`/subscriptions/${this.subscriptionId}/providers/Microsoft.Compute/locations/${focusRegion}/usages?api-version=2023-03-01`).catch(() => ({ value: [] })),
          this.makeRequest(`/subscriptions/${this.subscriptionId}/providers/Microsoft.Network/locations/${focusRegion}/usages?api-version=2023-05-01`).catch(() => ({ value: [] }))
        ]);

        // 解析vCPU配额
        const vcpuUsage = computeUsages.value?.find((usage: any) => 
          usage.name?.value === 'cores' || usage.name?.localizedValue?.includes('vCPU')
        );
        if (vcpuUsage) {
          quotas.push({
            key: 'vcpus',
            label: 'vCPU',
            used: vcpuUsage.currentValue || 0,
            limit: vcpuUsage.limit || 0
          });
        }

        // 解析公网IP配额
        const publicIPUsage = networkUsages.value?.find((usage: any) => 
          usage.name?.value === 'PublicIPAddresses' || usage.name?.localizedValue?.includes('Public IP')
        );
        if (publicIPUsage) {
          quotas.push({
            key: 'public_ip',
            label: '公网IP',
            used: publicIPUsage.currentValue || 0,
            limit: publicIPUsage.limit || 0
          });
        }
      } catch (quotaError) {
        console.log('[Azure] 获取配额信息失败，跳过:', quotaError);
        // 配额获取失败时继续，不影响其他信息
      }

      // 检测订阅类型
      let plan = '—';
      const offerType = subscriptionData.subscriptionPolicies?.quotaId;
      if (offerType?.includes('AzureForStudents') || subscriptionData.displayName?.includes('Student')) {
        plan = 'Azure for Students';
      } else if (offerType?.includes('PAYG') || subscriptionData.displayName?.includes('Pay-As-You-Go')) {
        plan = 'PAYG';
      }

      return {
        provider: 'azure',
        account: {
          name: subscriptionData.displayName || 'Azure订阅',
          email: undefined, // Azure订阅信息中通常不包含邮箱
          status: subscriptionData.state === 'Enabled' ? 'active' : 'inactive',
          plan: plan
        },
        money: {
          currency: 'USD',
          balance: 0, // Azure余额信息需要特殊权限，通常获取不到
          credits_remaining: undefined // 学生/赞助信用也需要特殊权限
        },
        quotas: quotas,
        resources: {
          instances: vms.length
        },
        meta: {
          region_focus: focusRegion,
          last_sync: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('[Azure] 获取账户概览失败:', error);
      // 返回基础信息，避免完全失败
      return {
        provider: 'azure',
        account: {
          name: 'Azure订阅',
          status: 'active',
          plan: '—'
        },
        money: {
          currency: 'USD',
          balance: 0
        },
        quotas: [],
        resources: {
          instances: 0
        },
        meta: {
          last_sync: new Date().toISOString()
        }
      };
    }
  }

  async getInstances(): Promise<CloudInstance[]> {
    const data = await this.makeRequest(
      `/subscriptions/${this.subscriptionId}/providers/Microsoft.Compute/virtualMachines?api-version=2023-03-01`
    );
    
    const instances: CloudInstance[] = [];
    
    for (const vm of data.value || []) {
      // 获取实例视图以获取状态信息
      const instanceView = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${vm.id.split('/')[4]}/providers/Microsoft.Compute/virtualMachines/${vm.name}/instanceView?api-version=2023-03-01`
      );
      
      const powerState = instanceView.statuses?.find((s: any) => s.code.startsWith('PowerState/'))?.code || 'PowerState/unknown';
      const status = powerState.replace('PowerState/', '');
      
      // 获取公网IP地址
      let publicIpAddress: string | undefined = undefined;
      let publicIpv6Address: string | undefined = undefined;
      let privateIpAddress: string | undefined = undefined;
      
      try {
        // 获取网络接口信息
        const resourceGroupName = vm.id.split('/')[4];
        const networkInterfaces = vm.properties.networkProfile?.networkInterfaces || [];
        
        for (const nicRef of networkInterfaces) {
          const nicName = nicRef.id.split('/').pop();
          const nicData = await this.makeRequest(
            `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
          );
          
          // 遍历所有IP配置
          const ipConfigurations = nicData.properties.ipConfigurations || [];
          for (const ipConfig of ipConfigurations) {
            // 获取私有IP (IPv4)
            if (ipConfig.properties?.privateIPAddress && ipConfig.properties?.privateIPAddressVersion === 'IPv4') {
              privateIpAddress = ipConfig.properties.privateIPAddress;
            }
            
            // 获取公网IP
            if (ipConfig.properties?.publicIPAddress?.id) {
              const publicIpName = ipConfig.properties.publicIPAddress.id.split('/').pop();
              const publicIpData = await this.makeRequest(
                `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}?api-version=2023-05-01`
              );
              
              if (publicIpData.properties?.ipAddress) {
                if (publicIpData.properties.publicIPAddressVersion === 'IPv6') {
                  publicIpv6Address = publicIpData.properties.ipAddress;
                } else {
                  publicIpAddress = publicIpData.properties.ipAddress;
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`获取VM ${vm.name} 的IP地址失败:`, error);
      }
      
      // 获取磁盘大小
      let diskSize = 64; // 默认值
      try {
        const osDisk = vm.properties.storageProfile?.osDisk;
        if (osDisk?.diskSizeGB) {
          diskSize = osDisk.diskSizeGB;
        }
      } catch (error) {
        console.error(`获取VM ${vm.name} 的磁盘大小失败:`, error);
      }
      
      instances.push({
        id: vm.name,
        name: vm.name,
        status: status === 'running' ? 'running' : status === 'stopped' ? 'stopped' : 'unknown',
        provider: 'azure',
        region: vm.location,
        image: vm.properties.storageProfile?.imageReference?.offer || 'Unknown',
        size: vm.properties.hardwareProfile?.vmSize || 'Unknown',
        ip_address: publicIpAddress,
        ipv6_address: publicIpv6Address,
        private_ip: privateIpAddress,
        vcpus: this.getVCpusFromVmSize(vm.properties.hardwareProfile?.vmSize),
        memory: this.getMemoryFromVmSize(vm.properties.hardwareProfile?.vmSize),
        disk: diskSize,
        created_at: vm.properties.timeCreated || new Date().toISOString(),
        tags: vm.tags ? Object.keys(vm.tags).map(key => `${key}:${vm.tags[key]}`) : []
      });
    }
    
    return instances;
  }

  private getVCpusFromVmSize(vmSize?: string): number {
    if (!vmSize) return 1;
    
    // 完整的VM大小到vCPU映射
    const sizeMap: { [key: string]: number } = {
      // B系列（可突发性能）
      'Standard_B1s': 1,
      'Standard_B1ms': 1,
      'Standard_B1ls': 1,     // B1ls系列
      'Standard_B2s': 2,
      'Standard_B2ms': 2,
      'Standard_B4ms': 4,
      'Standard_B8ms': 8,
      'Standard_B12ms': 12,
      'Standard_B16ms': 16,
      'Standard_B20ms': 20,
      
      // B系列新版本（v2）
      'Standard_B1ats_v2': 1,
      'Standard_B1s_v2': 1,
      'Standard_B2ats_v2': 2,  // 2 vCPU, 1GB RAM
      'Standard_B2pts_v2': 2,  // 2 vCPU, 1GB RAM
      'Standard_B2s_v2': 2,
      'Standard_B4ats_v2': 4,
      'Standard_B4pts_v2': 4,
      'Standard_B4s_v2': 4,
      
      // D系列（通用计算）
      'Standard_D1_v2': 1,
      'Standard_D2_v2': 2,
      'Standard_D3_v2': 4,
      'Standard_D4_v2': 8,
      'Standard_D5_v2': 16,
      'Standard_D2s_v3': 2,
      'Standard_D4s_v3': 4,
      'Standard_D8s_v3': 8,
      'Standard_D16s_v3': 16,
      'Standard_D32s_v3': 32,
      'Standard_D48s_v3': 48,
      'Standard_D64s_v3': 64,
      
      // F系列（计算优化）
      'Standard_F1': 1,
      'Standard_F2': 2,
      'Standard_F4': 4,
      'Standard_F8': 8,
      'Standard_F16': 16,
      'Standard_F1s': 1,
      'Standard_F2s': 2,
      'Standard_F4s': 4,
      'Standard_F8s': 8,
      'Standard_F16s': 16,
      
      // A系列（基础）
      'Standard_A1': 1,
      'Standard_A2': 2,
      'Standard_A3': 4,
      'Standard_A4': 8,
      'Standard_A1_v2': 1,
      'Standard_A2_v2': 2,
      'Standard_A4_v2': 4,
      'Standard_A8_v2': 8,
      
      // E系列（内存优化）
      'Standard_E2s_v3': 2,
      'Standard_E4s_v3': 4,
      'Standard_E8s_v3': 8,
      'Standard_E16s_v3': 16,
      'Standard_E32s_v3': 32,
      'Standard_E48s_v3': 48,
      'Standard_E64s_v3': 64,
    };
    
    // 如果在映射表中找到，直接返回
    if (sizeMap[vmSize]) {
      return sizeMap[vmSize];
    }
    
    // 智能解析：从VM名称推断CPU数量
    // 例如：Standard_B2s → 2, Standard_D4s_v3 → 4, Standard_B2ats_v2 → 2
    let match = vmSize.match(/Standard_[A-Z](\d+)[a-z]*(_v\d+)?$/i);
    if (!match) {
      // 尝试匹配新格式：Standard_B2ats_v2, Standard_B4pts_v2等
      match = vmSize.match(/Standard_[A-Z](\d+)[a-z]+(_v\d+)?$/i);
    }
    if (match && match[1]) {
      const cpuCount = parseInt(match[1], 10);
      console.log(`[Azure] 智能解析VM规格 ${vmSize} → ${cpuCount} vCPUs`);
      return cpuCount;
    }
    
    console.warn(`[Azure] 未知的VM规格: ${vmSize}，使用默认值 1 vCPU`);
    return 1;
  }

  private getMemoryFromVmSize(vmSize?: string): number {
    if (!vmSize) return 1024;
    
    // 完整的VM大小到内存映射 (MB)
    const sizeMap: { [key: string]: number } = {
      // B系列（可突发性能）
      'Standard_B1s': 1024,      // 1GB
      'Standard_B1ms': 2048,     // 2GB
      'Standard_B1ls': 512,      // 0.5GB
      'Standard_B2s': 4096,      // 4GB
      'Standard_B2ms': 8192,     // 8GB
      'Standard_B4ms': 16384,    // 16GB
      'Standard_B8ms': 32768,    // 32GB
      'Standard_B12ms': 49152,   // 48GB
      'Standard_B16ms': 65536,   // 64GB
      'Standard_B20ms': 81920,   // 80GB
      
      // B系列新版本（v2）- 特殊的低内存配置
      'Standard_B1ats_v2': 1024, // 1GB
      'Standard_B1s_v2': 1024,   // 1GB
      'Standard_B2ats_v2': 1024, // 1GB (2 vCPU, 1GB RAM)
      'Standard_B2pts_v2': 1024, // 1GB (2 vCPU, 1GB RAM)
      'Standard_B2s_v2': 4096,   // 4GB
      'Standard_B4ats_v2': 2048, // 2GB
      'Standard_B4pts_v2': 2048, // 2GB
      'Standard_B4s_v2': 16384,  // 16GB
      
      // D系列（通用计算）
      'Standard_D1_v2': 3584,    // 3.5GB
      'Standard_D2_v2': 7168,    // 7GB
      'Standard_D3_v2': 14336,   // 14GB
      'Standard_D4_v2': 28672,   // 28GB
      'Standard_D5_v2': 57344,   // 56GB
      'Standard_D2s_v3': 8192,   // 8GB
      'Standard_D4s_v3': 16384,  // 16GB
      'Standard_D8s_v3': 32768,  // 32GB
      'Standard_D16s_v3': 65536, // 64GB
      'Standard_D32s_v3': 131072, // 128GB
      'Standard_D48s_v3': 196608, // 192GB
      'Standard_D64s_v3': 262144, // 256GB
      
      // F系列（计算优化）
      'Standard_F1': 2048,       // 2GB
      'Standard_F2': 4096,       // 4GB
      'Standard_F4': 8192,       // 8GB
      'Standard_F8': 16384,      // 16GB
      'Standard_F16': 32768,     // 32GB
      'Standard_F1s': 2048,      // 2GB
      'Standard_F2s': 4096,      // 4GB
      'Standard_F4s': 8192,      // 8GB
      'Standard_F8s': 16384,     // 16GB
      'Standard_F16s': 32768,    // 32GB
      
      // A系列（基础）
      'Standard_A1': 1792,       // 1.75GB
      'Standard_A2': 3584,       // 3.5GB
      'Standard_A3': 7168,       // 7GB
      'Standard_A4': 14336,      // 14GB
      'Standard_A1_v2': 2048,    // 2GB
      'Standard_A2_v2': 4096,    // 4GB
      'Standard_A4_v2': 8192,    // 8GB
      'Standard_A8_v2': 16384,   // 16GB
      
      // E系列（内存优化）
      'Standard_E2s_v3': 16384,  // 16GB
      'Standard_E4s_v3': 32768,  // 32GB
      'Standard_E8s_v3': 65536,  // 64GB
      'Standard_E16s_v3': 131072, // 128GB
      'Standard_E32s_v3': 262144, // 256GB
      'Standard_E48s_v3': 393216, // 384GB
      'Standard_E64s_v3': 442368, // 432GB
    };
    
    // 如果在映射表中找到，直接返回
    if (sizeMap[vmSize]) {
      return sizeMap[vmSize];
    }
    
    // 智能解析：根据VM系列和CPU数量估算内存
    // B系列：每个vCPU约2-4GB内存
    // D系列：每个vCPU约4-8GB内存
    // F系列：每个vCPU约2GB内存（计算优化）
    // E系列：每个vCPU约8-16GB内存（内存优化）
    const cpuCount = this.getVCpusFromVmSize(vmSize);
    let memoryPerCpu = 4096; // 默认每CPU 4GB
    
    if (vmSize.includes('_B')) {
      memoryPerCpu = cpuCount === 1 ? 1024 : 4096; // B1s特殊，其他B系列4GB/CPU
    } else if (vmSize.includes('_F')) {
      memoryPerCpu = 2048; // F系列计算优化，内存较少
    } else if (vmSize.includes('_E')) {
      memoryPerCpu = 8192; // E系列内存优化
    } else if (vmSize.includes('_D')) {
      memoryPerCpu = 4096; // D系列通用
    }
    
    const estimatedMemory = cpuCount * memoryPerCpu;
    console.log(`[Azure] 智能解析VM规格 ${vmSize} → ${estimatedMemory}MB 内存 (${cpuCount} CPU × ${memoryPerCpu}MB)`);
    return estimatedMemory;
  }

  // 检测VM规格的CPU架构
  private getVmArchitecture(vmSize: string): 'x64' | 'arm64' {
    // B*pts_v2 系列是 ARM64 架构
    if (/_?B\d+.*pts_v2$/i.test(vmSize)) {
      return 'arm64';
    }
    // 其他规格默认为 x64 架构
    return 'x64';
  }

  // 自动修正镜像架构兼容性
  private autoFixImageArchitecture(imageId: string, targetArch: 'x64' | 'arm64'): string {
    if (targetArch === 'arm64') {
      // x64 镜像到 ARM64 镜像的映射
      const archMapping: { [key: string]: string } = {
        'Ubuntu_22_04': 'Ubuntu_22_04_arm64',
        'Ubuntu_22_04_gen1': 'Ubuntu_22_04_arm64',
        'Ubuntu_20_04': 'Ubuntu_20_04_arm64', 
        'Ubuntu_20_04_gen1': 'Ubuntu_20_04_arm64',
        'Debian_11': 'Debian_11_arm64',
        'Debian_11_gen1': 'Debian_11_arm64'
      };
      
      // 检查是否有对应的ARM64镜像
      for (const [x64Image, arm64Image] of Object.entries(archMapping)) {
        if (imageId.startsWith(x64Image) && !/arm64/i.test(imageId)) {
          return arm64Image;
        }
      }
    }
    
    return imageId; // 如果无法映射，返回原镜像ID
  }

  // 验证和自动修正架构兼容性
  private validateAndFixArchitectureCompatibility(config: CreateInstanceConfig): CreateInstanceConfig {
    const vmArch = this.getVmArchitecture(config.size);
    const imageArch = /arm64/i.test(config.image) ? 'arm64' : 'x64';
    
    // 如果架构不匹配，尝试自动修正
    if (vmArch !== imageArch) {
      const fixedImage = this.autoFixImageArchitecture(config.image, vmArch);
      
      if (fixedImage !== config.image) {
        console.log(`[Azure] 自动修正镜像架构: ${config.image} → ${fixedImage} (${vmArch})`);
        return { ...config, image: fixedImage };
      }
      
      // 如果无法自动修正，抛出详细错误
      const images = this.getAzureImages();
      const compatibleImages = images
        .filter(img => img.supportedArchitectures?.includes(vmArch))
        .map(img => img.name)
        .slice(0, 3);
      
      let errorMessage = `架构不兼容: VM规格 "${config.size}" 需要 ${vmArch} 架构的镜像，但选择的镜像是 ${imageArch} 架构。\n\n`;
      
      if (compatibleImages.length > 0) {
        errorMessage += `建议使用以下 ${vmArch} 架构的镜像:\n${compatibleImages.map(name => `  - ${name}`).join('\n')}\n\n`;
      }
      
      if (vmArch === 'arm64') {
        errorMessage += `或者选择支持 x64 架构的VM规格，如 Standard_B2ats_v2, Standard_B1s, Standard_B2s 等。`;
      }
      
      throw new CloudProviderError(errorMessage, 'azure', 400);
    }
    
    return config;
  }

  // 验证并调整区域，实现区域回退机制
  private async validateAndAdjustRegion(config: CreateInstanceConfig): Promise<CreateInstanceConfig> {
    const preferredRegions = ['eastus', 'westus2', 'westeurope', 'southeastasia'];
    
    try {
      // 首先尝试用户选择的区域
      await this.validateRegionAvailability(config.region);
      console.log(`[Azure] 区域验证通过: ${config.region}`);
      return config;
    } catch (error) {
      console.warn(`[Azure] 区域 ${config.region} 不可用，尝试回退区域:`, error);
      
      // 尝试回退到推荐区域
      for (const fallbackRegion of preferredRegions) {
        if (fallbackRegion === config.region) continue;
        
        try {
          await this.validateRegionAvailability(fallbackRegion);
          console.log(`[Azure] 使用回退区域: ${fallbackRegion}`);
          return { ...config, region: fallbackRegion };
        } catch (fallbackError) {
          console.warn(`[Azure] 回退区域 ${fallbackRegion} 也不可用:`, fallbackError);
        }
      }
      
      // 如果所有回退区域都失败，抛出详细错误
      throw new CloudProviderError(
        `所选区域 "${config.region}" 不可用，且所有推荐的回退区域也不可用。请联系Azure支持或选择其他区域。`,
        'azure',
        400
      );
    }
  }

  // 验证区域可用性
  private async validateRegionAvailability(region: string): Promise<void> {
    try {
      // 尝试在该区域创建一个测试资源组名称（不实际创建）
      const testRgName = `test-availability-${Date.now()}`;
      
      // 检查区域是否在订阅的可用区域列表中
      const locations = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/locations?api-version=2022-12-01`
      );
      
      const availableRegion = locations.value.find((loc: any) => 
        loc.name === region && loc.metadata?.regionCategory === 'Recommended'
      );
      
      if (!availableRegion) {
        throw new CloudProviderError(`区域 ${region} 在当前订阅中不可用`, 'azure', 400);
      }
      
      console.log(`[Azure] 区域 ${region} 验证成功`);
    } catch (error) {
      if (error instanceof CloudProviderError) {
        throw error;
      }
      throw new CloudProviderError(`验证区域 ${region} 失败: ${error}`, 'azure', 500);
    }
  }

  async createInstance(config: CreateInstanceConfig): Promise<CloudInstance> {
    // 生成唯一的资源名称，避免冲突
    const timestamp = Date.now();
    const uniqueSuffix = `${timestamp.toString().slice(-6)}`;
    const resourceGroupName = `cloudpanel-${config.name}-${uniqueSuffix}`;
    const vnetName = `${config.name}-vnet-${uniqueSuffix}`;
    const subnetName = `${config.name}-subnet-${uniqueSuffix}`;
    const nicName = `${config.name}-nic-${uniqueSuffix}`;
    const publicIpName = `${config.name}-ip-${uniqueSuffix}`;
    const publicIpv6Name = `${config.name}-ipv6-${uniqueSuffix}`;
    const nsgName = `${config.name}-nsg-${uniqueSuffix}`;

    // 验证并可能调整区域
    const validatedConfig = await this.validateAndAdjustRegion(config);
    
    try {
      // 自动验证和修正架构兼容性
      const finalConfig = this.validateAndFixArchitectureCompatibility(validatedConfig);
      
      console.log(`[Azure] 开始创建实例: ${finalConfig.name} 在区域: ${finalConfig.region}`);
      
      // 1. 创建资源组
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2021-04-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: finalConfig.region
          })
        }
      );

      // 2. 创建网络安全组（开放全端口全协议 - 仅用于测试开发）
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: finalConfig.region,
            properties: {
              securityRules: [
                {
                  name: 'AllowAllInbound',
                  properties: {
                    description: '允许所有入站流量 - 仅用于测试开发环境',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '*',
                    destinationAddressPrefix: '*',
                    access: 'Allow',
                    priority: 100,
                    direction: 'Inbound'
                  }
                },
                {
                  name: 'AllowAllOutbound',
                  properties: {
                    description: '允许所有出站流量',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '*',
                    destinationAddressPrefix: '*',
                    access: 'Allow',
                    priority: 110,
                    direction: 'Outbound'
                  }
                },
                {
                  name: 'AllowAllInboundIPv6',
                  properties: {
                    description: '允许所有IPv6入站流量 - 仅用于测试开发环境',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '::/0',
                    destinationAddressPrefix: '::/0',
                    access: 'Allow',
                    priority: 120,
                    direction: 'Inbound'
                  }
                },
                {
                  name: 'AllowAllOutboundIPv6',
                  properties: {
                    description: '允许所有IPv6出站流量',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '::/0',
                    destinationAddressPrefix: '::/0',
                    access: 'Allow',
                    priority: 130,
                    direction: 'Outbound'
                  }
                }
              ]
            }
          })
        }
      );

      // 3. 创建公共IP地址（IPv4，使用Standard SKU）
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: finalConfig.region,
            sku: {
              name: 'Standard'
            },
            properties: {
              publicIPAllocationMethod: 'Static',
              publicIPAddressVersion: 'IPv4'
            }
          })
        }
      );
      // 等待 PIP 成功
      await this.waitProvisioningSucceeded(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`
      );

      // 3.1. 创建公共IPv6地址（可选，必须使用Standard SKU）
      if (finalConfig.enableIPv6) {
        await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpv6Name}?api-version=2023-05-01`,
          {
            method: 'PUT',
            body: JSON.stringify({
              location: finalConfig.region,
              sku: {
                name: 'Standard'
              },
                          properties: {
              publicIPAllocationMethod: 'Static', // Standard SKU必须使用Static
              publicIPAddressVersion: 'IPv6'
            }
            })
          }
        );
        // 等待 IPv6 PIP 成功
        await this.waitProvisioningSucceeded(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpv6Name}`
        );
      }

      // 4. 创建虚拟网络（IPv4必需，IPv6可选）
      const addressPrefixes = ['10.0.0.0/16'];
      const subnetAddressPrefixes = ['10.0.0.0/24'];
      
      if (config.enableIPv6) {
        addressPrefixes.push('ace:cab:deca::/48');
        subnetAddressPrefixes.push('ace:cab:deca:deed::/64');
      }
      
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: finalConfig.region,
            properties: {
              addressSpace: {
                addressPrefixes: addressPrefixes
              },
              subnets: [{
                name: subnetName,
                properties: {
                  addressPrefixes: subnetAddressPrefixes,
                  networkSecurityGroup: {
                    id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}`
                  }
                }
              }]
            }
          })
        }
      );
      // 先等 VNet Succeeded
      await this.waitProvisioningSucceeded(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}`
      );
      // 再等 Subnet Succeeded（关键！解决 429 ReferencedResourceNotProvisioned）
      await this.waitSubnetSucceeded(resourceGroupName, vnetName, subnetName);

      // 5. 创建网络接口（IPv4必需，IPv6可选）
      const ipConfigurations = [
        {
                name: 'ipconfig1',
                properties: {
            primary: true,
                  subnet: {
                    id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}`
                  },
                  publicIPAddress: {
                    id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`
                  },
            privateIPAllocationMethod: 'Dynamic',
            privateIPAddressVersion: 'IPv4'
          }
        }
      ];
      
      // 只在启用IPv6时添加IPv6配置
      if (config.enableIPv6) {
        ipConfigurations.push({
          name: 'ipconfig2',
          properties: {
            primary: false,
            subnet: {
              id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}`
            },
            publicIPAddress: {
              id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpv6Name}`
            },
            privateIPAllocationMethod: 'Dynamic',
            privateIPAddressVersion: 'IPv6'
          }
        });
      }
      
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: finalConfig.region,
            properties: {
              ipConfigurations: ipConfigurations
            }
          })
        }
      );
      // 等待 NIC 成功
      await this.waitProvisioningSucceeded(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}`
      );

      // 5. 创建虚拟机
      const vmConfig = {
        location: config.region,
        properties: {
          hardwareProfile: {
            vmSize: finalConfig.size
          },
          storageProfile: {
            imageReference: this.parseImageReference(finalConfig.image),
            osDisk: {
              createOption: 'FromImage',
              diskSizeGB: finalConfig.diskSize || 64,
              managedDisk: {
                storageAccountType: 'Standard_LRS'
              }
            }
          },
          osProfile: {
            computerName: finalConfig.name,
            adminUsername: 'azureuser',
            adminPassword: 'TempPassword123!',
            customData: config.user_data ? this.encodeBase64Unicode(config.user_data) : undefined
          },
          networkProfile: {
            networkInterfaces: [{
              id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}`
            }]
          }
        }
      };

      const data = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${config.name}?api-version=2023-03-01`,
        {
          method: 'PUT',
          body: JSON.stringify(vmConfig)
        }
      );

      // 可选：等待 VM 创建成功（可以给更长超时）
      try {
        await this.waitProvisioningSucceeded(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${config.name}`,
          600000 // VM 可以给更长超时 10分钟
        );
      } catch (error) {
        console.log(`[Azure] VM等待超时，但VM可能仍在后台创建中: ${error}`);
        // 不抛出错误，让用户看到"creating"状态
      }

      // 获取创建的VM信息
      const vm = data;
      
      return {
        id: vm.name || finalConfig.name,
        name: vm.name || finalConfig.name,
        status: 'creating',
        provider: 'azure',
        region: finalConfig.region,
        image: finalConfig.image,
        size: finalConfig.size,
        ip_address: undefined, // Azure VM 创建后需要单独获取 IP
        private_ip: undefined,
        vcpus: this.getVCpusFromVmSize(finalConfig.size),
        memory: this.getMemoryFromVmSize(finalConfig.size),
        disk: finalConfig.diskSize || 64,
        created_at: new Date().toISOString(),
        tags: finalConfig.tags || []
      };
    } catch (error) {
      // 如果创建过程中出现错误，尝试清理已创建的资源
      try {
        await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2021-04-01`,
          { method: 'DELETE' }
        );
      } catch (cleanupError) {
        console.error('清理资源组失败:', cleanupError);
      }
      
      // 优化错误信息显示
      if (error instanceof CloudProviderError && error.message.includes('RequestDisallowedByAzure')) {
        const regionName = this.regionNameMap[validatedConfig.region] || validatedConfig.region;
        throw new CloudProviderError(
          `区域 "${regionName}" 不在您的订阅允许范围内。Azure学生订阅通常只允许在特定区域创建资源。请尝试其他区域或联系Azure支持。`,
          'azure',
          403
        );
      }
      
      throw error;
    }
  }

  async deleteInstance(instanceId: string): Promise<boolean> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    
    console.log(`[Azure] 开始删除实例: ${instanceId}`);
    console.log(`[Azure] 将删除资源组: ${resourceGroupName}`);
    
    try {
      // 检查资源组是否存在
      try {
        await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2021-04-01`
        );
      } catch (error) {
        if (error instanceof CloudProviderError && error.statusCode === 404) {
          console.log(`[Azure] 资源组 ${resourceGroupName} 不存在，可能已被删除`);
          return true;
        }
        throw error;
      }

      // 删除整个资源组（会自动删除其中的所有资源）
      console.log(`[Azure] 删除资源组: ${resourceGroupName}`);
    await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2021-04-01`,
      { method: 'DELETE' }
    );

      console.log(`[Azure] 资源组删除操作已提交: ${resourceGroupName}`);
      console.log(`[Azure] 这将删除以下资源: VM、网络接口、公网IP、NSG、虚拟网络、磁盘等`);

    return true;
    } catch (error) {
      console.error(`[Azure] 删除实例失败: ${instanceId}`, error);
      throw error;
    }
  }

  // 动态查找包含指定VM的资源组
  private async findResourceGroupForInstance(instanceId: string): Promise<string> {
    try {
      console.log(`[Azure] 查找实例 ${instanceId} 的资源组`);
      
      // 获取订阅下所有资源组
      const resourceGroups = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourcegroups?api-version=2021-04-01`
      );
      
      // 遍历资源组，查找包含该VM的资源组
      for (const rg of resourceGroups.value) {
        const rgName = rg.name;
        
        // 跳过不是cloudpanel相关的资源组
        if (!rgName.startsWith('cloudpanel-')) {
          continue;
        }
        
        try {
          // 检查该资源组中是否存在指定的VM
          await this.makeRequest(
            `/subscriptions/${this.subscriptionId}/resourceGroups/${rgName}/providers/Microsoft.Compute/virtualMachines/${instanceId}?api-version=2023-03-01`
          );
          
          console.log(`[Azure] 找到实例 ${instanceId} 的资源组: ${rgName}`);
          return rgName;
        } catch (error) {
          // VM不在这个资源组中，继续查找下一个
          continue;
        }
      }
      
      throw new CloudProviderError(`未找到实例 ${instanceId} 对应的资源组`, 'azure', 404);
    } catch (error) {
      console.error(`[Azure] 查找资源组失败: ${instanceId}`, error);
      throw error;
    }
  }

  // 动态查找指定VM的网络接口名称
  private async findNetworkInterfaceForInstance(instanceId: string): Promise<string> {
    try {
      console.log(`[Azure] 查找实例 ${instanceId} 的网络接口`);
      
      const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
      
      // 获取VM详情以找到网络接口
      const vmResponse = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${instanceId}?api-version=2023-03-01`
      );
      
      const networkInterfaceId = vmResponse.properties.networkProfile.networkInterfaces[0].id;
      const nicName = networkInterfaceId.split('/').pop();
      
      console.log(`[Azure] 找到实例 ${instanceId} 的网络接口: ${nicName}`);
      return nicName;
    } catch (error) {
      console.error(`[Azure] 查找网络接口失败: ${instanceId}`, error);
      throw error;
    }
  }

  // 动态查找指定VM的虚拟网络和子网名称
  private async findVNetAndSubnetForInstance(instanceId: string): Promise<{vnetName: string, subnetName: string}> {
    try {
      console.log(`[Azure] 查找实例 ${instanceId} 的虚拟网络和子网`);
      
      const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
      const nicName = await this.findNetworkInterfaceForInstance(instanceId);
      
      // 获取网络接口详情以找到子网
      const nicResponse = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );
      
      const subnetId = nicResponse.properties.ipConfigurations[0].properties.subnet.id;
      const subnetIdParts = subnetId.split('/');
      const vnetName = subnetIdParts[subnetIdParts.length - 3]; // 虚拟网络名称
      const subnetName = subnetIdParts[subnetIdParts.length - 1]; // 子网名称
      
      console.log(`[Azure] 找到实例 ${instanceId} 的虚拟网络: ${vnetName}, 子网: ${subnetName}`);
      return { vnetName, subnetName };
    } catch (error) {
      console.error(`[Azure] 查找虚拟网络和子网失败: ${instanceId}`, error);
      throw error;
    }
  }

  // 一次性获取实例的所有资源信息，减少API调用
  private async getInstanceResourceInfo(instanceId: string): Promise<{
    resourceGroupName: string,
    nicName: string,
    vnetName: string,
    subnetName: string,
    location: string
  }> {
    try {
      console.log(`[Azure] 获取实例 ${instanceId} 的完整资源信息`);
      
      // 1. 查找资源组
      const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
      
      // 2. 获取VM详情
      const vmResponse = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${instanceId}?api-version=2023-03-01`
      );
      
      const location = vmResponse.location;
      const networkInterfaceId = vmResponse.properties.networkProfile.networkInterfaces[0].id;
      const nicName = networkInterfaceId.split('/').pop();
      
      // 3. 获取网络接口详情
      const nicResponse = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );
      
      const subnetId = nicResponse.properties.ipConfigurations[0].properties.subnet.id;
      const subnetIdParts = subnetId.split('/');
      const vnetName = subnetIdParts[subnetIdParts.length - 3];
      const subnetName = subnetIdParts[subnetIdParts.length - 1];
      
      console.log(`[Azure] 实例资源信息: RG=${resourceGroupName}, NIC=${nicName}, VNet=${vnetName}, Subnet=${subnetName}, Location=${location}`);
      
      return {
        resourceGroupName,
        nicName,
        vnetName,
        subnetName,
        location
      };
    } catch (error) {
      console.error(`[Azure] 获取实例资源信息失败: ${instanceId}`, error);
      throw error;
    }
  }

  // 优化的IP关联方法，使用已获取的资源信息
  private async associateIPToNetworkInterfaceOptimized(
    resourceInfo: {resourceGroupName: string, nicName: string, vnetName: string, subnetName: string, location: string},
    publicIpName: string,
    ipVersion: 'IPv4' | 'IPv6'
  ): Promise<void> {
    const { resourceGroupName, nicName, vnetName, subnetName } = resourceInfo;
    
    try {
      // 1. 如果是IPv6，确保子网支持IPv6
      if (ipVersion === 'IPv6') {
        await this.ensureSubnetSupportsIPv6Optimized(resourceInfo);
      }
      
      // 2. 获取当前网络接口配置
      console.log(`[Azure] 获取网络接口配置: ${nicName}`);
      const nicData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );
      
      // 3. 更新IP配置
      const ipConfigurations = nicData.properties.ipConfigurations || [];
      const targetConfigName = ipVersion === 'IPv6' ? 'ipconfig2' : 'ipconfig1';
      
      // 找到对应的IP配置
      let targetConfig = ipConfigurations.find((config: any) => config.name === targetConfigName);
      
      if (!targetConfig && ipVersion === 'IPv6') {
        // 如果没有IPv6配置，创建新的配置
        targetConfig = {
          name: 'ipconfig2',
          properties: {
            primary: false,
            subnet: ipConfigurations[0]?.properties?.subnet,
            privateIPAllocationMethod: 'Dynamic',
            privateIPAddressVersion: 'IPv6'
          }
        };
        ipConfigurations.push(targetConfig);
      } else if (!targetConfig) {
        throw new CloudProviderError(`找不到IPv4配置: ${targetConfigName}`, 'azure', 404);
      }
      
      // 4. 关联新的公网IP
      targetConfig.properties.publicIPAddress = {
        id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`
      };
      
      // 5. 更新网络接口
      console.log(`[Azure] 更新网络接口配置: ${nicName}`);
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: nicData.location,
            properties: {
              ...nicData.properties,
              ipConfigurations: ipConfigurations
            }
          })
        }
      );
      
      console.log(`[Azure] IP关联成功: ${publicIpName} -> ${nicName}`);
    } catch (error) {
      console.error(`[Azure] 关联IP到网络接口失败: ${nicName}`, error);
      throw error;
    }
  }

  // 优化的子网IPv6支持检查，使用已获取的资源信息
  private async ensureSubnetSupportsIPv6Optimized(
    resourceInfo: {resourceGroupName: string, vnetName: string, subnetName: string}
  ): Promise<void> {
    const { resourceGroupName, vnetName, subnetName } = resourceInfo;
    
    try {
      console.log(`[Azure] 检查子网IPv6支持: ${subnetName}`);
      
      // 获取当前虚拟网络配置
      const vnetData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`
      );
      
      const subnets = vnetData.properties.subnets || [];
      const targetSubnet = subnets.find((subnet: any) => subnet.name === subnetName);
      
      if (!targetSubnet) {
        throw new CloudProviderError(`子网 ${subnetName} 不存在`, 'azure', 404);
      }
      
      // 检查是否已有IPv6支持
      const hasIPv6 = targetSubnet.properties.addressPrefixes?.some((prefix: string) => prefix.includes(':')) ||
                      targetSubnet.properties.addressPrefix?.includes(':');
      
      if (!hasIPv6) {
        console.log(`[Azure] 为子网添加IPv6支持: ${subnetName}`);
        
        // 1. 首先检查虚拟网络是否支持IPv6
        const vnetAddressSpace = vnetData.properties.addressSpace?.addressPrefixes || [];
        const vnetHasIPv6 = vnetAddressSpace.some((prefix: string) => prefix.includes(':'));
        
        if (!vnetHasIPv6) {
          console.log(`[Azure] 为虚拟网络添加IPv6地址空间: ${vnetName}`);
          vnetAddressSpace.push('ace:cab:deca::/48'); // 为VNet添加IPv6地址空间
        }
        
        // 2. 为子网添加IPv6地址前缀
        if (!targetSubnet.properties.addressPrefixes) {
          targetSubnet.properties.addressPrefixes = [targetSubnet.properties.addressPrefix];
        }
        targetSubnet.properties.addressPrefixes.push('ace:cab:deca::/64');
        
        // 3. 更新虚拟网络（包含VNet地址空间和子网配置）
        await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`,
          {
            method: 'PUT',
            body: JSON.stringify(vnetData)
          }
        );
        
        console.log(`[Azure] 虚拟网络和子网IPv6支持添加完成: ${vnetName}/${subnetName}`);
        
        // 等待配置生效
        console.log(`[Azure] 等待IPv6配置生效...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 减少等待时间
      } else {
        console.log(`[Azure] 子网已支持IPv6: ${subnetName}`);
      }
    } catch (error) {
      console.error(`[Azure] 确保子网IPv6支持失败: ${subnetName}`, error);
      throw error;
    }
  }

  async performInstanceAction(instanceId: string, action: string): Promise<boolean> {
    const actionMap: { [key: string]: string } = {
      'power_on': 'start',
      'power_off': 'powerOff',
      'reboot': 'restart'
    };

    const azureAction = actionMap[action];
    if (!azureAction) {
      throw new CloudProviderError(`不支持的操作: ${action}`, 'azure', 400);
    }

    console.log(`[Azure] 执行实例操作: ${instanceId}, 操作: ${action} -> ${azureAction}`);
    
    try {
      // 动态查找资源组
      const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
      
      const apiUrl = `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${instanceId}/${azureAction}?api-version=2023-03-01`;
      console.log(`[Azure] API调用: ${apiUrl}`);
      
      await this.makeRequest(apiUrl, { method: 'POST' });
      
      console.log(`[Azure] 实例操作成功: ${instanceId}, 操作: ${action}`);
      return true;
    } catch (error) {
      console.error(`[Azure] 实例操作失败: ${instanceId}, 操作: ${action}, 错误:`, error);
      throw error;
    }
  }

  async changeInstanceIP(instanceId: string, ipVersion: 'IPv4' | 'IPv6' = 'IPv4'): Promise<string> {
    console.log(`[Azure] 开始更换实例IP: ${instanceId}, 版本: ${ipVersion}`);
    
    // 一次性获取所有需要的资源信息，减少API调用
    const resourceInfo = await this.getInstanceResourceInfo(instanceId);
    const { resourceGroupName, nicName, vnetName, subnetName, location } = resourceInfo;
    
    // 使用带时间戳的唯一名称，避免重用旧IP
    const timestamp = Date.now();
    const newPublicIpName = ipVersion === 'IPv6' ? `${instanceId}-ipv6-${timestamp}` : `${instanceId}-ip-${timestamp}`;
    
    console.log(`[Azure] 新PIP名称: ${newPublicIpName}`);
    
    let oldPipResourceId: string | null = null;
    let hasExistingIPv6 = false;
    
    try {
      // 1. 获取网络接口当前配置，检查是否已有IPv6
      const nicData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );
      
      const ipConfigurations = nicData.properties?.ipConfigurations || [];
      
      // 检查现有IP配置
      for (const config of ipConfigurations) {
        if (ipVersion === 'IPv6' && config.name === 'ipconfig2' && config.properties?.publicIPAddress?.id) {
          oldPipResourceId = config.properties.publicIPAddress.id;
          hasExistingIPv6 = true;
          console.log(`[Azure] 发现现有IPv6: ${oldPipResourceId}`);
          break;
        } else if (ipVersion === 'IPv4' && config.name === 'ipconfig1' && config.properties?.publicIPAddress?.id) {
          oldPipResourceId = config.properties.publicIPAddress.id;
          console.log(`[Azure] 发现现有IPv4: ${oldPipResourceId}`);
          break;
        }
      }
      
      // 2. 检查配额并创建新的公网IP
      await this.ensureCapacityForNewPublicIP(location);
      
      console.log(`[Azure] 创建新的公网IP: ${newPublicIpName}`);
      
      const ipConfig: any = {
        location: location,
        properties: {
          publicIPAllocationMethod: 'Static',
          publicIPAddressVersion: ipVersion
        },
        sku: {
          name: 'Standard'
        }
      };

      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${newPublicIpName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify(ipConfig)
        }
      );
      
      // 3. 轮询等待新IP创建完成
      console.log(`[Azure] 轮询等待新IP创建完成...`);
      const newIP = await this.pollForPublicIP(resourceGroupName, newPublicIpName);
      
      // 4. 关联新IP到网络接口（使用已获取的资源信息）
      console.log(`[Azure] 关联新IP到网络接口...`);
      await this.associateIPToNetworkInterfaceOptimized(resourceInfo, newPublicIpName, ipVersion);
      
      // 5. 只有在新IP成功关联后，才删除旧IP（方案A）
      if (oldPipResourceId && hasExistingIPv6 && ipVersion === 'IPv6') {
        console.log(`[Azure] 删除旧的IPv6: ${oldPipResourceId}`);
        try {
          await this.makeRequest(`${oldPipResourceId}?api-version=2023-05-01`, { method: 'DELETE' });
          console.log(`[Azure] 旧IPv6删除成功`);
        } catch (error) {
          console.warn(`[Azure] 删除旧IPv6失败，但新IPv6已成功关联: ${error}`);
        }
      }
      
      console.log(`[Azure] IP${ipVersion === 'IPv6' ? '附加' : '更换'}成功: ${instanceId} -> ${newIP} (${ipVersion})`);
      return newIP;
      
    } catch (error) {
      console.error(`[Azure] IP${ipVersion === 'IPv6' ? '附加' : '更换'}失败: ${instanceId}`, error);
      throw error;
    }
  }

  private async getInstanceRegion(instanceId: string): Promise<string> {
    try {
      const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
      const vmData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${instanceId}?api-version=2023-03-01`
      );
      return vmData.location || 'eastus';
    } catch (error) {
      console.warn(`[Azure] 获取实例区域失败，使用默认区域: eastus`);
      return 'eastus';
    }
  }

  private async pollForPublicIP(resourceGroupName: string, publicIpName: string, maxAttempts: number = 30): Promise<string> {
    console.log(`[Azure] 开始轮询PIP状态: ${publicIpName}`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const ipData = await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}?api-version=2023-05-01`
        );
        
        const ipAddress = ipData.properties?.ipAddress;
        const provisioningState = ipData.properties?.provisioningState;
        
        console.log(`[Azure] 轮询第${attempt}次: provisioningState=${provisioningState}, ipAddress=${ipAddress || 'null'}`);
        
        if (provisioningState === 'Succeeded' && ipAddress) {
          console.log(`[Azure] PIP创建成功，获得IP地址: ${ipAddress}`);
          return ipAddress;
        }
        
        if (provisioningState === 'Failed') {
          throw new CloudProviderError(`PIP创建失败: ${publicIpName}`, 'azure', 500);
        }
        
        // 等待3秒后重试
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (error: any) {
        if (attempt === maxAttempts) {
          throw new CloudProviderError(`轮询PIP状态超时: ${publicIpName}`, 'azure', 500);
        }
        console.log(`[Azure] 轮询第${attempt}次失败，3秒后重试: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    throw new CloudProviderError(`轮询PIP状态超时: ${publicIpName}`, 'azure', 500);
  }

  private async associateIPToNetworkInterface(instanceId: string, publicIpName: string, ipVersion: 'IPv4' | 'IPv6'): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    const nicName = await this.findNetworkInterfaceForInstance(instanceId);
    
    try {
      // 1. 检查并处理SKU混用问题
      await this.ensureNoMixedSkuOnNic(instanceId);
      
      // 2. 如果是IPv6，先确保子网支持IPv6
      if (ipVersion === 'IPv6') {
        await this.ensureSubnetSupportsIPv6(instanceId);
      }
      
      // 2. 获取当前网络接口配置
      console.log(`[Azure] 获取网络接口配置: ${nicName}`);
      const nicData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );
      
      // 3. 更新IP配置
      const ipConfigurations = nicData.properties.ipConfigurations || [];
      const targetConfigName = ipVersion === 'IPv6' ? 'ipconfig2' : 'ipconfig1';
      
      // 找到对应的IP配置
      let targetConfig = ipConfigurations.find((config: any) => config.name === targetConfigName);
      
      if (!targetConfig) {
        // 如果没有找到配置，创建新的配置
        if (ipVersion === 'IPv6') {
          targetConfig = {
            name: 'ipconfig2',
            properties: {
              primary: false,
              subnet: ipConfigurations[0]?.properties?.subnet,
              privateIPAllocationMethod: 'Dynamic',
              privateIPAddressVersion: 'IPv6'
            }
          };
          ipConfigurations.push(targetConfig);
        } else {
          throw new CloudProviderError(`找不到IPv4配置: ${targetConfigName}`, 'azure', 404);
        }
      }
      
      // 4. 关联新的公网IP
      targetConfig.properties.publicIPAddress = {
        id: `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/publicIPAddresses/${publicIpName}`
      };
      
      // 5. 更新网络接口
      console.log(`[Azure] 更新网络接口配置: ${nicName}`);
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: nicData.location,
            properties: {
              ...nicData.properties,
              ipConfigurations: ipConfigurations
            }
          })
        }
      );
      
      console.log(`[Azure] 网络接口更新完成: ${nicName}`);
      
    } catch (error) {
      console.error(`[Azure] 关联IP到网络接口失败: ${nicName}`, error);
      throw error;
    }
  }

  private async ensureSubnetSupportsIPv6(instanceId: string): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    const { vnetName, subnetName } = await this.findVNetAndSubnetForInstance(instanceId);
    
    try {
      console.log(`[Azure] 检查子网IPv6支持: ${subnetName}`);
      
      // 1. 获取当前虚拟网络配置
      const vnetData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`
      );
      
      // 2. 检查子网是否已有IPv6地址前缀
      const subnet = vnetData.properties.subnets?.find((s: any) => s.name === subnetName);
      if (!subnet) {
        throw new CloudProviderError(`找不到子网: ${subnetName}`, 'azure', 404);
      }
      
      // 检查是否已有IPv6前缀
      const hasIPv6Prefix = vnetData.properties.addressSpace?.addressPrefixes?.some((prefix: string) => 
        prefix.includes(':')
      );
      
      const subnetPrefixes = subnet.properties.addressPrefixes || 
        (subnet.properties.addressPrefix ? [subnet.properties.addressPrefix] : []);
      const subnetHasIPv6 = subnetPrefixes.some((prefix: string) => 
        prefix.includes(':')
      );
      
      if (hasIPv6Prefix && subnetHasIPv6) {
        console.log(`[Azure] 子网已支持IPv6: ${subnetName}`);
        return;
      }
      
      // 3. 添加IPv6地址前缀
      console.log(`[Azure] 为子网添加IPv6支持: ${subnetName}`);
      
      // 添加虚拟网络IPv6地址空间
      const addressPrefixes = vnetData.properties.addressSpace?.addressPrefixes || [];
      if (!hasIPv6Prefix) {
        addressPrefixes.push('ace:cab:deca::/48'); // 使用Azure推荐的IPv6前缀格式
      }
      
      // 添加子网IPv6地址前缀
      let subnetAddressPrefixes;
      if (subnet.properties.addressPrefixes) {
        subnetAddressPrefixes = [...subnet.properties.addressPrefixes];
      } else if (subnet.properties.addressPrefix) {
        subnetAddressPrefixes = [subnet.properties.addressPrefix];
      } else {
        throw new CloudProviderError(`子网缺少地址前缀配置: ${subnetName}`, 'azure', 400);
      }
      
      if (!subnetHasIPv6) {
        subnetAddressPrefixes.push('ace:cab:deca:deed::/64');
      }
      
      // 更新虚拟网络配置
      const updatedVnet = {
        location: vnetData.location,
        properties: {
          ...vnetData.properties,
          addressSpace: {
            addressPrefixes: addressPrefixes
          },
          subnets: vnetData.properties.subnets.map((s: any) => {
            if (s.name === subnetName) {
              const updatedSubnet = {
                ...s,
                properties: {
                  ...s.properties,
                  addressPrefixes: subnetAddressPrefixes
                }
              };
              // 删除旧的addressPrefix属性，使用addressPrefixes
              delete updatedSubnet.properties.addressPrefix;
              return updatedSubnet;
            }
            return s;
          })
        }
      };
      
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify(updatedVnet)
        }
      );
      
      console.log(`[Azure] 子网IPv6支持添加完成: ${subnetName}`);
      
      // 等待配置生效并验证
      console.log(`[Azure] 等待子网IPv6配置生效...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // 验证配置是否生效
      await this.verifySubnetIPv6Support(instanceId);
      
    } catch (error) {
      console.error(`[Azure] 确保子网IPv6支持失败: ${subnetName}`, error);
      throw error;
    }
  }

  private async verifySubnetIPv6Support(instanceId: string): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    const { vnetName, subnetName } = await this.findVNetAndSubnetForInstance(instanceId);
    
    try {
      console.log(`[Azure] 验证子网IPv6支持: ${subnetName}`);
      
      // 重新获取虚拟网络配置
      const vnetData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}?api-version=2023-05-01`
      );
      
      const subnet = vnetData.properties.subnets?.find((s: any) => s.name === subnetName);
      if (!subnet) {
        throw new CloudProviderError(`找不到子网: ${subnetName}`, 'azure', 404);
      }
      
      // 检查是否有IPv6前缀
      const hasVnetIPv6 = vnetData.properties.addressSpace?.addressPrefixes?.some((prefix: string) => 
        prefix.includes(':')
      );
      
      const subnetPrefixes = subnet.properties.addressPrefixes || 
        (subnet.properties.addressPrefix ? [subnet.properties.addressPrefix] : []);
      const hasSubnetIPv6 = subnetPrefixes.some((prefix: string) => 
        prefix.includes(':')
      );
      
      if (!hasVnetIPv6 || !hasSubnetIPv6) {
        throw new CloudProviderError(
          `子网IPv6配置未生效。VNet IPv6: ${hasVnetIPv6}, Subnet IPv6: ${hasSubnetIPv6}`, 
          'azure', 
          400
        );
      }
      
      console.log(`[Azure] 子网IPv6支持验证成功: ${subnetName}`);
      
    } catch (error) {
      console.error(`[Azure] 验证子网IPv6支持失败: ${subnetName}`, error);
      throw error;
    }
  }

  private async disassociateIPFromNetworkInterface(instanceId: string, ipVersion: 'IPv4' | 'IPv6'): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    const nicName = await this.findNetworkInterfaceForInstance(instanceId);

    try {
      console.log(`[Azure] 解除IP关联: ${ipVersion}`);
      
      // 取 NIC
      const nicData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );

      const ipConfigurations = nicData.properties?.ipConfigurations || [];
      const targetConfigName = ipVersion === 'IPv6' ? 'ipconfig2' : 'ipconfig1';

      // 若该 ipConfig 不存在直接返回（当作已解绑）
      const idx = ipConfigurations.findIndex((c: any) => c.name === targetConfigName);
      if (idx === -1) {
        console.log(`[Azure] IP配置 ${targetConfigName} 不存在，跳过解绑`);
        return;
      }

      // 移除公网 IP 关联（不改私网）
      if (ipConfigurations[idx].properties.publicIPAddress) {
        delete ipConfigurations[idx].properties.publicIPAddress;
        console.log(`[Azure] 已从 ${targetConfigName} 移除公网IP关联`);
      }

      // 更新 NIC
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`,
        {
          method: 'PUT',
          body: JSON.stringify({
            location: nicData.location,
            properties: { ...nicData.properties, ipConfigurations }
          })
        }
      );
      
      console.log(`[Azure] IP解绑完成: ${targetConfigName}`);
      
    } catch (error) {
      console.error(`[Azure] 解除IP关联失败: ${ipVersion}`, error);
      throw error;
    }
  }

  private async ensureNoMixedSkuOnNic(instanceId: string): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    const nicName = await this.findNetworkInterfaceForInstance(instanceId);

    try {
      console.log(`[Azure] 检查NIC上的SKU混用情况: ${nicName}`);
      
      const nicData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`
      );

      const ipConfigurations = nicData.properties?.ipConfigurations || [];
      const pipIds: string[] = [];
      for (const c of ipConfigurations) {
        const id = c?.properties?.publicIPAddress?.id;
        if (id) pipIds.push(id);
      }
      if (pipIds.length <= 1) {
        console.log(`[Azure] NIC上只有${pipIds.length}个PIP，无需检查SKU混用`);
        return; // 只有一个/没有 PIP 不会混用
      }

      // 读取所有已关联 PIP 的 SKU
      const skus = await Promise.all(
        pipIds.map(async (id) => {
          const [, , , , , rg, , , , , pipName] = id.split('/');
          const pip = await this.makeRequest(
            `/subscriptions/${this.subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/publicIPAddresses/${pipName}?api-version=2023-05-01`
          );
          // 没写 sku 时视为 Basic（老资源常见）
          return (pip.sku?.name || 'Basic').toLowerCase();
        })
      );

      const hasBasic = skus.some((s) => s === 'basic');
      const hasStandard = skus.some((s) => s === 'standard');

      if (hasBasic && hasStandard) {
        console.log(`[Azure] 检测到SKU混用 (Basic: ${hasBasic}, Standard: ${hasStandard})，临时解绑所有PIP`);
        
        // 最安全的处理：把所有 ipConfig 上的 PIP 先解绑，避免 400
        const newIpConfigs = ipConfigurations.map((c: any) => {
          const pipId = c?.properties?.publicIPAddress?.id;
          if (!pipId) return c;
          c = { ...c, properties: { ...c.properties } };
          delete c.properties.publicIPAddress;
          return c;
        });

        await this.makeRequest(
          `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-05-01`,
          {
            method: 'PUT',
            body: JSON.stringify({
              location: nicData.location,
              properties: { ...nicData.properties, ipConfigurations: newIpConfigs }
            })
          }
        );
        
        console.log(`[Azure] 已临时解绑所有PIP以避免SKU混用错误`);
      } else {
        console.log(`[Azure] NIC上SKU一致 (${skus.join(', ')})，无需处理`);
      }
      
    } catch (error) {
      console.error(`[Azure] 检查SKU混用失败: ${nicName}`, error);
      throw error;
    }
  }

  private async ensureCapacityForNewPublicIP(region: string): Promise<void> {
    try {
      console.log(`[Azure] 检查区域 ${region} 的公网IP配额`);
      
      // 1) 查询该区域的 Public IP 使用量/上限
      const usage = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/providers/Microsoft.Network/locations/${region}/usages?api-version=2023-09-01`
      );
      const pipUsage = (usage.value || []).find((u: any) => u.name?.value === 'PublicIPAddresses');
      const current = pipUsage?.currentValue ?? 0;
      const limit = pipUsage?.limit ?? 3;

      console.log(`[Azure] 公网IP使用情况: ${current}/${limit}`);
      
      if (current < limit) {
        console.log(`[Azure] 配额充足，无需清理`);
        return;
      }

      // 2) 超限：尝试删除"未绑定"的老 PIP 以释放名额
      console.log(`[Azure] 配额已满，查找可清理的未绑定PIP...`);
      const pips = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/providers/Microsoft.Network/publicIPAddresses?api-version=2023-05-01`
      );
      const candidates = (pips.value || [])
        .filter((p: any) => p.location === region && !p.properties?.ipConfiguration)
        .sort((a: any, b: any) => Date.parse(a.properties?.provisioningStateTime || a.properties?.idleTimeoutInMinutes || 0) 
                               - Date.parse(b.properties?.provisioningStateTime || b.properties?.idleTimeoutInMinutes || 0));

      if (!candidates.length) {
        throw new CloudProviderError(`该区域 Public IP 已达上限(${limit})，且无可清理的未绑定 PIP。请先手动删除或申请升配。`, 'azure', 400);
      }

      // 3) 删除一个未绑定 PIP，并轮询到删除完成
      const target = candidates[0];
      const pipName = target.name;
      console.log(`[Azure] 清理未绑定的PIP: ${pipName}`);
      
      await this.makeRequest(`${target.id}?api-version=2023-05-01`, { method: 'DELETE' });
      await this.waitResourceDeleted(target.id, 300000); // 等到 404 或超时
      
      console.log(`[Azure] PIP清理完成: ${pipName}`);
      
    } catch (error) {
      console.error(`[Azure] 检查公网IP配额失败:`, error);
      throw error;
    }
  }

  private async waitResourceDeleted(resourceId: string, timeoutMs = 300000): Promise<void> {
    const start = Date.now();
    console.log(`[Azure] 等待资源删除完成: ${resourceId}`);
    
    while (Date.now() - start < timeoutMs) {
      try {
        await this.makeRequest(`${resourceId}?api-version=2023-05-01`);
        await new Promise(r => setTimeout(r, 5000));
      } catch (e: any) {
        // 被删掉后会返回 404
        if (e instanceof CloudProviderError && e.statusCode === 404) {
          console.log(`[Azure] 资源删除完成`);
          return;
        }
        throw e;
      }
    }
    throw new CloudProviderError('等待资源删除超时', 'azure', 504);
  }

  // 轮询某个 GET 资源，直到 provisioningState === "Succeeded"
  private async waitProvisioningSucceeded(resourceIdOrUrl: string, timeoutMs = 300000, intervalMs = 5000): Promise<void> {
    const start = Date.now();
    const url = resourceIdOrUrl.startsWith('http')
      ? resourceIdOrUrl
      : `${this.baseUrl}${resourceIdOrUrl}?api-version=2023-05-01`;

    console.log(`[Azure] 开始等待资源就绪: ${resourceIdOrUrl}`);
    
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.makeRequest(url);
        const state =
          res?.properties?.provisioningState ||
          res?.properties?.provisioningState?.toString?.() ||
          res?.provisioningState; // 兼容某些资源

        console.log(`[Azure] 资源状态检查: ${state}`);
        
        if (state === 'Succeeded') {
          console.log(`[Azure] 资源就绪完成: ${resourceIdOrUrl}`);
          return;
        }
        
        if (state === 'Failed') {
          throw new CloudProviderError(`资源创建失败: ${resourceIdOrUrl}`, 'azure', 500);
        }

        // 某些资源创建初期 GET 会 404，直接重试
      } catch (error) {
        if (error instanceof CloudProviderError && error.statusCode === 404) {
          console.log(`[Azure] 资源暂未可见，继续等待: ${resourceIdOrUrl}`);
        } else if (!(error instanceof CloudProviderError)) {
          console.log(`[Azure] 等待过程中出现错误，继续重试: ${error}`);
        } else {
          throw error; // 重新抛出非404错误
        }
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new CloudProviderError(`等待资源进入 Succeeded 超时: ${resourceIdOrUrl}`, 'azure', 504);
  }

  // 拿到 VNet，再等里面指定 Subnet 的 Succeeded
  private async waitSubnetSucceeded(resourceGroupName: string, vnetName: string, subnetName: string, timeoutMs = 300000, intervalMs = 5000): Promise<void> {
    const vnetUrl = `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
    const start = Date.now();

    console.log(`[Azure] 开始等待子网就绪: ${subnetName}`);

    while (Date.now() - start < timeoutMs) {
      try {
        const vnet = await this.makeRequest(`${vnetUrl}?api-version=2023-05-01`);
        const subnet = (vnet?.properties?.subnets || []).find((s: any) => s.name === subnetName);
        const state = subnet?.properties?.provisioningState;
        
        console.log(`[Azure] 子网状态检查: ${subnetName} -> ${state}`);
        
        if (state === 'Succeeded') {
          console.log(`[Azure] 子网就绪完成: ${subnetName}`);
          return;
        }
        
        if (state === 'Failed') {
          throw new CloudProviderError(`子网创建失败: ${subnetName}`, 'azure', 500);
        }
        
      } catch (error) {
        if (error instanceof CloudProviderError && error.statusCode === 404) {
          console.log(`[Azure] VNet暂未可见，继续等待: ${vnetName}`);
        } else if (!(error instanceof CloudProviderError)) {
          console.log(`[Azure] 子网等待过程中出现错误，继续重试: ${error}`);
        } else {
          throw error;
        }
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new CloudProviderError(`等待子网 ${subnetName} 就绪超时`, 'azure', 504);
  }

  private async restartVirtualMachine(instanceId: string): Promise<void> {
    const resourceGroupName = await this.findResourceGroupForInstance(instanceId);
    
    try {
      console.log(`[Azure] 重启虚拟机: ${instanceId}`);
      
      // 发送重启命令
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${instanceId}/restart?api-version=2023-03-01`,
      { method: 'POST' }
    );

      console.log(`[Azure] 虚拟机重启命令已发送: ${instanceId}`);
      
    } catch (error) {
      console.error(`[Azure] 重启虚拟机失败: ${instanceId}`, error);
      throw error;
    }
  }

  async getRegions(): Promise<CloudRegion[]> {
    // 直接使用静态区域列表，确保所有用户都能看到完整的区域选项
    const regions = [
      // 优先推荐的稳定区域
      { slug: 'eastus', name: '美国东部 弗吉尼亚 (推荐)', available: true },
      { slug: 'westus2', name: '美国西部2 华盛顿 (推荐)', available: true },
      { slug: 'westeurope', name: '西欧 荷兰 (推荐)', available: true },
      { slug: 'southeastasia', name: '东南亚 新加坡 (推荐)', available: true },
      
      // 亚太地区
      { slug: 'eastasia', name: '东亚 中国香港', available: true },
      { slug: 'japaneast', name: '日本东部 东京', available: true },
      { slug: 'japanwest', name: '日本西部 大阪', available: true },
      { slug: 'koreacentral', name: '韩国中部 首尔', available: true },
      { slug: 'australiaeast', name: '澳大利亚东部 新南威尔士州', available: true },
      { slug: 'australiasoutheast', name: '澳大利亚东南部 维多利亚', available: true },
      { slug: 'australiacentral', name: '澳大利亚中部 堪培拉', available: true },
      { slug: 'centralindia', name: '印度中部 浦那', available: true },
      { slug: 'southindia', name: '印度南部 钦奈', available: true },
      { slug: 'jioindiawest', name: '印度西部 贾姆纳格尔', available: true },
      
      // 北美地区
      { slug: 'eastus2', name: '美国东部2 弗吉尼亚', available: true },
      { slug: 'westus', name: '美国西部 加利福尼亚', available: true },
      { slug: 'westus3', name: '美国西部3 凤凰城', available: true },
      { slug: 'centralus', name: '美国中部 爱荷华州', available: true },
      { slug: 'southcentralus', name: '美国中南部 德克萨斯州', available: true },
      { slug: 'westcentralus', name: '美国中西部 怀俄明州', available: true },
      { slug: 'northcentralus', name: '美国中北部 伊利诺伊州', available: true },
      { slug: 'canadacentral', name: '加拿大中部 多伦多', available: true },
      { slug: 'canadaeast', name: '加拿大东部 魁北克', available: true },
      
      // 欧洲地区
      { slug: 'northeurope', name: '北欧 爱尔兰', available: true },
      { slug: 'uksouth', name: '英国南部 伦敦', available: true },
      { slug: 'ukwest', name: '英国西部 加的夫', available: true },
      { slug: 'francecentral', name: '法国中部 巴黎', available: true },
      { slug: 'germanywestcentral', name: '德国中西部 法兰克福', available: true },
      { slug: 'norwayeast', name: '挪威东部 奥斯陆', available: true },
      { slug: 'switzerlandnorth', name: '瑞士北部 苏黎世', available: true },
      { slug: 'swedencentral', name: '瑞典中部 斯德哥尔摩', available: true },
      
      // 其他地区
      { slug: 'brazilsouth', name: '巴西南部 圣保罗', available: true },
      { slug: 'southafricanorth', name: '南非北部 约翰内斯堡', available: true },
      { slug: 'uaenorth', name: '阿联酋北部 迪拜', available: true }
    ];

    return regions;
  }

  // Azure区域中英文映射表
  private readonly regionNameMap: Record<string, string> = {
    'eastus': '美国东部 弗吉尼亚',
    'eastus2': '美国东部2 弗吉尼亚', 
    'westus': '美国西部 加利福尼亚',
    'westus2': '美国西部2 华盛顿',
    'westus3': '美国西部3 凤凰城',
    'centralus': '美国中部 爱荷华州',
    'southcentralus': '美国中南部 德克萨斯州',
    'westcentralus': '美国中西部 怀俄明州',
    'northcentralus': '美国中北部 伊利诺伊州',
    'canadacentral': '加拿大中部 多伦多',
    'canadaeast': '加拿大东部 魁北克',
    'westeurope': '西欧 荷兰',
    'northeurope': '北欧 爱尔兰',
    'uksouth': '英国南部 伦敦',
    'ukwest': '英国西部 加的夫',
    'francecentral': '法国中部 巴黎',
    'francesouth': '法国南部 马赛',
    'germanywestcentral': '德国中西部 法兰克福',
    'germanynorth': '德国北部 柏林',
    'norwayeast': '挪威东部 奥斯陆',
    'norwaywest': '挪威西部 斯塔万格',
    'switzerlandnorth': '瑞士北部 苏黎世',
    'switzerlandwest': '瑞士西部 日内瓦',
    'swedencentral': '瑞典中部 斯德哥尔摩',
    'swedensouth': '瑞典南部 马尔默',
    'eastasia': '东亚 中国香港',
    'southeastasia': '东南亚 新加坡',
    'japaneast': '日本东部 东京',
    'japanwest': '日本西部 大阪',
    'koreacentral': '韩国中部 首尔',
    'koreasouth': '韩国南部 釜山',
    'australiaeast': '澳大利亚东部 新南威尔士州',
    'australiasoutheast': '澳大利亚东南部 维多利亚',
    'australiacentral': '澳大利亚中部 堪培拉',
    'australiacentral2': '澳大利亚中部2 堪培拉',
    'brazilsouth': '巴西南部 圣保罗',
    'brazilsoutheast': '巴西东南部 里约热内卢',
    'southafricanorth': '南非北部 约翰内斯堡',
    'southafricawest': '南非西部 开普敦',
    'centralindia': '印度中部 浦那',
    'southindia': '印度南部 钦奈',
    'westindia': '印度西部 孟买',
    'jioindiawest': '印度西部 贾姆纳格尔',
    'jioindiacentral': '印度中部 纳格浦尔',
    'uaenorth': '阿联酋北部 迪拜',
    'uaecentral': '阿联酋中部 阿布扎比',
    'qatarcentral': '卡塔尔中部 多哈',
    'indonesiacentral': '印度尼西亚中部 雅加达',
    'malaysiawest': '马来西亚西部 吉隆坡',
    'newzealandnorth': '新西兰北部 奥克兰',
    'austriaeast': '奥地利东部 维也纳',
    'polandcentral': '波兰中部 华沙',
    'israelcentral': '以色列中部 特拉维夫',
    'italynorth': '意大利北部 米兰',
    'spaincentral': '西班牙中部 马德里',
    'mexicocentral': '墨西哥中部 墨西哥城',
    'chilecentral': '智利中部 圣地亚哥'
  };

  // 检查订阅在特定区域的可用性
  private async checkRegionAvailability(regionName: string): Promise<boolean> {
    try {
      // 尝试获取该区域的VM规格，如果成功则表示该区域可用
      const vmSizesData = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/providers/Microsoft.Compute/locations/${regionName}/vmSizes?api-version=2023-03-01`
      );
      
      // 如果能获取到VM规格且数量大于0，则认为该区域可用
      return vmSizesData.value && vmSizesData.value.length > 0;
    } catch (error: any) {
      // 如果返回403或其他权限错误，说明该区域不可用
      if (error.message?.includes('403') || error.message?.includes('RequestDisallowedByAzure')) {
        console.log(`[Azure] 区域 ${regionName} 不可用: ${error.message}`);
        return false;
      }
      // 其他错误也认为不可用
      console.warn(`[Azure] 检查区域 ${regionName} 可用性失败: ${error.message}`);
      return false;
    }
  }

  // 新增：动态获取可用区域（包含可用性检查）
  private async getAvailableRegions(): Promise<CloudRegion[]> {
    try {
      console.log('[Azure] 开始获取订阅可用区域...');
      
      const data = await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/locations?api-version=2022-12-01`
      );

      const physicalRegions = data.value
        .filter((location: any) => 
          location.metadata?.regionType === 'Physical' && 
          location.metadata?.regionCategory === 'Recommended'
        )
        .slice(0, 15); // 先限制数量，避免太多API调用

      console.log(`[Azure] 找到 ${physicalRegions.length} 个推荐区域，开始检查可用性...`);

      // 并行检查区域可用性（限制并发数）
      const availabilityChecks = [];
      for (let i = 0; i < physicalRegions.length; i += 3) {
        const batch = physicalRegions.slice(i, i + 3);
        const batchPromises = batch.map(async (location: any) => {
          const slug = location.name;
          const isAvailable = await this.checkRegionAvailability(slug);
          const chineseName = this.regionNameMap[slug];
          const displayName = chineseName || location.displayName;
          
          return {
            slug: slug,
            name: displayName,
            available: isAvailable
          };
        });
        
        availabilityChecks.push(...batchPromises);
        
        // 批次间稍作延迟，避免API限制
        if (i + 3 < physicalRegions.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const results = await Promise.all(availabilityChecks);
      const availableRegions = results.filter(region => region.available);
      
      console.log(`[Azure] 检查完成，发现 ${availableRegions.length} 个可用区域:`, 
        availableRegions.map(r => r.name).join(', '));

      return results; // 返回所有区域，但标记可用性
    } catch (error) {
      console.error('[Azure] 获取可用区域失败:', error);
      
      // 如果检查失败，返回默认的常用区域
      console.log('[Azure] 使用默认区域列表');
      return [
        { slug: 'eastus', name: '美国东部 弗吉尼亚', available: true },
        { slug: 'westus2', name: '美国西部2 华盛顿', available: true },
        { slug: 'westeurope', name: '西欧 荷兰', available: true },
        { slug: 'eastasia', name: '东亚 中国香港', available: true },
        { slug: 'southeastasia', name: '东南亚 新加坡', available: true }
      ];
    }
  }

  async getImages(region?: string): Promise<CloudImage[]> {
    const cacheKey = 'azure-images';
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }

    // 使用完整的Azure镜像列表（基于用户提供的数据）
    const images = this.getAzureImages();
    
    this.setCachedData(cacheKey, images);
    return images;
  }

  // 获取完整的Azure镜像列表（基于用户提供的数据）
  private getAzureImages(): CloudImage[] {
    return [
      // x64架构镜像
      { id: 'Debian_9', slug: 'Debian_9', name: 'Debian 9 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Debian_10', slug: 'Debian_10', name: 'Debian 10 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Debian_11', slug: 'Debian_11', name: 'Debian 11 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Debian_10_gen1', slug: 'Debian_10_gen1', name: 'Debian 10 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Debian_11_gen1', slug: 'Debian_11_gen1', name: 'Debian 11 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_16_04', slug: 'Ubuntu_16_04', name: 'Ubuntu 16.04 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_18_04', slug: 'Ubuntu_18_04', name: 'Ubuntu 18.04 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_20_04', slug: 'Ubuntu_20_04', name: 'Ubuntu 20.04 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_16_04_gen1', slug: 'Ubuntu_16_04_gen1', name: 'Ubuntu 16.04 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_18_04_gen1', slug: 'Ubuntu_18_04_gen1', name: 'Ubuntu 18.04 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_20_04_gen1', slug: 'Ubuntu_20_04_gen1', name: 'Ubuntu 20.04 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Ubuntu_22_04_gen1', slug: 'Ubuntu_22_04_gen1', name: 'Ubuntu 22.04 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Centos_79', slug: 'Centos_79', name: 'Centos 7.9 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Centos_79_gen1', slug: 'Centos_79_gen1', name: 'Centos 7.9 (x64)', supportedArchitectures: ['x64'] },
      { id: 'Centos_85', slug: 'Centos_85', name: 'Centos 8.5 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'Centos_85_gen1', slug: 'Centos_85_gen1', name: 'Centos 8.5 (x64)', supportedArchitectures: ['x64'] },
      { id: 'WinData_2022', slug: 'WinData_2022', name: 'Windows Datacenter 2022 (x64)', supportedArchitectures: ['x64'] },
      { id: 'WinData_2019', slug: 'WinData_2019', name: 'Windows Datacenter 2019 (x64)', supportedArchitectures: ['x64'] },
      { id: 'WinData_2016', slug: 'WinData_2016', name: 'Windows Datacenter 2016 (x64)', supportedArchitectures: ['x64'] },
      { id: 'WinData_2012', slug: 'WinData_2012', name: 'Windows Datacenter 2012 (x64)', supportedArchitectures: ['x64'] },
      { id: 'WinDesk_10', slug: 'WinDesk_10', name: 'Windows 10 21H2 (gen2, x64)', supportedArchitectures: ['x64'] },
      { id: 'WinDesk_11', slug: 'WinDesk_11', name: 'Windows 11 21H2 (x64)', supportedArchitectures: ['x64'] },
      
      // ARM64架构镜像（支持B2pts_v2等ARM规格）
      { id: 'Ubuntu_22_04_arm64', slug: 'Ubuntu_22_04_arm64', name: 'Ubuntu 22.04 LTS (ARM64)', supportedArchitectures: ['arm64'] },
      { id: 'Ubuntu_20_04_arm64', slug: 'Ubuntu_20_04_arm64', name: 'Ubuntu 20.04 LTS (ARM64)', supportedArchitectures: ['arm64'] },
      { id: 'Debian_11_arm64', slug: 'Debian_11_arm64', name: 'Debian 11 (ARM64)', supportedArchitectures: ['arm64'] }
    ];
  }

  async getPlans(region?: string): Promise<CloudPlan[]> {
    const cacheKey = 'azure-plans';
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }

    // 使用完整的Azure VM规格列表（基于用户提供的数据和准确定价）
    const plans = [
      {
        slug: 'Standard_B1ls',
        description: 'B1ls 1C_0.5G (3.7 USD/Month) - x64',
        vcpus: 1,
        memory: 512, // 0.5GB
        disk: 64,
        price_monthly: 3.7,
        price_hourly: 0.005,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B1s',
        description: 'B1s 1C_1G (7.5 USD/Month) - x64',
        vcpus: 1,
        memory: 1024, // 1GB
        disk: 64,
        price_monthly: 7.5,
        price_hourly: 0.01,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B2ats_v2',
        description: 'B2ats_v2 2C_1G (6.8 USD/Month) - AMD x64',
        vcpus: 2,
        memory: 1024, // 1GB
        disk: 64,
        price_monthly: 6.8,
        price_hourly: 0.009,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B2pts_v2',
        description: 'B2pts_v2 2C_1G (6.8 USD/Month) - ARM64',
        vcpus: 2,
        memory: 1024, // 1GB
        disk: 64,
        price_monthly: 6.8,
        price_hourly: 0.009,
        transfer: 100,
        architecture: 'arm64' as const
      },
      {
        slug: 'Standard_B1ms',
        description: 'B1ms 1C_2G (14.9 USD/Month) - x64',
        vcpus: 1,
        memory: 2048, // 2GB
        disk: 64,
        price_monthly: 14.9,
        price_hourly: 0.021,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B2s',
        description: 'B2s 2C_4G (30 USD/Month) - x64',
        vcpus: 2,
        memory: 4096, // 4GB
        disk: 64,
        price_monthly: 30,
        price_hourly: 0.041,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B2ms',
        description: 'B2ms 2C_8G (59.9 USD/Month) - x64',
        vcpus: 2,
        memory: 8192, // 8GB
        disk: 64,
        price_monthly: 59.9,
        price_hourly: 0.082,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_B4ms',
        description: 'B4ms 4C_16G (119.5 USD/Month) - x64',
        vcpus: 4,
        memory: 16384, // 16GB
        disk: 64,
        price_monthly: 119.5,
        price_hourly: 0.164,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_F1s',
        description: 'F1s 1C_2G (35.8 USD/Month) - x64',
        vcpus: 1,
        memory: 2048, // 2GB
        disk: 64,
        price_monthly: 35.8,
        price_hourly: 0.049,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_F2s_v2',
        description: 'F2s_v2 2C_4G (60.9 USD/Month) - x64',
        vcpus: 2,
        memory: 4096, // 4GB
        disk: 64,
        price_monthly: 60.9,
        price_hourly: 0.084,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_F4s_v2',
        description: 'F4s_v2 4C_8G (121.7 USD/Month) - x64',
        vcpus: 4,
        memory: 8192, // 8GB
        disk: 64,
        price_monthly: 121.7,
        price_hourly: 0.167,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_F8s_v2',
        description: 'F8s_v2 8C_16G (243.4 USD/Month) - x64',
        vcpus: 8,
        memory: 16384, // 16GB
        disk: 64,
        price_monthly: 243.4,
        price_hourly: 0.334,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_DS1_v2',
        description: 'DS1_v2 1C_3.5G (52.6 USD/Month) - x64',
        vcpus: 1,
        memory: 3584, // 3.5GB
        disk: 64,
        price_monthly: 52.6,
        price_hourly: 0.072,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_DS2_v2',
        description: 'DS2_v2 2C_7G (105.1 USD/Month) - x64',
        vcpus: 2,
        memory: 7168, // 7GB
        disk: 64,
        price_monthly: 105.1,
        price_hourly: 0.144,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_DS3_v2',
        description: 'DS3_v2 4C_14G (211 USD/Month) - x64',
        vcpus: 4,
        memory: 14336, // 14GB
        disk: 64,
        price_monthly: 211,
        price_hourly: 0.290,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_D1',
        description: 'D1 1C_3.5G (55.4 USD/Month) - x64',
        vcpus: 1,
        memory: 3584, // 3.5GB
        disk: 64,
        price_monthly: 55.4,
        price_hourly: 0.076,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_D2',
        description: 'D2 2C_7G (110.9 USD/Month) - x64',
        vcpus: 2,
        memory: 7168, // 7GB
        disk: 64,
        price_monthly: 110.9,
        price_hourly: 0.152,
        transfer: 100,
        architecture: 'x64' as const
      },
      {
        slug: 'Standard_D11',
        description: 'D11 2C_14G (139 USD/Month) - x64',
        vcpus: 2,
        memory: 14336, // 14GB
        disk: 64,
        price_monthly: 139,
        price_hourly: 0.191,
        transfer: 100,
        architecture: 'x64' as const
      }
    ];

    // 按价格排序，便宜的在前面
    const sortedPlans = plans.sort((a, b) => a.price_monthly - b.price_monthly);
    this.setCachedData(cacheKey, sortedPlans);
    return sortedPlans;
  }

  // Unicode兼容的Base64编码
  private encodeBase64Unicode(str: string): string {
    try {
      // 使用TextEncoder将Unicode字符串转换为UTF-8字节数组
      const encoder = new TextEncoder();
      const bytes = encoder.encode(str);
      
      // 将字节数组转换为二进制字符串
      let binaryString = '';
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      
      // 使用btoa编码二进制字符串
      return btoa(binaryString);
    } catch (error) {
      console.error('Base64 encoding error:', error);
      // 如果编码失败，返回空字符串的Base64编码
      return btoa('');
    }
  }

  // 解析镜像引用
  private parseImageReference(imageId: string): any {
    // 镜像映射表，将简化的镜像ID映射为Azure镜像引用
    const imageMap: { [key: string]: any } = {
      'Debian_9': { publisher: 'Debian', offer: 'debian-9', sku: '9', version: 'latest' },
      'Debian_10': { publisher: 'Debian', offer: 'debian-10', sku: '10-gen2', version: 'latest' },
      'Debian_11': { publisher: 'Debian', offer: 'debian-11', sku: '11-gen2', version: 'latest' },
      'Debian_10_gen1': { publisher: 'Debian', offer: 'debian-10', sku: '10', version: 'latest' },
      'Debian_11_gen1': { publisher: 'Debian', offer: 'debian-11', sku: '11', version: 'latest' },
      'Ubuntu_16_04': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-xenial', sku: '16_04-lts-gen2', version: 'latest' },
      'Ubuntu_18_04': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-bionic', sku: '18_04-lts-gen2', version: 'latest' },
      'Ubuntu_20_04': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-focal', sku: '20_04-lts-gen2', version: 'latest' },
      'Ubuntu_16_04_gen1': { publisher: 'Canonical', offer: 'UbuntuServer', sku: '16.04-LTS', version: 'latest' },
      'Ubuntu_18_04_gen1': { publisher: 'Canonical', offer: 'UbuntuServer', sku: '18.04-LTS', version: 'latest' },
      'Ubuntu_20_04_gen1': { publisher: 'Canonical', offer: 'UbuntuServer', sku: '20.04-LTS', version: 'latest' },
      'Ubuntu_22_04_gen1': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts', version: 'latest' },
      'Centos_79': { publisher: 'OpenLogic', offer: 'CentOS', sku: '7_9-gen2', version: 'latest' },
      'Centos_79_gen1': { publisher: 'OpenLogic', offer: 'CentOS', sku: '7.9', version: 'latest' },
      'Centos_85': { publisher: 'OpenLogic', offer: 'CentOS', sku: '8_5-gen2', version: 'latest' },
      'Centos_85_gen1': { publisher: 'OpenLogic', offer: 'CentOS', sku: '8.5', version: 'latest' },
      'WinData_2022': { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2022-datacenter-g2', version: 'latest' },
      'WinData_2019': { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2019-datacenter-gensecond', version: 'latest' },
      'WinData_2016': { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2016-datacenter-gensecond', version: 'latest' },
      'WinData_2012': { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2012-R2-datacenter-gensecond', version: 'latest' },
      'WinDesk_10': { publisher: 'MicrosoftWindowsDesktop', offer: 'Windows-10', sku: 'win10-21h2-pro-g2', version: 'latest' },
      'WinDesk_11': { publisher: 'MicrosoftWindowsDesktop', offer: 'Windows-11', sku: 'win11-21h2-pro', version: 'latest' },
      
      // ARM64架构镜像映射（支持B2pts_v2等ARM规格）
      'Ubuntu_22_04_arm64': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-arm64', version: 'latest' },
      'Ubuntu_20_04_arm64': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-focal', sku: '20_04-lts-arm64', version: 'latest' },
      'Debian_11_arm64': { publisher: 'Debian', offer: 'debian-11', sku: '11-arm64', version: 'latest' }
    };

    return imageMap[imageId] || {
      publisher: 'Canonical',
      offer: '0001-com-ubuntu-server-focal',
      sku: '20_04-lts-gen2',
      version: 'latest'
    };
  }

  // 估算VM价格的辅助方法（简化版，实际应调用Azure定价API）
  private estimateVmPrice(vmSize: any): { monthly: number; hourly: number } {
    const { name, numberOfCores, memoryInMB } = vmSize;
    
    // 免费层VM
    if (name === 'Standard_B1s' || name === 'Standard_B2pts_v2' || name === 'Standard_B2ats_v2') {
      return { monthly: 0, hourly: 0 };
    }
    
    // 基于vCPU和内存的简单估算
    const memoryGB = memoryInMB / 1024;
    const basePrice = numberOfCores * 10 + memoryGB * 5; // 简化的定价公式
    const hourly = Math.round(basePrice * 0.01 * 100) / 100; // 保留2位小数
    const monthly = Math.round(hourly * 24 * 30 * 100) / 100;
    
    return { monthly, hourly };
  }
}

/**
 * 云服务商工厂函数
 */
export function createCloudProvider(provider: string, apiKey: string): CloudProviderAPI {
  switch (provider) {
    case 'digitalocean':
      return new DigitalOceanProvider(apiKey);
    case 'linode':
      return new LinodeProvider(apiKey);
    case 'azure':
      return new AzureProvider(apiKey);
    default:
      throw new CloudProviderError(`不支持的云服务商: ${provider}`, provider, 400);
  }
}

/**
 * 获取解密后的 API 密钥并创建云服务商实例
 */
export async function createCloudProviderFromEncryptedKey(
  provider: string, 
  encryptedKey: string, 
  encryptionKey: string
): Promise<CloudProviderAPI> {
  try {
    const apiKey = await CryptoService.decrypt(encryptedKey, encryptionKey);
    return createCloudProvider(provider, apiKey);
  } catch (error) {
    throw new CloudProviderError(
      `解密 API 密钥失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      provider,
      500
    );
  }
}

/**
 * 统一的实例操作接口
 */
export class CloudInstanceManager {
  constructor(private provider: CloudProviderAPI) {}

  async listInstances(): Promise<CloudInstance[]> {
    return this.provider.getInstances();
  }

  async createInstance(config: CreateInstanceConfig): Promise<CloudInstance> {
    return this.provider.createInstance(config);
  }

  async deleteInstance(instanceId: string): Promise<boolean> {
    return this.provider.deleteInstance(instanceId);
  }

  async startInstance(instanceId: string): Promise<boolean> {
    return this.provider.performInstanceAction(instanceId, 'power_on');
  }

  async stopInstance(instanceId: string): Promise<boolean> {
    return this.provider.performInstanceAction(instanceId, 'power_off');
  }

  async rebootInstance(instanceId: string): Promise<boolean> {
    return this.provider.performInstanceAction(instanceId, 'reboot');
  }

  async changeInstanceIP(instanceId: string, ipVersion?: 'IPv4' | 'IPv6'): Promise<string> {
    if (this.provider.changeInstanceIP) {
      return this.provider.changeInstanceIP(instanceId, ipVersion);
    }
    throw new Error('该云服务商不支持更换IP功能。DigitalOcean、Linode和Azure都支持此功能。');
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return this.provider.getAccountInfo();
  }

  async getBalance(): Promise<BalanceInfo> {
    return this.provider.getBalance();
  }

  async getAccountOverview(): Promise<UnifiedAccountOverview> {
    return this.provider.getAccountOverview();
  }

  // 浮动IP管理（主要用于DigitalOcean）
  async listFloatingIPs(): Promise<{ ip: string; dropletId?: number; region: string }[]> {
    if (!this.provider.listFloatingIPs) {
      throw new Error('该云服务商不支持浮动IP列表功能');
    }
    return this.provider.listFloatingIPs();
  }

  async deleteFloatingIP(ip: string): Promise<boolean> {
    if (!this.provider.deleteFloatingIP) {
      throw new Error('该云服务商不支持删除浮动IP功能');
    }
    return this.provider.deleteFloatingIP(ip);
  }

  // 一键清理未绑定浮动IP（仅DigitalOcean）
  async cleanupUnassignedFloatingIPs(): Promise<string[]> {
    if (!this.provider.listFloatingIPs || !this.provider.deleteFloatingIP) {
      throw new Error('该云服务商不支持浮动IP管理功能');
    }
    
    console.log('[CloudInstanceManager] 开始清理未绑定的浮动IP');
    const list = await this.provider.listFloatingIPs();
    const unassigned = list.filter(i => !i.dropletId);
    
    console.log(`[CloudInstanceManager] 发现${unassigned.length}个未绑定的浮动IP:`, unassigned.map(i => i.ip));
    
    const deletedIPs: string[] = [];
    for (const ip of unassigned) {
      try {
        await this.provider.deleteFloatingIP(ip.ip);
        deletedIPs.push(ip.ip);
        console.log(`[CloudInstanceManager] 成功删除未绑定浮动IP: ${ip.ip}`);
      } catch (error) {
        console.warn(`[CloudInstanceManager] 删除浮动IP失败: ${ip.ip}`, error);
        // 继续删除其他IP，不因单个失败而中断
      }
    }
    
    console.log(`[CloudInstanceManager] 清理完成，成功删除${deletedIPs.length}个浮动IP`);
    return deletedIPs;
  }

  // 绑定浮动IP到实例（仅DigitalOcean）
  async assignFloatingIP(ip: string, instanceId: string | number): Promise<boolean> {
    const provider = this.provider as any;
    if (!provider.assignFloatingIP) {
      throw new Error('该云服务商不支持绑定浮动IP功能');
    }
    return provider.assignFloatingIP(ip, Number(instanceId));
  }

  // 分离浮动IP（仅DigitalOcean）
  async unassignFloatingIP(ip: string): Promise<boolean> {
    const provider = this.provider as any;
    if (!provider.unassignFloatingIP) {
      throw new Error('该云服务商不支持分离浮动IP功能');
    }
    return provider.unassignFloatingIP(ip);
  }

  async getAvailableOptions(): Promise<{
    regions: CloudRegion[];
    images: CloudImage[];
    plans: CloudPlan[];
  }> {
    const [regions, images, plans] = await Promise.all([
      this.provider.getRegions(),
      this.provider.getImages(),
      this.provider.getPlans()
    ]);

    return { regions, images, plans };
  }
} 
