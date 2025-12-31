#!/bin/bash

# CloudPanel Docker 快速启动脚本

set -e

echo "========================================="
echo "  CloudPanel Docker 快速部署"
echo "========================================="
echo ""

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未检测到Docker，请先安装Docker"
    exit 1
fi

echo "✓ Docker已安装"

# 检查Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ 错误: 未检测到Docker Compose，请先安装"
    exit 1
fi

echo "✓ Docker Compose已安装"
echo ""

# 检查.env文件
if [ ! -f .env ]; then
    echo "📝 创建配置文件..."
    cp .env.example .env
    
    # 生成随机密钥
    if command -v node &> /dev/null; then
        ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        
        # 在macOS和Linux上使用不同的sed语法
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
            sed -i '' "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
        else
            sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
            sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
        fi
        
        echo "✓ 已生成随机加密密钥"
    else
        echo "⚠️  警告: 未安装Node.js，无法自动生成密钥"
        echo "   请手动编辑.env文件并设置ENCRYPTION_KEY和SESSION_SECRET"
    fi
    
    echo ""
    echo "⚠️  请编辑 .env 文件设置管理员账户："
    echo "   ADMIN_USER=your_username"
    echo "   ADMIN_PASSWORD=your_password"
    echo ""
    read -p "按Enter继续（确保已修改.env）..."
else
    echo "✓ 配置文件已存在"
fi

echo ""
echo "🚀 启动CloudPanel..."
echo ""

# 启动服务
if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
else
    docker compose up -d --build
fi

echo ""
echo "========================================="
echo "  ✅ CloudPanel 启动成功！"
echo "========================================="
echo ""
echo "📍 访问地址: http://localhost:3000"
echo ""
echo "📊 查看日志: docker-compose logs -f"
echo "🔄 重启服务: docker-compose restart"
echo "🛑 停止服务: docker-compose stop"
echo ""
echo "========================================="
