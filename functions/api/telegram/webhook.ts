// functions/api/telegram/webhook.ts - Telegram Bot Webhook Handler
import { Env, RequestContext, User, ApiKey } from '../../shared/types';
import { createCloudProviderFromEncryptedKey } from '../../shared/cloud-providers';
import { createDatabaseService } from '../../shared/db';
import { CryptoService, PasswordService } from '../../shared/crypto';
import { CloudPanelBot } from './bot';

const ITEMS_PER_PAGE = 5; // 每页显示的项目数

// 类型定义
interface ValidKey {
    keyName: string;
    provider: string;
    accountEmail: string;
    status: string;
    username?: string;
    userId?: number;
}

interface InvalidKey {
    keyName: string;
    provider: string;
    accountEmail?: string; // 添加邮箱字段
    error: string;
    username?: string;
    userId?: number;
}

interface TestResult {
    success: boolean;
    username?: string;
    valid: ValidKey[];
    invalid: InvalidKey[];
    totalKeys?: number;
    message?: string;
}

interface AllTestResult {
    totalUsers: number;
    totalKeys: number;
    validKeys: ValidKey[];
    invalidKeys: InvalidKey[];
    healthRate: number;
}

// --- Telegram API 辅助函数 ---
async function telegramApi(botToken: string, methodName: string, params: object) {
    const url = `https://api.telegram.org/bot${botToken}/${methodName}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        const errorData = await response.json();
        console.error(`Telegram API Error (${methodName}):`, errorData);
    }
    return response;
}

// 计算存活时间（从添加到现在的时间差）
function formatDuration(dateString: string): string {
    if (!dateString) return '未知';
    
    // 确保正确解析数据库中的UTC时间
    let createdDate: Date;
    if (dateString.includes('T') || dateString.includes('Z')) {
        // ISO格式时间字符串（UTC）
        createdDate = new Date(dateString);
    } else {
        // 数据库DATETIME格式，需要明确指定为UTC
        createdDate = new Date(dateString + ' UTC');
    }
    
    const now = new Date();
    const diffMs = now.getTime() - createdDate.getTime();
    
    // 转换为各种时间单位
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    
    // 根据时间长度选择合适的显示格式
    if (diffYears > 0) {
        const remainingMonths = Math.floor((diffDays % 365) / 30);
        return remainingMonths > 0 ? `${diffYears}年${remainingMonths}个月` : `${diffYears}年`;
    } else if (diffMonths > 0) {
        const remainingDays = diffDays % 30;
        return remainingDays > 0 ? `${diffMonths}个月${remainingDays}天` : `${diffMonths}个月`;
    } else if (diffDays > 0) {
        const remainingHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return remainingHours > 0 ? `${diffDays}天${remainingHours}小时` : `${diffDays}天`;
    } else if (diffHours > 0) {
        const remainingMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return remainingMinutes > 0 ? `${diffHours}小时${remainingMinutes}分钟` : `${diffHours}小时`;
    } else if (diffMinutes > 0) {
        return `${diffMinutes}分钟`;
    } else {
        return '刚刚';
    }
}

// --- 核心功能函数 ---

// 测试单个用户的所有API密钥
async function testUserApiKeys(userId: number, db: any, env: Env): Promise<TestResult> {
    const user = await db.getUserById(userId);
    if (!user) {
        return {
            success: false,
            message: '用户不存在',
            valid: [],
            invalid: [],
            totalKeys: 0
        };
    }

    const apiKeys = await db.getApiKeysByUser(userId);
    if (apiKeys.length === 0) {
        return {
            success: true,
            message: `用户 ${user.username} 没有API密钥`,
            valid: [],
            invalid: [],
            totalKeys: 0
        };
    }

    const valid: ValidKey[] = [];
    const invalid: InvalidKey[] = [];

    // 导入健康检查函数
    const { checkApiKeyHealth } = await import('../apikeys/validate-batch');

    // 优化并发策略：每批5个密钥并行处理，提高速度
    const KEY_BATCH_SIZE = 5;
    const keyBatches = [];
    for (let i = 0; i < apiKeys.length; i += KEY_BATCH_SIZE) {
        keyBatches.push(apiKeys.slice(i, i + KEY_BATCH_SIZE));
    }

    console.log(`[Bot] 开始测试用户 ${user.username} 的 ${apiKeys.length} 个密钥，分 ${keyBatches.length} 批处理`);

    for (const keyBatch of keyBatches) {
        const keyResults = await Promise.allSettled(
            keyBatch.map(async (key: ApiKey) => {
                try {
                    const result = await checkApiKeyHealth(key, env.ENCRYPTION_KEY);
                    
                    // 更新数据库中的健康状态
                    try {
                        await db.updateApiKeyHealth(
                            key.id,
                            result.status,
                            result.checkedAt,
                            result.error
                        );
                    } catch (updateError) {
                        console.error(`更新密钥 ${key.id} 健康状态失败:`, updateError);
                    }
                    
                    if (result.status === 'healthy') {
                        // 获取详细的账户信息，包括邮箱地址
                        let accountEmail = '未知';
                        try {
                            const provider = await createCloudProviderFromEncryptedKey(
                                key.provider, 
                                key.encrypted_key, 
                                env.ENCRYPTION_KEY
                            );
                            const accountInfo = await provider.getAccountInfo();
                            accountEmail = accountInfo.email || '邮箱未知';
                        } catch (emailError) {
                            console.warn(`获取密钥 ${key.name} 邮箱失败:`, emailError);
                            accountEmail = '邮箱获取失败';
                        }
                        
                        return {
                            type: 'valid',
                            data: {
                                keyName: key.name,
                                provider: key.provider,
                                accountEmail,
                                status: 'healthy'
                            }
                        };
                    } else {
                        // 失效密钥也尝试获取邮箱信息用于识别
                        let accountEmail = '';
                        try {
                            const provider = await createCloudProviderFromEncryptedKey(
                                key.provider, 
                                key.encrypted_key, 
                                env.ENCRYPTION_KEY
                            );
                            const accountInfo = await provider.getAccountInfo();
                            accountEmail = accountInfo.email || '';
                        } catch (emailError) {
                            // 获取失败，可能密钥已完全失效
                            console.warn(`失效密钥 ${key.name} 无法获取邮箱`);
                        }
                        
                        return {
                            type: 'invalid',
                            data: {
                                keyName: key.name,
                                provider: key.provider,
                                accountEmail,
                                error: result.error || `状态：${result.status}`
                            }
                        };
                    }

                } catch (error) {
                    // 更新数据库状态为错误
                    try {
                        await db.updateApiKeyHealth(
                            key.id,
                            'error',
                            new Date().toISOString(),
                            error instanceof Error ? error.message : '检查失败'
                        );
                    } catch (updateError) {
                        console.error(`更新密钥 ${key.id} 错误状态失败:`, updateError);
                    }
                    
                    // 尝试获取邮箱信息
                    let accountEmail = '';
                    try {
                        const provider = await createCloudProviderFromEncryptedKey(
                            key.provider, 
                            key.encrypted_key, 
                            env.ENCRYPTION_KEY
                        );
                        const accountInfo = await provider.getAccountInfo();
                        accountEmail = accountInfo.email || '';
                    } catch (emailError) {
                        // 无法获取邮箱
                    }
                    
                    return {
                        type: 'invalid',
                        data: {
                            keyName: key.name,
                            provider: key.provider,
                            accountEmail,
                            error: error instanceof Error ? error.message : '检查失败'
                        }
                    };
                }
            })
        );

        // 处理批次结果
        keyResults.forEach((result) => {
            if (result.status === 'fulfilled') {
                if (result.value.type === 'valid') {
                    valid.push(result.value.data);
                } else {
                    invalid.push(result.value.data);
                }
            }
        });

        // 批次间添加小延迟
        if (keyBatches.indexOf(keyBatch) < keyBatches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    return {
        success: true,
        username: user.username,
        valid,
        invalid,
        totalKeys: apiKeys.length
    };
}

// 测试所有用户的API密钥（管理员功能）
async function testAllApiKeys(db: any, env: Env): Promise<AllTestResult> {
    const users = await db.getAllUsers();
    const allValid: ValidKey[] = [];
    const allInvalid: InvalidKey[] = [];
    let totalKeys = 0;
    let totalUsers = 0;

    // 限制并发数量，避免CPU超时
    const BATCH_SIZE = 3; // 每批最多处理3个用户
    const batches = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        batches.push(users.slice(i, i + BATCH_SIZE));
    }

    // 批量处理用户，避免一次性处理太多
    for (const batch of batches) {
        const userResults = await Promise.allSettled(
            batch.map(async (user: User) => {
                const result = await testUserApiKeys(user.id, db, env);
                return { user, result };
            })
        );

        userResults.forEach((userResult) => {
            if (userResult.status === 'fulfilled') {
                const { user, result } = userResult.value;
                if (result.success && result.totalKeys > 0) {
                    totalUsers++;
                    totalKeys += result.totalKeys;
                    
                    result.valid.forEach((key: ValidKey) => {
                        allValid.push({
                            ...key,
                            username: user.username,
                            userId: user.id
                        });
                    });
                    
                    result.invalid.forEach((key: InvalidKey) => {
                        allInvalid.push({
                            ...key,
                            username: user.username,
                            userId: user.id
                        });
                    });
                }
            }
        });

        // 如果还有更多批次，添加小延迟避免过载
        if (batches.indexOf(batch) < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return {
        totalUsers,
        totalKeys,
        validKeys: allValid,
        invalidKeys: allInvalid,
        healthRate: totalKeys > 0 ? Math.round((allValid.length / totalKeys) * 100) : 0
    };
}

// 格式化测试结果消息
function formatTestResults(results: TestResult | AllTestResult, isAdmin: boolean = false): string {
    const timeStr = new Date().toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    let message = `🔍 **API密钥测活报告**\n`;
    message += `🕐 **检查时间:** ${timeStr}\n\n`;

    if (isAdmin && 'totalUsers' in results) {
        // 管理员看到全局统计
        const adminResults = results as AllTestResult;
        message += `📊 **全局统计:**\n`;
        message += `• 用户数量: ${adminResults.totalUsers}\n`;
        message += `• 总密钥数: ${adminResults.totalKeys}\n`;
        message += `• ✅ 有效密钥: ${adminResults.validKeys.length}\n`;
        message += `• ❌ 失效密钥: ${adminResults.invalidKeys.length}\n`;
        message += `• 🎯 健康率: ${adminResults.healthRate}%\n\n`;

        if (adminResults.validKeys.length > 0) {
            message += `✅ **有效密钥详情:**\n`;
            const userValidMap = new Map<string, ValidKey[]>();
            adminResults.validKeys.forEach((key: ValidKey) => {
                const username = key.username || '未知';
                if (!userValidMap.has(username)) {
                    userValidMap.set(username, []);
                }
                userValidMap.get(username)!.push(key);
            });
            
            userValidMap.forEach((keys, username) => {
                message += `👤 **${username}** (${keys.length}个有效)\n`;
                keys.forEach((key: ValidKey) => {
                    message += `   • ${key.keyName} (${key.provider})\n`;
                    message += `     📧 ${key.accountEmail}\n`;
                });
                message += `\n`;
            });
        }

        if (adminResults.invalidKeys.length > 0) {
            message += `❌ **失效密钥详情:**\n`;
            const userInvalidMap = new Map<string, InvalidKey[]>();
            adminResults.invalidKeys.forEach((key: InvalidKey) => {
                const username = key.username || '未知';
                if (!userInvalidMap.has(username)) {
                    userInvalidMap.set(username, []);
                }
                userInvalidMap.get(username)!.push(key);
            });
            
            userInvalidMap.forEach((keys, username) => {
                message += `👤 **${username}** (${keys.length}个失效)\n`;
                keys.forEach((key: InvalidKey) => {
                    message += `   • ${key.keyName} (${key.provider})\n`;
                    message += `     ⚠️ ${key.error}\n`;
                });
                message += `\n`;
            });
            
            message += `🔧 **管理员建议:**\n`;
            message += `• 通知相关用户更新失效密钥\n`;
            message += `• 检查是否需要增加额度或续费\n`;
            message += `• 定期执行测活保持系统健康\n\n`;
        }
        
        if (adminResults.totalKeys === 0) {
            message += `ℹ️ 系统中暂无API密钥需要测试。\n\n`;
        }
    } else {
        // 用户看到个人统计
        const userResults = results as TestResult;
        const totalKeys = userResults.valid.length + userResults.invalid.length;
        
        message += `� **测活结果统计**\n\n`;
        message += `• **有效密钥：** ${userResults.valid.length} 个\n`;
        message += `• **失效密钥：** ${userResults.invalid.length} 个\n`;
        message += `• **密钥总数：** ${totalKeys} 个\n`;
        message += `• **健康率：** ${totalKeys > 0 ? Math.round((userResults.valid.length / totalKeys) * 100) : 0}%\n\n`;

        if (userResults.invalid.length > 0) {
            message += `❌ **失效密钥详情**\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            userResults.invalid.forEach((key: InvalidKey, index: number) => {
                message += `${index + 1}. **${key.keyName}**\n`;
                if (key.accountEmail) {
                    message += `   📧 邮箱：${key.accountEmail}\n`;
                }
                message += `   🔹 服务商：${key.provider}\n`;
                message += `   ⚠️ 原因：${key.error}\n\n`;
            });
        }

        if (userResults.valid.length > 0) {
            message += `✅ **有效密钥列表**\n`;
            message += `━━━━━━━━━━━━━━━━\n`;
            userResults.valid.forEach((key: ValidKey, index: number) => {
                message += `${index + 1}. **${key.keyName}** (${key.provider})\n`;
                message += `   📧 ${key.accountEmail}\n\n`;
            });
        }
        
        if (totalKeys === 0) {
            message += `ℹ️ 您还没有添加任何API密钥。\n`;
            message += `请访问CloudPanel添加您的云服务商API密钥。\n\n`;
        } else if (userResults.invalid.length > 0) {
            message += `\n🔧 **处理建议：**\n`;
            message += `• 检查密钥是否过期或被撤销\n`;
            message += `• 检查云服务商账户余额\n`;
            message += `• 登录CloudPanel更新失效密钥\n`;
        }
    }

    message += `📱 数据已同步更新到CloudPanel系统`;
    return message;
}

