# Zeabur 一键部署指南

## 一键部署

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/cloudpanel)

或者使用 Docker 镜像手动部署：

```
ghcr.io/7d653179z/dla:latest
```

## 部署步骤

### 方法一：使用模板（推荐）

1. 点击上方的 "Deploy on Zeabur" 按钮
2. 登录 Zeabur 账户
3. 填写必要的环境变量：
   - `ENCRYPTION_KEY`: 32字符的加密密钥
   - `JWT_SECRET`: JWT 签名密钥
4. 点击部署

### 方法二：手动部署 Docker 镜像

1. 登录 [Zeabur Dashboard](https://dash.zeabur.com)
2. 创建新项目
3. 添加服务 → 选择 "Prebuilt Image"
4. 输入镜像地址：`ghcr.io/7d653179z/dla:latest`
5. 配置端口：`3000`
6. 添加持久化存储：`/app/data`
7. 设置环境变量：
   ```
   ENCRYPTION_KEY=你的32字符加密密钥
   JWT_SECRET=你的JWT密钥
   ```
8. 绑定域名并部署

## 环境变量说明

| 变量名 | 必填 | 说明 |
|--------|------|------|
| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ENCRYPTION_KEY` | ❌ | API密钥加密密钥（64字符hex），已内置默认值 |
| `JWT_SECRET` | ❌ | JWT签名密钥，已内置默认值 |
| `ADMIN_USERNAME` | ❌ | 管理员用户名，默认 admin |
| `ADMIN_PASSWORD` | ❌ | 管理员初始密码 |

## 生成密钥

```bash
# 生成 ENCRYPTION_KEY (32字符)
openssl rand -hex 16

# 生成 JWT_SECRET
openssl rand -hex 32
```

## 数据持久化

确保挂载 `/app/data` 目录以保存数据库和配置。

## 更新

Zeabur 会在镜像更新时自动重新部署，或者你可以手动触发重新部署。
