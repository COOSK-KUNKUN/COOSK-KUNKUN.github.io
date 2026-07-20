/**
 * 颜色计算工具 — 移植自参考项目 pixelation.ts 的纯函数部分。
 * sRGB → 线性 → Oklab，用 Oklab 欧氏距离找最近色（比 RGB 距离更贴合人眼）。
 */

import { PALETTE } from './color-data.js';

/** "#RRGGBB" → { r, g, b }，非法输入返回 null */
export function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function srgbChannelToLinear(channel) {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function rgbToOklab(rgb) {
    const r = srgbChannelToLinear(rgb.r);
    const g = srgbChannelToLinear(rgb.g);
    const b = srgbChannelToLinear(rgb.b);

    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);

    return {
        l: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
        a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
        b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
    };
}

const oklabCache = new Map();

function getOklabColor(rgb) {
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    let cached = oklabCache.get(key);
    if (cached) return cached;
    cached = rgbToOklab(rgb);
    oklabCache.set(key, cached);
    return cached;
}

/** Oklab 空间的颜色距离（乘 100 保持与阈值输入兼容） */
export function colorDistance(rgb1, rgb2) {
    const o1 = getOklabColor(rgb1);
    const o2 = getOklabColor(rgb2);
    const dl = o1.l - o2.l;
    const da = o1.a - o2.a;
    const db = o1.b - o2.b;
    return Math.sqrt(dl * dl + da * da + db * db) * 100;
}

/**
 * 把色板预处理成数组，附带 rgb，供映射时复用。
 * 返回 [{ hex, rgb, systems: { MARD, COCO, ... } }]
 */
let _paletteArrayCache = null;
export function getPaletteArray() {
    if (_paletteArrayCache) return _paletteArrayCache;
    _paletteArrayCache = Object.keys(PALETTE).map(hex => ({
        hex,
        rgb: hexToRgb(hex),
        systems: PALETTE[hex],
    })).filter(p => p.rgb);
    return _paletteArrayCache;
}

/**
 * 在色板中查找与 targetRgb 最接近的颜色。
 * @param {{r,g,b}} targetRgb
 * @param {Array} paletteArray getPaletteArray() 的结果
 * @returns 命中的色板项 { hex, rgb, systems }
 */
export function findClosestColor(targetRgb, paletteArray) {
    const palette = paletteArray || getPaletteArray();
    let minDist = Infinity;
    let closest = palette[0];
    for (const p of palette) {
        const d = colorDistance(targetRgb, p.rgb);
        if (d < minDist) {
            minDist = d;
            closest = p;
            if (d === 0) break;
        }
    }
    return closest;
}
