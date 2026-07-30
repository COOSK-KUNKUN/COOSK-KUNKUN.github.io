/**
 * CSV 导入/导出 — 将拼豆图纸与 CSV 文件互转。
 * 格式：每行 N 个 HEX 色值（#RRGGBB），逗号分隔；空格子用空字符串表示。
 */

import { PALETTE } from './color-data.js';
import { findClosestColor, hexToRgb } from './color-utils.js';

/**
 * 将 HEX 映射到最近的拼豆色板颜色，返回完整 cell 数据
 */
function hexToCell(hex) {
    if (!hex || hex.trim() === '') {
        return { hex: null, systems: null, transparent: true };
    }
    const normalized = hex.trim().toUpperCase();
    if (PALETTE[normalized]) {
        return { hex: normalized, systems: PALETTE[normalized], transparent: false };
    }
    const rgb = hexToRgb(normalized);
    if (rgb) {
        const closest = findClosestColor(rgb);
        if (closest) {
            return { hex: closest.hex, systems: closest.systems, transparent: false };
        }
    }
    return { hex: normalized, systems: null, transparent: false };
}

/**
 * 解析 CSV 文件，返回 cells 二维数组和网格尺寸
 * @param {File} file CSV 文件
 * @returns {Promise<{ cells: Array, N: number, M: number }>}
 */
export function parseCsvFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
                if (lines.length === 0) {
                    reject(new Error('CSV 文件为空'));
                    return;
                }
                // 跳过可能的表头（如果第一行包含非 HEX 内容）
                let startIdx = 0;
                const firstLine = lines[0].trim();
                if (!/^[#0-9A-Fa-f,\s]+$/.test(firstLine)) {
                    startIdx = 1;
                }
                const dataLines = lines.slice(startIdx);
                if (dataLines.length === 0) {
                    reject(new Error('CSV 文件无有效数据'));
                    return;
                }
                // 解析每行
                const rows = dataLines.map(line => {
                    const hexes = line.split(',').map(h => h.trim());
                    return hexes.map(hexToCell);
                });
                // 确保每行列数一致（以第一行为准）
                const N = rows[0].length;
                const cells = rows.map(row => {
                    if (row.length < N) {
                        return [...row, ...Array(N - row.length).fill({ hex: null, systems: null, transparent: true })];
                    }
                    return row.slice(0, N);
                });
                const M = cells.length;
                resolve({ cells, N, M });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsText(file, 'UTF-8');
    });
}

/**
 * 导出 cells 为 CSV 内容字符串
 * @param {Array<Array>} cells 像素网格
 * @returns {string} CSV 文本
 */
export function cellsToCsv(cells) {
    return cells.map(row =>
        row.map(cell => cell.transparent ? '' : cell.hex).join(',')
    ).join('\n');
}

/**
 * 导出 CSV 文件并触发下载
 */
export function exportCsvFile(cells, filename) {
    const csv = cellsToCsv(cells);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '拼豆图纸.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 创建空白网格
 * @param {number} N 列数
 * @param {number} M 行数
 * @returns {Array<Array>} 全透明 cells
 */
export function createEmptyGrid(N, M) {
    return Array.from({ length: M }, () =>
        Array.from({ length: N }, () => ({ hex: null, systems: null, transparent: true }))
    );
}
