# Azure实例操作功能修复说明

## 问题描述

Azure实例的所有操作功能（更换IP、重启、关机、启动）都出现了 `ResourceGroupNotFound` 错误，错误信息显示：
```
"ResourceGroupNotFound": "Resource group 'cloudpanel-az-server-68291428' could not be found."
```

## 问题根源

在之前的Azure实例创建修复中，我们为了避免资源冲突，在创建实例时使用了带时间戳后缀的唯一资源组命名：

**创建时的命名规则**：
```typescript
const resourceGroupName = `cloudpanel-${config.name}-${uniqueSuffix}`;
// 实际创建：cloudpanel-az-server-68291428-123456
```

**操作时的命名规则**：
```typescript
const resourceGroupName = `cloudpanel-${instanceId}`;
// 查找时使用：cloudpanel-az-server-68291428
```

这导致了命名不匹配，操作时找不到正确的资源组。

## 修复方案

采用**动态资源组查找**方案，通过Azure API实时查找包含指定VM的资源组：

### 1. 新增动态查找方法

```typescript
private async findResourceGroupForInstance(instanceId: string): Promise<string> {
  // 获取订阅下所有资源组
  const resourceGroups = await this.makeRequest(
    `/subscriptions/${this.subscriptionId}/resourcegroups?api-version=2021-04-01`
  );
  
  // 遍历cloudpanel相关的资源组，查找包含该VM的资源组
  for (const rg of resourceGroups.value) {
    const rgName = rg.name;
    if (!rgName.startsWith('cloudpanel-')) continue;
    
    try {
      // 检查该资源组中是否存在指定的VM
      await this.makeRequest(
        `/subscriptions/${this.subscriptionId}/resourceGroups/${rgName}/providers/Microsoft.Compute/virtualMachines/${instanceId}?api-version=2023-03-01`
      );
      return rgName; // 找到了
    } catch (error) {
      continue; // VM不在这个资源组中，继续查找
    }
  }
  
  throw new CloudProviderError(`未找到实例 ${instanceId} 对应的资源组`, 'azure', 404);
}
```

### 2. 修复的方法列表

以下方法已全部修复，将硬编码的资源组名称替换为动态查找：

1. **performInstanceAction()** - 实例操作（启动/关机/重启）
2. **changeInstanceIP()** - 更换IP地址
3. **deleteInstance()** - 删除实例
4. **getInstanceRegion()** - 获取实例区域
5. **associateIPToNetworkInterface()** - 关联IP到网络接口
6. **ensureSubnetSupportsIPv6()** - 确保子网支持IPv6
7. **verifySubnetIPv6Support()** - 验证子网IPv6支持
8. **disassociateIPFromNetworkInterface()** - 解除IP关联
9. **ensureNoMixedSkuOnNic()** - 确保NIC上无SKU混用
10. **restartVirtualMachine()** - 重启虚拟机

### 3. 网络接口命名问题（第二次修复）

在第一次修复后发现新问题：网络接口名称也存在命名不匹配：

**创建时的命名规则**：
```typescript
const nicName = `${config.name}-nic-${uniqueSuffix}`;
// 实际创建：az-server-68291428-nic-718374
```

**操作时的命名规则**：
```typescript
const nicName = `${instanceId}-nic`;
// 查找时使用：az-server-68291428-nic
```

**解决方案**：新增 `findNetworkInterfaceForInstance()` 方法，通过VM的网络配置动态获取真实的网络接口名称。

### 4. 虚拟网络和子网命名问题（第三次修复）

在第二次修复后发现新问题：虚拟网络和子网名称也存在命名不匹配：

**创建时的命名规则**：
```typescript
const vnetName = `${config.name}-vnet-${uniqueSuffix}`;
const subnetName = `${config.name}-subnet-${uniqueSuffix}`;
// 实际创建：az-server-68291428-vnet-718374, az-server-68291428-subnet-718374
```

**操作时的命名规则**：
```typescript
const vnetName = `${instanceId}-vnet`;
const subnetName = `${instanceId}-subnet`;
// 查找时使用：az-server-68291428-vnet, az-server-68291428-subnet
```

**解决方案**：新增 `findVNetAndSubnetForInstance()` 方法，通过网络接口的子网配置动态获取真实的虚拟网络和子网名称。

### 5. 修复优势

- **可靠性**：不依赖命名规则，通过API动态查找
- **向后兼容**：能处理所有现有实例，无论使用何种命名规则
- **未来安全**：不会因为命名规则变化而出问题
- **性能优化**：只查找cloudpanel相关的资源组，减少API调用
- **完整修复**：同时解决资源组、网络接口、虚拟网络和子网的命名不匹配问题

## 测试验证

修复后，以下功能应该能正常工作：

- ✅ Azure实例启动/关机/重启
- ✅ Azure实例IPv4地址更换
- ✅ Azure实例IPv6地址附加
- ✅ Azure实例删除

## 部署说明

此修复已应用到 `functions/shared/cloud-providers.ts` 文件中的 `AzureProvider` 类，部署后即可生效。

---

**修复时间**: 2025年10月17日  
**影响范围**: Azure实例操作功能  
**兼容性**: 向后兼容，不影响现有实例
