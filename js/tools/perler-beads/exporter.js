/**
 * 导出模块 — 生成带色号标注的 PNG 图纸，以及颜色清单 CSV。
 * 纯前端：Canvas 离屏绘制 → Blob → 触发下载。
 */

/** 触发浏览器下载一个 Blob */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 根据背景色决定标注文字用黑还是白 */
function textColorFor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // 相对亮度
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#333333' : '#ffffff';
}

/**
 * 导出带色号标注的 PNG 图纸。
 * @param {Array<Array>} cells 像素网格
 * @param {string} colorSystem 当前色号系统（如 'MARD'）
 * @param {object} opts { cellSize=32, showCode=true }
 */
export function exportGridPng(cells, colorSystem, opts = {}) {
    const cellSize = opts.cellSize || 32;
    const showCode = opts.showCode !== false;
    const M = cells.length;
    const N = cells[0] ? cells[0].length : 0;
    if (!N || !M) return;

    const canvas = document.createElement('canvas');
    canvas.width = N * cellSize;
    canvas.height = M * cellSize;
    const ctx = canvas.getContext('2d');

    // 背景白色
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${Math.floor(cellSize * 0.34)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const cell = cells[j][i];
            const x = i * cellSize;
            const y = j * cellSize;
            if (cell && !cell.transparent && cell.hex) {
                ctx.fillStyle = cell.hex;
                ctx.fillRect(x, y, cellSize, cellSize);
                if (showCode && cell.systems) {
                    const code = cell.systems[colorSystem] || '';
                    if (code) {
                        ctx.fillStyle = textColorFor(cell.hex);
                        ctx.fillText(code, x + cellSize / 2, y + cellSize / 2);
                    }
                }
            }
            // 网格线
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);
        }
    }

    canvas.toBlob(blob => {
        if (blob) downloadBlob(blob, `拼豆图纸_${colorSystem}_${N}x${M}.png`);
    }, 'image/png');
}

/**
 * 导出颜色清单 CSV：色号、HEX、数量。
 * @param {Array<{hex,systems,count}>} stats countColors() 的结果
 * @param {string} colorSystem
 */
export function exportCsv(stats, colorSystem) {
    const header = `${colorSystem},HEX,数量\n`;
    const rows = stats.map(s => {
        const code = (s.systems && s.systems[colorSystem]) || '';
        return `${code},${s.hex},${s.count}`;
    }).join('\n');
    // 加 BOM 让 Excel 正确识别 UTF-8
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `拼豆清单_${colorSystem}.csv`);
}
