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
];
