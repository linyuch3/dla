# 可视化部署教程 (通过 Cloudflare 仪表板)

本教程将指导您通过 Cloudflare 的图形界面完成项目的部署。**这是最推荐的部署方式**，因为它完全利用了 Cloudflare Pages 的 GitOps 工作流，所有配置都在网站上完成，清晰明了。

**核心概念**: 在此模式下，您无需修改本地的 `wrangler.toml` 文件来进行部署。所有的环境变量和服务绑定（D1, KV）都将在 Cloudflare 的仪表板中设置，这些设置会在部署时自动应用。

---

### 步骤 1: Fork 项目到您的 GitHub 账户

1.  访问本项目的 GitHub 仓库。
2.  点击页面右上角的 **"Fork"** 按钮，将项目复制到您自己的 GitHub 账户下。

### 步骤 2: 在 Cloudflare 仪表板中创建所需服务

1.  **登录 Cloudflare 仪表板**: [dash.cloudflare.com](https://dash.cloudflare.com/)
2.  **创建 D1 数据库**:
    *   在左侧导航栏，进入 **Workers & Pages** > **D1**。
    *   点击 **"Create database"**。
    *   **数据库名称**: `cloudpanel`
    *   点击 **"Create"**。
3.  **创建 KV 命名空间**:
    *   在左侧导航栏，进入 **Workers & Pages** > **KV**。
    *   点击 **"Create a namespace"**。
    *   **命名空间名称**: `cloudpanel`
    *   点击 **"Create"**。

### 步骤 3: 创建 Pages 应用并配置

1.  **创建应用**:
    *   在仪表板主页或 **Workers & Pages** 概览页，点击 **"Create application"** > **Pages** > **"Connect to Git"**。
2.  **连接仓库**:
    *   选择您在步骤 1 中 Fork 的 `cloudpanel-cf` 仓库，然后点击 **"Begin setup"**。
3.  **配置构建与部署**:
    *   **项目名称**: 可自定义，例如 `my-cloud-panel`。
    *   **生产分支**: 选择 `main`。
    *   **构建设置**:
        *   **框架预设**: `None`
        *   **构建命令**: `npm install && bash build.sh`
        *   **构建输出目录**: `.` (一个点)
    *   **环境变量和服务绑定**: 这是最关键的一步。
        *   **环境变量 (Environment Variables)**:
            *   点击 **"Add variable"**，添加以下**生产 (Production)** 变量：
            *   `ENCRYPTION_KEY`: **必填**。一个 64 位的十六进制字符串（32字节）。**在本地运行 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成一个并粘贴**。
            *   `ADMIN_USER`: **必填**。您的初始管理员用户名。
            *   `ADMIN_PASSWORD`: **必填**。您的初始管理员密码（请使用强密码）。
            *   `TELEGRAM_BOT_TOKEN`: (可选) 您的 Telegram Bot Token。
            *   `TELEGRAM_ADMIN_ID`: (可选) 您的 Telegram User ID。
        *   **服务绑定 (Bindings)**:
            *   **D1 数据库绑定**:
                *   点击 **"Add binding"**。
                *   **变量名称**: `DB`
                *   **D1 数据库**: 选择您在步骤 2 中创建的 `cloudpanel` 数据库。
            *   **KV 命名空间绑定**:
                *   点击 **"Add binding"**。
                *   **变量名称**: `KV`
                *   **KV 命名空间**: 选择您在步骤 2 中创建的 `cloudpanel` KV 命名空间。
4.  **保存并部署**:
    *   点击 **"Save and Deploy"**。Cloudflare 将开始从您的 GitHub 仓库拉取代码、构建并部署。

### 步骤 4: 初始化数据库

首次部署会因为数据库是空的而无法完全正常工作。我们需要手动执行一次数据库初始化。

1.  **进入 D1 控制台**:
    *   部署完成后，在 Cloudflare 仪表板左侧导航栏进入 **Workers & Pages** > **D1**。
    *   点击进入 `cloudpanel` 数据库。
2.  **执行 SQL**:
    *   选择 **"Console"** 标签页。
    *   请复制我在此对话中提供的 `migrations/0001_initial.sql` 文件内容。
    *   将复制的 SQL 粘贴到 D1 控制台的输��框中，点击 **"Run"**。
    *   成功执行后，数据库表结构就创建好了。

### 步骤 5: 重新部署以应用更改

为了让应用识别到已经初始化好的数据库，我们需要重新触发一次部署。

1.  回到您的 Pages 项目 (`Workers & Pages` > 点击您的应用名称)。
2.  在 **"Deployments"** 标签页，找到最新的那条部署记录。
3.  点击右侧的 **"..."** 菜单，选择 **"Retry deployment"**。

部署成功后，您的 CloudPanel 就可以正常访问了！系统会使用您在环境变量中设置的管理员账户信息作为默认管理员。
