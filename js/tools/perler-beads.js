/**
 * 拼豆图纸生成器
 * 流程：上传图片 → 像素化（Dominant/Average）→ 映射到拼豆色板 → 预览 + 色号统计 → 导出 PNG/CSV
 * 纯前端，适配 github.io 静态部署，图片全程本地处理不上传。
 */

import { COLOR_SYSTEMS } from './perler-beads/color-data.js';
import { calculatePixelGrid, countColors, PixelationMode } from './perler-beads/pixelation.js';
import { exportGridPng, exportCsv } from './perler-beads/exporter.js';

const MAX_GRID = 150; // 粒度上限（决策 D2：150×150 性能可控）
const BASE_CELL = 20; // 离屏图纸每格基准像素（色号文字按此绘制）
const CODE_MIN_SCALE = 0.7; // 视图缩放 ≥ 此值才显示色号文字（决策 D4）
const GRID_MIN_CELL_PX = 4; // 单格屏幕尺寸 ≥ 此值才画网格线（避免缩小时线条糊成粗条）
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

let objectUrls = new Set();
function trackUrl(url) { objectUrls.add(url); return url; }
function revokeAllUrls() {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls.clear();
}

// 状态
const state = {
    img: null,          // 原始 Image
    srcCtx: null,       // 原图离屏 context
    cells: null,        // 像素网格
    stats: null,        // 颜色统计
    gridN: 50,          // 横向格子数
    mode: PixelationMode.Dominant,
    system: 'MARD',
    showCode: true,
};

// 视图变换：screen = image * scale + offset（image = 离屏图纸像素坐标）
const view = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    gridImg: null,   // 离屏图纸 canvas（不含色号）
    codeImg: null,   // 离屏色号层 canvas（叠加用）
    N: 0, M: 0,
};

// 拖动平移状态
let panning = false;
let panStart = null; // { x, y, ox, oy }
let rafPending = false;

// DOM 引用
let els = {};

export function mount(container) {
    container.innerHTML = `
        <h2>🧩 拼豆图纸生成器</h2>
        <p class="perler-desc">上传图片，自动像素化并映射到拼豆色板，生成带色号的图纸与颜色清单。全程在浏览器本地处理，图片不上传。</p>

        <!-- 上传区 -->
        <div class="perler-upload" id="perlerUpload">
            <div class="perler-upload-icon">🖼️</div>
            <div class="perler-upload-title">点击或拖拽图片到此处</div>
            <div class="perler-upload-hint">支持 JPG / PNG</div>
            <input type="file" id="perlerFile" accept="image/*" style="display:none;">
        </div>

        <!-- 工作区 -->
        <div class="perler-workspace hidden" id="perlerWorkspace">
            <div class="perler-toolbar">
                <div class="perler-field">
                    <label class="perler-label">粒度（横向格子）<span id="perlerGridVal">50</span></label>
                    <input type="range" id="perlerGrid" min="10" max="${MAX_GRID}" value="50" class="perler-range">
                </div>
                <div class="perler-field">
                    <label class="perler-label">模式</label>
                    <select id="perlerMode" class="perler-select">
                        <option value="dominant">主色（卡通）</option>
                        <option value="average">平均色（照片）</option>
                    </select>
                </div>
                <div class="perler-field">
                    <label class="perler-label">色号系统</label>
                    <select id="perlerSystem" class="perler-select">
                        ${COLOR_SYSTEMS.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </div>
                <div class="perler-field perler-field-check">
                    <label class="perler-label"><input type="checkbox" id="perlerShowCode" checked> 显示色号</label>
                </div>
                <div class="perler-field perler-field-actions">
                    <button class="tool-btn" id="perlerReupload">重新上传</button>
                    <button class="tool-btn tool-btn-primary" id="perlerExportPng">导出图纸</button>
                    <button class="tool-btn" id="perlerExportCsv">导出清单</button>
                </div>
            </div>

            <div class="perler-canvas-area" id="perlerCanvasArea">
                <canvas id="perlerCanvas"></canvas>
                <div class="perler-tooltip hidden" id="perlerTooltip"></div>
                <div class="perler-view-hint">拖动平移 · 滚轮缩放</div>
                <button class="tool-btn tool-btn-sm perler-reset-view" id="perlerResetView">复位</button>
            </div>

            <div class="perler-stats" id="perlerStats"></div>
        </div>
    `;

    els = {
        upload: container.querySelector('#perlerUpload'),
        file: container.querySelector('#perlerFile'),
        workspace: container.querySelector('#perlerWorkspace'),
        grid: container.querySelector('#perlerGrid'),
        gridVal: container.querySelector('#perlerGridVal'),
        mode: container.querySelector('#perlerMode'),
        system: container.querySelector('#perlerSystem'),
        showCode: container.querySelector('#perlerShowCode'),
        reupload: container.querySelector('#perlerReupload'),
        exportPng: container.querySelector('#perlerExportPng'),
        exportCsv: container.querySelector('#perlerExportCsv'),
        canvasArea: container.querySelector('#perlerCanvasArea'),
        canvas: container.querySelector('#perlerCanvas'),
        tooltip: container.querySelector('#perlerTooltip'),
        resetView: container.querySelector('#perlerResetView'),
        stats: container.querySelector('#perlerStats'),
    };

    bindEvents();
}

