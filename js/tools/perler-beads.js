/**
 * 拼豆图纸生成器 + 编辑器
 * 流程：选择模式 → 图片生成器（上传图片 → 像素化 → 映射色板 → 预览 + 导出）
 *                    → 编辑器（手绘/导入CSV → 编辑 → 导出）
 * 纯前端，适配 github.io 静态部署，图片全程本地处理不上传。
 */

import { COLOR_SYSTEMS } from './perler-beads/color-data.js';
import { calculatePixelGrid, countColors, PixelationMode } from './perler-beads/pixelation.js';
import { exportGridPng, exportCsv } from './perler-beads/exporter.js';
import { mountCraft, unmountCraft } from './perler-beads/craft-editor.js';

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
let currentMode = null; // 'generator' | 'editor'
let containerRef = null;

export function mount(container) {
    containerRef = container;
    currentMode = null;
    renderModeSelect(container);
}

// ================= 模式选择界面 =================
function renderModeSelect(container) {
    container.innerHTML = `
        <div class="perler-mode-select">
            <div class="perler-mode-header">
                <h2 class="perler-mode-title">🧩 拼豆工具</h2>
                <p class="perler-mode-sub">选择你需要的功能</p>
            </div>
            <div class="perler-mode-cards">
                <button class="perler-mode-card" data-mode="generator">
                    <div class="perler-mode-icon">🖼️</div>
                    <h3 class="perler-mode-name">图片生成器</h3>
                    <p class="perler-mode-desc">上传图片，自动像素化并映射到拼豆色板，生成带色号的图纸与颜色清单</p>
                </button>
                <button class="perler-mode-card" data-mode="editor">
                    <div class="perler-mode-icon">✏️</div>
                    <h3 class="perler-mode-name">拼豆编辑器</h3>
                    <p class="perler-mode-desc">从空白画布自由手绘，或导入已有 CSV 图纸继续编辑</p>
                </button>
            </div>
        </div>
    `;

    container.querySelectorAll('.perler-mode-card').forEach(card => {
        card.addEventListener('click', () => {
            const mode = card.dataset.mode;
            if (mode === 'generator') {
                currentMode = 'generator';
                renderGenerator(container);
            } else if (mode === 'editor') {
                currentMode = 'editor';
                mountCraft(container);
            }
        });
    });
}

