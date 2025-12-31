#!/bin/bash
# 验证Docker部署环境的脚本

echo "========================================="
echo "  CloudPanel Docker 环境检查"
echo "========================================="
echo ""

EXIT_CODE=0

# 检查Docker
echo "检查 Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo "✓ $DOCKER_VERSION"
else
    echo "✗ Docker 未安装"
    echo "  请访问 https://docs.docker.com/get-docker/ 安装Docker"
    EXIT_CODE=1
fi

# 检查Docker Compose
echo ""
echo "检查 Docker Compose..."
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version)
    echo "✓ $COMPOSE_VERSION"
elif docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version)
    echo "✓ $COMPOSE_VERSION"
else
    echo "✗ Docker Compose 未安装"
    echo "  请访问 https://docs.docker.com/compose/install/ 安装Docker Compose"
    EXIT_CODE=1
fi

# 检查端口3000
echo ""
echo "检查端口 3000..."
if command -v lsof &> /dev/null; then
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
        echo "⚠ 端口 3000 已被占用"
        echo "  请修改 docker-compose.yml 中的端口映射"
    else
        echo "✓ 端口 3000 可用"
    fi
elif command -v netstat &> /dev/null; then
    if netstat -tuln | grep :3000 &> /dev/null ; then
        echo "⚠ 端口 3000 已被占用"
        echo "  请修改 docker-compose.yml 中的端口映射"
    else
        echo "✓ 端口 3000 可用"
    fi
else
    echo "⚠ 无法检查端口状态"
fi

# 检查磁盘空间
echo ""
echo "检查磁盘空间..."
if command -v df &> /dev/null; then
    AVAILABLE=$(df -h . | awk 'NR==2 {print $4}')
    echo "  可用空间: $AVAILABLE"
    
    # 简单检查（这里只是显示，不做严格验证）
    echo "✓ 磁盘空间检查完成"
else
    echo "⚠ 无法检查磁盘空间"
fi

# 检查.env文件
echo ""
echo "检查配置文件..."
if [ -f .env ]; then
    echo "✓ .env 文件存在"
    
    # 检查关键配置
    if grep -q "^ENCRYPTION_KEY=" .env && ! grep -q "^ENCRYPTION_KEY=$" .env; then
        ENCRYPTION_KEY=$(grep "^ENCRYPTION_KEY=" .env | cut -d'=' -f2)
        if [ ${#ENCRYPTION_KEY} -eq 64 ]; then
            echo "✓ ENCRYPTION_KEY 已配置"
        else
            echo "⚠ ENCRYPTION_KEY 长度不正确（应为64字符）"
            EXIT_CODE=1
        fi
    else
        echo "✗ ENCRYPTION_KEY 未配置"
        EXIT_CODE=1
    fi
    
    if grep -q "^SESSION_SECRET=" .env && ! grep -q "^SESSION_SECRET=$" .env; then
        echo "✓ SESSION_SECRET 已配置"
    else
        echo "⚠ SESSION_SECRET 未配置（建议配置）"
    fi
    
    if grep -q "^ADMIN_PASSWORD=admin123" .env; then
        echo "⚠ 使用默认管理员密码（建议修改）"
    fi
else
    echo "✗ .env 文件不存在"
    echo "  请运行: cp .env.example .env"
    echo "  然后编辑 .env 文件配置必要参数"
    EXIT_CODE=1
fi

# 检查必需文件
echo ""
echo "检查必需文件..."
REQUIRED_FILES=(
    "Dockerfile"
    "docker-compose.yml"
    "package.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file"
    else
        echo "✗ $file 缺失"
        EXIT_CODE=1
    fi
done

# 总结
echo ""
echo "========================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "  ✅ 环境检查通过！"
    echo "========================================="
    echo ""
    echo "下一步："
    echo "1. 运行: ./start-docker.sh"
    echo "2. 或者: docker-compose up -d"
    echo "3. 访问: http://localhost:3000"
else
    echo "  ⚠️  发现问题，请先解决"
    echo "========================================="
    echo ""
    echo "请根据上述提示修复问题后重试"
fi
echo ""

exit $EXIT_CODE
