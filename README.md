# COOSK-KUNKUN 静态博客

一个简洁美观的个人静态博客/书签导航网站，适合部署到 GitHub Pages。

## ✨ 特性

- 🎨 **现代设计** - 简约美观的卡片式布局
- 🌓 **深色/浅色模式** - 自动跟随系统主题，也可手动切换
- 📱 **响应式设计** - 完美适配手机、平板和桌面
- 🔍 **搜索功能** - 快速查找你需要的内容
- 📝 **随手笔记** - 日志/博客文章列表
- 🔗 **随手收集** - 分类URL链接收藏（类似永硕E盘）
-  **纯静态** - 无需后端，可直接部署到 GitHub Pages

## 📁 项目结构

```
├── index.html          # 首页（Landing Page）
├── blog.html           # 主页面（随手笔记 + 随手收集）
├── notes/              # 笔记详情页文件夹
│   └── first-note.html # 示例笔记页面
├── css/
│   ├── style.css       # 主样式文件
│   └── note.css        # 笔记详情页样式
├── js/
│   ├── data.js         # 数据配置（在这里添加你的内容）
│   ── main.js         # 交互逻辑
└── README.md           # 说明文档
```

## 🚀 快速开始

### 本地预览

1. 克隆或下载本项目到本地
2. 直接用浏览器打开 `index.html` 即可预览

### 部署到 GitHub Pages

1. 在 GitHub 上创建一个新的仓库，命名为 `你的用户名.github.io`
2. 将本项目文件推送到该仓库
3. 进入仓库 Settings → Pages
4. Source 选择 `main` 分支，点击 Save
5. 等待几分钟后，访问 `https://你的用户名.github.io` 即可查看

## ✏️ 自定义内容

### 添加笔记

1. 在 `notes/` 文件夹中创建一个新的 HTML 文件（如 `my-note.html`）
2. 复制 `notes/first-note.html` 作为模板修改
3. 编辑 `js/data.js` 文件中的 `notes` 数组，添加笔记信息：

```javascript
notes: [
    {
        id: 1,
        title: '笔记标题',
        excerpt: '笔记摘要...',
        date: '2024-01-30',
        tags: ['标签1', '标签2'],
        url: 'notes/my-note.html'  // 笔记详情页路径
    }
]
```

### 添加收藏链接

编辑 `js/data.js` 文件中的 `collections` 数组：

```javascript
collections: [
    {
        id: 1,
        category: 'game',       // 对应分类的 id
        title: '网站标题',
        description: '网站描述',
        url: 'https://example.com',
        emoji: '🌐',            // 卡片显示的图标
        date: '2024-01-15'
    }
]
```

### 添加收藏分类

编辑 `js/data.js` 文件中的 `collectionCategories` 数组：

```javascript
collectionCategories: [
    { id: 'my-category', name: '我的分类', icon: '📁' }
]
```

### 修改个人信息

编辑 `index.html` 中的以下内容：
- `site-title`: 你的标题
- `site-subtitle`: 副标题
- `site-desc`: 描述文字
- `avatar-placeholder`: 头像文字（可替换为 `<img>` 标签）

## 🎨 自定义样式

编辑 `css/style.css` 中的 CSS 变量来快速修改主题颜色：

```css
:root {
    --bg-primary: #f5f5f7;        /* 主背景色 */
    --accent-color: #0071e3;      /* 强调色 */
    /* ... 更多变量 */
}
```

## 📝 许可证

MIT License - 可自由使用

---

Made with ❤️ by COOSK-KUNKUN