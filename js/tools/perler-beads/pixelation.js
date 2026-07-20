/**
 * 像素化算法 — 移植自参考项目 pixelation.ts 的核心逻辑。
 * 把原图按格子数切成网格，每格取代表色（Dominant/Average），再映射到最近的拼豆色。
 */

import { findClosestColor, getPaletteArray } from './color-utils.js';

export const PixelationMode = {
    Dominant: 'dominant', // 卡通模式：格内出现最多的颜色
    Average: 'average',   // 真实模式：格内 RGB 平均值
};

/** 空格子（全透明）的标记 */
export const TRANSPARENT_CELL = { hex: null, systems: null, transparent: true };

/**
 * 计算某个格子的代表色。全透明格子返回 null。
 */
function calculateCellColor(imageData, startX, startY, width, height, mode) {
    const data = imageData.data;
    const imgWidth = imageData.width;
    let rSum = 0, gSum = 0, bSum = 0, pixelCount = 0;
    const counts = {};
    let dominant = null, maxCount = 0;

    const endX = startX + width;
    const endY = startY + height;

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const idx = (y * imgWidth + x) * 4;
            if (data[idx + 3] < 128) continue; // 忽略透明像素

            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            pixelCount++;

            if (mode === PixelationMode.Average) {
                rSum += r; gSum += g; bSum += b;
            } else {
                const key = (r << 16) | (g << 8) | b;
                const c = (counts[key] || 0) + 1;
                counts[key] = c;
                if (c > maxCount) { maxCount = c; dominant = { r, g, b }; }
            }
        }
    }

    if (pixelCount === 0) return null;

    if (mode === PixelationMode.Average) {
        return {
            r: Math.round(rSum / pixelCount),
            g: Math.round(gSum / pixelCount),
            b: Math.round(bSum / pixelCount),
        };
    }
    return dominant;
}

/**
 * 计算像素化网格。
 * @param {CanvasRenderingContext2D} ctx 原图的 2D context
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {number} N 横向格子数
 * @param {number} M 纵向格子数
 * @param {string} mode PixelationMode
 * @returns {Array<Array<{hex,systems,transparent?}>>} cells[row][col]
 */
export function calculatePixelGrid(ctx, imgWidth, imgHeight, N, M, mode) {
    const palette = getPaletteArray();
    const cells = Array.from({ length: M }, () => new Array(N).fill(TRANSPARENT_CELL));

    let fullData;
    try {
        fullData = ctx.getImageData(0, 0, imgWidth, imgHeight);
    } catch (e) {
        console.error('getImageData 失败：', e);
        return cells;
    }

    const cellW = imgWidth / N;
    const cellH = imgHeight / M;

    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const sx = Math.floor(i * cellW);
            const sy = Math.floor(j * cellH);
            const ex = Math.min(imgWidth, Math.ceil((i + 1) * cellW));
            const ey = Math.min(imgHeight, Math.ceil((j + 1) * cellH));
            const w = Math.max(1, ex - sx);
            const h = Math.max(1, ey - sy);

            const rgb = calculateCellColor(fullData, sx, sy, w, h, mode);
            if (rgb) {
                const bead = findClosestColor(rgb, palette);
                cells[j][i] = { hex: bead.hex, systems: bead.systems };
            } else {
                cells[j][i] = TRANSPARENT_CELL;
            }
        }
    }
    return cells;
}

/**
 * 统计网格中每种颜色的用量。
 * @returns {Array<{hex, systems, count}>} 按 count 降序
 */
export function countColors(cells) {
    const stat = new Map();
    for (const row of cells) {
        for (const cell of row) {
            if (!cell || cell.transparent || !cell.hex) continue;
            const existing = stat.get(cell.hex);
            if (existing) existing.count++;
            else stat.set(cell.hex, { hex: cell.hex, systems: cell.systems, count: 1 });
        }
    }
    return Array.from(stat.values()).sort((a, b) => b.count - a.count);
}