// --- 键盘生成器 ---

// 主菜单键盘（管理员）
function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 用户管理', callback_data: 'users_list:0' }],
            [{ text: '🔍 测活我的密钥', callback_data: 'admin_test_my_keys' }],
            [{ text: '📊 系统统计', callback_data: 'admin_stats' }],
        ],
    };
}

// 用户菜单键盘
function getUserMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🔍 测活我的API密钥', callback_data: 'user_test_my_keys' }
            ],
            [
                { text: '️ 删除失效密钥', callback_data: 'delete_invalid_keys' }
            ]
        ],
    };
}

// 用户列表键盘
async function getUsersListKeyboard(db: any, page: number, env: Env) { // 传入 env
    const users = await db.getAllUsers();
    const totalUsers = users.length;
    const totalPages = Math.ceil(totalUsers / ITEMS_PER_PAGE);
    const offset = page * ITEMS_PER_PAGE;
    const usersOnPage = users.slice(offset, offset + ITEMS_PER_PAGE);

    // 优化：使用数据库缓存的健康状态，而不是实时验证
    const userButtons = await Promise.all(usersOnPage.map(async (user: User) => {
        const apiKeys = await db.getApiKeysByUserId(user.id);
        const totalKeys = apiKeys.length;
        
        // 使用数据库中已缓存的健康状态，避免实时网络请求
        let validKeys = 0;
        if (totalKeys > 0) {
            validKeys = apiKeys.filter((key: ApiKey) => 
                key.health_status === 'healthy'
            ).length;
        }

        const userText = `${user.is_admin ? '👑' : '👤'} ${user.username} (总数: ${totalKeys}, 有效: ${validKeys})`;
        return [{ text: userText, callback_data: `user_manage:${user.id}` }];
    }));

    const navigation = [];
    if (page > 0) navigation.push({ text: '⬅️ 上一页', callback_data: `users_list:${page - 1}` });
    if (page < totalPages - 1) navigation.push({ text: '下一页 ➡️', callback_data: `users_list:${page + 1}` });
    
    const keyboard = [...userButtons];
    if (navigation.length > 0) keyboard.push(navigation);
    
    // 添加返回主菜单按钮
    keyboard.push([{ text: '🏠 返回主菜单', callback_data: 'admin_main_menu' }]);

    return {
        text: `*用户管理* - 第 ${page + 1} / ${totalPages} 页\n\n💡 *提示:* 密钥健康状态基于最近一次检查结果`,
        keyboard: { inline_keyboard: keyboard },
    };
}

