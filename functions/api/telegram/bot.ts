// functions/api/telegram/bot.ts - CloudPanel Telegram Bot 主控制器
import { Env, RequestContext, User, ApiKey, CloudInstance } from '../../shared/types';
import { createDatabaseService } from '../../shared/db';
import { createCloudProviderFromEncryptedKey, CloudInstanceManager } from '../../shared/cloud-providers';
import { CryptoService } from '../../shared/crypto';

const ITEMS_PER_PAGE = 5; // 每页显示的项目数

// Bot 状态管理
interface BotState {
    action: string;
    data?: any;
    step?: number;
    expiresAt: number;
}

// 时间格式化工具
class TimeFormatter {
    static formatRelativeTime(dateStr: string): string {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMinutes < 1) return '刚刚';
        if (diffMinutes < 60) return `${diffMinutes}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays < 30) return `${diffDays}天前`;
        
        return date.toLocaleDateString('zh-CN');
    }

    static formatFullTime(dateStr: string): string {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

// 实例状态中文映射
const STATUS_MAP: { [key: string]: string } = {
    'new': '创建中',
    'active': '运行中',
    'off': '已关机',
    'archive': '已归档',
    'running': '运行中',
    'stopped': '已停止',
    'stopping': '停止中',
    'starting': '启动中',
    'rebooting': '重启中',
    'provisioning': '配置中',
    'rebuilding': '重建中',
    'resizing': '调整大小中',
    'migrating': '迁移中',
    'deallocated': '已释放',
    'creating': '创建中'
};

// 地区中文映射
const REGION_MAP: { [key: string]: string } = {
    'nyc1': '纽约1',
    'nyc3': '纽约3',
    'ams3': '阿姆斯特丹3',
    'fra1': '法兰克福1',
    'lon1': '伦敦1',
    'sgp1': '新加坡1',
    'tor1': '多伦多1',
    'sfo3': '旧金山3',
    'blr1': '班加罗尔1',
    'us-east': '美国东部',
    'us-west': '美国西部',
    'eu-west': '欧洲西部',
    'eu-central': '欧洲中部',
    'ap-south': '亚太南部',
    'ap-southeast': '亚太东南',
    'eastus': '美国东部',
    'westus': '美国西部',
    'northeurope': '北欧',
    'westeurope': '西欧',
    'eastasia': '东亚',
    'southeastasia': '东南亚'
};

// Telegram API 辅助函数
export async function telegramApi(botToken: string, methodName: string, params: object) {
    const url = `https://api.telegram.org/bot${botToken}/${methodName}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        console.error(`Telegram API Error (${methodName}):`, errorData);
        throw new Error(`Telegram API Error: ${errorData.description || 'Unknown error'}`);
    }
    
    return response.json();
}

// Bot 主类
export class CloudPanelBot {
    constructor(
        private botToken: string,
        private user: User,
        private env: Env
    ) {}

    // 获取用户当前选中的 API 密钥
    private async getCurrentApiKey(): Promise<{ apiKey: ApiKey; provider: any } | null> {
        const db = createDatabaseService(this.env);
        const userKeys = await db.getApiKeysByUserId(this.user.id);
        
        if (userKeys.length === 0) {
            return null;
        }

        // 简化逻辑：使用第一个密钥作为当前密钥
        // 或者可以从用户设置中读取选中的密钥
        const apiKey = userKeys[0];
        
        try {
            const provider = await createCloudProviderFromEncryptedKey(
                apiKey.provider,
                apiKey.encrypted_key,
                this.env.ENCRYPTION_KEY
            );
            return { apiKey, provider };
        } catch (error) {
            console.error('创建云服务商客户端失败:', error);
            return null;
        }
    }

    // 保存 Bot 状态
    private async setBotState(chatId: string, state: BotState): Promise<void> {
        const key = `bot_state:${chatId}`;
        await this.env.KV.put(key, JSON.stringify(state), { 
            expirationTtl: 1800 // 30分钟过期
        });
    }

    // 获取 Bot 状态
    private async getBotState(chatId: string): Promise<BotState | null> {
        const key = `bot_state:${chatId}`;
        const stateJson = await this.env.KV.get(key);
        
        if (!stateJson) return null;
        
        const state = JSON.parse(stateJson) as BotState;
        if (Date.now() > state.expiresAt) {
            await this.env.KV.delete(key);
            return null;
        }
        
        return state;
    }

    // 清除 Bot 状态
    private async clearBotState(chatId: string): Promise<void> {
        const key = `bot_state:${chatId}`;
        await this.env.KV.delete(key);
    }

    // 格式化实例状态
    private formatInstanceStatus(status: string): string {
        return STATUS_MAP[status.toLowerCase()] || status;
    }

    // 格式化地区名称
    private formatRegionName(region: string): string {
        return REGION_MAP[region.toLowerCase()] || region;
    }

    // 格式化实例信息行
    private formatInstanceRow(instance: CloudInstance): string {
        const status = this.formatInstanceStatus(instance.status);
        const region = this.formatRegionName(instance.region);
        const ipv4 = instance.ip_address || '—';
        const ipv6 = instance.ipv6_address || '—';
        
        return `📦 ${instance.name} | ${status} | ${region}\nIPv4: ${ipv4} | IPv6: ${ipv6}`;
    }

    // 格式化实例详情
    private formatInstanceDetails(instance: CloudInstance): string {
        const status = this.formatInstanceStatus(instance.status);
        const region = this.formatRegionName(instance.region);
        const relativeTime = TimeFormatter.formatRelativeTime(instance.created_at);
        const fullTime = TimeFormatter.formatFullTime(instance.created_at);
        
        // 增强的实例详情显示
        let details = `📦 **${instance.name}**\n\n`;
        
        // 基本信息
        details += `**🔸 基本信息**\n`;
        details += `状态：${status}\n`;
        details += `ID：\`${instance.id}\`\n`;
        details += `区域：${region}\n`;
        details += `镜像：${instance.image || 'N/A'}\n\n`;
        
        // 网络信息
        details += `**🔸 网络信息**\n`;
        details += `IPv4：\`${instance.ip_address || '—'}\`\n`;
        details += `IPv6：\`${instance.ipv6_address || '—'}\`\n`;
        
        // 显示私有网络信息（如果有）
        if (instance.private_ip) {
            details += `私有IP：\`${instance.private_ip}\`\n`;
        }
        
        // 硬件配置
        details += `\n**🔸 硬件配置**\n`;
        details += `CPU：${instance.vcpus || 'N/A'} 核心\n`;
        
        // 内存显示优化
        if (instance.memory) {
            const memoryGB = instance.memory >= 1024 ? 
                `${(instance.memory / 1024).toFixed(1)}GB` : 
                `${instance.memory}MB`;
            details += `内存：${memoryGB}\n`;
        } else {
            details += `内存：N/A\n`;
        }
        
        details += `存储：${instance.disk ? instance.disk + 'GB' : 'N/A'} SSD\n`;
        
        // 价格信息（如果有）- 注释掉，因为当前CloudInstance类型不包含价格字段
        // if (instance.price_monthly || instance.price_hourly) {
        //     details += `\n**🔸 价格信息**\n`;
        //     if (instance.price_monthly) details += `月付：$${instance.price_monthly}/月\n`;
        //     if (instance.price_hourly) details += `时付：$${instance.price_hourly}/小时\n`;
        // }
        
        // 流量配额
        details += `\n**🔸 流量配额**\n`;
        if (instance.transfer?.quota) {
            details += `带宽：${instance.transfer.quota}GB/月`;
            if (instance.transfer.used) {
                details += ` (已用 ${instance.transfer.used}GB)`;
            }
            details += `\n`;
        } else {
            details += `带宽：不限制\n`;
        }
        
        // 时间信息
        details += `\n**🔸 时间信息**\n`;
        details += `创建：${relativeTime}\n`;
        details += `精确时间：${fullTime}`;
        
        // 显示标签（如果有）
        if (instance.tags && instance.tags.length > 0) {
            details += `\n\n**🔸 标签**\n${instance.tags.join(', ')}`;
        }
        
        return details;
    }

    // 生成主菜单键盘
    private getMainMenuKeyboard() {
        return {
            inline_keyboard: [
                [
                    { text: '📦 实例管理', callback_data: 'instances_list:0' },
                    { text: '🔑 密钥管理', callback_data: 'keys_list:0' }
                ],
                [
                    { text: '📊 账号信息', callback_data: 'account_info' },
                    { text: '🌐 浮动IP', callback_data: 'floating_ips:0' }
                ],
                [
                    { text: '➕ 创建实例', callback_data: 'create_instance_start' },
                    { text: '⚙️ 用户设置', callback_data: 'user_settings' }
                ],
                [
                    { text: '🔄 切换云服务商', callback_data: 'switch_provider' }
                ],
                [
                    { text: '❓ 帮助', callback_data: 'help' }
                ]
            ]
        };
    }

