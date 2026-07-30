# 拼豆底稿生成器 — Vercel 部署方案

## 目录

1. [为什么选 Vercel](#1-为什么选-vercel)
2. [项目适配情况（零改造）](#2-项目适配情况零改造)
3. [部署步骤（GitHub 关联方式）](#3-部署步骤github-关联方式)
4. [部署步骤（CLI 方式）](#4-部署步骤cli-方式)
5. [环境变量配置](#5-环境变量配置)
6. [自定义域名](#6-自定义域名)
7. [PWA 功能确认](#7-pwa-功能确认)
8. [注意事项](#8-注意事项)
9. [与 CF Workers 方案对比](#9-与-cf-workers-方案对比)

---

## 1. 为什么选 Vercel

Vercel 是 Next.js 的**官方开发团队**，是部署 Next.js 项目最原生的平台：

- **零配置部署**：检测到 Next.js 项目后自动完成所有构建配置
- **原生支持所有 Next.js 特性**：SSR、SSG、ISR、API Routes、Middleware、Image Optimization、Font Optimization
- **全球 CDN**：静态资源自动分发到边缘节点
- **内置 Analytics**：项目已接入 `@vercel/analytics`，部署即生效
- **自动 HTTPS**：无需自行管理证书
- **Git 集成**：推送到 main 分支自动触发部署
- **免费额度充足**：Hobby Plan 对个人项目完全够用

---

## 2. 项目适配情况（零改造）

经过逐项检查，**本项目不需要任何代码修改即可部署到 Vercel**：

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Next.js 15.3.6 | 兼容 | Vercel 原生支持 |
| `'use client'` 客户端组件 | 兼容 | Vercel 完整支持 App Router |
| API Route（`crypto` 模块） | 兼容 | Vercel Serverless Functions 完整支持 Node.js API |
| `next/image`（`DonationModal.tsx`） | 兼容 | Vercel 原生图片优化，比其他平台更好 |
| `next/font/google`（`layout.tsx`） | 兼容 | Vercel 原生字体优化 |
| `@vercel/analytics` | 兼容 | **Vercel 专属功能，部署即生效** |
| `next-pwa` | 兼容 | 构建生成的 `sw.js` 和 `workbox-*.js` 在 `public/` 目录，Vercel 自动作为静态资源部署 |
| `sharp`（devDependencies） | 兼容 | 仅在构建时使用（Vercel 构建环境自带），不影响运行 |
| Google AdSense 脚本 | 兼容 | 纯客户端 `<Script>` 标签 |
| `manifest.json`（PWA） | 兼容 | `public/` 目录下的静态文件直接部署 |

**结论：直接部署，零改造。**

---

## 3. 部署步骤（GitHub 关联方式）

这是最推荐的方式，推送代码后自动部署。

### 第一步：将代码推送到 GitHub

```bash
# 如果还没有远程仓库
git remote add origin https://github.com/liangdabiao/perler-beads.git
git push -u origin main
```

### 第二步：在 Vercel 创建项目

1. 打开 [vercel.com](https://vercel.com)，使用 GitHub 账号登录
2. 点击 **"Add New..."** → **"Project"**
3. 在 **"Import Git Repository"** 中找到 `perler-beads` 仓库
4. 点击 **"Import"**

### 第三步：配置构建设置

Vercel 会自动检测到 Next.js 项目并填充配置，**通常不需要修改**：

| 设置项 | 自动检测值 | 是否需要改 |
|--------|-----------|-----------|
| Framework Preset | Next.js | 不需要 |
| Build Command | `next build` | 不需要 |
| Output Directory | `.next` | 不需要 |
| Install Command | `npm install` | 不需要 |
| Node.js Version | 18.x / 20.x | 不需要 |

### 第四步：配置环境变量

在项目的 **Settings** 页面中添加：

| 变量名 | 值 | 说明 |
|--------|---|------|
| `VOLC_ACCESS_KEY_ID` | 你的火山引擎 Access Key | AI 优化功能所需 |
| `VOLC_SECRET_ACCESS_KEY` | 你的火山引擎 Secret Key | AI 优化功能所需 |
| `NODE_ENV` | `production` | Vercel 自动设置，通常不需要手动加 |

### 第五步：点击 Deploy

点击 **"Deploy"** 按钮，等待构建完成（通常 1-2 分钟）。构建完成后会获得一个 `*.vercel.app` 域名。

### 后续：自动部署

关联 GitHub 后，每次推送到 `main` 分支都会自动触发重新部署。Pull Request 也会生成预览链接。

---

## 4. 部署步骤（CLI 方式）

如果不使用 GitHub 集成，可以用 Vercel CLI 直接部署。

### 第一步：安装 Vercel CLI

```bash
npm install -g vercel
```

### 第二步：登录

```bash
vercel login
```

会打开浏览器进行授权。

### 第三步：部署

在项目根目录执行：

```bash
# 首次部署（会交互式确认配置）
vercel
```

CLI 会自动检测 Next.js 项目，显示以下提示：

```
? Set up and deploy "~/perler-beads-master"? [Y/n] Y
? Which scope do you want to deploy to? your-username
? Link to existing project? [y/N] N
? What's your project's name? perler-beads
? In which directory is your code located? ./
```

### 第四步：设置环境变量

```bash
vercel env add VOLC_ACCESS_KEY_ID
vercel env add VOLC_SECRET_ACCESS_KEY
```

每次执行会提示选择环境（Production / Preview / Development），建议全部添加。

### 第五步：生产部署

```bash
vercel --prod
```

### 后续更新

每次代码更新后执行：

```bash
vercel --prod
```

---

## 5. 环境变量配置

### 5.1 通过 Dashboard 配置（推荐）

1. 进入 Vercel Dashboard → 项目 → **Settings** → **Environment Variables**
2. 添加变量，可选择作用范围：

| 环境 | 触发场景 |
|------|---------|
| Production | `main` 分支部署 |
| Preview | 所有 PR 预览部署 |
| Development | `vercel dev` 本地开发 |

### 5.2 通过 CLI 配置

```bash
# 添加到所有环境
vercel env add VOLC_ACCESS_KEY_ID

# 仅添加到生产环境
vercel env add VOLC_ACCESS_KEY_ID production

# 仅添加到预览环境
vercel env add VOLC_ACCESS_KEY_ID preview
```

### 5.3 通过 `.env.local`（本地开发）

本地开发时在项目根目录创建 `.env.local`：

```
VOLC_ACCESS_KEY_ID=your_key_here
VOLC_SECRET_ACCESS_KEY=your_secret_here
```

此文件已在 `.gitignore` 中，不会提交到仓库。

---

## 6. 自定义域名

### 6.1 配置步骤

1. Vercel Dashboard → 项目 → **Settings** → **Domains**
2. 输入你的域名（如 `perler-beads.com`）
3. 按提示在域名 DNS 中添加记录：

**方式 A：使用 Vercel DNS（最简单）**
- 将域名的 Name Server 改为 Vercel 提供的 NS 记录

**方式 B：使用自有 DNS（如 Cloudflare、阿里云）**
- 添加 CNAME 记录：`www` → `cname.vercel-dns.com`
- 添加 A 记录：`@` → `76.76.21.21`

4. Vercel 自动签发 SSL 证书，完成后域名即可访问

### 6.2 域名配置示例（阿里云 DNS）

| 类型 | 主机记录 | 记录值 |
|------|---------|--------|
| CNAME | www | cname.vercel-dns.com |
| A | @ | 76.76.21.21 |

---

## 7. PWA 功能确认

本项目使用 `next-pwa` 生成 Service Worker，部署到 Vercel 后需要确认：

### 7.1 预期行为

- 构建时在 `public/` 目录生成的 `sw.js` 和 `workbox-cb477421.js` 会被自动部署
- 浏览器访问后注册 Service Worker
- 离线缓存策略生效（NetworkFirst，最多 200 条，30 天过期）

### 7.2 验证步骤

部署后在浏览器中验证：

1. 打开 Chrome DevTools → **Application** → **Service Workers**
2. 确认 Service Worker 已注册且状态为 "activated"
3. **Application** → **Manifest** 确认 `manifest.json` 被正确识别
4. 断网测试：DevTools → **Network** → 选择 **Offline**，刷新页面应能加载

### 7.3 潜在问题

如果 PWA 不生效，可能是因为 `.gitignore` 忽略了构建时生成的文件。检查 `.gitignore` 是否包含以下条目并**需要调整**：

```gitignore
# next-pwa 构建产物不应被忽略（它们在 public/ 目录下）
# 但如果你使用 Vercel 自动构建，sw.js 和 workbox-*.js 会在构建时重新生成
# 所以不需要手动提交这些文件
```

实际上 `next-pwa` 在 Vercel 构建时会**自动重新生成**这些文件，所以无需手动提交。但需要确保 `public/` 目录中有一个**占位的 `sw.js`**（已存在），否则首次部署时可能找不到文件。

---

## 8. 注意事项

### 8.1 `sharp` 依赖

`sharp` 在 `devDependencies` 中，Vercel 构建环境自带原生编译能力，**无需任何处理**。与 CF Workers 不同，这里不需要移除它。

### 8.2 Serverless Function 冷启动

API 路由（`/api/ai-optimize`）运行在 Vercel Serverless Functions 上，存在冷启动延迟（通常 50-200ms）。但对于本项目影响不大——AI 优化本身就是秒级操作。

**Serverless Function 限制（Hobby Plan）：**

| 限制项 | 值 |
|--------|---|
| 执行超时 | 10 秒 |
| 函数大小 | 50 MB |
| 每次请求内存 | 1024 MB |

> **注意：** AI 优化的轮询等待最长可达 3 分钟（60 次 x 3 秒），**会超过 10 秒超时限制**。如果该功能在生产中使用，需要考虑以下方案：
> - 方案 A：将轮询逻辑移到客户端（推荐）
> - 方案 B：升级到 Vercel Pro Plan（超时提升到 60 秒，仍不够）
> - 方案 C：使用 Vercel Cron Jobs + 外部存储进行异步处理

### 8.3 Vercel Analytics

项目已正确集成 `@vercel/analytics`：

- `src/app/layout.tsx:3` — `import { Analytics } from "@vercel/analytics/next"`
- `src/app/layout.tsx:56` — `<Analytics />`

部署到 Vercel 后自动生效，提供页面访问量、Web Vitals、用户地理位置等数据。**这是 Vercel 专属功能，部署到其他平台时需要移除。**

### 8.4 构建日志

部署后可在 Dashboard → **Deployments** → 点击某次部署 → **Build Logs** 查看构建过程。如果构建失败，日志中会明确标注错误原因。

---

## 9. 与 CF Workers 方案对比

| 对比项 | Vercel | Cloudflare Workers |
|--------|--------|--------------------|
| **改造量** | **零改造** | 需改造 4 处 |
| **部署难度** | **一键部署** | 需安装配置多个工具 |
| **Next.js 兼容性** | **100%**（官方平台） | 需要 opennextjs 适配 |
| **`next/image` 优化** | **原生支持** | 需要 `unoptimized: true` |
| **`next/font` 优化** | **原生支持** | 正常工作 |
| **Analytics** | **内置免费** | 需自行接入第三方 |
| **免费额度** | 100GB 带宽/月 | 100,000 请求/天 |
| **全球 CDN** | 有 | 有 |
| **API 超时** | 10 秒（Hobby） | 30 秒（Paid） |
| **冷启动** | ~100ms | ~5ms |
| **自定义域名** | 免费 | 免费 |
| **AI 优化 API 超时问题** | 有（10 秒限制） | 有（10ms CPU 限制） |
| **成本** | 免费 | 免费 |

### 建议

| 场景 | 推荐方案 |
|------|---------|
| 快速上线、零折腾 | **Vercel** |
| 已有 Cloudflare 生态 | Cloudflare Workers |
| 追求最低冷启动延迟 | Cloudflare Workers |
| 需要 100% Next.js 特性兼容 | **Vercel** |
| 不想写任何配置文件 | **Vercel** |

**对于本项目，Vercel 是最简单直接的选择——零改造、零配置、推送即部署。**

---

## 附录：快速部署检查清单

- [ ] 1. 代码已推送到 GitHub
- [ ] 2. Vercel 导入 GitHub 仓库
- [ ] 3. 确认自动检测到的构建配置正确
- [ ] 4. 添加环境变量 `VOLC_ACCESS_KEY_ID` 和 `VOLC_SECRET_ACCESS_KEY`
- [ ] 5. 点击 Deploy，构建成功
- [ ] 6. 访问 `*.vercel.app` 验证功能正常
- [ ] 7. 验证 PWA 安装功能
- [ ] 8. 验证 AI 优化 API 功能
- [ ] 9. 配置自定义域名（可选）
- [ ] 10. 确认 Analytics 数据正常采集