// 单个用户管理键盘
async function getUserManageKeyboard(db: any, userId: number) {
    const user = await db.getUserById(userId);
    if (!user) return { text: '❌ 错误：找不到该用户。', keyboard: { inline_keyboard: [[{ text: '返回列表', callback_data: 'users_list:0' }]] } };

    const keyboard = [
        [{ text: user.is_admin ? '移除管理员' : '设为管理员', callback_data: `user_toggle_admin:${userId}` }],
        [{ text: '🔑 查看API密钥', callback_data: `keys_list:${userId}:0` }],
        [{ text: '🗑️ 删除用户', callback_data: `user_delete_confirm:${userId}` }],
        [{ text: '🔄 重置密码', callback_data: `user_reset_password_prompt:${userId}` }],
        [{ text: '⬅️ 返回用户列表', callback_data: 'users_list:0' }],
    ];

    return {
        text: `*管理用户: ${user.username}* (ID: ${user.id})`,
        keyboard: { inline_keyboard: keyboard },
    };
}

// API密钥列表键盘
async function getKeysListKeyboard(db: any, userId: number, page: number) {
    const user = await db.getUserById(userId);
    if (!user) return { text: '❌ 错误：找不到该用户。', keyboard: { inline_keyboard: [[{ text: '返回列表', callback_data: 'users_list:0' }]] } };
    
    const keys = await db.getApiKeysByUserId(userId);
    const totalKeys = keys.length;
    const totalPages = Math.ceil(totalKeys / ITEMS_PER_PAGE);
    const offset = page * ITEMS_PER_PAGE;
    const keysOnPage = keys.slice(offset, offset + ITEMS_PER_PAGE);

    const keyboard = keysOnPage.map((key: ApiKey) => ([{
        text: `🔑 ${key.name} (${key.provider})`,
        callback_data: `key_view:${key.id}`,
    }]));

    const navigation = [];
    if (page > 0) navigation.push({ text: '⬅️ 上一页', callback_data: `keys_list:${userId}:${page - 1}` });
    if (page < totalPages - 1) navigation.push({ text: '下一页 ➡️', callback_data: `keys_list:${userId}:${page + 1}` });

    if (navigation.length > 0) keyboard.push(navigation);
    keyboard.push([{ text: '⬅️ 返回用户管理', callback_data: `user_manage:${userId}` }]);

    return {
        text: `*管理 ${user.username} 的API密钥* - 第 ${page + 1} / ${totalPages} 页`,
        keyboard: { inline_keyboard: keyboard },
    };
}


// --- 主处理逻辑 ---

// 处理GET请求（用于webhook验证）
export async function onRequestGet(context: RequestContext): Promise<Response> {
    return new Response('Telegram webhook endpoint is ready', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
    });
}

