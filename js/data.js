/**
 * 数据文件
 * notes 通过 fetch 从 notes/index.json 动态加载
 * collectionTree 拆分到 collections.js 懒加载
 */

const siteData = {
    notes: [],

    // 收藏数据在进入"随手收集"视图时由 js/collections.js 懒加载填充
    collectionTree: []
};