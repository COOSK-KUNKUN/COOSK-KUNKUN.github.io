/**
 * 数据文件
 * notes 首屏同步加载；collectionTree 拆分到 collections.js 懒加载
 */

const siteData = {
    notes: [
            {
                    "id": 1,
                    "title": "我的第一篇笔记",
                    "excerpt": "这是我在 COOSK琨琨 的第一篇笔记，记录一些想法和感悟...",
                    "content": "\n                <p>这是我博客的第一篇笔记。</p>\n                <p>在这里，我可以记录生活中的点点滴滴，分享我的想法和感悟。无论是学习心得、工作感悟，还是生活中的小确幸，都可以在这里留下痕迹。</p>\n                <h2>为什么开始写笔记</h2>\n                <p>记录是一种很好的习惯。通过文字，我们可以：</p>\n                <ul>\n                    <li>整理思绪，让想法更清晰</li>\n                    <li>记录成长，回顾过去的自己</li>\n                    <li>分享知识，帮助他人</li>\n                    <li>留下回忆，珍藏美好时光</li>\n                </ul>\n                <h2>未来计划</h2>\n                <p>我打算在这里记录以下内容：</p>\n                <ol>\n                    <li>学习新技术的心得体会</li>\n                    <li>阅读书籍的读书笔记</li>\n                    <li>生活中的有趣发现</li>\n                    <li>工作中的经验总结</li>\n                </ol>\n                <blockquote>\n                    <p>生活不止眼前的苟且，还有诗和远方。</p>\n                </blockquote>\n                <p>希望这个小小的空间能够成为我记录生活、分享知识的好去处。</p>\n            ",
                    "date": "2024-01-30",
                    "tags": [
                            "随笔",
                            "生活"
                    ],
                    "url": "notes/first-note-2026-07-14.html"
            }
    ],

    // 收藏数据在进入"随手收集"视图时由 js/collections.js 懒加载填充
    collectionTree: []
};