export async function onRequestPost(context: RequestContext): Promise<Response> {
    console.log('🤖 Telegram webhook triggered');
    
    const { request, env } = context;
    const { TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID, ENCRYPTION_KEY } = env;

    console.log('Environment check:', {
        hasToken: !!TELEGRAM_BOT_TOKEN,
        hasAdminId: !!TELEGRAM_ADMIN_ID,
        hasEncryptionKey: !!ENCRYPTION_KEY,
        tokenPrefix: TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...',
        adminId: TELEGRAM_ADMIN_ID
    });

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID || !ENCRYPTION_KEY) {
        console.error('❌ 缺少必要的环境变量');
        return new Response('配置错误', { status: 500 });
    }

    try {
        const payload = await request.json();
        console.log('📨 Received payload:', JSON.stringify(payload, null, 2));

        // 获取消息发送者的ID
        let senderId: string | null = null;
        if (payload.message) {
            senderId = payload.message.chat.id.toString();
        } else if (payload.callback_query) {
            senderId = payload.callback_query.message.chat.id.toString();
        }

        if (!senderId) {
            console.log('⚠️ 无法获取发送者ID');
            return new Response('ok');
        }

        // 检查是否是管理员
        const isAdmin = senderId === TELEGRAM_ADMIN_ID;
        console.log(`👤 发送者: ${senderId}, 是管理员: ${isAdmin}`);

        if (isAdmin) {
            // 管理员使用全局Bot Token
            const botToken: string = TELEGRAM_BOT_TOKEN;
            const adminId: string = TELEGRAM_ADMIN_ID;
            const encryptionKey: string = ENCRYPTION_KEY;

            // 处理回调查询
            if (payload.callback_query) {
                console.log('🔄 Processing admin callback query');
                return handleCallbackQuery(payload.callback_query, botToken, adminId, encryptionKey, env);
            }

            // 处理普通消息
            if (payload.message) {
                console.log('💬 Processing admin message');
                return handleMessage(payload.message, botToken, adminId, env);
            }
        } else {
            // 普通用户：查找用户的Bot Token
            const db = createDatabaseService(env);
            const { user, userBotToken } = await getUserAndBotToken(senderId, db, env);
            
            if (!user || !userBotToken) {
                // 用户没有配置或未找到，使用管理员Bot发送提示消息
                await telegramApi(TELEGRAM_BOT_TOKEN, 'sendMessage', { 
                    chat_id: senderId, 
                    text: '❌ 您还没有配置Telegram通知设置，或者Bot Token无效。\n\n请先在CloudPanel中配置您的Telegram通知设置：\n1. 登录CloudPanel\n2. 进入"用户设置"\n3. 配置"Telegram通知"' 
                });
                return new Response('ok');
            }

            console.log(`👤 找到用户: ${user.username}, 使用用户Bot Token`);

            // 处理回调查询
            if (payload.callback_query) {
                console.log('🔄 Processing user callback query');
                return handleUserCallbackQuery(payload.callback_query, userBotToken, user, env);
            }

            // 处理普通消息
            if (payload.message) {
                console.log('💬 Processing user message');
                return handleUserMessage(payload.message, userBotToken, user, env);
            }
        }

        console.log('✅ Webhook processed successfully');
        return new Response('ok');
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        return new Response(JSON.stringify({
            error: 'Webhook processing failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 获取用户信息和Bot Token（通过Telegram ID）
async function getUserAndBotToken(telegramId: string, db: any, env: Env) {
    try {
        // 查找是否有用户配置了这个Telegram ID
        const users = await db.getAllUsers();
        for (const user of users) {
            if (user.telegram_user_id === telegramId && user.telegram_enabled && user.telegram_bot_token) {
                try {
                    // 解密用户的Bot Token
                    const userBotToken = await CryptoService.decrypt(user.telegram_bot_token, env.ENCRYPTION_KEY);
                    return { user, userBotToken };
                } catch (error) {
                    console.error(`解密用户 ${user.username} 的Bot Token失败:`, error);
                    return { user: null, userBotToken: null };
                }
            }
        }

        return { user: null, userBotToken: null };
    } catch (error) {
        console.error('查找用户失败:', error);
        return { user: null, userBotToken: null };
    }
}

// 获取用户信息（通过Telegram ID）- 保留用于兼容性
async function getUserByTelegramId(telegramId: string, db: any, env: Env) {
    try {
        // 首先检查是否是管理员
        if (telegramId === env.TELEGRAM_ADMIN_ID) {
            // 尝试获取管理员的用户信息
            const users = await db.getAllUsers();
            const adminUser = users.find((user: any) => user.is_admin);
            return { isAdmin: true, user: adminUser || null };
        }

        // 查找是否有用户配置了这个Telegram ID
        const users = await db.getAllUsers();
        for (const user of users) {
            if (user.telegram_user_id === telegramId && user.telegram_enabled) {
                return { isAdmin: false, user };
            }
        }

        return { isAdmin: false, user: null };
    } catch (error) {
        console.error('查找用户失败:', error);
        return { isAdmin: false, user: null };
    }
}

// 处理普通消息
async function handleMessage(message: any, botToken: string, adminId: string, env: Env) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const telegramId = chatId.toString();

    const db = createDatabaseService(env);
    const { isAdmin, user } = await getUserByTelegramId(telegramId, db, env);

    // 身份验证
    if (!isAdmin && !user) {
        await telegramApi(botToken, 'sendMessage', { 
            chat_id: chatId, 
            text: '抱歉，您无权使用此Bot。请先在CloudPanel中配置您的Telegram通知设置。' 
        });
        return new Response('unauthorized', { status: 403 });
    }

    // 检查是否有待处理的状态
    const stateJSON = await env.KV.get(`state:${chatId}`);
    if (stateJSON) {
        const state = JSON.parse(stateJSON);
        await env.KV.delete(`state:${chatId}`); // 立即删除状态，防止重复处理

        if (state.action === 'reset_password') {
            const newPassword = text.trim();
            if (newPassword) {
                try {
                    const hashedPassword = await PasswordService.hashPassword(newPassword);
                    await db.updateUser(state.userId, { password_hash: hashedPassword });
                    await telegramApi(botToken, 'sendMessage', {
                        chat_id: chatId,
                        text: `✅ 已成功为用户 *${state.username}* 设置新密码。`,
                        parse_mode: 'Markdown',
                    });
                } catch (error) {
                    await telegramApi(botToken, 'sendMessage', { 
                        chat_id: chatId, 
                        text: `❌ 为用户 *${state.username}* 重置密码时发生错误.`,
                        parse_mode: 'Markdown',
                    });
                }
            } else {
                await telegramApi(botToken, 'sendMessage', { chat_id: chatId, text: '密码不能为空，操作已取消。' });
            }
            return new Response('ok');
        }
    }

    const [command, ...args] = text.split(' ');

    if (command === '/start') {
        if (isAdmin) {
            // 管理员使用原来的简洁菜单
            await telegramApi(botToken, 'sendMessage', {
                chat_id: chatId,
                text: '*CloudPanel Bot 管理面板*\n\n欢迎，管理员！请选择要执行的操作:',
                parse_mode: 'Markdown',
                reply_markup: getMainMenuKeyboard(),
            });
        } else {
            await telegramApi(botToken, 'sendMessage', {
                chat_id: chatId,
                text: `*CloudPanel Bot 用户面板*\n\n欢迎，${user.username}！请选择要执行的操作:`,
                parse_mode: 'Markdown',
                reply_markup: getUserMenuKeyboard(),
            });
        }
    } else if (command === '/resetpassword') {
        // 保留旧命令以防万一，但现在主要流程已更改
        const userId = parseInt(args[0]);
        const newPassword = args[1];
        if (isNaN(userId) || !newPassword) {
            await telegramApi(botToken, 'sendMessage', { chat_id: chatId, text: '用法: `/resetpassword <用户ID> <新密码>`', parse_mode: 'Markdown' });
            return new Response('ok');
        }
        const user = await db.getUserById(userId);
        if (!user) {
            await telegramApi(botToken, 'sendMessage', { chat_id: chatId, text: `未找到ID为 ${userId} 的用户。` });
            return new Response('ok');
        }
        const hashedPassword = await PasswordService.hashPassword(newPassword);
        await db.updateUser(userId, { password_hash: hashedPassword });
        await telegramApi(botToken, 'sendMessage', { chat_id: chatId, text: `✅ 已成功重置用户 *${user.username}* 的密码。`, parse_mode: 'Markdown' });
    }

    return new Response('ok');
}

// 处理回调查询
async function handleCallbackQuery(callbackQuery: any, botToken: string, adminId: string, encryptionKey: string, env: Env) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const data = callbackQuery.data;
    const telegramId = chatId.toString();

    const db = createDatabaseService(env);
    const { isAdmin, user } = await getUserByTelegramId(telegramId, db, env);

    // 身份验证
    if (!isAdmin && !user) {
        await telegramApi(botToken, 'answerCallbackQuery', { 
            callback_query_id: callbackQuery.id, 
            text: '错误：无权操作' 
        });
        return new Response('unauthorized', { status: 403 });
    }

    const cryptoService = { decrypt: (encrypted: string) => CryptoService.decrypt(encrypted, encryptionKey) };
    const [action, ...params] = data.split(':');

    // 检查是否是新的Bot功能（仅保留密钥管理相关）
    const newBotActions = [
        'delete_invalid_keys', 'delete_invalid_keys_confirm', 'delete_invalid_keys_execute',
        'user_keys_list'
    ];

    if (newBotActions.includes(action)) {
        // 新Bot功能只对普通用户开放，管理员继续使用原来的功能
        if (!isAdmin && user) {
            const userBot = new CloudPanelBot(botToken, user, env);
            await userBot.handleCallbackQuery(callbackQuery);
            return new Response('ok');
        }
        // 如果是管理员，继续走下面的原始处理逻辑
    }

    let responseText = ''; // 用于 answerCallbackQuery 的文本

    switch (action) {
        // ====== 管理员功能 ======
        case 'users_list': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const page = parseInt(params[0]) || 0;
            const { text, keyboard } = await getUsersListKeyboard(db, page, env);
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            break;
        }
        case 'admin_test_my_keys': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            
            // 获取管理员用户信息 - 使用已验证的 user 对象
            if (!user) {
                responseText = '❌ 无法找到管理员用户信息';
                break;
            }
            
            responseText = '🔍 正在测试您的API密钥，请稍候...';
            
            try {
                // 只测试管理员自己的密钥
                const results = await testUserApiKeys(user.id, db, env);
                
                let message = `🔍 **管理员密钥测试完成**\n\n`;
                
                if (results.totalKeys === 0) {
                    message += '📝 您还没有添加任何API密钥。';
                } else {
                    message += `📊 **测试结果：**\n`;
                    message += `• 总密钥数: ${results.totalKeys || 0}\n`;
                    message += `• 有效密钥: ${results.valid.length}\n`;
                    message += `• 失效密钥: ${results.invalid.length}\n`;
                    const totalKeys = results.totalKeys || 0;
                    if (totalKeys > 0) {
                        const healthRate = Math.round((results.valid.length / totalKeys) * 100);
                        message += `• 健康率: ${healthRate}%\n\n`;
                    }
                    
                    if (results.valid.length > 0) {
                        message += `✅ **有效密钥：**\n`;
                        results.valid.slice(0, 3).forEach((key, index) => {
                            message += `${index + 1}. ${key.keyName} (${key.provider})\n`;
                        });
                        if (results.valid.length > 3) {
                            message += `... 及其他 ${results.valid.length - 3} 个\n`;
                        }
                        message += `\n`;
                    }
                    
                    if (results.invalid.length > 0) {
                        message += `❌ **失效密钥：**\n`;
                        results.invalid.slice(0, 3).forEach((key, index) => {
                            message += `${index + 1}. ${key.keyName} (${key.provider})\n`;
                            message += `   ⚠️ ${key.error}\n`;
                        });
                        if (results.invalid.length > 3) {
                            message += `... 及其他 ${results.invalid.length - 3} 个\n`;
                        }
                    }
                }
                
                message += `\n⏰ 测试时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
                
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 重新测试', callback_data: 'admin_test_my_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'admin_main_menu' }]
                        ]
                    }
                });
            } catch (error) {
                console.error('测试管理员密钥失败:', error);
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 测试过程中发生错误，请稍后重试。\n\n💡 提示：如果密钥数量较多，建议使用 Web 界面进行测试。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 重新测试', callback_data: 'admin_test_my_keys' }],
                            [{ text: '🌐 Web 界面', url: 'https://cloudpanel.pages.dev' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'admin_main_menu' }]
                        ]
                    }
                });
                responseText = '❌ 测试失败';
            }
            break;
        }
        case 'admin_stats': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            try {
                const stats = await db.getStats();
                const statsMessage = `📊 **系统统计信息**\n\n` +
                    `👥 **用户统计:**\n` +
                    `• 总用户数: ${stats.userCount}\n` +
                    `• API密钥总数: ${stats.apiKeyCount}\n\n` +
                    `🌐 **代理统计:**\n` +
                    `• SOCKS代理总数: ${stats.proxyCount}\n` +
                    `• 工作状态代理: ${stats.workingProxyCount}\n\n` +
                    `⏰ **统计时间:** ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
                
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: statsMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 刷新统计', callback_data: 'admin_stats' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'admin_main_menu' }]
                        ]
                    }
                });
                responseText = '📊 已刷新统计信息';
            } catch (error) {
                console.error('获取统计信息失败:', error);
                responseText = '❌ 获取统计信息失败';
            }
            break;
        }
        case 'admin_main_menu': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: '*CloudPanel Bot 管理后台*\n\n请选择要执行的操作:',
                parse_mode: 'Markdown',
                reply_markup: getMainMenuKeyboard(),
            });
            responseText = '返回主菜单';
            break;
        }

        // ====== 用户功能 ======
        case 'user_test_my_keys': {
            if (isAdmin || !user) {
                responseText = '❌ 功能仅限普通用户使用';
                break;
            }
            responseText = '🔍 正在测试您的API密钥，请稍候...';
            
            try {
                // 获取用户的API密钥数量，如果太多则限制测试
                const apiKeys = await db.getApiKeysByUserId(user.id);
                if (apiKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: `ℹ️ 您还没有添加任何API密钥\n\n💡 请在CloudPanel中添加API密钥后再试。`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                // 不再限制密钥数量，使用批量并行处理提高速度
                console.log(`[Bot] 用户 ${user.username} 开始测试 ${apiKeys.length} 个密钥`);

                const results = await testUserApiKeys(user.id, db, env);
                if (!results.success) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: `❌ ${results.message}`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 重试', callback_data: 'user_test_my_keys' }],
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                const message = formatTestResults(results, false);
                
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 重新测试', callback_data: 'user_test_my_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = `✅ 测试完成: ${results.valid.length}/${results.totalKeys} 密钥有效`;
            } catch (error) {
                console.error('测试用户API密钥失败:', error);
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 测试过程中发生错误，请稍后重试。\n\n' +
                          '💡 如果问题持续，建议在CloudPanel中查看密钥状态。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '� 查看密钥列表', callback_data: 'user_keys_list' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = '❌ 测试失败';
            }
            break;
        }
        case 'user_my_keys': {
            if (isAdmin || !user) {
                responseText = '❌ 功能仅限普通用户使用';
                break;
            }
            try {
                const apiKeys = await db.getApiKeysByUserId(user.id);
                if (apiKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: 'ℹ️ 您还没有添加任何API密钥\n\n💡 请在CloudPanel中添加API密钥。',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                let message = `🔑 **您的API密钥列表**\n\n`;
                apiKeys.forEach((key, index) => {
                    message += `${index + 1}. **${key.name}** (${key.provider})\n`;
                    message += `   📅 创建时间: ${new Date(key.created_at).toLocaleString('zh-CN')}\n`;
                    message += `   ⏰ 存活时间: ${formatDuration(key.created_at)}\n\n`;
                });

                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔍 测试所有密钥', callback_data: 'user_test_my_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = `📋 显示了 ${apiKeys.length} 个密钥`;
            } catch (error) {
                console.error('获取用户密钥失败:', error);
                responseText = '❌ 获取密钥列表失败';
            }
            break;
        }
        case 'user_settings': {
            if (isAdmin || !user) {
                responseText = '❌ 功能仅限普通用户使用';
                break;
            }
            const settingsMessage = `⚙️ **您的通知设置**\n\n` +
                `• **通知状态:** ${user.telegram_enabled ? '✅ 已启用' : '❌ 已禁用'}\n` +
                `• **通知时间:** ${user.telegram_notification_time}\n` +
                `• **时区设置:** ${user.telegram_timezone}\n` +
                `• **上次通知:** ${user.telegram_last_notification ? 
                    new Date(user.telegram_last_notification).toLocaleString('zh-CN') : '从未'}\n\n` +
                `💡 要修改这些设置，请登录CloudPanel面板。`;

            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: settingsMessage,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
            responseText = '⚙️ 显示通知设置';
            break;
        }
        case 'user_main_menu': {
            if (isAdmin || !user) {
                responseText = '❌ 功能仅限普通用户使用';
                break;
            }
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `*CloudPanel Bot 用户面板*\n\n欢迎，${user.username}！请选择要执行的操作:`,
                parse_mode: 'Markdown',
                reply_markup: getUserMenuKeyboard(),
            });
            responseText = '返回主菜单';
            break;
        }
        case 'user_manage': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const { text, keyboard } = await getUserManageKeyboard(db, userId);
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            break;
        }
        case 'user_toggle_admin': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const targetUser = await db.getUserById(userId);
            if (targetUser) {
                await db.updateUser(userId, { is_admin: !targetUser.is_admin });
                responseText = `✅ ${targetUser.username} 的管理员权限已${!targetUser.is_admin ? '开启' : '关闭'}。`;
                const { text, keyboard } = await getUserManageKeyboard(db, userId); // 刷新键盘
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown', reply_markup: keyboard,
                });
            } else {
                responseText = '❌ 用户不存在';
            }
            break;
        }
        case 'user_delete_confirm': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const targetUser = await db.getUserById(userId);
            if (targetUser) {
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `*确认删除*\n\n您确定要永久删除用户 *${targetUser.username}* 吗？此操作不可撤销。`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❗️ 是，确认删除', callback_data: `user_delete_execute:${userId}` }],
                            [{ text: '取消', callback_data: `user_manage:${userId}` }]
                        ]
                    }
                });
            }
            break;
        }
        case 'user_delete_execute': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const targetUser = await db.getUserById(userId);
            if (targetUser) {
                await db.deleteUser(userId);
                responseText = `✅ 用户 ${targetUser.username} 已被删除。`;
                const { text, keyboard } = await getUsersListKeyboard(db, 0, env); // 返回用户列表第一页
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown', reply_markup: keyboard,
                });
            } else {
                responseText = '❌ 用户不存在';
            }
            break;
        }
        case 'user_reset_password_prompt': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const targetUser = await db.getUserById(userId);
            if (targetUser) {
                // 设置 KV 状态，等待用户输入新密码
                const state = { action: 'reset_password', userId: userId, username: targetUser.username };
                await env.KV.put(`state:${chatId}`, JSON.stringify(state), { expirationTtl: 300 }); // 5分钟过期

                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `*重置用户 ${targetUser.username} 的密码*\n\n请直接在下方输入新的密码：`,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '取消操作', callback_data: `user_manage:${userId}` }]] }
                });
                responseText = '请输入新密码';
            } else {
                responseText = '❌ 用户不存在';
            }
            break;
        }
        case 'keys_list': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const userId = parseInt(params[0]);
            const page = parseInt(params[1]) || 0;
            const { text, keyboard } = await getKeysListKeyboard(db, userId, page);
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            break;
        }
        case 'key_view': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const keyId = parseInt(params[0]);
            const key = await db.getApiKeyById(keyId);
            if (!key) {
                responseText = '❌ 密钥不存在';
                break;
            }
            const keyOwner = await db.getUserById(key.user_id);
            let decryptedKey = '[无法解密]';
            try {
                console.log(`[DEBUG] Attempting to decrypt raw value for key ID ${key.id}:`, key.encrypted_key);
                decryptedKey = await cryptoService.decrypt(key.encrypted_key);
            } catch (e) {
                console.error('解密失败:', e);
            }
            const keyDetails = `*密钥详情 (ID: ${key.id})*\n` +
                `*所属用户:* ${keyOwner ? keyOwner.username : '未知'}\n` +
                `*密钥名称:* ${key.name}\n` +
                `*服务商:* ${key.provider}\n` +
                `*创建时间:* ${new Date(key.created_at).toLocaleString('zh-CN')}\n\n` +
                `*解密后的密钥:*\n\`\`\`\n${decryptedKey}\n\`\`\``;
            
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: keyDetails,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑️ 删除此密钥', callback_data: `key_delete_confirm:${key.id}` }],
                        [{ text: '⬅️ 返回密钥列表', callback_data: `keys_list:${key.user_id}:0` }]
                    ]
                }
            });
            break;
        }
        case 'key_delete_confirm': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const keyId = parseInt(params[0]);
            const key = await db.getApiKeyById(keyId);
            if (key) {
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `*确认删除密钥*\n\n您确定要永久删除密钥 *${key.name}* 吗？`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❗️ 是，确认删除', callback_data: `key_delete_execute:${key.id}` }],
                            [{ text: '取消', callback_data: `key_view:${key.id}` }]
                        ]
                    }
                });
            }
            break;
        }
        case 'key_delete_execute': {
            if (!isAdmin) {
                responseText = '❌ 权限不足';
                break;
            }
            const keyId = parseInt(params[0]);
            const key = await db.getApiKeyById(keyId);
            if (key) {
                await db.deleteApiKey(keyId);
                responseText = `✅ 密钥 ${key.name} 已被删除。`;
                const { text, keyboard } = await getKeysListKeyboard(db, key.user_id, 0);
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown', reply_markup: keyboard,
                });
            } else {
                responseText = '❌ 密钥不存在';
            }
            break;
        }
    }

    // 对回调查询做出响应，以移除按钮的加载状态
    await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: responseText,
    });

    return new Response('ok');
}