// ================= 图片生成器模式 =================
function renderGenerator(container) {
    container.innerHTML = `
        <div class="perler-generator">
            <!-- 上传区 -->
            <div class="perler-upload" id="perlerUpload">
                <div class="perler-upload-icon">🖼️</div>
                <div class="perler-upload-title">点击或拖拽图片到此处</div>
                <div class="perler-upload-hint">支持 JPG / PNG</div>
                <input type="file" id="perlerFile" accept="image/*" style="display:none;">
            </div>

            <!-- 工作区 -->
            <div class="perler-workspace hidden" id="perlerWorkspace">
                <!-- 顶部工具栏 -->
                <div class="perler-gen-toolbar">
                    <div class="perler-gen-toolbar-group">
                        <div class="perler-gen-grid-control">
                            <div class="perler-gen-grid-label">横向格子数</div>
                            <div class="perler-gen-grid-value" id="perlerGridVal">50</div>
                            <input type="range" id="perlerGrid" min="10" max="${MAX_GRID}" value="50" class="perler-gen-range">
                        </div>
                        <div class="perler-gen-field">
                            <div class="perler-gen-field-label">像素化模式</div>
                            <select id="perlerMode" class="perler-gen-select">
                                <option value="dominant">主色提取（卡通）</option>
                                <option value="average">平均色（照片）</option>
                            </select>
                        </div>
                    </div>
                    <div class="perler-gen-toolbar-divider"></div>
                    <div class="perler-gen-toolbar-group">
                        <div class="perler-gen-field">
                            <div class="perler-gen-field-label">色号系统</div>
                            <select id="perlerSystem" class="perler-gen-select">
                                ${COLOR_SYSTEMS.map(s => `<option value="${s}">${s}</option>`).join('')}
                            </select>
                        </div>
                        <label class="perler-gen-checkbox">
                            <input type="checkbox" id="perlerShowCode" checked>
                            <span class="perler-gen-checkbox-mark"></span>
                            <span>显示色号</span>
                        </label>
                    </div>
                    <div class="perler-gen-toolbar-actions">
                        <button class="perler-gen-btn-regen" id="perlerRegenerate">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            重新生成
                        </button>
                    </div>
                </div>

                <!-- 主内容区：画布 + 右侧面板 -->
                <div class="perler-gen-main">
                    <div class="perler-gen-canvas-wrap" id="perlerCanvasArea">
                        <canvas id="perlerCanvas"></canvas>
                        <div class="perler-gen-canvas-hint">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>
                            拖动平移 · 滚轮缩放
                        </div>
                        <div class="perler-tooltip hidden" id="perlerTooltip"></div>
                    </div>

                    <!-- 右侧材料清单面板 -->
                    <div class="perler-gen-panel">
                        <div class="perler-gen-panel-header">
                            <span class="perler-gen-panel-icon"></span>
                            <span class="perler-gen-panel-title">材料清单</span>
                        </div>
                        <div class="perler-gen-panel-stats">
                            <div class="perler-gen-stat-card">
                                <div class="perler-gen-stat-num" id="perlerStatColors">0</div>
                                <div class="perler-gen-stat-label">种颜色</div>
                            </div>
                            <div class="perler-gen-stat-card">
                                <div class="perler-gen-stat-num" id="perlerStatBeads">0</div>
                                <div class="perler-gen-stat-label">颗豆子</div>
                            </div>
                        </div>
                        <div class="perler-gen-color-list" id="perlerColorList"></div>
                        <div class="perler-gen-panel-actions">
                            <button class="perler-gen-btn perler-gen-btn-secondary" id="perlerExportCsv">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                清单
                            </button>
                            <button class="perler-gen-btn perler-gen-btn-primary" id="perlerExportPng">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                导出
                            </button>
                        </div>
                    </div>
                </div>
            </div>
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
        regenerate: container.querySelector('#perlerRegenerate'),
        exportPng: container.querySelector('#perlerExportPng'),
        exportCsv: container.querySelector('#perlerExportCsv'),
        canvasArea: container.querySelector('#perlerCanvasArea'),
        canvas: container.querySelector('#perlerCanvas'),
        tooltip: container.querySelector('#perlerTooltip'),
        statColors: container.querySelector('#perlerStatColors'),
        statBeads: container.querySelector('#perlerStatBeads'),
        colorList: container.querySelector('#perlerColorList'),
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
    els.system.addEventListener('change', () => { state.system = els.system.value; buildCodeLayer(); paint(); renderStats(); });
    els.showCode.addEventListener('change', () => { state.showCode = els.showCode.checked; paint(); });

    els.regenerate.addEventListener('click', () => regenerate());
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
    const N = state.cells[0] ? state.cells[0].length : 0;
    const M = state.cells.length;

    // 更新统计卡片
    els.statColors.textContent = state.stats.length;
    els.statBeads.textContent = total.toLocaleString();

    // 更新颜色列表
    els.colorList.innerHTML = state.stats.map(s => {
        const code = (s.systems && s.systems[state.system]) || '?';
        return `<div class="perler-gen-color-item">
            <div class="perler-gen-color-swatch" style="background-color:${s.hex}"></div>
            <div class="perler-gen-color-info">
                <div class="perler-gen-color-code">${code}</div>
                <div class="perler-gen-color-hex">${s.hex}</div>
            </div>
            <div class="perler-gen-color-count">×${s.count}</div>
        </div>`;
    }).join('');
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
    
    // 如果当前是编辑器模式，调用编辑器的 unmount
    if (currentMode === 'editor') {
        unmountCraft();
    }
    
    currentMode = null;
    containerRef = null;
}
