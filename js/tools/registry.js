/**
 * 工具注册表
 * 每个工具声明 id、名称、图标、描述、加载器
 * 加载器返回一个 Promise，resolve 一个带有 mount/unmount 方法的模块
 *
 * 使用 import.meta.url 解析路径，确保无论页面 URL 是什么，
 * 都能正确加载到 js/tools/ 目录下的模块。
 */
const __toolsDir = new URL('./', import.meta.url).href;

window.__toolRegistry = [
    {
        id: 'bg-remove',
        name: 'AI 抠图',
        icon: '✂️',
        desc: '上传图片，本地 AI 去背景，全程不上传',
        loader: () => import(__toolsDir + 'bg-remove.js')
    },
    {
        id: 'id-photo',
        name: '证件照',
        icon: '📷',
        desc: 'AI 去背景，生成标准证件照，支持排版打印',
        loader: () => import(__toolsDir + 'id-photo.js')
    },
    {
        id: 'perler-beads',
        name: '拼豆图纸',
        icon: '🧩',
        desc: '上传图片，生成拼豆像素图纸与色号清单，全程本地处理',
        loader: () => import(__toolsDir + 'perler-beads.js')
    },
];