    // 生成实例列表键盘
    private getInstancesListKeyboard(instances: CloudInstance[], page: number) {
        const totalPages = Math.ceil(instances.length / ITEMS_PER_PAGE);
        const offset = page * ITEMS_PER_PAGE;
        const instancesOnPage = instances.slice(offset, offset + ITEMS_PER_PAGE);

        const keyboard = instancesOnPage.map(instance => [{
            text: `📦 ${instance.name} (${this.formatInstanceStatus(instance.status)})`,
            callback_data: `instance_details:${instance.id}`
        }]);

        // 添加分页导航
        const navigation = [];
        if (page > 0) navigation.push({ text: '⬅️ 上一页', callback_data: `instances_list:${page - 1}` });
        if (page < totalPages - 1) navigation.push({ text: '下一页 ➡️', callback_data: `instances_list:${page + 1}` });
        
        if (navigation.length > 0) keyboard.push(navigation);
        
        // 添加功能按钮
        keyboard.push([
            { text: '🔄 刷新', callback_data: `instances_list:${page}` },
            { text: '➕ 创建实例', callback_data: 'create_instance_start' }
        ]);
        keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]);

        return { inline_keyboard: keyboard };
    }

    // 生成实例详情键盘
    private getInstanceDetailsKeyboard(instance: CloudInstance) {
        const keyboard = [];
        
        // 根据状态显示不同的操作按钮
        if (instance.status === 'active' || instance.status === 'running') {
            keyboard.push([
                { text: '⏹ 关机', callback_data: `instance_action:${instance.id}:power_off` },
                { text: '🔁 重启', callback_data: `instance_action:${instance.id}:reboot` }
            ]);
        } else if (instance.status === 'off' || instance.status === 'stopped') {
            keyboard.push([
                { text: '▶️ 启动', callback_data: `instance_action:${instance.id}:power_on` }
            ]);
        }

        // IP 管理
        keyboard.push([
            { text: '🔄 更换 IPv4', callback_data: `change_ip:${instance.id}:IPv4` }
        ]);
        
        if (instance.ipv6_address) {
            keyboard.push([
                { text: '🔄 更换 IPv6', callback_data: `change_ip:${instance.id}:IPv6` }
            ]);
        } else {
            keyboard.push([
                { text: '🆕 添加 IPv6', callback_data: `add_ipv6:${instance.id}` }
            ]);
        }

        // 危险操作
        keyboard.push([
            { text: '🗑 删除实例', callback_data: `delete_instance_confirm:${instance.id}` }
        ]);

        // 导航按钮
        keyboard.push([
            { text: '🔄 刷新状态', callback_data: `instance_details:${instance.id}` },
            { text: '⬅️ 返回列表', callback_data: 'instances_list:0' }
        ]);

        return { inline_keyboard: keyboard };
    }

    // 生成 API 密钥列表键盘
    private getKeysListKeyboard(keys: ApiKey[], page: number, currentKeyId?: number) {
        const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE);
        const offset = page * ITEMS_PER_PAGE;
        const keysOnPage = keys.slice(offset, offset + ITEMS_PER_PAGE);

        const keyboard = keysOnPage.map(key => {
            const isCurrent = currentKeyId === key.id;
            const text = `🔑 ${key.name} (${key.provider})${isCurrent ? ' ✓' : ''}`;
            return [{
                text,
                callback_data: `key_details:${key.id}`
            }];
        });

        // 分页导航
        const navigation = [];
        if (page > 0) navigation.push({ text: '⬅️ 上一页', callback_data: `keys_list:${page - 1}` });
        if (page < totalPages - 1) navigation.push({ text: '下一页 ➡️', callback_data: `keys_list:${page + 1}` });
        
        if (navigation.length > 0) keyboard.push(navigation);

        // 功能按钮
        keyboard.push([
            { text: '🔄 刷新', callback_data: `keys_list:${page}` },
            { text: '➕ 添加密钥', callback_data: 'add_key_start' }
        ]);
        keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]);

        return { inline_keyboard: keyboard };
    }

    // 处理 /start 命令
    async handleStart(chatId: string): Promise<void> {
        const welcomeText = `👋 **欢迎使用 CloudPanel Bot！**\n\n` +
            `您好，${this.user.username}！\n\n` +
            `通过此Bot，您可以：\n` +
            `📦 管理云服务器实例\n` +
            `🔑 管理API密钥\n` +
            `📊 查看账户信息\n` +
            `➕ 创建新实例\n\n` +
            `请选择要执行的操作：`;

        await telegramApi(this.botToken, 'sendMessage', {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: 'Markdown',
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    // 处理 /keys 命令
    async handleKeys(chatId: string): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            console.log(`🔍 查询用户密钥 - 用户ID: ${this.user.id}, 用户名: ${this.user.username}`);
            
            const keys = await db.getApiKeysByUserId(this.user.id);
            console.log(`📋 找到 ${keys.length} 个密钥:`, keys.map(k => ({ id: k.id, name: k.name, provider: k.provider })));

            if (keys.length === 0) {
                // 也检查一下是否通过用户名能找到密钥（调试用）
                const allUsers = await db.getAllUsers();
                const currentUser = allUsers.find(u => u.username === this.user.username);
                console.log(`🔍 通过用户名查找: ${this.user.username}, 找到用户:`, currentUser ? { id: currentUser.id, username: currentUser.username } : 'null');
                
                if (currentUser && currentUser.id !== this.user.id) {
                    console.log(`⚠️ 用户ID不匹配! Bot用户ID: ${this.user.id}, 数据库用户ID: ${currentUser.id}`);
                    
                    // 使用正确的用户ID重新查询
                    const keysWithCorrectId = await db.getApiKeysByUserId(currentUser.id);
                    console.log(`🔍 使用正确ID (${currentUser.id}) 查询到 ${keysWithCorrectId.length} 个密钥`);
                    
                    if (keysWithCorrectId.length > 0) {
                        // 显示找到的密钥
                        const text = `🔑 **密钥管理**\n\n共有 ${keysWithCorrectId.length} 个API密钥：`;
                        await telegramApi(this.botToken, 'sendMessage', {
                            chat_id: chatId,
                            text: text,
                            parse_mode: 'Markdown',
                            reply_markup: this.getKeysListKeyboard(keysWithCorrectId, 0)
                        });
                        return;
                    }
                }

                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '🔑 **密钥管理**\n\n您还没有添加任何API密钥。\n\n💡 请在CloudPanel Web界面中添加API密钥，然后回来使用Bot管理功能。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 刷新密钥列表', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const currentKey = await this.getCurrentApiKey();
            const text = `🔑 **密钥管理**\n\n共有 ${keys.length} 个API密钥：`;

            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: this.getKeysListKeyboard(keys, 0, currentKey?.apiKey.id)
            });
        } catch (error) {
            console.error('获取密钥列表失败:', error);
            await this.sendErrorMessage(chatId, '获取密钥列表失败，请稍后重试。');
        }
    }

    // 处理 /instances 命令
    async handleInstances(chatId: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '❌ 请先添加并选择一个API密钥才能查看实例列表。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const instances = await instanceManager.listInstances();

            if (instances.length === 0) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '📦 **实例管理**\n\n您还没有任何云服务器实例。\n\n请创建一个新实例开始使用。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ 创建实例', callback_data: 'create_instance_start' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const text = `📦 **实例管理**\n\n共有 ${instances.length} 个实例：`;

            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: this.getInstancesListKeyboard(instances, 0)
            });
        } catch (error) {
            console.error('获取实例列表失败:', error);
            await this.sendErrorMessage(chatId, '获取实例列表失败，请稍后重试。');
        }
    }

    // 处理 /account 命令
    async handleAccount(chatId: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '❌ 请先添加并选择一个API密钥才能查看账户信息。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const [accountInfo, balance, instances] = await Promise.all([
                instanceManager.getAccountInfo(),
                instanceManager.getBalance(),
                instanceManager.listInstances()
            ]);

            let text = `📊 **账户信息**\n\n`;
            text += `🔑 **当前密钥：** ${currentApi.apiKey.name}\n`;
            text += `☁️ **云服务商：** ${currentApi.apiKey.provider}\n`;
            text += `📧 **账户邮箱：** ${accountInfo.email}\n`;
            text += `💰 **账户余额：** ${balance.balance} ${balance.currency}\n`;
            text += `📦 **实例数量：** ${instances.length}`;

            if (accountInfo.droplet_limit) {
                text += ` / ${accountInfo.droplet_limit}`;
            }

            if (balance.month_to_date_usage) {
                text += `\n💳 **本月使用：** ${balance.month_to_date_usage} ${balance.currency}`;
            }

            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 刷新', callback_data: 'account_info' }],
                        [{ text: '📦 查看实例', callback_data: 'instances_list:0' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        } catch (error) {
            console.error('获取账户信息失败:', error);
            await this.sendErrorMessage(chatId, '获取账户信息失败，请稍后重试。');
        }
    }

    // 处理 /help 命令
    async handleHelp(chatId: string): Promise<void> {
        const helpText = `❓ **CloudPanel Bot 帮助**\n\n` +
            `**可用命令：**\n` +
            `/start - 显示主菜单\n` +
            `/keys - 管理API密钥\n` +
            `/instances - 查看实例列表\n` +
            `/create - 创建新实例\n` +
            `/account - 查看账户信息\n` +
            `/help - 显示此帮助信息\n\n` +
            `**功能说明：**\n` +
            `📦 **实例管理** - 查看、启停、重启云服务器\n` +
            `🔑 **密钥管理** - 添加、删除、切换API密钥\n` +
            `🔄 **IP管理** - 更换IPv4/IPv6地址\n` +
            `➕ **创建实例** - 向导式创建新云服务器\n` +
            `📊 **账户信息** - 查看余额和使用情况\n\n` +
            `**支持的云服务商：**\n` +
            `• DigitalOcean\n` +
            `• Linode\n` +
            `• Microsoft Azure\n\n` +
            `**常见问题：**\n` +
            `Q: 如何添加API密钥？\n` +
            `A: 使用 /keys 命令，然后点击"添加密钥"按钮\n\n` +
            `Q: 为什么看不到实例？\n` +
            `A: 请确保已添加并选择了正确的API密钥\n\n` +
            `Q: 操作失败怎么办？\n` +
            `A: 请检查API密钥是否有效，稍后重试或联系管理员`;

        await telegramApi(this.botToken, 'sendMessage', {
            chat_id: chatId,
            text: helpText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 发送错误消息
    private async sendErrorMessage(chatId: string, message: string, showRetry: boolean = true): Promise<void> {
        const keyboard = [];
        if (showRetry) {
            keyboard.push([{ text: '🔄 重试', callback_data: 'retry_last_action' }]);
        }
        keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]);

        await telegramApi(this.botToken, 'sendMessage', {
            chat_id: chatId,
            text: `❌ ${message}`,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // 发送成功消息
    private async sendSuccessMessage(chatId: string, message: string): Promise<void> {
        await telegramApi(this.botToken, 'sendMessage', {
            chat_id: chatId,
            text: `✅ ${message}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 处理回调查询的主入口
    async handleCallbackQuery(callbackQuery: any): Promise<void> {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const data = callbackQuery.data;
        
        try {
            // 解析回调数据
            const [action, ...params] = data.split(':');
            
            switch (action) {
                case 'main_menu':
                    await this.handleMainMenu(chatId, messageId);
                    break;
                case 'instances_list':
                    await this.handleInstancesList(chatId, messageId, parseInt(params[0]) || 0);
                    break;
                case 'instance_details':
                    await this.handleInstanceDetails(chatId, messageId, params[0]);
                    break;
                case 'instance_action':
                    await this.handleInstanceAction(chatId, messageId, params[0], params[1]);
                    break;
                case 'change_ip':
                    await this.handleChangeIP(chatId, messageId, params[0], params[1] as 'IPv4' | 'IPv6');
                    break;
                case 'delete_instance_confirm':
                    await this.handleDeleteInstanceConfirm(chatId, messageId, params[0]);
                    break;
                case 'delete_instance_execute':
                    await this.handleDeleteInstanceExecute(chatId, messageId, params[0]);
                    break;
                case 'keys_list':
                    await this.handleKeysList(chatId, messageId, parseInt(params[0]) || 0);
                    break;
                case 'key_details':
                    await this.handleKeyDetails(chatId, messageId, parseInt(params[0]));
                    break;
                case 'account_info':
                    await this.handleAccountInfo(chatId, messageId);
                    break;
                case 'help':
                    await this.handleHelpCallback(chatId, messageId);
                    break;
                case 'floating_ips':
                    await this.handleFloatingIPs(chatId, messageId, parseInt(params[0]) || 0);
                    break;
                case 'floating_ip_assign':
                    await this.handleFloatingIPAssign(chatId, messageId, params[0]);
                    break;
                case 'floating_ip_unassign':
                    await this.handleFloatingIPUnassign(chatId, messageId, params[0]);
                    break;
                case 'floating_ip_delete':
                    await this.handleFloatingIPDelete(chatId, messageId, params[0]);
                    break;
                case 'user_settings':
                    await this.handleUserSettingsCallback(chatId, messageId);
                    break;
                case 'change_password':
                    await this.handleChangePassword(chatId, messageId);
                    break;
                case 'notification_settings':
                    await this.handleNotificationSettings(chatId, messageId);
                    break;
                case 'delete_invalid_keys':
                    await this.handleDeleteInvalidKeys(chatId, messageId);
                    break;
                case 'delete_invalid_keys_confirm':
                    await this.handleDeleteInvalidKeysConfirm(chatId, messageId);
                    break;
                case 'delete_invalid_keys_execute':
                    await this.handleDeleteInvalidKeysExecute(chatId, messageId);
                    break;
                case 'user_keys_list':
                    await this.handleUserKeysList(chatId, messageId);
                    break;
                case 'user_test_my_keys':
                case 'user_test_3_keys': // 测试前3个密钥（用于密钥数量多的情况）
                    await this.handleUserTestMyKeys(chatId, messageId);
                    break;
                // 创建实例相关回调
                case 'create_instance_start':
                case 'create_region':
                case 'create_image':
                case 'create_plan':
                case 'create_count':
                case 'create_confirm':
                case 'create_execute':
                case 'create_name_custom':
                case 'create_name_auto':
                case 'create_password_custom':
                case 'create_password_random':
                case 'create_toggle_ipv6':
                    await this.handleCreateCallbacks(callbackQuery);
                    break;
                // API 密钥管理相关回调
                case 'add_key_start':
                case 'add_key_provider':
                case 'add_key_save':
                case 'select_key':
                case 'delete_key_confirm':
                case 'delete_key_execute':
                case 'azure_input_separate':
                case 'azure_input_json':
                    await this.handleKeyManagementCallbacks(callbackQuery);
                    break;
                default:
                    console.log(`未处理的回调操作: ${action}`);
                    break;
            }

            // 应答回调查询
            await telegramApi(this.botToken, 'answerCallbackQuery', {
                callback_query_id: callbackQuery.id
            });

        } catch (error) {
            console.error('处理回调查询失败:', error);
            
            // 应答回调查询并显示错误
            await telegramApi(this.botToken, 'answerCallbackQuery', {
                callback_query_id: callbackQuery.id,
                text: '操作失败，请重试',
                show_alert: true
            });
        }
    }

    // 处理主菜单回调
    private async handleMainMenu(chatId: string, messageId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🏠 **主菜单**\n\n选择要执行的操作：`,
            parse_mode: 'Markdown',
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    // 处理实例列表回调
    private async handleInstancesList(chatId: string, messageId: number, page: number): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 请先添加并选择一个API密钥。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const instances = await instanceManager.listInstances();

            if (instances.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '📦 **实例管理**\n\n您还没有任何实例。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ 创建实例', callback_data: 'create_instance_start' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const totalPages = Math.ceil(instances.length / ITEMS_PER_PAGE);
            const text = `📦 **实例管理** (第${page + 1}/${totalPages}页)\n\n共有 ${instances.length} 个实例：`;

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: this.getInstancesListKeyboard(instances, page)
            });
        } catch (error) {
            console.error('获取实例列表失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取实例列表失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `instances_list:${page}` }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 处理实例详情回调
    private async handleInstanceDetails(chatId: string, messageId: number, instanceId: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'answerCallbackQuery', {
                    callback_query_id: messageId.toString(),
                    text: '请先选择API密钥',
                    show_alert: true
                });
                return;
            }

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const instances = await instanceManager.listInstances();
            const instance = instances.find(i => i.id.toString() === instanceId);

            if (!instance) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 实例不存在或已被删除。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                        ]
                    }
                });
                return;
            }

            const detailsText = this.formatInstanceDetails(instance);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: detailsText,
                parse_mode: 'Markdown',
                reply_markup: this.getInstanceDetailsKeyboard(instance)
            });
        } catch (error) {
            console.error('获取实例详情失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取实例详情失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `instance_details:${instanceId}` }],
                        [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                    ]
                }
            });
        }
    }

    // 处理实例操作回调
    private async handleInstanceAction(chatId: string, messageId: number, instanceId: string, action: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            
            let result = false;
            let actionDescription = '';

            switch (action) {
                case 'power_on':
                    result = await instanceManager.startInstance(instanceId);
                    actionDescription = '启动';
                    break;
                case 'power_off':
                    result = await instanceManager.stopInstance(instanceId);
                    actionDescription = '关机';
                    break;
                case 'reboot':
                    result = await instanceManager.rebootInstance(instanceId);
                    actionDescription = '重启';
                    break;
                default:
                    throw new Error(`不支持的操作: ${action}`);
            }

            if (result) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `✅ ${actionDescription}操作已提交，请稍后查看状态。`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 刷新状态', callback_data: `instance_details:${instanceId}` }],
                            [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                        ]
                    }
                });
            } else {
                throw new Error(`${actionDescription}操作失败`);
            }
        } catch (error) {
            console.error('实例操作失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `❌ 操作失败：${error instanceof Error ? error.message : '未知错误'}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `instance_action:${instanceId}:${action}` }],
                        [{ text: '⬅️ 返回详情', callback_data: `instance_details:${instanceId}` }]
                    ]
                }
            });
        }
    }

    // 处理更换IP回调
    private async handleChangeIP(chatId: string, messageId: number, instanceId: string, ipVersion: 'IPv4' | 'IPv6'): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const newIP = await instanceManager.changeInstanceIP(instanceId, ipVersion);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `✅ ${ipVersion}地址更换成功！\n\n新的${ipVersion}地址：${newIP}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 刷新状态', callback_data: `instance_details:${instanceId}` }],
                        [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                    ]
                }
            });
        } catch (error) {
            console.error('更换IP失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `❌ ${ipVersion}地址更换失败：${error instanceof Error ? error.message : '未知错误'}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `change_ip:${instanceId}:${ipVersion}` }],
                        [{ text: '⬅️ 返回详情', callback_data: `instance_details:${instanceId}` }]
                    ]
                }
            });
        }
    }

    // 处理删除实例确认回调
    private async handleDeleteInstanceConfirm(chatId: string, messageId: number, instanceId: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const instances = await instanceManager.listInstances();
            const instance = instances.find(i => i.id.toString() === instanceId);

            if (!instance) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 实例不存在或已被删除。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                        ]
                    }
                });
                return;
            }

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `⚠️ **删除确认**\n\n您确定要删除实例 **${instance.name}** 吗？\n\n❗ 此操作不可撤销，实例的所有数据将被永久删除！`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑 确认删除', callback_data: `delete_instance_execute:${instanceId}` }],
                        [{ text: '❌ 取消', callback_data: `instance_details:${instanceId}` }]
                    ]
                }
            });
        } catch (error) {
            console.error('获取实例信息失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取实例信息失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回列表', callback_data: 'instances_list:0' }]
                    ]
                }
            });
        }
    }

    // 处理删除实例执行回调
    private async handleDeleteInstanceExecute(chatId: string, messageId: number, instanceId: string): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const result = await instanceManager.deleteInstance(instanceId);

            if (result) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `✅ 实例删除操作已提交。\n\n实例将在几分钟内被删除，请稍后刷新列表查看。`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📦 查看实例列表', callback_data: 'instances_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
            } else {
                throw new Error('删除操作失败');
            }
        } catch (error) {
            console.error('删除实例失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `❌ 删除实例失败：${error instanceof Error ? error.message : '未知错误'}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `delete_instance_execute:${instanceId}` }],
                        [{ text: '⬅️ 返回详情', callback_data: `instance_details:${instanceId}` }]
                    ]
                }
            });
        }
    }

    // 处理密钥列表回调
    private async handleKeysList(chatId: string, messageId: number, page: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const keys = await db.getApiKeysByUserId(this.user.id);

            if (keys.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🔑 **密钥管理**\n\n您还没有添加任何API密钥。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ 添加密钥', callback_data: 'add_key_start' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const currentKey = await this.getCurrentApiKey();
            const totalPages = Math.ceil(keys.length / ITEMS_PER_PAGE);
            const text = `🔑 **密钥管理** (第${page + 1}/${totalPages}页)\n\n共有 ${keys.length} 个API密钥：`;

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: this.getKeysListKeyboard(keys, page, currentKey?.apiKey.id)
            });
        } catch (error) {
            console.error('获取密钥列表失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取密钥列表失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `keys_list:${page}` }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 处理密钥详情回调
    private async handleKeyDetails(chatId: string, messageId: number, keyId: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const key = await db.getApiKeyById(keyId);

            if (!key || key.user_id !== this.user.id) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 密钥不存在或无权限访问。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回列表', callback_data: 'keys_list:0' }]
                        ]
                    }
                });
                return;
            }

            const currentKey = await this.getCurrentApiKey();
            const isCurrent = currentKey?.apiKey.id === keyId;
            const createdAt = TimeFormatter.formatFullTime(key.created_at);

            let text = `🔑 **密钥详情**\n\n`;
            text += `**名称：** ${key.name}\n`;
            text += `**云服务商：** ${key.provider}\n`;
            text += `**状态：** ${isCurrent ? '✅ 当前使用' : '⭕ 未选择'}\n`;
            text += `**创建时间：** ${createdAt}`;

            const keyboard = [];
            
            if (!isCurrent) {
                keyboard.push([{ text: '✅ 设为当前', callback_data: `select_key:${keyId}` }]);
            }
            
            keyboard.push([
                { text: '🗑 删除密钥', callback_data: `delete_key_confirm:${keyId}` }
            ]);
            keyboard.push([
                { text: '⬅️ 返回列表', callback_data: 'keys_list:0' }
            ]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (error) {
            console.error('获取密钥详情失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取密钥详情失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `key_details:${keyId}` }],
                        [{ text: '⬅️ 返回列表', callback_data: 'keys_list:0' }]
                    ]
                }
            });
        }
    }

    // 处理账户信息回调
    private async handleAccountInfo(chatId: string, messageId: number): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 请先添加并选择一个API密钥。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const [accountInfo, balance, instances] = await Promise.all([
                instanceManager.getAccountInfo(),
                instanceManager.getBalance(),
                instanceManager.listInstances()
            ]);

            let text = `📊 **账户信息**\n\n`;
            text += `🔑 **当前密钥：** ${currentApi.apiKey.name}\n`;
            text += `☁️ **云服务商：** ${currentApi.apiKey.provider}\n`;
            text += `📧 **账户邮箱：** ${accountInfo.email}\n`;
            text += `💰 **账户余额：** ${balance.balance} ${balance.currency}\n`;
            text += `📦 **实例数量：** ${instances.length}`;

            if (accountInfo.droplet_limit) {
                text += ` / ${accountInfo.droplet_limit}`;
            }

            if (balance.month_to_date_usage) {
                text += `\n💳 **本月使用：** ${balance.month_to_date_usage} ${balance.currency}`;
            }

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 刷新', callback_data: 'account_info' }],
                        [{ text: '📦 查看实例', callback_data: 'instances_list:0' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        } catch (error) {
            console.error('获取账户信息失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取账户信息失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'account_info' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 处理帮助回调
    private async handleHelpCallback(chatId: string, messageId: number): Promise<void> {
        await this.handleHelp(chatId.toString());
    }

    // === 创建实例多轮表单 ===

    // 开始创建实例流程
    async handleCreateInstanceStart(chatId: string, messageId?: number): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                const text = '❌ 请先添加并选择一个API密钥才能创建实例。';
                const markup = {
                    inline_keyboard: [
                        [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                };

                if (messageId) {
                    await telegramApi(this.botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text,
                        reply_markup: markup
                    });
                } else {
                    await telegramApi(this.botToken, 'sendMessage', {
                        chat_id: chatId,
                        text,
                        reply_markup: markup
                    });
                }
                return;
            }

            // 获取可用地区
            const regions = await currentApi.provider.getRegions();
            
            // 保存创建状态
            await this.setBotState(chatId, {
                action: 'create_instance',
                step: 1,
                data: { provider: currentApi.apiKey.provider },
                expiresAt: Date.now() + 1800000 // 30分钟
            });

            const text = `➕ **创建新实例 - 步骤 1/6**\n\n` +
                `选择服务器地区：\n\n` +
                `💡 建议选择离您较近的地区以获得更好的网络延迟。`;

            const keyboard = regions.slice(0, 10).map((region: any) => ([{
                text: `🌍 ${this.formatRegionName(region.slug)} (${region.slug})`,
                callback_data: `create_region:${region.slug}`
            }]));

            keyboard.push([{ text: '❌ 取消创建', callback_data: 'main_menu' }]);

            const params: any = {
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            };

            if (messageId) {
                params.message_id = messageId;
                await telegramApi(this.botToken, 'editMessageText', params);
            } else {
                await telegramApi(this.botToken, 'sendMessage', params);
            }

        } catch (error) {
            console.error('开始创建实例失败:', error);
            await this.sendErrorMessage(chatId, '获取地区列表失败，请稍后重试。');
        }
    }

    // 选择地区后，选择镜像
    async handleCreateRegion(chatId: string, messageId: number, region: string): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            // 获取镜像列表
            const images = await currentApi.provider.getImages();
            const popularImages = images.filter((img: any) => 
                img.name.toLowerCase().includes('ubuntu') ||
                img.name.toLowerCase().includes('centos') ||
                img.name.toLowerCase().includes('debian') ||
                img.name.toLowerCase().includes('windows')
            ).slice(0, 8);

            // 更新状态
            state.step = 2;
            state.data.region = region;
            await this.setBotState(chatId, state);

            const text = `➕ **创建新实例 - 步骤 2/6**\n\n` +
                `地区：${this.formatRegionName(region)}\n\n` +
                `选择操作系统镜像：`;

            const keyboard = popularImages.map((image: any) => ([{
                text: `💽 ${image.name}`,
                callback_data: `create_image:${image.id || image.slug}`
            }]));

            keyboard.push([
                { text: '⬅️ 上一步', callback_data: 'create_instance_start' },
                { text: '❌ 取消', callback_data: 'main_menu' }
            ]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('选择地区失败:', error);
            await this.sendErrorMessage(chatId, '获取镜像列表失败，请稍后重试。');
        }
    }

    // 选择镜像后，选择配置
    async handleCreateImage(chatId: string, messageId: number, image: string): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            // 获取配置计划
            const plans = await currentApi.provider.getPlans();
            const affordablePlans = plans.slice(0, 8); // 显示前8个配置

            // 更新状态
            state.step = 3;
            state.data.image = image;
            await this.setBotState(chatId, state);

            const text = `➕ **创建新实例 - 步骤 3/6**\n\n` +
                `地区：${this.formatRegionName(state.data.region)}\n` +
                `镜像：${image}\n\n` +
                `选择服务器配置：`;

            const keyboard = affordablePlans.map((plan: any) => {
                const monthlyPrice = plan.price_monthly ? `$${plan.price_monthly}/月` : `$${plan.price_hourly}/小时`;
                return [{
                    text: `💻 ${plan.vcpus}CPU/${plan.memory}MB/${plan.disk}GB - ${monthlyPrice}`,
                    callback_data: `create_plan:${plan.slug}`
                }];
            });

            keyboard.push([
                { text: '⬅️ 上一步', callback_data: `create_region:${state.data.region}` },
                { text: '❌ 取消', callback_data: 'main_menu' }
            ]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('选择镜像失败:', error);
            await this.sendErrorMessage(chatId, '获取配置列表失败，请稍后重试。');
        }
    }

    // 选择配置后，设置实例数量
    async handleCreatePlan(chatId: string, messageId: number, plan: string): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            // 更新状态
            state.step = 4;
            state.data.plan = plan;
            await this.setBotState(chatId, state);

            const text = `➕ **创建新实例 - 步骤 4/6**\n\n` +
                `地区：${this.formatRegionName(state.data.region)}\n` +
                `镜像：${state.data.image}\n` +
                `配置：${plan}\n\n` +
                `选择创建数量（1-10个）：`;

            const keyboard = [];
            for (let i = 1; i <= 10; i++) {
                if (i <= 5) {
                    if (keyboard.length === 0 || keyboard[keyboard.length - 1].length === 5) {
                        keyboard.push([]);
                    }
                    keyboard[keyboard.length - 1].push({
                        text: `${i}个`,
                        callback_data: `create_count:${i}`
                    });
                } else {
                    keyboard.push([{
                        text: `${i}个实例`,
                        callback_data: `create_count:${i}`
                    }]);
                }
            }

            keyboard.push([
                { text: '⬅️ 上一步', callback_data: `create_image:${state.data.image}` },
                { text: '❌ 取消', callback_data: 'main_menu' }
            ]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('选择配置失败:', error);
            await this.sendErrorMessage(chatId, '设置失败，请稍后重试。');
        }
    }

    // 选择数量后，设置名称和密码
    async handleCreateCount(chatId: string, messageId: number, count: string): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            // 更新状态
            state.step = 5;
            state.data.count = parseInt(count);
            await this.setBotState(chatId, state);

            const text = `➕ **创建新实例 - 步骤 5/6**\n\n` +
                `地区：${this.formatRegionName(state.data.region)}\n` +
                `镜像：${state.data.image}\n` +
                `配置：${state.data.plan}\n` +
                `数量：${count}个\n\n` +
                `设置选项：`;

            const keyboard = [
                [{ text: '🏷 自定义名称', callback_data: 'create_name_custom' }],
                [{ text: '🎲 自动生成名称', callback_data: 'create_name_auto' }],
                [{ text: '🔐 设置密码', callback_data: 'create_password_custom' }],
                [{ text: '🎲 随机生成密码', callback_data: 'create_password_random' }],
                [{ text: '🌐 启用IPv6', callback_data: 'create_toggle_ipv6' }]
            ];

            // 显示当前设置状态
            let currentSettings = '\n**当前设置：**\n';
            currentSettings += `名称：${state.data.customName || '自动生成'}\n`;
            currentSettings += `密码：${state.data.customPassword ? '已设置' : '随机生成'}\n`;
            currentSettings += `IPv6：${state.data.enableIPv6 ? '启用' : '禁用'}`;

            keyboard.push([
                { text: '⬅️ 上一步', callback_data: `create_plan:${state.data.plan}` },
                { text: '✅ 确认创建', callback_data: 'create_confirm' }
            ]);
            keyboard.push([{ text: '❌ 取消', callback_data: 'main_menu' }]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text + currentSettings,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('设置数量失败:', error);
            await this.sendErrorMessage(chatId, '设置失败，请稍后重试。');
        }
    }

    // 确认创建
    async handleCreateConfirm(chatId: string, messageId: number): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            // 显示确认信息
            const count = state.data.count || 1;
            let confirmText = `✅ **确认创建实例**\n\n`;
            confirmText += `**配置摘要：**\n`;
            confirmText += `地区：${this.formatRegionName(state.data.region)}\n`;
            confirmText += `镜像：${state.data.image}\n`;
            confirmText += `配置：${state.data.plan}\n`;
            confirmText += `数量：${count}个\n`;
            confirmText += `名称：${state.data.customName || '自动生成'}\n`;
            confirmText += `密码：${state.data.customPassword ? '自定义' : '随机生成'}\n`;
            confirmText += `IPv6：${state.data.enableIPv6 ? '启用' : '禁用'}\n\n`;
            confirmText += `⚠️ **请确认后点击"开始创建"，创建过程需要几分钟时间。**`;

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: confirmText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 开始创建', callback_data: 'create_execute' }],
                        [{ text: '⬅️ 修改设置', callback_data: `create_count:${count}` }],
                        [{ text: '❌ 取消', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            console.error('确认创建失败:', error);
            await this.sendErrorMessage(chatId, '确认失败，请稍后重试。');
        }
    }

    // 执行创建
    async handleCreateExecute(chatId: string, messageId: number): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'create_instance') {
                await this.sendErrorMessage(chatId, '会话已过期，请重新开始创建。');
                return;
            }

            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) return;

            // 显示创建中状态
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '🚀 **正在创建实例...**\n\n请稍候，这可能需要几分钟时间。',
                parse_mode: 'Markdown'
            });

            const instanceManager = new CloudInstanceManager(currentApi.provider);
            const count = state.data.count || 1;
            const createdInstances = [];
            const failedCreations = [];

            // 批量创建实例
            for (let i = 0; i < count; i++) {
                try {
                    const instanceName = state.data.customName || 
                        `${state.data.provider}-server-${Date.now()}-${i + 1}`;

                    const createConfig = {
                        name: instanceName,
                        region: state.data.region,
                        image: state.data.image,
                        size: state.data.plan,
                        enableIPv6: state.data.enableIPv6 || false,
                        user_data: state.data.customPassword ? 
                            `#!/bin/bash\necho 'root:${state.data.customPassword}' | chpasswd` : 
                            undefined
                    };

                    const newInstance = await instanceManager.createInstance(createConfig);
                    createdInstances.push(newInstance);
                } catch (error) {
                    console.error(`创建第${i + 1}个实例失败:`, error);
                    failedCreations.push({
                        index: i + 1,
                        error: error instanceof Error ? error.message : '未知错误'
                    });
                }
            }

            // 清除状态
            await this.clearBotState(chatId);

            // 显示创建结果
            let resultText = '🎉 **实例创建完成！**\n\n';
            
            if (createdInstances.length > 0) {
                resultText += `✅ **成功创建 ${createdInstances.length} 个实例：**\n`;
                createdInstances.forEach((instance, index) => {
                    resultText += `${index + 1}. ${instance.name} (${instance.id})\n`;
                });
                resultText += '\n';
            }

            if (failedCreations.length > 0) {
                resultText += `❌ **失败 ${failedCreations.length} 个：**\n`;
                failedCreations.forEach(failed => {
                    resultText += `${failed.index}. ${failed.error}\n`;
                });
                resultText += '\n';
            }

            resultText += '💡 实例可能需要几分钟时间完成初始化，请稍后查看状态。';

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: resultText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 查看实例列表', callback_data: 'instances_list:0' }],
                        [{ text: '➕ 继续创建', callback_data: 'create_instance_start' }],
                        [{ text: '🏠 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            console.error('执行创建失败:', error);
            await this.clearBotState(chatId);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `❌ 创建实例失败：${error instanceof Error ? error.message : '未知错误'}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'create_instance_start' }],
                        [{ text: '🏠 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 处理创建实例相关的回调
    async handleCreateCallbacks(callbackQuery: any): Promise<void> {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const data = callbackQuery.data;
        const [action, param] = data.split(':');

        switch (action) {
            case 'create_instance_start':
                await this.handleCreateInstanceStart(chatId.toString(), messageId);
                break;
            case 'create_region':
                await this.handleCreateRegion(chatId, messageId, param);
                break;
            case 'create_image':
                await this.handleCreateImage(chatId, messageId, param);
                break;
            case 'create_plan':
                await this.handleCreatePlan(chatId, messageId, param);
                break;
            case 'create_count':
                await this.handleCreateCount(chatId, messageId, param);
                break;
            case 'create_confirm':
                await this.handleCreateConfirm(chatId, messageId);
                break;
            case 'create_execute':
                await this.handleCreateExecute(chatId, messageId);
                break;
            case 'create_name_custom':
                await this.handleCreateNameCustom(chatId, messageId);
                break;
            case 'create_name_auto':
                await this.handleCreateNameAuto(chatId, messageId);
                break;
            case 'create_password_custom':
                await this.handleCreatePasswordCustom(chatId, messageId);
                break;
            case 'create_password_random':
                await this.handleCreatePasswordRandom(chatId, messageId);
                break;
            case 'create_toggle_ipv6':
                await this.handleCreateToggleIPv6(chatId, messageId);
                break;
        }
    }

    // 自定义名称
    private async handleCreateNameCustom(chatId: string, messageId: number): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        // 设置等待输入状态
        state.action = 'waiting_name_input';
        await this.setBotState(chatId, state);

        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: '🏷 **自定义实例名称**\n\n请输入实例名称（3-64个字符，支持字母、数字、短横线）：',
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ 取消', callback_data: `create_count:${state.data.count}` }]
                ]
            }
        });
    }

    // 自动生成名称
    private async handleCreateNameAuto(chatId: string, messageId: number): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        state.action = 'create_instance';
        delete state.data.customName;
        await this.setBotState(chatId, state);

        await this.handleCreateCount(chatId, messageId, state.data.count.toString());
    }

    // 自定义密码
    private async handleCreatePasswordCustom(chatId: string, messageId: number): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        state.action = 'waiting_password_input';
        await this.setBotState(chatId, state);

        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: '🔐 **设置root密码**\n\n请输入密码（至少8个字符，建议包含大小写字母、数字和特殊字符）：',
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ 取消', callback_data: `create_count:${state.data.count}` }]
                ]
            }
        });
    }

    // 随机生成密码
    private async handleCreatePasswordRandom(chatId: string, messageId: number): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        state.action = 'create_instance';
        delete state.data.customPassword;
        await this.setBotState(chatId, state);

        await this.handleCreateCount(chatId, messageId, state.data.count.toString());
    }

    // 切换IPv6
    private async handleCreateToggleIPv6(chatId: string, messageId: number): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        state.data.enableIPv6 = !state.data.enableIPv6;
        await this.setBotState(chatId, state);

        await this.handleCreateCount(chatId, messageId, state.data.count.toString());
    }

    // 处理文本输入
    async handleTextInput(chatId: string, text: string): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        if (state.action === 'waiting_name_input') {
            // 验证实例名称
            if (text.length < 3 || text.length > 64) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '❌ 名称长度必须在3-64个字符之间，请重新输入：'
                });
                return;
            }

            if (!/^[a-zA-Z0-9-]+$/.test(text)) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '❌ 名称只能包含字母、数字和短横线，请重新输入：'
                });
                return;
            }

            // 保存名称并返回创建流程
            state.action = 'create_instance';
            state.data.customName = text;
            await this.setBotState(chatId, state);

            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: `✅ 实例名称已设置为：${text}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回设置', callback_data: `create_count:${state.data.count}` }]
                    ]
                }
            });

        } else if (state.action === 'waiting_password_input') {
            // 验证密码
            if (text.length < 8) {
                await telegramApi(this.botToken, 'sendMessage', {
                    chat_id: chatId,
                    text: '❌ 密码长度至少8个字符，请重新输入：'
                });
                return;
            }

            // 保存密码并返回创建流程
            state.action = 'create_instance';
            state.data.customPassword = text;
            await this.setBotState(chatId, state);

            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: '✅ 密码已设置',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回设置', callback_data: `create_count:${state.data.count}` }]
                    ]
                }
            });
        }
    }

    // 处理密钥管理回调
    async handleKeyManagementCallbacks(callbackQuery: any): Promise<void> {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const data = callbackQuery.data;
        const [action, param] = data.split(':');

        switch (action) {
            case 'add_key_start':
                await this.handleAddKeyStart(chatId.toString(), messageId);
                break;
            case 'add_key_provider':
                await this.handleAddKeyInput(chatId, messageId, param);
                break;
            case 'add_key_save':
                await this.handleAddKeySave(chatId, messageId);
                break;
            case 'select_key':
                await this.handleSelectKey(chatId, messageId, parseInt(param));
                break;
            case 'delete_key_confirm':
                await this.handleDeleteKeyConfirm(chatId, messageId, parseInt(param));
                break;
            case 'delete_key_execute':
                await this.handleDeleteKeyExecute(chatId, messageId, parseInt(param));
                break;
            case 'azure_input_separate':
                await this.handleAzureInputSeparate(chatId, messageId);
                break;
            case 'azure_input_json':
                await this.handleAzureInputJson(chatId, messageId);
                break;
        }
    }

    // 简化的添加密钥开始方法
    async handleAddKeyStart(chatId: string, messageId?: number): Promise<void> {
        const text = `🔑 **添加新API密钥**\n\n` +
            `请输入密钥名称（用于识别不同的密钥）：\n\n` +
            `💡 例如：我的DigitalOcean密钥、生产环境密钥等`;

        const params: any = {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ 取消添加', callback_data: 'keys_list:0' }]
                ]
            }
        };

        if (messageId) {
            params.message_id = messageId;
            await telegramApi(this.botToken, 'editMessageText', params);
        } else {
            await telegramApi(this.botToken, 'sendMessage', params);
        }
    }

    // 输入API密钥的简化版本
    async handleAddKeyInput(chatId: string, messageId: number, provider: string): Promise<void> {
        const text = `🔑 **添加 ${provider.toUpperCase()} API密钥**\n\n` +
            `请输入您的API密钥或Token：\n\n` +
            `⚠️ 密钥将被加密存储，确保安全性。`;

        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ 取消', callback_data: 'keys_list:0' }]
                ]
            }
        });
    }

    // 保存密钥的简化版本
    async handleAddKeySave(chatId: string, messageId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `✅ **密钥添加功能开发中**\n\n此功能正在开发中，敬请期待。\n\n您可以在Web界面中添加密钥。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔑 查看密钥列表', callback_data: 'keys_list:0' }],
                    [{ text: '🏠 返回主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 选择密钥
    async handleSelectKey(chatId: string, messageId: number, keyId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `✅ **密钥选择功能开发中**\n\n此功能正在开发中，敬请期待。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔑 密钥列表', callback_data: 'keys_list:0' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 删除密钥确认
    async handleDeleteKeyConfirm(chatId: string, messageId: number, keyId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `⚠️ **删除密钥功能开发中**\n\n此功能正在开发中，敬请期待。\n\n您可以在Web界面中删除密钥。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔑 密钥列表', callback_data: 'keys_list:0' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 执行删除密钥
    async handleDeleteKeyExecute(chatId: string, messageId: number, keyId: number): Promise<void> {
        await this.handleDeleteKeyConfirm(chatId, messageId, keyId);
    }

    // Azure 输入处理
    async handleAzureInputSeparate(chatId: string, messageId: number): Promise<void> {
        await this.handleAddKeyInput(chatId, messageId, 'azure');
    }

    async handleAzureInputJson(chatId: string, messageId: number): Promise<void> {
        await this.handleAddKeyInput(chatId, messageId, 'azure');
    }

    // 扩展文本输入处理
    async handleExtendedTextInput(chatId: string, text: string): Promise<void> {
        const state = await this.getBotState(chatId);
        if (!state) return;

        // 处理原有的创建实例输入
        if (state.action === 'waiting_name_input' || state.action === 'waiting_password_input') {
            await this.handleTextInput(chatId, text);
            return;
        }

        // 处理新的密钥管理输入（简化版本）
        if (state.action.includes('waiting_key') || state.action.includes('waiting_azure')) {
            await telegramApi(this.botToken, 'sendMessage', {
                chat_id: chatId,
                text: '✅ 输入已接收，但密钥添加功能仍在开发中。\n\n请在Web界面中管理密钥。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔑 密钥列表', callback_data: 'keys_list:0' }],
                        [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
            await this.clearBotState(chatId);
        }
    }

    // === 浮动IP管理功能 ===

    // 处理浮动IP列表
    async handleFloatingIPs(chatId: string, messageId: number, page: number): Promise<void> {
        try {
            const currentApi = await this.getCurrentApiKey();
            if (!currentApi) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 请先添加并选择一个API密钥。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            // 获取浮动IP列表
            const response = await fetch(`/api/floating-ips`, {
                headers: {
                    'Authorization': `Bearer ${currentApi.apiKey.encrypted_key}` // 这里需要适配实际认证方式
                }
            });

            if (!response.ok) {
                throw new Error('获取浮动IP列表失败');
            }

            const data = await response.json();
            const floatingIPs = data.floating_ips || [];

            if (floatingIPs.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🌐 **浮动IP管理**\n\n您还没有任何浮动IP。\n\n💡 浮动IP可以在实例之间灵活分配，提供更好的网络灵活性。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ 创建浮动IP', callback_data: 'create_floating_ip' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            const totalPages = Math.ceil(floatingIPs.length / ITEMS_PER_PAGE);
            const offset = page * ITEMS_PER_PAGE;
            const ipsOnPage = floatingIPs.slice(offset, offset + ITEMS_PER_PAGE);

            let text = `🌐 **浮动IP管理** (第${page + 1}/${totalPages}页)\n\n共有 ${floatingIPs.length} 个浮动IP：\n\n`;

            const keyboard = ipsOnPage.map((ip: any) => {
                const status = ip.droplet ? `分配给 ${ip.droplet.name}` : '未分配';
                return [{
                    text: `${ip.ip} (${status})`,
                    callback_data: `floating_ip_details:${ip.ip}`
                }];
            });

            // 分页导航
            const navigation = [];
            if (page > 0) navigation.push({ text: '⬅️ 上一页', callback_data: `floating_ips:${page - 1}` });
            if (page < totalPages - 1) navigation.push({ text: '下一页 ➡️', callback_data: `floating_ips:${page + 1}` });
            
            if (navigation.length > 0) keyboard.push(navigation);

            // 功能按钮
            keyboard.push([
                { text: '🔄 刷新', callback_data: `floating_ips:${page}` },
                { text: '➕ 创建浮动IP', callback_data: 'create_floating_ip' }
            ]);
            keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('获取浮动IP列表失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取浮动IP列表失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: `floating_ips:${page}` }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 分配浮动IP（简化版本）
    async handleFloatingIPAssign(chatId: string, messageId: number, ip: string): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🌐 **浮动IP分配功能开发中**\n\nIP: ${ip}\n\n此功能正在开发中，敬请期待。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 浮动IP列表', callback_data: 'floating_ips:0' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 解除分配浮动IP（简化版本）
    async handleFloatingIPUnassign(chatId: string, messageId: number, ip: string): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🌐 **浮动IP解除分配功能开发中**\n\nIP: ${ip}\n\n此功能正在开发中，敬请期待。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 浮动IP列表', callback_data: 'floating_ips:0' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 删除浮动IP（简化版本）
    async handleFloatingIPDelete(chatId: string, messageId: number, ip: string): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🌐 **浮动IP删除功能开发中**\n\nIP: ${ip}\n\n此功能正在开发中，敬请期待。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 浮动IP列表', callback_data: 'floating_ips:0' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // === 用户设置功能 ===

    // 处理用户设置回调
    async handleUserSettingsCallback(chatId: string, messageId: number): Promise<void> {
        const settingsText = `⚙️ **用户设置**\n\n` +
            `**当前用户：** ${this.user.username}\n` +
            `**用户类型：** ${this.user.is_admin ? '管理员' : '普通用户'}\n` +
            `**Telegram通知：** ${this.user.telegram_enabled ? '✅ 已启用' : '❌ 已禁用'}\n` +
            `**通知时间：** ${this.user.telegram_notification_time || '08:00'}\n` +
            `**时区设置：** ${this.user.telegram_timezone || 'Asia/Shanghai'}\n\n` +
            `💡 要修改这些设置，请访问CloudPanel Web界面。`;

        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: settingsText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔐 修改密码', callback_data: 'change_password' }],
                    [{ text: '🔔 通知设置', callback_data: 'notification_settings' }],
                    [{ text: '🧪 测试通知', callback_data: 'test_notification' }],
                    [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 处理修改密码（简化版本）
    async handleChangePassword(chatId: string, messageId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🔐 **修改密码功能**\n\n出于安全考虑，请访问CloudPanel Web界面修改密码。\n\n💡 Web界面提供更安全的密码修改流程。`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ 返回设置', callback_data: 'user_settings' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // 处理通知设置（简化版本）
    async handleNotificationSettings(chatId: string, messageId: number): Promise<void> {
        await telegramApi(this.botToken, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `🔔 **通知设置功能**\n\n请访问CloudPanel Web界面配置通知设置。\n\n💡 Web界面可以配置：\n• Bot Token\n• 通知时间\n• 时区设置\n• 启用/禁用通知`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ 返回设置', callback_data: 'user_settings' }],
                    [{ text: '🏠 主菜单', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // === 云服务商切换功能 ===

    // 处理切换云服务商
    async handleSwitchProvider(chatId: string, messageId: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const keys = await db.getApiKeysByUserId(this.user.id);

            if (keys.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🔄 **切换云服务商**\n\n您还没有添加任何API密钥。\n\n💡 请先添加不同云服务商的密钥才能进行切换。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔑 管理密钥', callback_data: 'keys_list:0' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                });
                return;
            }

            // 按云服务商分组
            const providerGroups = keys.reduce((groups: any, key: any) => {
                if (!groups[key.provider]) {
                    groups[key.provider] = [];
                }
                groups[key.provider].push(key);
                return groups;
            }, {});

            const currentKey = await this.getCurrentApiKey();
            const currentProvider = currentKey?.apiKey.provider;

            let text = `🔄 **切换云服务商**\n\n当前使用：${currentProvider ? this.getProviderName(currentProvider) : '未选择'}\n\n可用的云服务商：\n\n`;

            const keyboard: any[][] = [];

            Object.keys(providerGroups).forEach(provider => {
                const providerName = this.getProviderName(provider);
                const keyCount = providerGroups[provider].length;
                const isCurrentProvider = provider === currentProvider;
                
                text += `${isCurrentProvider ? '✅' : '◯'} **${providerName}** (${keyCount} 个密钥)\n`;
                
                if (!isCurrentProvider) {
                    keyboard.push([{
                        text: `切换到 ${providerName}`,
                        callback_data: `switch_to_provider:${provider}`
                    }]);
                }
            });

            // 添加返回按钮
            keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('切换云服务商失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 切换云服务商失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'switch_provider' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    // 获取云服务商显示名称
    private getProviderName(provider: string): string {
        const providerNames: { [key: string]: string } = {
            'digitalocean': 'DigitalOcean',
            'linode': 'Linode',
            'azure': 'Azure',
            'aws': 'Amazon Web Services',
            'vultr': 'Vultr',
            'hetzner': 'Hetzner'
        };
        return providerNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
    }

    // === 删除失效密钥功能 ===

    // 检测并删除失效密钥
    async handleDeleteInvalidKeys(chatId: string, messageId: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const keys = await db.getApiKeysByUserId(this.user.id);

            if (keys.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🗑️ **删除失效密钥**\n\n您还没有添加任何API密钥。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            // 显示检测进度
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '🔍 **正在检测失效密钥...**\n\n请稍候，正在测试所有密钥的有效性...',
                parse_mode: 'Markdown'
            });

            const valid: any[] = [];
            const invalid: any[] = [];

            // 并行测试所有密钥
            const results = await Promise.allSettled(
                keys.map(async (key: any) => {
                    try {
                        const provider = await createCloudProviderFromEncryptedKey(
                            key.provider, 
                            key.encrypted_key, 
                            this.env.ENCRYPTION_KEY
                        );
                        await provider.getAccountInfo();
                        return { key, success: true };
                    } catch (error) {
                        return { 
                            key, 
                            success: false, 
                            error: error instanceof Error ? error.message : '未知错误' 
                        };
                    }
                })
            );

            results.forEach((result: any) => {
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        valid.push(result.value.key);
                    } else {
                        invalid.push(result.value);
                    }
                } else {
                    // Promise被拒绝的情况，也视为失效
                    invalid.push({ key: null, success: false, error: '测试失败' });
                }
            });

            if (invalid.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `🎉 **密钥检测完成**\n\n✅ 所有 ${valid.length} 个密钥都是有效的！\n\n无需删除任何密钥。`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            // 显示检测结果并询问是否删除
            let text = `🔍 **密钥检测结果**\n\n`;
            text += `✅ **有效密钥：** ${valid.length} 个\n`;
            text += `❌ **失效密钥：** ${invalid.length} 个\n\n`;
            
            text += `**失效密钥列表：**\n`;
            invalid.forEach((item: any, index: number) => {
                const key = item.key;
                if (key) {
                    text += `${index + 1}. ${key.name} (${key.provider})\n`;
                    text += `   错误：${item.error}\n\n`;
                }
            });

            text += `⚠️ 是否删除这些失效密钥？此操作不可撤销。`;

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑️ 确认删除失效密钥', callback_data: 'delete_invalid_keys_confirm' }],
                        [{ text: '❌ 取消', callback_data: 'user_main_menu' }]
                    ]
                }
            });

            // 将失效密钥ID保存到状态中
            const invalidKeyIds = invalid.map((item: any) => item.key?.id).filter(id => id !== undefined);
            await this.setBotState(chatId, {
                action: 'delete_invalid_keys',
                data: { invalidKeyIds },
                expiresAt: Date.now() + 10 * 60 * 1000 // 10分钟过期
            });

        } catch (error) {
            console.error('检测失效密钥失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 检测失效密钥失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'delete_invalid_keys' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
        }
    }

    // 确认删除失效密钥
    async handleDeleteInvalidKeysConfirm(chatId: string, messageId: number): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'delete_invalid_keys' || !state.data?.invalidKeyIds) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 会话已过期，请重新开始。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🗑️ 重新检测', callback_data: 'delete_invalid_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '🗑️ **正在删除失效密钥...**\n\n请稍候...',
                parse_mode: 'Markdown'
            });

            // 执行删除
            await this.handleDeleteInvalidKeysExecute(chatId, messageId);
        } catch (error) {
            console.error('确认删除失效密钥失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 操作失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
        }
    }

    // 执行删除失效密钥
    async handleDeleteInvalidKeysExecute(chatId: string, messageId: number): Promise<void> {
        try {
            const state = await this.getBotState(chatId);
            if (!state || state.action !== 'delete_invalid_keys' || !state.data?.invalidKeyIds) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 会话已过期，请重新开始。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            const db = createDatabaseService(this.env);
            const invalidKeyIds = state.data.invalidKeyIds;
            
            let successCount = 0;
            let failureCount = 0;

            // 逐个删除失效密钥
            for (const keyId of invalidKeyIds) {
                try {
                    await db.deleteApiKey(keyId);
                    successCount++;
                } catch (error) {
                    console.error(`删除密钥 ${keyId} 失败:`, error);
                    failureCount++;
                }
            }

            // 清除状态
            await this.clearBotState(chatId);

            // 显示删除结果
            let resultText = `✅ **删除完成**\n\n`;
            resultText += `成功删除：${successCount} 个失效密钥\n`;
            if (failureCount > 0) {
                resultText += `删除失败：${failureCount} 个密钥\n`;
            }
            resultText += `\n💡 建议重新测试剩余密钥确保都是有效的。`;

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: resultText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 重新测试密钥', callback_data: 'user_test_my_keys' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });

        } catch (error) {
            console.error('执行删除失效密钥失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 删除操作失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'delete_invalid_keys' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
        }
    }

    // === 用户密钥管理功能 ===

    // 用户测试自己的密钥
    async handleUserTestMyKeys(chatId: string, messageId: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const allKeys = await db.getApiKeysByUserId(this.user.id);

            if (allKeys.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🔑 **密钥测试**\n\n您还没有添加任何API密钥。\n\n💡 请在CloudPanel Web界面中添加API密钥。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            console.log(`[Bot] 用户 ${this.user.username} 请求测试 ${allKeys.length} 个密钥`);

            // 显示开始测试
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `🔍 **正在测试密钥...**\n\n测试中: ${allKeys.length} 个密钥\n请稍候...`,
                parse_mode: 'Markdown'
            });

            // 🎯 使用与前端完全相同的测试逻辑
            const { checkApiKeyHealth } = await import('../apikeys/validate-batch');
            
            // 根据密钥数量动态调整策略
            let batchSize: number;
            let maxKeys: number;
            
            if (allKeys.length <= 10) {
                batchSize = 2;
                maxKeys = allKeys.length;
            } else if (allKeys.length <= 20) {
                batchSize = 1;
                maxKeys = allKeys.length;
            } else {
                // 超过20个密钥时，只测试前20个最重要的
                batchSize = 1;
                maxKeys = 20;
                console.log(`[Bot] 用户密钥过多 (${allKeys.length}个)，仅测试前 ${maxKeys} 个`);
            }
            
            const keysToTest = allKeys.slice(0, maxKeys);
            const results: any[] = [];

            console.log(`[Bot] 开始测试用户 ${this.user.username} 的 ${keysToTest.length} 个密钥，分 ${Math.ceil(keysToTest.length / batchSize)} 批处理`);

            // 分批处理（串行执行以避免CPU超时）
            for (let i = 0; i < keysToTest.length; i += batchSize) {
                const batch = keysToTest.slice(i, i + batchSize);
                
                // 串行处理当前批次（避免并发过多）
                for (const apiKey of batch) {
                    try {
                        const result = await checkApiKeyHealth(apiKey, this.env.ENCRYPTION_KEY);
                        
                        // 更新数据库中的健康状态
                        try {
                            await db.updateApiKeyHealth(
                                result.keyId,
                                result.status,
                                result.checkedAt,
                                result.error
                            );
                        } catch (updateError) {
                            console.error(`更新密钥 ${result.keyId} 状态失败:`, updateError);
                        }
                        
                        results.push(result);
                    } catch (error) {
                        console.error(`测试密钥 ${apiKey.id} 失败:`, error);
                        results.push({
                            keyId: apiKey.id,
                            status: 'unhealthy',
                            error: '测试失败',
                            checkedAt: new Date().toISOString()
                        });
                    }
                }

                console.log(`[Bot] 进度: ${results.length}/${keysToTest.length}`);
                
                // 每批次后短暂暂停，防止CPU过载
                if (i + batchSize < keysToTest.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // 统计结果
            const totalKeys = results.length;
            const healthyCount = results.filter(r => r.status === 'healthy').length;
            const unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
            const limitedCount = results.filter(r => r.status === 'limited').length;

            console.log(`[Bot] 测试完成: 总计 ${totalKeys}, 健康 ${healthyCount}, 失效 ${unhealthyCount}, 受限 ${limitedCount}`);

            // 分类密钥（用于显示）
            const validKeys = allKeys.filter((k: any) => 
                results.find(r => r.keyId === k.id && r.status === 'healthy')
            );
            const invalidKeysData = results.filter(r => r.status === 'unhealthy').map(r => {
                const key = allKeys.find((k: any) => k.id === r.keyId);
                return { key, error: r.error || '未知错误' };
            });

            // 显示测试结果
            let text = `🔍 **密钥测试完成**\n\n`;
            
            // 如果只测试了部分密钥，添加说明
            if (keysToTest.length < allKeys.length) {
                text += `⚠️ 由于密钥过多，仅测试了前 ${keysToTest.length} 个（共 ${allKeys.length} 个）\n\n`;
            }
            
            text += `📊 **测试结果：** ${totalKeys} 个 | ✅ ${healthyCount} 有效 | ❌ ${unhealthyCount} 失效`;
            if (limitedCount > 0) {
                text += ` | ⚠️ ${limitedCount} 受限`;
            }
            text += `\n\n`;

            if (validKeys.length > 0) {
                text += `✅ **有效密钥：**\n`;
                validKeys.slice(0, 5).forEach((key: any, index: number) => {
                    const providerIcon = this.getProviderIcon(key.provider);
                    text += `${index + 1}. ${providerIcon} **${key.name}**\n`;
                });
                if (validKeys.length > 5) {
                    text += `... 及其他 ${validKeys.length - 5} 个\n`;
                }
                text += `\n`;
            }

            if (invalidKeysData.length > 0) {
                text += `❌ **失效密钥：**\n`;
                invalidKeysData.slice(0, 5).forEach((item: any, index: number) => {
                    if (item.key) {
                        const providerIcon = this.getProviderIcon(item.key.provider);
                        text += `${index + 1}. ${providerIcon} **${item.key.name}**\n`;
                        const errorMsg = item.error.length > 30 ? item.error.substring(0, 27) + '...' : item.error;
                        text += `   ⚠️ ${errorMsg}\n\n`;
                    }
                });
                if (invalidKeysData.length > 5) {
                    text += `... 及其他 ${invalidKeysData.length - 5} 个\n`;
                }
            }

            const keyboard: any[][] = [];
            if (invalidKeysData.length > 0) {
                keyboard.push([{ text: '🗑️ 删除失效密钥', callback_data: 'delete_invalid_keys' }]);
            }
            keyboard.push([
                { text: '🔄 重新测试', callback_data: 'user_test_my_keys' },
                { text: '📋 密钥列表', callback_data: 'user_keys_list' }
            ]);
            keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('测试密钥失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 测试密钥失败，请稍后重试。\n\n💡 提示：这可能是因为密钥数量较多导致的性能问题。建议使用 Web 界面进行测试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'user_test_my_keys' }],
                        [{ text: '🌐 Web 界面', url: 'https://cloudpanel.pages.dev' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
        }
    }    // === 用户密钥管理功能 ===

    // 显示用户的密钥列表和状态
    async handleUserKeysList(chatId: string, messageId: number): Promise<void> {
        try {
            const db = createDatabaseService(this.env);
            const keys = await db.getApiKeysByUserId(this.user.id);

            if (keys.length === 0) {
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🔑 **密钥管理**\n\n您还没有添加任何API密钥。\n\n💡 请在CloudPanel Web界面中添加API密钥。',
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                return;
            }

            // 显示检测进度
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '🔍 **正在检测密钥状态...**\n\n请稍候，正在验证所有密钥...',
                parse_mode: 'Markdown'
            });

            const validKeys: any[] = [];
            const invalidKeys: any[] = [];

            // 分批并行测试密钥 - 避免 CPU 超时和子请求限制
            const batchSize = 2; // 每批处理2个密钥，避免超时
            const totalKeys = keys.length;

            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                
                // 更新进度
                const progress = Math.min(i + batchSize, totalKeys);
                await telegramApi(this.botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `🔍 **正在检测密钥状态...**\n\n进度: ${progress}/${totalKeys} 个密钥`,
                    parse_mode: 'Markdown'
                });

                // 并行测试当前批次
                const batchResults = await Promise.allSettled(
                    batch.map(async (key: any) => {
                        try {
                            const provider = await createCloudProviderFromEncryptedKey(
                                key.provider, 
                                key.encrypted_key, 
                                this.env.ENCRYPTION_KEY
                            );
                            await provider.getAccountInfo();
                            return { key, success: true };
                        } catch (error) {
                            return { 
                                key, 
                                success: false, 
                                error: error instanceof Error ? error.message : '未知错误' 
                            };
                        }
                    })
                );

                // 处理批次结果
                batchResults.forEach((result: any) => {
                    if (result.status === 'fulfilled') {
                        if (result.value.success) {
                            validKeys.push(result.value.key);
                        } else {
                            invalidKeys.push(result.value);
                        }
                    } else {
                        invalidKeys.push({ key: null, success: false, error: '测试失败' });
                    }
                });
            }

            // 显示密钥列表和状态
            let text = `🔑 **密钥管理**\n\n`;
            text += `📊 **总览：** ${keys.length} 个密钥 | ✅ ${validKeys.length} 有效 | ❌ ${invalidKeys.length} 失效\n\n`;

            if (validKeys.length > 0) {
                text += `✅ **有效密钥：**\n`;
                validKeys.forEach((key: any, index: number) => {
                    const providerIcon = this.getProviderIcon(key.provider);
                    text += `${index + 1}. ${providerIcon} **${key.name}** (${key.provider})\n`;
                });
                text += `\n`;
            }

            if (invalidKeys.length > 0) {
                text += `❌ **失效密钥：**\n`;
                invalidKeys.forEach((item: any, index: number) => {
                    const key = item.key;
                    if (key) {
                        const providerIcon = this.getProviderIcon(key.provider);
                        text += `${index + 1}. ${providerIcon} **${key.name}** (${key.provider})\n`;
                        text += `   ⚠️ 错误：${item.error}\n\n`;
                    }
                });
            }

            const keyboard: any[][] = [];

            // 功能按钮
            if (invalidKeys.length > 0) {
                keyboard.push([{ text: '🗑️ 删除失效密钥', callback_data: 'delete_invalid_keys' }]);
            }
            
            keyboard.push([
                { text: '🔄 刷新状态', callback_data: 'user_keys_list' },
                { text: '🔍 测活密钥', callback_data: 'user_test_my_keys' }
            ]);
            
            keyboard.push([{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]);

            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            console.error('获取用户密钥列表失败:', error);
            await telegramApi(this.botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '❌ 获取密钥列表失败，请稍后重试。',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 重试', callback_data: 'user_keys_list' }],
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
        }
    }

    // 获取云服务商图标
    private getProviderIcon(provider: string): string {
        const providerIcons: { [key: string]: string } = {
            'digitalocean': '🌊',
            'linode': '🟢', 
            'azure': '☁️',
            'aws': '📦',
            'vultr': '🔥',
            'hetzner': '🏢'
        };
        return providerIcons[provider] || '🔑';
    }
}
