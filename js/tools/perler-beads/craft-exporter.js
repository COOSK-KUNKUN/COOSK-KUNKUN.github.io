/**
 * 拼豆工作台导出 — 生成可打印的图纸 PNG（坐标标尺 + 色号 + 底部色号清单表）与清单 CSV。
 * 纯前端：离屏 Canvas → Blob → 触发下载。
 */

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function textColorFor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#3a2d20' : '#ffffff';
}

function countColors(cells, system) {
    const map = new Map();
    for (const row of cells) {
        for (const c of row) {
            if (!c || c.transparent || !c.hex) continue;
            const key = c.hex.toUpperCase();
            if (!map.has(key)) map.set(key, { hex: c.hex, systems: c.systems, count: 0 });
            map.get(key).count++;
        }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * 导出图纸 PNG：顶部标题栏 + 四边坐标标尺 + 每格色号 + 每 10 格加重线 + 底部色号清单。
 */
export function exportCraftPng(cells, system, opts = {}) {
    const showCode = opts.showCode !== false;
    const M = cells.length;
    const N = cells[0] ? cells[0].length : 0;
    if (!N || !M) return;

    const cell = 30;
    const pad = 28;          // 外边距
    const ruler = 30;        // 标尺宽
    const headerH = 56;      // 标题栏
    const stats = countColors(cells, system);

    // 清单表格布局
    const legendCols = Math.max(2, Math.min(5, Math.floor((N * cell) / 190)));
    const legendRowH = 30;
    const legendRows = Math.ceil(stats.length / legendCols);
    const legendH = stats.length ? (legendRows * legendRowH + 56) : 40;

    const gridW = N * cell;
    const gridH = M * cell;
    const W = pad * 2 + ruler + gridW;
    const H = headerH + pad + ruler + gridH + legendH + pad;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景
    ctx.fillStyle = '#fffdf5';
    ctx.fillRect(0, 0, W, H);

    // 标题栏
    ctx.fillStyle = '#3a2d20';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#19c8b9';
    ctx.fillRect(0, headerH - 4, W, 4);
    ctx.fillStyle = '#fffdf5';
    ctx.font = '700 24px Nunito, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('🧩 拼豆图纸', pad, headerH / 2);
    ctx.font = '500 15px Nunito, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${N} × ${M} · ${system}`, W - pad, headerH / 2);

    const ox = pad + ruler;      // 网格左上
    const oy = headerH + pad + ruler;

    // 标尺
    ctx.fillStyle = '#9f927d';
    ctx.font = '600 12px Nunito, sans-serif';
    ctx.textBaseline = 'middle';
    // 顶部列号（每 5）
    ctx.textAlign = 'center';
    for (let i = 0; i < N; i++) {
        if (i === 0 || (i + 1) % 5 === 0) ctx.fillText(String(i + 1), ox + i * cell + cell / 2, oy - ruler / 2);
    }
    // 左侧行号（每 5）
    ctx.textAlign = 'center';
    for (let j = 0; j < M; j++) {
        if (j === 0 || (j + 1) % 5 === 0) ctx.fillText(String(j + 1), ox - ruler / 2, oy + j * cell + cell / 2);
    }

    // 格子
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.floor(cell * 0.4)}px Nunito, sans-serif`;
    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const c = cells[j][i];
            const x = ox + i * cell, y = oy + j * cell;
            if (c && !c.transparent && c.hex) {
                ctx.fillStyle = c.hex;
                ctx.fillRect(x, y, cell, cell);
                if (showCode && c.systems) {
                    const code = c.systems[system] || '';
                    if (code) { ctx.fillStyle = textColorFor(c.hex); ctx.fillText(code, x + cell / 2, y + cell / 2); }
                }
            } else {
                ctx.fillStyle = (i + j) % 2 === 0 ? '#f4efe0' : '#ece5d2';
                ctx.fillRect(x, y, cell, cell);
            }
        }
    }

    // 细网格
    ctx.strokeStyle = 'rgba(121,79,39,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const x = ox + i * cell + 0.5; ctx.moveTo(x, oy); ctx.lineTo(x, oy + gridH); }
    for (let j = 0; j <= M; j++) { const y = oy + j * cell + 0.5; ctx.moveTo(ox, y); ctx.lineTo(ox + gridW, y); }
    ctx.stroke();
    // 每 10 格加重
    ctx.strokeStyle = 'rgba(121,79,39,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 10) { const x = ox + i * cell + 0.5; ctx.moveTo(x, oy); ctx.lineTo(x, oy + gridH); }
    for (let j = 0; j <= M; j += 10) { const y = oy + j * cell + 0.5; ctx.moveTo(ox, y); ctx.lineTo(ox + gridW, y); }
    ctx.stroke();

    // 底部色号清单
    const legendTop = oy + gridH + 36;
    ctx.fillStyle = '#794f27';
    ctx.font = '700 16px Nunito, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const totalBeads = stats.reduce((s, c) => s + c.count, 0);
    ctx.fillText(`色号清单 · 共 ${stats.length} 色 · ${totalBeads} 颗`, pad, legendTop - 14);

    const colW = gridW / legendCols;
    ctx.font = '500 13px Nunito, sans-serif';
    stats.forEach((s, idx) => {
        const col = idx % legendCols;
        const rowi = Math.floor(idx / legendCols);
        const x = ox + col * colW;
        const y = legendTop + rowi * legendRowH + legendRowH / 2;
        // 色块
        ctx.fillStyle = s.hex;
        ctx.fillRect(x, y - 9, 18, 18);
        ctx.strokeStyle = 'rgba(121,79,39,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y - 9 + 0.5, 18, 18);
        // 文字
        const code = (s.systems && s.systems[system]) || '自定义';
        ctx.fillStyle = '#3a2d20';
        ctx.textAlign = 'left';
        ctx.fillText(code, x + 26, y);
        ctx.fillStyle = '#9f927d';
        ctx.textAlign = 'right';
        ctx.fillText(`${s.count} 颗`, x + colW - 16, y);
        ctx.textAlign = 'left';
    });

    canvas.toBlob(blob => { if (blob) download(blob, `拼豆图纸_${system}_${N}x${M}.png`); }, 'image/png');
}

/** 导出色号清单 CSV */
export function exportCraftListCsv(stats, system) {
    const header = `${system},HEX,数量\n`;
    const rows = stats.map(s => `${(s.systems && s.systems[system]) || ''},${s.hex},${s.count}`).join('\n');
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' });
    download(blob, `拼豆清单_${system}.csv`);
}
