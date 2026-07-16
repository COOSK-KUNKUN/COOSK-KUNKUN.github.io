/**
 * 工具注册表
 * 每个工具声明 id、名称、图标、描述、加载器
 * 加载器返回一个 Promise，resolve 一个带有 mount/unmount 方法的模块
 */
window.__toolRegistry = [
    {
        id: 'bg-remove',
        name: 'AI 抠图',
        icon: '✂️',
        desc: '上传图片，本地 AI 去背景，全程不上传',
        loader: () => import('./bg-remove.js')
    },
    {
        id: 'sam-poc',
        name: 'SAM 框选分割（POC）',
        icon: '🎯',
        desc: '可行性验证：框/点选自动识别物体，本地运行',
        loader: () => import('./sam-poc.js')
    }
];
