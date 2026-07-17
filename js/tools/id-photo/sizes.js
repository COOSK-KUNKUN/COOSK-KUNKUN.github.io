/**
 * 证件照尺寸和背景色配置
 */

// 证件照尺寸（像素）。按物理尺寸从小到大排列，重复规格已合并。
export const ID_PHOTO_SIZES = [
    { id: '1inch', name: '一寸', width: 295, height: 413, desc: '25×35mm' },
    { id: 'id_card', name: '身份证', width: 307, height: 378, desc: '26×32mm' },
    { id: '2inch', name: '二寸', width: 413, height: 579, desc: '35×49mm' },
    { id: 'passport', name: '护照', width: 413, height: 531, desc: '35×45mm' },
];

// 常用背景颜色（value 为官方规格色值，use 标注常见用途）
export const BG_COLORS = [
    { id: 'white', name: '白底', value: '#ffffff', use: '社保 / 签证 / 通用' },
    { id: 'red', name: '红底', value: '#ff0000', use: '毕业证 / 保险 / 部分证件' },
    { id: 'blue', name: '蓝底', value: '#438edc', use: '简历 / 部分学历证件' },
    { id: 'lightblue', name: '浅蓝', value: '#6cb5f5', use: '备用蓝底' },
    { id: 'darkblue', name: '深蓝', value: '#2e5f88', use: '部分证件 / 简历' },
];

// 打印纸张尺寸（像素，300 DPI）
export const PAPER_SIZES = {
    '4R': { name: '4R (4×6寸)', width: 1800, height: 1200 },
    'A4': { name: 'A4', width: 2480, height: 3508 },
    'A3': { name: 'A3', width: 3508, height: 4960 },
};

// 默认设置
export const DEFAULT_SETTINGS = {
    sizeId: '1inch',
    bgColorId: 'white',
    model: 'isnet',
};

/**
 * 证件照构图参考规范（比例，相对裁剪框高度/宽度）
 * headTop:  头顶到画面顶部的留白占比
 * headHeight: 头部（发顶到下巴）高度占画面高度的比例
 * 依据大陆一寸/二寸常见规范：头部约占 60~70%，头顶留白约 8~12%。
 * 各尺寸可在 ID_PHOTO_SIZES 里用 guide 字段覆盖，否则用此默认。
 */
export const DEFAULT_GUIDE = {
    headTop: 0.12,      // 头顶留白 12%
    headHeight: 0.70,   // 头高占 70%，下巴线落在 82%，底部留白约 18%
};