// 处理用户消息
async function handleUserMessage(message: any, botToken: string, user: User, env: Env) {
    const chatId = message.chat.id;
    const text = message.text || '';

    // 创建CloudPanelBot实例以使用增强功能
    const bot = new CloudPanelBot(botToken, user, env);

    // 检查是否是等待输入状态
    if (!text.startsWith('/')) {
        await bot.handleExtendedTextInput(chatId.toString(), text);
        return new Response('ok');
    }

    // 处理命令
    const [command, ...args] = text.split(' ');

    switch (command) {
        case '/start':
            // 普通用户使用简化菜单
            await telegramApi(botToken, 'sendMessage', {
                chat_id: chatId,
                text: `*CloudPanel Bot 用户面板*\n\n欢迎，${user.username}！请选择要执行的操作:`,
                parse_mode: 'Markdown',
                reply_markup: getUserMenuKeyboard(),
            });
            break;
        case '/keys':
        case '/instances':
        case '/create':
        case '/account':
        case '/help':
            // 这些命令已简化，引导用户使用菜单
            await telegramApi(botToken, 'sendMessage', {
                chat_id: chatId,
                text: `💡 该功能已简化，请使用主菜单操作：`,
                reply_markup: getUserMenuKeyboard(),
            });
            break;
        default:
            // 未知命令，显示主菜单
            await telegramApi(botToken, 'sendMessage', {
                chat_id: chatId,
                text: `❓ 未知命令: ${command}\n\n请使用下方菜单操作：`,
                reply_markup: getUserMenuKeyboard()
            });
            break;
    }

    return new Response('ok');
}

