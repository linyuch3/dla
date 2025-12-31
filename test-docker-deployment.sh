#!/bin/bash
# Docker部署完整测试脚本

set -e

echo "========================================="
echo "  CloudPanel Docker 部署测试"
echo "========================================="
echo ""

# 1. 清理环境
echo "1. 清理环境..."
docker-compose down -v 2>/dev/null || true
rm -rf data/
echo "   ✓ 环境已清理"
echo ""

# 2. 检查配置
echo "2. 检查配置文件..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "   ✓ .env文件已创建"
else
    echo "   ✓ .env文件已存在"
fi
echo ""

# 3. 构建Docker镜像
echo "3. 构建Docker镜像..."
docker-compose build --no-cache
echo "   ✓ Docker镜像构建成功"
echo ""

# 4. 启动服务
echo "4. 启动Docker服务..."
docker-compose up -d
echo "   ✓ 服务已启动"
echo ""

# 5. 等待服务就绪
echo "5. 等待服务启动（最多30秒）..."
for i in {1..30}; do
    if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
        echo "   ✓ 服务已就绪 (${i}秒)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "   ✗ 服务启动超时"
        docker-compose logs
        exit 1
    fi
    sleep 1
    echo -n "."
done
echo ""

# 6. 测试API
echo "6. 测试API接口..."
HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health)
echo "   健康检查: $HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    echo "   ✓ API正常响应"
else
    echo "   ✗ API响应异常"
    exit 1
fi
echo ""

# 7. 查看服务状态
echo "7. 服务状态..."
docker-compose ps
echo ""

# 8. 查看日志
echo "8. 最新日志..."
docker-compose logs --tail=20
echo ""

echo "========================================="
echo "  ✅ Docker部署测试成功！"
echo "========================================="
echo ""
echo "访问地址: http://localhost:3000"
echo "默认账户: admin / admin123"
echo ""
echo "查看日志: docker-compose logs -f"
echo "停止服务: docker-compose down"
echo ""
