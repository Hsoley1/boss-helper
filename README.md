# Boss直聘自动投递与飞书同步PWA管理系统

本项目专为应届生设计，致力于自动/半自动投递 Boss 直聘上“AI产品经理”岗位，同时将投递信息自动同步至飞书多维表格（Bitable）。此外，提供了一个适配 iPhone 屏幕的极简 iOS 风 Web App，支持作为 PWA（渐进式 Web 应用）直接添加到 iPhone 主屏幕，用于随时随地查看投递进度和修改求职状态。

## 项目结构
```
Deliver/
├── automation/          # 本地 Playwright 自动投递与同步脚本
│   ├── .env.template    # 本地脚本环境变量模板
│   ├── feishu.js        # 飞书 API 交互封装
│   ├── boss_robot.js    # Boss 直聘自动投递机器人主程序
│   └── package.json     # 本地脚本依赖
└── pwa/                 # Next.js 移动端管理 Web App (可部署至 Vercel)
    ├── .env.local.template # PWA 本地测试环境变量模板
    ├── src/
    │   ├── lib/feishu.ts   # 飞书 API 交互封装
    │   └── app/            # 页面路由与 UI 组件
    └── public/             # PWA 配置文件与图标 (manifest.json, sw.js)
```

---

## 准备工作（最关键一步）

### 1. 注册并配置飞书自建应用
为了让脚本和 PWA 能够读写您的飞书多维表格，您需要前往飞书开放平台进行简单的配置：

1. 登录 [飞书开放平台](https://open.feishu.cn/)。
2. 点击 **“创建自建应用”**，填写应用名称（如“AI求职助手”）和描述，点击创建。
3. 进入自建应用的后台，在左侧导航栏选择 **“凭证与基础信息”**，获取 **App ID** 和 **App Secret**。
4. 在左侧选择 **“权限管理”**，在搜索栏中搜索并开启以下权限：
   * **`获取与更新多维表格的数据`** (bitable:app:write)
   * **`查看多维表格数据`** (bitable:app:readonly)
5. 在左侧选择 **“应用发布” -> “版本管理与发布”**，点击 **“创建版本”**，填写版本号（如 `1.0.0`），保存并申请发布。
6. *如果是个人版飞书，您自己就是管理员，可以在消息收到通知后直接同意上线；如果是企业版，需要企业管理员审批通过。*

### 2. 创建并共享多维表格
1. 在飞书文档中新建一个**多维表格**（Bitable）。
2. 在该表格中创建一个数据表（默认数据表即可），确保包含以下列（列名称和类型必须严格一致）：
   * **`岗位名称`** (文本类型)
   * **`公司名称`** (文本类型)
   * **`薪资`** (文本类型)
   * **`HR姓名`** (文本类型)
   * **`状态`** (单选/文本类型，可设选项：`已投递`、`待沟通`、`面试中`、`已拒绝`、`已发Offer`)
   * **`投递时间`** (日期或时间戳类型)
   * **`备注`** (文本类型)
   * **`详情链接`** (超链接/文本类型)
3. 点击多维表格右上角的 **“分享/协作”** 按钮，将刚刚创建的**飞书自建应用**添加为“协作者”，并赋予“可编辑”权限（或者至少“可读写”权限）。
4. **获取 Token 标识**：
   * 表格的完整链接类似：`https://yourcompany.feishu.cn/base/bascnXXXXXXXXXXXXXX?table=tblXXXXXXXXXX`
   * 其中 `bascnXXXXXXXXXXXXXX` 即为多维表格的 **FEISHU_APP_TOKEN**
   * 其中 `tblXXXXXXXXXX` 即为具体数据表的 **FEISHU_TABLE_ID**

---

## 第一阶段：本地投递机器人 (automation) 使用指南

### 1. 配置环境变量
在 `automation` 目录下，复制 `.env.template` 并重命名为 `.env`：
```bash
cd automation
cp .env.template .env
```
修改其中的字段为您的飞书凭证和多维表格凭证。

### 2. 安装依赖
在 `automation` 目录下执行：
```bash
npm install
```

### 3. 运行自动投递脚本
```bash
npm start
```
* **登录流程**：第一次运行时，脚本会自动打开一个普通的 Chrome 浏览器窗口。如果您未登录 Boss 直聘，脚本会在控制台提示。请在打开的 Chrome 中完成 Boss 直聘的登录（扫码或短信验证码）。
* **自动持久化**：登录成功后，脚本会自动保存您的登录状态至 `.chrome_profile` 文件夹中。下次运行将直接使用该状态，无需重新登录。
* **安全机制**：脚本使用系统原生 Chrome 渠道并隐藏了 Playwright 自动化指纹。每次点击会进行 `5-15` 秒的随机延迟，每天默认限制最大投递 `30` 次，以确保账号安全。

---

## 第二阶段：iPhone PWA 应用 (pwa) 部署指南

### 1. 部署到 Vercel
您可直接在 Github 上创建一个私有仓库，把当前工作区的文件上传，随后在 Vercel 中进行绑定部署：

1. 导入项目时，将根目录（Framework）设为 `Next.js`，并将 Build Directory 设为 `pwa`。
2. 在 Vercel 后台配置以下环境变量（与本地脚本一致）：
   * `FEISHU_APP_ID`
   * `FEISHU_APP_SECRET`
   * `FEISHU_APP_TOKEN`
   * `FEISHU_TABLE_ID`
3. 点击 **Deploy**，部署成功后会得到一个 Vercel 提供的二级域名（如 `https://your-app-name.vercel.app`）。

### 2. 在 iPhone 上安装使用
1. 在 iPhone 的 Safari 浏览器中打开您的 Vercel 部署链接。
2. 点击 Safari 底部工具栏的 **“分享”** 按钮（向上箭头的图标）。
3. 在弹出的菜单中向下滚动，选择 **“添加到主屏幕”** (Add to Home Screen)。
4. 确认后，您的 iPhone 桌面上就会出现一个名为 **“AI投递”** 的应用图标。
5. 此时像普通原生 APP 一样在桌面上点击打开，即可获得全屏、无浏览器地址栏的极致求职记录管理体验！