function bindEvents() {
    // 上传：点击 + 拖拽
    els.upload.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) loadImage(f);
    });
    els.upload.addEventListener('dragover', e => { e.preventDefault(); els.upload.classList.add('dragover'); });
    els.upload.addEventListener('dragleave', () => els.upload.classList.remove('dragover'));
    els.upload.addEventListener('drop', e => {
        e.preventDefault();
        els.upload.classList.remove('dragover');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) loadImage(f);
    });

    // 参数变化 → 重新生成
    els.grid.addEventListener('input', () => { els.gridVal.textContent = els.grid.value; });
    els.grid.addEventListener('change', () => { state.gridN = parseInt(els.grid.value, 10); regenerate(); });
    els.mode.addEventListener('change', () => { state.mode = els.mode.value; regenerate(); });
    // 换色号系统 / 开关色号：只需重建色号层，不用重算网格
    els.system.addEventListener('change', () => { state.system = els.system.value; buildCodeLayer(); paint(); renderStats(); });
    els.showCode.addEventListener('change', () => { state.showCode = els.showCode.checked; paint(); });

    els.reupload.addEventListener('click', () => resetToUpload());
    els.resetView.addEventListener('click', () => { resetView(); paint(); });
    els.exportPng.addEventListener('click', () => {
        if (state.cells) exportGridPng(state.cells, state.system, { showCode: state.showCode });
    });
    els.exportCsv.addEventListener('click', () => {
        if (state.stats) exportCsv(state.stats, state.system);
    });

    // 视图交互：滚轮缩放（以光标为锚点）、按住拖动平移、悬停显示色号
    els.canvas.addEventListener('wheel', onWheel, { passive: false });
    els.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    els.canvas.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));
}

function loadImage(file) {
    const url = trackUrl(URL.createObjectURL(file));
    const img = new Image();
    img.onload = () => {
        state.img = img;
        // 原图画到离屏 canvas，供 getImageData
        const off = document.createElement('canvas');
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        state.srcCtx = ctx;

        els.upload.classList.add('hidden');
        els.workspace.classList.remove('hidden');
        regenerate();
    };
    img.onerror = () => alert('图片加载失败，请换一张试试');
    img.src = url;
}

/** 根据当前参数重新计算网格，重建离屏图纸，复位视图并绘制 */
function regenerate() {
    if (!state.srcCtx || !state.img) return;
    const w = state.img.naturalWidth;
    const h = state.img.naturalHeight;
    const N = state.gridN;
    // 按图片宽高比推纵向格子数
    const M = Math.max(1, Math.round(N * h / w));

    state.cells = calculatePixelGrid(state.srcCtx, w, h, N, M, state.mode);
    state.stats = countColors(state.cells);
    buildGridLayer();
    buildCodeLayer();
    resetView();
    paint();
    renderStats();
}

