#!/bin/bash

# CloudPanel 定时任务 Worker 部署脚本

set -e

echo "🚀 开始部署 CloudPanel 定时健康检查 Worker..."

# 检查是否在 workers 目录
if [ ! -f "scheduled-health-check.ts" ]; then
    echo "❌ 错误: 请在 workers 目录下运行此脚本"
    exit 1
fi

# 检查 wrangler 是否已安装
if ! command -v wrangler &> /dev/null; then
    echo "📦 正在安装 Wrangler CLI..."
    npm install -g wrangler
fi

# 检查是否已登录
echo "🔐 检查 Cloudflare 认证状态..."
if ! wrangler whoami &> /dev/null; then
    echo "请先登录 Cloudflare:"
    wrangler login
fi

# 部署到生产环境
echo "📤 部署到生产环境..."
wrangler deploy --env production

echo "✅ 部署完成！"
echo ""
echo "📋 后续步骤:"
echo "1. 访问 Cloudflare Dashboard 确认 Worker 已创建"
echo "2. 验证 Cron Trigger 已设置为每天 UTC 00:00"
echo "3. 设置环境变量 PAGES_URL (如果与默认值不同)"
echo "4. 测试定时任务: curl -X POST https://cloudpanel-scheduler.your-subdomain.workers.dev/trigger"
echo ""
echo "🔧 配置 Cron Trigger (如果需要修改时间):"
echo "  编辑 wrangler.toml 中的 crons 配置"
echo "  例如: [\"0 6 * * *\"] = 每天 UTC 06:00 (北京时间 14:00)"
echo ""
echo "📈 监控:"
echo "  在 Cloudflare Dashboard -> Workers & Pages -> cloudpanel-scheduler"
echo "  查看日志和执行情况"