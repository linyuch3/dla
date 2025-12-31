# 单阶段构建 - 直接运行TypeScript
FROM node:20-alpine

WORKDIR /app

# 复制package文件
COPY package*.json ./
COPY tsconfig.json ./

# 安装所有依赖（包括tsx用于运行TypeScript）
RUN npm ci

# 复制源代码
COPY functions ./functions
COPY migrations ./migrations
COPY index.html ./
COPY admin.html ./
COPY _headers ./
COPY _routes.json ./

# 创建数据目录
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chown -R node:node /app

# 切换到非root用户
USER node

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 启动命令 - 直接使用tsx运行TypeScript
CMD ["npx", "tsx", "functions/server.ts"]