/** 把像素网格画到离屏 canvas（每格 BASE_CELL 像素，只放色块，网格线在 paint 里实时画） */
function buildGridLayer() {
    const cells = state.cells;
    const M = cells.length;
    const N = cells[0] ? cells[0].length : 0;
    view.N = N; view.M = M;
    if (!N) { view.gridImg = null; return; }

    const off = document.createElement('canvas');
    off.width = N * BASE_CELL;
    off.height = M * BASE_CELL;
    const ctx = off.getContext('2d');

    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const cell = cells[j][i];
            if (cell && !cell.transparent && cell.hex) {
                ctx.fillStyle = cell.hex;
                ctx.fillRect(i * BASE_CELL, j * BASE_CELL, BASE_CELL, BASE_CELL);
            }
        }
    }
    view.gridImg = off;
}

/** 把当前色号系统的色号画到独立离屏层（换系统只重建这层） */
function buildCodeLayer() {
    const cells = state.cells;
    const M = cells.length;
    const N = cells[0] ? cells[0].length : 0;
    if (!N) { view.codeImg = null; return; }

    const off = document.createElement('canvas');
    off.width = N * BASE_CELL;
    off.height = M * BASE_CELL;
    const ctx = off.getContext('2d');
    ctx.font = `${Math.floor(BASE_CELL * 0.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const cell = cells[j][i];
            if (!cell || cell.transparent || !cell.hex || !cell.systems) continue;
            const code = cell.systems[state.system] || '';
            if (!code) continue;
            ctx.fillStyle = textColorFor(cell.hex);
            ctx.fillText(code, i * BASE_CELL + BASE_CELL / 2, j * BASE_CELL + BASE_CELL / 2);
        }
    }
    view.codeImg = off;
}

/** 复位视图：让图纸整体居中铺满画布区 */
function resetView() {
    if (!view.gridImg) return;
    fitCanvasToArea();
    const cw = els.canvas.width, ch = els.canvas.height;
    const iw = view.gridImg.width, ih = view.gridImg.height;
    const s = Math.min(cw / iw, ch / ih) * 0.95;
    view.scale = s > 0 ? s : 1;
    view.offsetX = (cw - iw * view.scale) / 2;
    view.offsetY = (ch - ih * view.scale) / 2;
}

/** 让可见 canvas 像素尺寸匹配其显示区域 */
function fitCanvasToArea() {
    const area = els.canvasArea;
    const w = Math.max(240, area.clientWidth);
    const h = Math.max(240, area.clientHeight);
    if (els.canvas.width !== w) els.canvas.width = w;
    if (els.canvas.height !== h) els.canvas.height = h;
}

/** 按当前视图变换把离屏图纸绘制到可见 canvas（用 rAF 合帧） */
function paint() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
        rafPending = false;
        if (!view.gridImg) return;
        const ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.imageSmoothingEnabled = false;
        const dw = view.gridImg.width * view.scale;
        const dh = view.gridImg.height * view.scale;
        ctx.drawImage(view.gridImg, view.offsetX, view.offsetY, dw, dh);
        // 网格线：实时按当前缩放画 1px 细线；格子太小则不画，避免缩小时糊成粗条
        drawGridLines(ctx, dw, dh);
        // 色号层：仅在放大到一定程度才叠加，避免缩小时糊成一团
        if (state.showCode && view.codeImg && view.scale >= CODE_MIN_SCALE) {
            ctx.drawImage(view.codeImg, view.offsetX, view.offsetY, dw, dh);
        }
    });
}

/** 在屏幕坐标系实时绘制网格线（1px），随缩放自适应，格子过小时跳过 */
function drawGridLines(ctx, dw, dh) {
    const cellPx = BASE_CELL * view.scale; // 单格在屏幕上的像素尺寸
    if (cellPx < GRID_MIN_CELL_PX) return;
    const x0 = view.offsetX, y0 = view.offsetY;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= view.N; i++) {
        const x = Math.round(x0 + i * cellPx) + 0.5; // +0.5 对齐像素，避免线条发虚
        ctx.moveTo(x, Math.round(y0) + 0.5);
        ctx.lineTo(x, Math.round(y0 + dh) + 0.5);
    }
    for (let j = 0; j <= view.M; j++) {
        const y = Math.round(y0 + j * cellPx) + 0.5;
        ctx.moveTo(Math.round(x0) + 0.5, y);
        ctx.lineTo(Math.round(x0 + dw) + 0.5, y);
    }
    ctx.stroke();
    ctx.restore();
}

function textColorFor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#333' : '#fff';
}

/** 屏幕坐标（canvas 像素）→ 离屏图纸坐标 */
function screenToImage(sx, sy) {
    return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

/** 从鼠标事件取相对 canvas 的像素坐标（含 CSS 缩放校正） */
function eventToCanvas(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (els.canvas.width / rect.width),
        y: (e.clientY - rect.top) * (els.canvas.height / rect.height),
        clientRect: rect,
    };
}

/** 滚轮缩放：以光标位置为锚点 */
function onWheel(e) {
    if (!view.gridImg) return;
    e.preventDefault();
    const p = eventToCanvas(e);
    const before = screenToImage(p.x, p.y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    // 保持光标下的图纸点不动
    view.offsetX = p.x - before.x * view.scale;
    view.offsetY = p.y - before.y * view.scale;
    paint();
}

function onMouseDown(e) {
    if (!view.gridImg || e.button !== 0) return;
    panning = true;
    const p = eventToCanvas(e);
    panStart = { x: p.x, y: p.y, ox: view.offsetX, oy: view.offsetY };
    els.canvas.classList.add('perler-grabbing');
    els.tooltip.classList.add('hidden');
}

function onMouseMove(e) {
    if (panning && panStart) {
        const p = eventToCanvas(e);
        view.offsetX = panStart.ox + (p.x - panStart.x);
        view.offsetY = panStart.oy + (p.y - panStart.y);
        paint();
        return;
    }
    updateTooltip(e);
}

function onMouseUp() {
    if (!panning) return;
    panning = false;
    panStart = null;
    els.canvas.classList.remove('perler-grabbing');
}

/** 悬停显示格子色号（非拖动时） */
function updateTooltip(e) {
    if (!view.gridImg || !state.cells) return;
    const rect = els.canvas.getBoundingClientRect();
    // 命中检测在 canvas 区域外则隐藏
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        els.tooltip.classList.add('hidden');
        return;
    }
    const p = eventToCanvas(e);
    const img = screenToImage(p.x, p.y);
    const i = Math.floor(img.x / BASE_CELL);
    const j = Math.floor(img.y / BASE_CELL);
    if (i < 0 || j < 0 || j >= view.M || i >= view.N) {
        els.tooltip.classList.add('hidden');
        return;
    }
    const cell = state.cells[j][i];
    if (!cell || cell.transparent || !cell.hex) {
        els.tooltip.classList.add('hidden');
        return;
    }
    const code = (cell.systems && cell.systems[state.system]) || '?';
    els.tooltip.innerHTML = `<span class="perler-swatch" style="background:${cell.hex}"></span> ${code} · ${cell.hex}`;
    els.tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
    els.tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
    els.tooltip.classList.remove('hidden');
}

function renderStats() {
    if (!state.stats) return;
    const total = state.stats.reduce((s, c) => s + c.count, 0);
    const items = state.stats.map(s => {
        const code = (s.systems && s.systems[state.system]) || '?';
        return `<div class="perler-stat-item">
            <span class="perler-swatch" style="background:${s.hex}"></span>
            <span class="perler-stat-code">${code}</span>
            <span class="perler-stat-count">×${s.count}</span>
        </div>`;
    }).join('');
    els.stats.innerHTML = `
        <div class="perler-stats-head">共 ${state.stats.length} 种颜色 · ${total} 颗豆子</div>
        <div class="perler-stats-list">${items}</div>
    `;
}

function resetToUpload() {
    state.img = null;
    state.srcCtx = null;
    state.cells = null;
    state.stats = null;
    view.gridImg = null;
    view.codeImg = null;
    els.file.value = '';
    els.workspace.classList.add('hidden');
    els.upload.classList.remove('hidden');
    revokeAllUrls();
}

export function unmount() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    revokeAllUrls();
    els = {};
    panning = false;
    panStart = null;
    state.img = null;
    state.srcCtx = null;
    state.cells = null;
    state.stats = null;
    view.gridImg = null;
    view.codeImg = null;
}