// 处理用户回调查询
async function handleUserCallbackQuery(callbackQuery: any, botToken: string, user: User, env: Env) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const data = callbackQuery.data;

    // 创建CloudPanelBot实例以使用增强功能
    const bot = new CloudPanelBot(botToken, user, env);

    // 先尝试使用新的Bot系统处理
    const [action, ...params] = data.split(':');
    
    // 检查是否是新的Bot功能
    const newBotActions = [
        'main_menu', 'instances_list', 'instance_details', 'instance_action', 'change_ip', 
        'delete_instance_confirm', 'delete_instance_execute', 'keys_list', 'key_details', 
        'account_info', 'help', 'create_instance_start', 'create_region', 'create_image', 
        'create_plan', 'create_count', 'create_confirm', 'create_execute', 'create_name_custom',
        'create_name_auto', 'create_password_custom', 'create_password_random', 'create_toggle_ipv6',
        'add_key_start', 'add_key_provider', 'add_key_save', 'select_key', 'delete_key_confirm',
        'delete_key_execute', 'azure_input_separate', 'azure_input_json'
    ];

    if (newBotActions.includes(action)) {
        await bot.handleCallbackQuery(callbackQuery);
        return new Response('ok');
    }

    // 如果不是新Bot功能，继续使用原有的处理逻辑
    const db = createDatabaseService(env);
    let responseText = ''; // 用于 answerCallbackQuery 的文本

    switch (action) {
        case 'user_test_my_keys': {
            responseText = '🔍 正在测试您的API密钥，请稍候...';
            
            try {
                // 获取用户的API密钥数量，如果太多则限制测试
                const apiKeys = await db.getApiKeysByUserId(user.id);
                if (apiKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: `ℹ️ 您还没有添加任何API密钥\n\n💡 请在CloudPanel中添加API密钥后再试。`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                // 不再限制密钥数量，使用批量并行处理提高速度
                console.log(`[Bot] 用户 ${user.username} 开始测试 ${apiKeys.length} 个密钥`);

                const results = await testUserApiKeys(user.id, db, env);
                if (!results.success) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: `❌ ${results.message}`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 重试', callback_data: 'user_test_my_keys' }],
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                const messageText = formatTestResults(results, false);
                
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: messageText,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 重新测试', callback_data: 'user_test_my_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = `✅ 测试完成: ${results.valid.length}/${results.totalKeys} 密钥有效`;
            } catch (error) {
                console.error('测试用户API密钥失败:', error);
                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '❌ 测试过程中发生错误，请稍后重试。\n\n' +
                          '💡 如果问题持续，建议在CloudPanel中查看密钥状态。',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '� 查看密钥列表', callback_data: 'user_keys_list' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = '❌ 测试失败';
            }
            break;
        }
        case 'user_keys_list':
        case 'user_my_keys': {
            try {
                const apiKeys = await db.getApiKeysByUserId(user.id);
                if (apiKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: 'ℹ️ 您还没有添加任何API密钥\n\n💡 请在CloudPanel中添加API密钥。',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                let messageText = `🔑 **您的API密钥列表**\n\n`;
                apiKeys.forEach((key: ApiKey, index: number) => {
                    const healthStatus = key.health_status === 'healthy' ? '✅' : 
                                       key.health_status === 'unhealthy' ? '❌' : '⚠️';
                    messageText += `${index + 1}. **${key.name}** (${key.provider}) ${healthStatus}\n`;
                    messageText += `   📅 创建时间: ${new Date(key.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
                    messageText += `   ⏰ 存活时间: ${formatDuration(key.created_at)}\n`;
                    if (key.last_checked) {
                        messageText += `   🔍 最后检查: ${new Date(key.last_checked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
                    }
                    messageText += `\n`;
                });

                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: messageText,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔍 测试所有密钥', callback_data: 'user_test_my_keys' }],
                            [{ text: '🗑️ 删除失效密钥', callback_data: 'delete_invalid_keys' }],
                            [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = `📋 显示了 ${apiKeys.length} 个密钥`;
            } catch (error) {
                console.error('获取用户密钥失败:', error);
                responseText = '❌ 获取密钥列表失败';
            }
            break;
        }
        case 'delete_invalid_keys': {
            try {
                // 获取用户的失效密钥
                const allKeys = await db.getApiKeysByUserId(user.id);
                const invalidKeys = allKeys.filter(key => key.health_status === 'unhealthy');
                
                if (invalidKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: '✅ 您当前没有失效的密钥需要删除。',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回密钥管理', callback_data: 'user_keys_list' }],
                                [{ text: '🏠 返回主菜单', callback_data: 'user_main_menu' }]
                            ]
                        }
                    });
                    break;
                }

                let confirmMessage = `🗑️ **确认删除失效密钥**\n\n`;
                confirmMessage += `即将删除以下 ${invalidKeys.length} 个失效密钥：\n\n`;
                
                invalidKeys.forEach((key, index) => {
                    confirmMessage += `${index + 1}. **${key.name}** (${key.provider})\n`;
                    if (key.error_message) {
                        confirmMessage += `   错误: ${key.error_message}\n`;
                    }
                });
                
                confirmMessage += `\n⚠️ **此操作无法撤销！**`;

                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: confirmMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '❌ 确认删除', callback_data: 'delete_invalid_keys_confirm' }],
                            [{ text: '⬅️ 取消', callback_data: 'user_keys_list' }]
                        ]
                    }
                });
                responseText = `⚠️ 请确认删除 ${invalidKeys.length} 个失效密钥`;
            } catch (error) {
                console.error('获取失效密钥失败:', error);
                responseText = '❌ 获取失效密钥失败';
            }
            break;
        }
        case 'delete_invalid_keys_confirm': {
            try {
                // 执行删除失效密钥
                const allKeys = await db.getApiKeysByUserId(user.id);
                const invalidKeys = allKeys.filter(key => key.health_status === 'unhealthy');
                
                if (invalidKeys.length === 0) {
                    await telegramApi(botToken, 'editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: '✅ 没有找到需要删除的失效密钥。',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⬅️ 返回密钥管理', callback_data: 'user_keys_list' }]
                            ]
                        }
                    });
                    break;
                }

                let deletedCount = 0;
                let failedKeys: string[] = [];

                for (const key of invalidKeys) {
                    try {
                        await db.deleteApiKey(key.id);
                        deletedCount++;
                    } catch (error) {
                        failedKeys.push(key.name);
                    }
                }

                let resultMessage = `🗑️ **删除结果**\n\n`;
                resultMessage += `✅ 成功删除: ${deletedCount} 个密钥\n`;
                
                if (failedKeys.length > 0) {
                    resultMessage += `❌ 删除失败: ${failedKeys.length} 个密钥\n`;
                    resultMessage += `失败的密钥: ${failedKeys.join(', ')}\n`;
                }

                await telegramApi(botToken, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: resultMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 查看密钥列表', callback_data: 'user_keys_list' }],
                            [{ text: '🏠 返回主菜单', callback_data: 'user_main_menu' }]
                        ]
                    }
                });
                responseText = `✅ 删除完成: ${deletedCount}/${invalidKeys.length}`;
            } catch (error) {
                console.error('删除失效密钥失败:', error);
                responseText = '❌ 删除失败';
            }
            break;
        }
        case 'user_settings': {
            const settingsMessage = `⚙️ **您的通知设置**\n\n` +
                `• **通知状态:** ${user.telegram_enabled ? '✅ 已启用' : '❌ 已禁用'}\n` +
                `• **通知时间:** ${user.telegram_notification_time}\n` +
                `• **时区设置:** ${user.telegram_timezone}\n` +
                `• **上次通知:** ${user.telegram_last_notification ? 
                    new Date(user.telegram_last_notification).toLocaleString('zh-CN') : '从未'}\n\n` +
                `💡 要修改这些设置，请登录CloudPanel面板。`;

            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: settingsMessage,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ 返回主菜单', callback_data: 'user_main_menu' }]
                    ]
                }
            });
            responseText = '⚙️ 显示通知设置';
            break;
        }
        case 'user_main_menu': {
            await telegramApi(botToken, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `*CloudPanel Bot 用户面板*\n\n欢迎，${user.username}！请选择要执行的操作:`,
                parse_mode: 'Markdown',
                reply_markup: getUserMenuKeyboard(),
            });
            responseText = '返回主菜单';
            break;
        }
        default: {
            responseText = '❌ 未知操作';
            break;
        }
    }

    // 对回调查询做出响应，以移除按钮的加载状态
    await telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: responseText,
    });

    return new Response('ok');
}
