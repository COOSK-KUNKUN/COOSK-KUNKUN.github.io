# 拼豆底稿生成器 — 微信小程序方案

## 目录

1. [技术选型与决策](#1-技术选型与决策)
2. [项目架构设计](#2-项目架构设计)
3. [代码迁移分析](#3-代码迁移分析)
4. [核心模块改造方案](#4-核心模块改造方案)
5. [后端架构设计](#5-后端架构设计)
6. [数据存储方案](#6-数据存储方案)
7. [性能优化策略](#7-性能优化策略)
8. [项目结构与文件组织](#8-项目结构与文件组织)
9. [开发计划与里程碑](#9-开发计划与里程碑)
10. [风险与应对](#10-风险与应对)

---

## 1. 技术选型与决策

### 1.1 框架选型：Taro 4.x + React

| 候选方案 | 结论 | 原因 |
|---------|------|------|
| **Taro (React)** | **选择** | React 语法，最高代码复用率；JD 维护，社区活跃 |
| uni-app (Vue) | 不选 | 需要把 6000+ 行 React 全部改写成 Vue，工作量翻倍 |
| 原生小程序 | 备选 | 性能最好但开发效率低，完全重写 UI 层 |
| Remax / MorJS / Rax | 不选 | 社区衰退或不够成熟 |

**选择 Taro 的核心理由**：

1. **React 代码直接复用** — 本项目约 6053 行核心代码，其中大量使用 React Hooks（`useState`, `useRef`, `useEffect`, `useMemo`, `useCallback`），Taro 完整支持这些 Hooks
2. **纯工具函数零改造移植** — `pixelation.ts`(220行)、`floodFillUtils.ts`(144行)、`colorSystemUtils.ts`(175行)、`pixelEditingUtils.ts`(189行)、`canvasUtils.ts`(54行) 共约 782 行纯 TypeScript 逻辑，无任何 DOM/框架依赖，可以直接复用
3. **TypeScript 原生支持** — Taro 4.x 基于 Vite，完整支持 TypeScript
4. **包大小可控** — 核心色板数据 `colorSystemMapping.json` 约 292 行，配合分包策略轻松控制在微信 2MB 主包限制内

### 1.2 技术栈对照表

| 能力 | Web 版 (现有) | 小程序版 (Taro) |
|------|-------------|----------------|
| UI 框架 | Next.js + React 19 | Taro 4.x + React 19 |
| 样式 | Tailwind CSS 4 | 内联样式 / CSS Modules / Linaria |
| Canvas | HTML5 Canvas API | 微信 Canvas 2D API（通过 Taro 封装） |
| 图片处理 | 浏览器端 Canvas | 浏览器端 Canvas（小程序内置浏览器内核） |
| 状态管理 | React Hooks | React Hooks（可直接复用） |
| 文件导入 | FileReader / `<input type="file">` | `wx.chooseMedia` / `wx.chooseMessageFile` |
| 文件导出 | `<a>.click()` 下载 | `wx.saveImageToPhotosAlbum` |
| 本地存储 | localStorage | `Taro.setStorage` / `Taro.getStorageSync` |
| API 请求 | Next.js API Route | `Taro.request` → 后端服务 |
| 图片裁剪 | cropperjs + react-cropper | 需自实现或使用 Taro 插件 |
| PWA | next-pwa | 小程序天然支持"安装到桌面" |

### 1.3 不需要迁移的部分

以下模块小程序版本**不需要**：

- `@vercel/analytics` — Vercel 专属，小程序不用
- `next-pwa` — 小程序本身就是"类 PWA"体验
- `server.js` — 本地 HTTPS 开发服务器
- `next/image` — 小程序用 `<image>` 组件
- `next/font/google` — 小程序用 `wx.loadFontFace` 或系统字体
- Google AdSense 脚本 — 小程序有自己的广告组件 `ad`

---

## 2. 项目架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────┐
│            微信小程序 (Taro + React)          │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │  首页     │ │ 统一画布  │ │  色板模块     │ │
│  │ (导入图片) │ │ (三种模式) │ │ (店家色号)    │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │          核心算法层 (纯TS，直接复用)    │   │
│  │  pixelation / floodFill / colorSystem │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │          Canvas 渲染层 (需适配)        │   │
│  │  预览渲染 / 导出渲染 / 编辑渲染        │   │
│  └──────────────────────────────────────┘   │
└────────────────────┬────────────────────────┘
                     │ wx.request
                     ▼
┌─────────────────────────────────────────────┐
│              后端服务 (二选一)                 │
│                                             │
│  方案A: 腾讯云函数 SCF (推荐，免费额度够用)    │
│  方案B: 复用 Vercel 部署的 API Route          │
│                                             │
│  功能: AI 优化接口 (火山引擎 HMAC 签名)        │
└─────────────────────────────────────────────┘
```

### 2.2 小程序页面结构

```
app/                        # Taro 项目根目录
├── app.config.ts           # 小程序全局配置（页面路由、tabBar 等）
├── app.tsx                 # 入口组件
├── app.scss                # 全局样式
│
├── pages/
│   ├── index/              # 首页（导入图片/项目列表）
│   │   └── index.tsx
│   ├── workspace/          # 统一画布工作台（核心页面）
│   │   └── workspace.tsx   # 承载三种模式切换
│   ├── palette/            # 色板设置页
│   │   └── palette.tsx
│   └── settings/           # 全局设置
│       └── settings.tsx
│
├── components/             # 组件
│   ├── PixelCanvas/        # 统一画布组件（最核心）
│   ├── ColorPalette/       # 色板组件
│   ├── ColorPanel/         # 颜色操作面板
│   ├── ToolBar/            # 工具栏
│   ├── ImageCropper/       # 图片裁剪组件
│   └── ...                 # 其他 UI 组件
│
├── utils/                  # 工具函数（从 Web 版直接迁移）
│   ├── pixelation.ts       # ✅ 直接复用
│   ├── floodFillUtils.ts   # ✅ 直接复用
│   ├── colorSystemUtils.ts # ✅ 直接复用
│   ├── pixelEditingUtils.ts# ✅ 直接复用
│   └── canvasAdapter.ts    # 🆕 Canvas API 适配层
│
├── hooks/                  # React Hooks（大部分直接复用）
│   ├── useManualEditingState.ts  # ✅ 直接复用
│   └── usePixelEditingOperations.ts # ✅ 直接复用
│
├── data/
│   └── colorSystemMapping.json    # 色板数据
│
└── subpackages/            # 分包（控制主包大小）
    ├── export/             # 导出功能分包
    │   └── pages/
    │       └── export.tsx
    └── focus/              # 专注拼豆模式分包
        └── pages/
            └── focus.tsx
```

### 2.3 分包策略

微信小程序限制：**主包 2MB，单个分包 2MB，总计不超过 20MB**。

| 包 | 内容 | 预估大小 |
|---|------|---------|
| **主包** | 首页、画布工作台、色板、核心算法、色板数据 | ~1.2MB |
| **分包 export** | 导出图纸功能（导出渲染逻辑较重） | ~0.3MB |
| **分包 focus** | 专注拼豆模式 | ~0.5MB |

核心色板数据 `colorSystemMapping.json` 约 15KB，放在主包没问题。

---

## 3. 代码迁移分析

### 3.1 逐文件迁移评估

#### 可直接复用的文件（零改造或极小改造）

| 文件 | 行数 | 迁移难度 | 说明 |
|------|------|---------|------|
| `utils/pixelation.ts` | 220 | **零改造** | 纯数学/逻辑，操作 `RgbColor` / `MappedPixel` 等自定义类型，无 DOM 依赖。核心函数 `calculatePixelGrid()` 接收 `ImageData` 参数，小程序 Canvas 2D 的 `getImageData()` 返回相同结构的 `Uint8ClampedArray` |
| `utils/floodFillUtils.ts` | 144 | **零改造** | 纯算法（BFS 洪水填充），只操作 `MappedPixel[][]` 数组 |
| `utils/colorSystemUtils.ts` | 175 | **零改造** | 颜色系统映射计算，纯函数 |
| `utils/pixelEditingUtils.ts` | 189 | **零改造** | 像素编辑工具函数，操作 `MappedPixel[][]` |
| `hooks/useManualEditingState.ts` | ~60 | **零改造** | 纯 React Hooks，`useState` + `useCallback` |
| `hooks/usePixelEditingOperations.ts` | ~80 | **零改造** | 纯 React Hooks，依赖上述 utils |
| `data/colorSystemMapping.json` | 292 | **零改造** | JSON 数据文件 |

**直接复用合计：约 1160 行，零改造。**

#### 需要适配的文件

| 文件 | 行数 | 迁移难度 | 改造要点 |
|------|------|---------|---------|
| `utils/canvasUtils.ts` | 54 | **低** | `canvas.getBoundingClientRect()` → 用 `wx.createSelectorQuery()` 获取尺寸；`HTMLCanvasElement` 类型 → 改为通用 Canvas 类型 |
| `utils/localStorageUtils.ts` | 78 | **低** | `localStorage` → `Taro.setStorage` / `Taro.getStorageSync` |
| `utils/aiOptimize.ts` | 215 | **低** | `fetch('/api/ai-optimize')` → `Taro.request({ url: 'https://your-server/api/ai-optimize' })`，并改为异步提交+轮询模式 |
| `components/PixelatedPreviewCanvas.tsx` | 259 | **中** | Canvas 初始化方式不同（见 4.1 节）；触摸事件格式不同；需要实现虚拟渲染 |
| `components/FocusCanvas.tsx` | ~200 | **中** | 同上，Canvas 适配 + 虚拟渲染 |
| `components/ColorPanel.tsx` | ~150 | **低** | 纯 UI 组件，Taro 的 View/Text 替换 div/span |
| `components/ColorStatusBar.tsx` | ~100 | **低** | 同上 |
| `components/ToolBar.tsx` | ~100 | **低** | 纯 UI 组件 |
| `components/ProgressBar.tsx` | ~80 | **低** | 纯 UI 组件 |
| `components/DownloadSettingsModal.tsx` | ~200 | **中** | Modal 弹窗交互改为小程序样式 |
| `components/SettingsPanel.tsx` | ~150 | **低** | 表单组件适配 |
| `components/CelebrationAnimation.tsx` | ~100 | **中** | 动画需要改用小程序动画 API 或 CSS 动画 |
| `components/CompletionCard.tsx` | ~100 | **低** | 纯 UI 组件 |

#### 需要重写的文件

| 文件 | 行数 | 原因 | 重写策略 |
|------|------|------|---------|
| `utils/imageDownloader.ts` | 852 | 大量使用 `document.createElement('canvas')`、`canvas.toDataURL()`、`<a>.click()`、`Blob`、`URL.createObjectURL()` 等 DOM API，小程序完全不支持 | 重写为使用 `wx.createOffscreenCanvas()` + `canvas.toTempFilePath()` + `wx.saveImageToPhotosAlbum()`。核心绘图逻辑（fillRect、strokeRect、fillText、渐变等）不变，只是 Canvas 获取方式和导出方式改变 |
| `app/page.tsx` | 2796 | 主页面组件，包含所有状态管理和业务逻辑。需要拆分重构为 Taro 页面结构 | 拆分为多个页面（首页 + 工作台），状态管理逻辑可复用。这个文件太大（2796行），本身就需要重构 |
| `app/focus/page.tsx` | 658 | 专注模式页面，Canvas + 状态管理 | Canvas 适配 + 拆分到分包 |
| `app/api/ai-optimize/route.ts` | 413 | Next.js API Route，使用 Node.js `crypto` | 移到后端服务（见第 5 节） |

#### 不迁移的文件

| 文件 | 原因 |
|------|------|
| `components/InstallPWA.tsx` | PWA 安装提示，小程序不需要 |
| `components/DonationModal.tsx` | 打赏弹窗（含 next/image），改用小程序广告组件或移除 |
| `components/MagnifierTool.tsx` | 放大镜工具，可后续实现 |
| `components/MagnifierSelectionOverlay.tsx` | 同上 |
| `components/FloatingColorPalette.tsx` | 浮动色板，小程序用底部固定色板替代 |
| `components/FloatingToolbar.tsx` | 浮动工具栏，小程序用固定工具栏替代 |
| `components/AIOptimizeModal.tsx` | AI 优化弹窗，改用小程序页面或弹窗 |
| `components/ImageCropperModal.tsx` | 图片裁剪，使用 Taro 生态的裁剪组件替代 cropperjs |
| `components/GridTooltip.tsx` | 网格提示，小程序用自定义组件替代 |
| `app/layout.tsx` | Next.js 布局文件 |
| `app/pwa-debug/page.tsx` | PWA 调试页面 |

### 3.2 迁移工作量估算

| 类别 | 行数 | 工作量 |
|------|------|--------|
| 直接复用 | ~1,160 | 0 人天 |
| 小幅适配（UI 组件替换） | ~1,600 | 3-5 人天 |
| 中度改造（Canvas 适配） | ~500 | 5-8 人天 |
| 重写（imageDownloader + 页面重构） | ~3,600 | 10-15 人天 |
| 新增（Canvas 适配层、小程序特有功能） | ~800 | 3-5 人天 |
| **合计** | **~7,660** | **21-33 人天** |

---

## 4. 核心模块改造方案

### 4.1 Canvas 渲染适配层（最关键）

小程序 Canvas 2D API 与浏览器 Canvas API 的核心差异在于**获取方式不同**。实际绘图方法（`fillRect`, `strokeRect`, `fillText`, `getImageData` 等）是相同的。

#### 浏览器 vs 小程序 Canvas 初始化对比

**浏览器（现在）：**
```typescript
// 直接获取 DOM 元素
const canvas = canvasRef.current;  // HTMLCanvasElement
const ctx = canvas.getContext('2d');

// 加载图片
const img = new Image();
img.onload = () => ctx.drawImage(img, 0, 0);
img.src = 'path/to/image.png';
```

**小程序（Taro）：**
```typescript
// 通过查询获取 Canvas 节点
Taro.createSelectorQuery()
  .select('#myCanvas')
  .fields({ node: true, size: true })
  .exec((res) => {
    const canvas = res[0].node;    // Canvas 节点
    const ctx = canvas.getContext('2d');
    const dpr = Taro.getSystemInfoSync().pixelRatio;
    canvas.width = res[0].width * dpr;
    canvas.height = res[0].height * dpr;
    ctx.scale(dpr, dpr);

    // 加载图片
    const img = canvas.createImage();  // 注意：不是 new Image()
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = 'path/to/image.png';
  });
```

#### Canvas 适配层设计

创建 `canvasAdapter.ts` 统一封装差异：

```typescript
// utils/canvasAdapter.ts

/**
 * 统一的 Canvas 上下文类型
 * 适配层让核心绘图代码不需要关心运行环境
 */
interface CanvasContext {
  canvas: any;   // HTMLCanvasElement 或小程序 Canvas 节点
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * 初始化 Canvas（小程序端）
 */
export function initMiniCanvas(canvasId: string): Promise<CanvasContext> {
  return new Promise((resolve, reject) => {
    Taro.createSelectorQuery()
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) { reject(new Error('Canvas not found')); return; }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = Taro.getSystemInfoSync().pixelRatio;
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);
        resolve({ canvas, ctx, width: res[0].width, height: res[0].height });
      });
  });
}

/**
 * 创建离屏 Canvas（用于导出图纸，替代 document.createElement('canvas')）
 * 小程序限制：最大 4096 x 4096 像素
 */
export function createOffscreenCanvas(width: number, height: number) {
  const w = Math.min(width, 4096);
  const h = Math.min(height, 4096);
  return Taro.createOffscreenCanvas({ type: '2d', width: w, height: h });
}

/**
 * 导出 Canvas 为图片并保存到相册
 * 替代 canvas.toDataURL() + <a>.click()
 */
export async function saveCanvasToAlbum(
  canvas: any,
  quality: number = 1
): Promise<void> {
  // 1. 先检查/请求相册权限
  const authSetting = await Taro.getSetting();
  if (!authSetting.authSetting['scope.writePhotosAlbum']) {
    try {
      await Taro.authorize({ scope: 'scope.writePhotosAlbum' });
    } catch {
      // 用户拒绝，引导去设置页
      await Taro.showModal({
        title: '需要相册权限',
        content: '请授权保存图片到相册，以便保存您的拼豆图纸',
      });
      // 打开设置页让用户手动授权
      // (实际需要用 openSetting)
      return;
    }
  }

  // 2. Canvas 转临时文件
  const { tempFilePath } = await new Promise<{ tempFilePath: string }>((resolve, reject) => {
    canvas.toTempFilePath({
      fileType: 'png',
      quality,
      success: resolve,
      fail: reject,
    });
  });

  // 3. 保存到相册
  await Taro.saveImageToPhotosAlbum({ filePath: tempFilePath });
  Taro.showToast({ title: '已保存到相册', icon: 'success' });
}
```

#### 绘图方法对照

| 操作 | 浏览器 API | 小程序 Canvas 2D | 兼容性 |
|------|-----------|-----------------|--------|
| 填充矩形 | `ctx.fillRect()` | `ctx.fillRect()` | 相同 |
| 描边矩形 | `ctx.strokeRect()` | `ctx.strokeRect()` | 相同 |
| 填充文字 | `ctx.fillText()` | `ctx.fillText()` | 相同 |
| 画图片 | `ctx.drawImage()` | `ctx.drawImage()` | 相同，但图片来源不同 |
| 获取像素 | `ctx.getImageData()` | `ctx.getImageData()` | 相同，需基础库 >= 2.16.1 |
| 设置像素 | `ctx.putImageData()` | `ctx.putImageData()` | 相同 |
| 圆角矩形 | `ctx.roundRect()` | `ctx.roundRect()` | 可能需要 polyfill |
| 线性渐变 | `ctx.createLinearGradient()` | `ctx.createLinearGradient()` | 相同 |
| 裁剪 | `ctx.clip()` | `ctx.clip()` | 相同 |
| 导出图片 | `canvas.toDataURL()` | `canvas.toTempFilePath()` | **不同** |
| 创建图片 | `new Image()` | `canvas.createImage()` | **不同** |
| 离屏 Canvas | `document.createElement('canvas')` | `wx.createOffscreenCanvas()` | **不同** |

**关键结论**：核心绘图逻辑（约 852 行的 `imageDownloader.ts` 中的所有 `fillRect`、`strokeRect`、`fillText`、渐变、裁剪等调用）**不需要改动**，只需要改外层的 Canvas 获取方式和导出方式。

### 4.2 imageDownloader.ts 重写方案

这是改造量最大的单个文件（852 行），但**核心绘图逻辑不变**，只改外层包装。

**现有结构：**
```
downloadImage(options) {
  1. document.createElement('canvas')  ← 需要改
  2. ctx = canvas.getContext('2d')     ← 基本不变
  3. ctx.fillStyle / fillRect / ...   ← 完全不变
  4. ctx.fillText(...)                ← 完全不变
  5. canvas.toDataURL()               ← 需要改
  6. <a>.click() 下载                 ← 需要改
}
```

**重写后结构：**
```
async downloadImage(canvas, options) {
  1. canvas 已由调用方传入（离屏 Canvas）
  2. ctx = canvas.getContext('2d')
  3. ctx.fillStyle / fillRect / ...   ← 完全不变
  4. ctx.fillText(...)                ← 完全不变
  5. canvas.toTempFilePath()          ← 改用小程序 API
  6. wx.saveImageToPhotosAlbum()      ← 改用小程序 API
}
```

**预估：约 852 行中，约 700 行绘图代码不变，约 150 行涉及 Canvas 创建和导出的代码需要重写。**

### 4.3 图片导入适配

**浏览器（现在）：**
```typescript
<input type="file" accept="image/*" onChange={handleFileChange} />
// + FileReader / URL.createObjectURL
```

**小程序（Taro）：**
```typescript
// 选择图片（相册 + 拍照）
const handleChooseImage = async () => {
  const res = await Taro.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
  });
  const tempFilePath = res.tempFiles[0].tempFilePath;
  // tempFilePath 格式如 "wxfile://tmp_xxx.jpg"
  // 可直接用于 canvas.createImage().src
};
```

**CSV 导入适配：**
```typescript
// 浏览器: FileReader.readAsText(file)
// 小程序:
const res = await Taro.chooseMessageFile({
  count: 1,
  type: 'file',
  extension: ['csv'],
});
const content = await Taro.getFileSystemManager().readFile({
  filePath: res.tempFiles[0].path,
  encoding: 'utf-8',
});
// content.data 即为 CSV 文本内容
```

### 4.4 触摸事件适配

**浏览器（现在）：**
```typescript
<canvas onMouseMove={(e) => handleInteraction(e.clientX, e.clientY)} />
// e.clientX, e.clientY, e.touches[0].clientX 等
```

**小程序（Taro）：**
```typescript
<Canvas
  type="2d"
  id="pixelCanvas"
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
/>
// e.touches[0].x, e.touches[0].y（相对于元素）
// 或 e.touches[0].clientX, e.touches[0].clientY（相对于视口）
```

**坐标转换需要适配**：`canvasUtils.ts` 中的 `clientToGridCoords` 函数使用 `canvas.getBoundingClientRect()`，需要改为使用已知的 Canvas 显示尺寸（在初始化时通过 `wx.createSelectorQuery` 获取）。

### 4.5 页面重构方案（page.tsx 2796 行）

现有 `page.tsx` 过于庞大，需要拆分。这是好机会一并重构：

**现在（单体组件）：**
```
page.tsx (2796行)
├── 所有 useState（20+ 个状态变量）
├── 图片上传处理
├── 像素化处理
├── 颜色管理
├── 手动编辑
├── 下载功能
├── 工具栏逻辑
├── ...所有功能混在一起
```

**小程序（拆分）：**
```
pages/index/index.tsx          # 首页：导入图片、项目列表
pages/workspace/workspace.tsx  # 工作台：统一画布 + 模式切换

hooks/usePixelProcessor.ts     # 提取：像素化处理逻辑
hooks/useColorManager.ts       # 提取：颜色管理逻辑
hooks/useExportManager.ts      # 提取：导出功能逻辑
hooks/useProjectStorage.ts     # 提取：项目保存/加载
```

---

## 5. 后端架构设计

### 5.1 需求分析

小程序需要一个后端服务来处理 AI 优化接口，因为：
1. 火山引擎 API 需要 HMAC-SHA256 签名（使用 Node.js `crypto` 模块）
2. API 密钥（`VOLC_ACCESS_KEY_ID`、`VOLC_SECRET_ACCESS_KEY`）不能暴露在小程序前端
3. 当前 Web 版在 `route.ts` 中实现，轮询最长 3 分钟

### 5.2 方案 A：腾讯云函数 SCF（推荐）

**适合场景**：没有 ICP 备案域名，想快速上线

| 项目 | 说明 |
|------|------|
| 超时限制 | 最长 **900 秒**（15 分钟），完全覆盖 3 分钟轮询 |
| 免费额度 | 每月 40 万 GBs 资源使用量 + 100 万次调用，足够个人项目 |
| crypto 模块 | Node.js 18/20 运行时，完整支持 |
| 部署方式 | 微信云开发控制台 或 SCF 控制台 |
| 域名要求 | 如果走微信云开发云调用，**不需要域名白名单** |

**改造方式**：将现有 `route.ts` 稍微改造为云函数入口格式：

```typescript
// 云函数入口 (cloudfunctions/ai-optimize/index.js)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 现有 route.ts 的核心逻辑直接搬入
const crypto = require('crypto');
// ... hmac signing, api call 逻辑不变

exports.main = async (event, context) => {
  const { action, imageBase64, prompt, taskId } = event;

  if (action === 'submit') {
    // 提交任务，返回 taskId
  } else if (action === 'getResult') {
    // 查询结果
  }
};
```

**小程序端调用**：
```typescript
// 通过云开发 SDK 调用（不需要域名白名单）
wx.cloud.callFunction({
  name: 'ai-optimize',
  data: { action: 'submit', imageBase64, prompt },
}).then(res => {
  const taskId = res.result.taskId;
  // 然后轮询
});
```

### 5.3 方案 B：复用现有 Vercel 部署

**适合场景**：已有 ICP 备案域名，Web 版已部署在 Vercel

将现有 API Route 改造为异步模式（解决 Vercel 10 秒超时限制），小程序通过 `wx.request` 调用。

**需要**：
1. ICP 备案域名
2. 在微信后台配置服务器域名白名单
3. Vercel 上配置 CORS 允许小程序域名

**Vercel API Route 改造**（异步模式）：
```typescript
// route.ts - 改为提交+查询两个端点

// POST /api/ai-optimize/submit - 提交任务
export async function POST(req: NextRequest) {
  const { imageBase64, prompt } = await req.json();
  // 提交到火山引擎，返回 taskId
  // 这个请求 2-3 秒就能完成
  return NextResponse.json({ taskId });
}

// GET /api/ai-optimize/result?taskId=xxx - 查询结果
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId');
  // 查询火山引擎结果
  // 这个请求 3-5 秒完成
  return NextResponse.json({ status, result });
}
```

**小程序端调用**：
```typescript
// 提交任务
const submitRes = await Taro.request({
  url: 'https://your-domain.vercel.app/api/ai-optimize/submit',
  method: 'POST',
  data: { imageBase64, prompt },
});
const taskId = submitRes.data.taskId;

// 客户端轮询（代替服务端轮询，解决超时问题）
const pollResult = async () => {
  const res = await Taro.request({
    url: `https://your-domain.vercel.app/api/ai-optimize/result?taskId=${taskId}`,
  });
  if (res.data.status === 'done') return res.data.result;
  if (res.data.status === 'failed') throw new Error(res.data.error);
  await new Promise(r => setTimeout(r, 3000));
  return pollResult(); // 递归轮询
};
```

### 5.4 方案对比

| 维度 | 方案 A: 腾讯云函数 | 方案 B: 复用 Vercel |
|------|-------------------|-------------------|
| ICP 备案 | **不需要**（云调用） | **需要** |
| 域名白名单 | **不需要**（云调用） | **需要** |
| 免费额度 | 40 万次/月 | 100GB 带宽/月 |
| 超时限制 | 900 秒 | 10 秒（需改为客户端轮询） |
| 代码改造量 | 中等（搬入云函数格式） | 小（拆成两个端点） |
| 维护成本 | 低 | 低 |
| 推荐度 | **首选** | 备选 |

**建议**：先用方案 A 快速上线，后续如果需要也可以同时保留 Vercel 版本。

---

## 6. 数据存储方案

### 6.1 本地存储映射

| 浏览器 API | 小程序 API | 说明 |
|-----------|-----------|------|
| `localStorage.setItem(key, value)` | `Taro.setStorageSync(key, value)` | 同步写入 |
| `localStorage.getItem(key)` | `Taro.getStorageSync(key)` | 同步读取 |
| `localStorage.removeItem(key)` | `Taro.removeStorageSync(key)` | 同步删除 |

小程序本地存储上限 **10MB**，对于本项目完全够用（色板数据 ~15KB，一个项目数据 ~100-500KB）。

### 6.2 项目数据结构

```typescript
interface ProjectData {
  id: string;                    // 项目唯一ID
  name: string;                  // 项目名称
  createdAt: number;             // 创建时间
  updatedAt: number;             // 更新时间
  // 原始图片
  originalImagePath: string;     // wx.env.USER_DATA_PATH 下的路径
  // 像素化参数
  granularity: number;           // 粒度
  pixelationMode: PixelationMode;
  similarityThreshold: number;   // 合并阈值
  // 颜色配置
  paletteKey: string;            // 色板名称
  colorSystem: ColorSystem;      // 色号体系
  excludedColors: string[];      // 排除的颜色
  customPalette: string[] | null;// 自定义色板
  // 处理结果
  mappedPixelData: MappedPixel[][];
  gridDimensions: { N: number; M: number };
  colorCounts: { [key: string]: { count: number; color: string } };
  // 专注模式进度
  focusProgress?: {
    completedCells: string[];    // "row,col" 格式
    totalCells: number;
  };
}
```

### 6.3 图片存储策略

小程序的 `wx.env.USER_DATA_PATH` 提供用户数据目录，文件不会被自动清理。图片保存策略：

1. 用户选择图片后，用 `wx.getFileSystemManager().copyFile()` 复制到用户数据目录
2. 项目数据中记录文件路径
3. 图片较大时（> 1MB），可在保存项目时压缩

---

## 7. 性能优化策略

### 7.1 Canvas 虚拟渲染（必须实现）

现有 Web 版的 `PixelatedPreviewCanvas` 每次交互都重绘**所有格子**。对于 100x100 = 10,000 个格子，每次重绘 20,000+ 次 drawCall。在手机上这会卡顿。

**优化方案：只绘制可见区域内的格子**

```typescript
function drawVisibleCells(ctx, data, dims, viewport, cellSize) {
  const { offsetX, offsetY, scale } = viewport;
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  // 计算可见的行列范围
  const startCol = Math.max(0, Math.floor(-offsetX / (cellSize * scale)));
  const endCol = Math.min(dims.N, Math.ceil((canvasWidth - offsetX) / (cellSize * scale)));
  const startRow = Math.max(0, Math.floor(-offsetY / (cellSize * scale)));
  const endRow = Math.min(dims.M, Math.ceil((canvasHeight - offsetY) / (cellSize * scale)));

  // 只绘制可见格子
  for (let j = startRow; j < endRow; j++) {
    for (let i = startCol; i < endCol; i++) {
      const pixel = data[j][i];
      ctx.fillStyle = pixel.color;
      ctx.fillRect(i * cellSize, j * cellSize, cellSize, cellSize);
      ctx.strokeRect(i * cellSize, j * cellSize, cellSize, cellSize);
    }
  }
}
```

**效果**：假设手机屏幕 375px 宽，格子 30px，可见约 12 列。100 列中只画 12 列，drawCall 减少 **88%**。

### 7.2 requestAnimationFrame 节流

触摸移动事件触发频率很高，需要用 `requestAnimationFrame` 节流：

```typescript
let rafId: number | null = null;

function scheduleRedraw() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    redraw();
  });
}
```

### 7.3 大尺寸网格的导出优化

导出图纸时 Canvas 最大 **4096 x 4096** 像素。对于大网格需要动态缩小单元格尺寸：

```typescript
function calculateExportCellSize(N: number, M: number, maxCanvasSize: number = 4096) {
  const maxWidth = maxCanvasSize - 200;  // 留出边距
  const maxHeight = maxCanvasSize - 400; // 留出标题和统计区
  const cellSize = Math.min(
    Math.floor(maxWidth / N),
    Math.floor(maxHeight / M),
    30  // 最大单元格 30px
  );
  return Math.max(cellSize, 5);  // 最小 5px
}
```

### 7.4 图片加载优化

- 图片选择后立即创建缩略图用于预览（低分辨率）
- 只在导出或进入高精度预览时加载原图
- 使用 `canvas.createImage()` 的 `onload` 事件确保图片加载完成后再处理

---

## 8. 项目结构与文件组织

### 8.1 Taro 项目初始化

```bash
# 安装 Taro CLI
npm install -g @tarojs/cli

# 创建项目（使用 React + TypeScript 模板）
taro init perler-beads-miniprogram
# 选择: React, TypeScript, CSS Modules 或 Linaria

# 安装必要依赖
cd perler-beads-miniprogram
npm install
```

### 8.2 项目结构

```
perler-beads-miniprogram/
├── config/                    # Taro 构建配置
│   ├── index.ts              # 主配置
│   ├── dev.ts                # 开发环境
│   └── prod.ts               # 生产环境
│
├── src/
│   ├── app.tsx               # 入口
│   ├── app.config.ts         # 全局配置
│   ├── app.scss              # 全局样式
│   │
│   ├── assets/               # 静态资源
│   │   └── icons/            # 图标
│   │
│   ├── pages/
│   │   ├── index/            # 首页
│   │   │   ├── index.tsx
│   │   │   └── index.scss
│   │   ├── workspace/        # 画布工作台（核心）
│   │   │   ├── index.tsx
│   │   │   ├── index.scss
│   │   │   └── components/   # 工作台子组件
│   │   │       ├── PreviewCanvas.tsx
│   │   │       ├── EditCanvas.tsx
│   │   │       ├── CreateCanvas.tsx
│   │   │       └── ModeSwitcher.tsx
│   │   ├── palette/          # 色板编辑
│   │   │   ├── index.tsx
│   │   │   └── index.scss
│   │   └── settings/         # 设置
│   │       ├── index.tsx
│   │       └── index.scss
│   │
│   ├── subpackages/          # 分包
│   │   ├── export/           # 导出功能
│   │   │   └── pages/
│   │   │       └── index.tsx
│   │   └── focus/            # 专注拼豆
│   │       └── pages/
│   │           └── index.tsx
│   │
│   ├── components/           # 通用组件
│   │   ├── ColorPalette/
│   │   ├── ColorPanel/
│   │   ├── ToolBar/
│   │   ├── ProgressBar/
│   │   ├── ImageCropper/
│   │   └── ...
│   │
│   ├── utils/                # 工具函数
│   │   ├── pixelation.ts     # ← 从 Web 版复制，零改造
│   │   ├── floodFillUtils.ts # ← 从 Web 版复制，零改造
│   │   ├── colorSystemUtils.ts # ← 从 Web 版复制，零改造
│   │   ├── pixelEditingUtils.ts # ← 从 Web 版复制，零改造
│   │   ├── canvasAdapter.ts  # 🆕 Canvas 适配层
│   │   ├── storageAdapter.ts # 🆕 存储适配层
│   │   └── imageExporter.ts  # 🆕 改写自 imageDownloader.ts
│   │
│   ├── hooks/                # React Hooks
│   │   ├── useManualEditingState.ts  # ← 从 Web 版复制
│   │   ├── usePixelEditingOperations.ts # ← 从 Web 版复制
│   │   ├── usePixelProcessor.ts  # 🆕 从 page.tsx 提取
│   │   ├── useColorManager.ts  # 🆕 从 page.tsx 提取
│   │   └── useProjectStorage.ts # 🆕 新增
│   │
│   ├── data/
│   │   └── colorSystemMapping.json # ← 从 Web 版复制
│   │
│   └── constants/            # 常量
│       ├── palettes.ts       # 色板选项配置
│       └── index.ts
│
├── project.config.json       # 微信小程序项目配置
├── project.private.config.json
├── package.json
└── tsconfig.json
```

---

## 9. 开发计划与里程碑

### 阶段一：基础框架搭建（1-2 天）

- [ ] Taro 项目初始化（React + TypeScript）
- [ ] 分包配置
- [ ] 页面路由配置
- [ ] 复制可直接复用的工具函数（`pixelation.ts`、`floodFillUtils.ts` 等）
- [ ] 复制色板数据（`colorSystemMapping.json`）
- [ ] 验证：核心算法在 Taro 环境中能正常运行

### 阶段二：Canvas 适配层（3-5 天）

- [ ] 实现 `canvasAdapter.ts`（初始化、离屏 Canvas、导出）
- [ ] 改写 `imageDownloader.ts` 为 `imageExporter.ts`
- [ ] 实现虚拟渲染（viewport culling）
- [ ] 验证：在小程序中能正确渲染像素画预览

### 阶段三：首页与图片导入（2-3 天）

- [ ] 首页 UI（导入按钮、项目列表）
- [ ] 图片选择（`wx.chooseMedia`）
- [ ] 图片裁剪功能（使用 Taro 插件或自实现简单裁剪）
- [ ] CSV 导入功能
- [ ] 验证：能选择图片并看到像素化预览

### 阶段四：核心画布工作台（5-8 天）

- [ ] 从 `page.tsx` 提取状态管理到独立 Hooks
- [ ] 实现统一画布组件（预览模式）
- [ ] 色板组件适配
- [ ] 颜色排除/恢复功能
- [ ] 手动编辑模式
- [ ] 缩放和平移手势
- [ ] 验证：核心功能（像素化、颜色管理、手动编辑）正常工作

### 阶段五：导出功能（2-3 天）

- [ ] 带 Key 图纸导出
- [ ] 颜色统计图导出
- [ ] 采购清单导出
- [ ] 保存到相册
- [ ] 验证：导出图片清晰可读

### 阶段六：专注拼豆模式（3-5 天）

- [ ] 进度管理
- [ ] 颜色引导
- [ ] 区域推荐
- [ ] 完成动画
- [ ] 验证：完整的拼豆制作流程

### 阶段七：AI 优化 & 后端（2-3 天）

- [ ] 云函数部署（或 Vercel 改造）
- [ ] 小程序端 AI 优化交互
- [ ] 异步提交 + 客户端轮询

### 阶段八：测试与发布（2-3 天）

- [ ] 真机测试（iOS + Android）
- [ ] 性能优化
- [ ] 提交微信审核
- [ ] 发布上线

**总计预估：20-32 天**

---

## 10. 风险与应对

### 10.1 技术风险

| 风险 | 严重度 | 应对方案 |
|------|--------|---------|
| Canvas 2D API 兼容性问题 | 中 | 在开发初期做 POC 验证核心绘图 API（getImageData、fillRect、fillText、toTempFilePath）在小程序中的表现 |
| 大尺寸网格性能卡顿 | 中 | 虚拟渲染（只画可见区域）+ requestAnimationFrame 节流 + 分块渲染 |
| 导出 Canvas 超过 4096x4096 限制 | 中 | 动态缩小单元格尺寸；或实现分块渲染+拼接 |
| Taro 对某些 React 特性支持不完整 | 低 | 核心只用标准 Hooks（useState/useRef/useEffect/useMemo/useCallback），这些 Taro 完整支持 |
| 图片裁剪组件质量 | 低 | 可使用 Taro 生态中的 `taro-cropper` 插件，或自实现简单裁剪 |

### 10.2 业务风险

| 风险 | 严重度 | 应对方案 |
|------|--------|---------|
| 微信审核不通过 | 低 | 核心功能是工具类（图片处理），不涉及敏感内容。首次提交时注意隐私协议声明 |
| 免费额度不够 | 低 | 腾讯云函数 40 万次/月免费，个人项目绰绰有余 |
| 用户数据丢失 | 中 | 本地存储 + 提供导出/导入项目功能作为备份手段 |

### 10.3 微信小程序审核注意事项

1. **隐私协议**：使用 `wx.chooseMedia` 需要声明隐私权限，`app.json` 中配置 `"requiredPrivateInfos": ["chooseImage"]`
2. **用户信息**：本项目不需要用户头像/昵称，无需处理微信登录
3. **内容安全**：图片处理不涉及生成内容，只有像素化转换，无风险
4. **类目选择**：建议选择「工具 > 图像处理」类目

---

## 附录 A：快速检查清单

### 开发前准备
- [ ] 安装 Node.js 18+
- [ ] 安装微信开发者工具
- [ ] 注册微信小程序账号
- [ ] 安装 Taro CLI：`npm install -g @tarojs/cli`
- [ ] 微信开发者工具中开通云开发（如使用方案 A）

### 核心验证（POC）
- [ ] Canvas 2D 初始化成功
- [ ] `getImageData` 正常返回像素数据
- [ ] `fillRect` / `strokeRect` 正常绘制
- [ ] `fillText` 正常渲染文字
- [ ] `toTempFilePath` 成功导出图片
- [ ] `saveImageToPhotosAlbum` 成功保存到相册
- [ ] 缩放/平移手势正常响应

### 功能验证
- [ ] 图片选择和加载
- [ ] 像素化算法结果正确
- [ ] 颜色映射正确
- [ ] 颜色合并效果正常
- [ ] 手动编辑（上色、擦除、填充）
- [ ] 颜色排除/恢复
- [ ] 导出图纸（带 Key）
- [ ] 导出统计图
- [ ] 专注模式完整流程
- [ ] AI 优化功能（如需）
