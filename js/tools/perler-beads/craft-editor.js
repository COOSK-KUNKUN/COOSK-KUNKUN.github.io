/**
 * 拼豆编辑器 - 手绘模式
 * 从空白画布自由手绘，或导入已有 CSV 图纸继续编辑。
 * 三列布局：画布+快捷操作 | 工具+色板+最近使用+导出 | 统计
 * 顶部栏：logo、网格尺寸、当前颜色、色号系统、显示选项、新建
 */

import { COLOR_SYSTEMS, COLOR_GROUPS, getColorGroup, PALETTE as COLOR_PALETTE } from './color-data.js';
import { hexToRgb, rgbToHex, findClosestColor } from './color-utils.js';

// ================= 预设尺寸 =================
const PRESETS = [
    { label: '小图标', N: 20, M: 20 },
    { label: '常用', N: 50, M: 50 },
];

// ================= 状态 =================
const state = {
    cells: null,
    N: 50, M: 50,
    tool: 'hand',
    selected: null,
    system: 'MARD',
    showCode: true,
    showTexture: true,
    showGrid: true,
    mirrorMode: false,
    history: [],
    redo: [],
    stats: [],
    activeGroup: Object.keys(COLOR_GROUPS)[0], // 默认选中第一个大类
    recentColors: [], // 最近使用的颜色列表
};

// ================= 最近使用颜色配置 =================
const RECENT_COLORS_MAX = 15; // 最多保存的最近颜色数量（3行×5列）
const RECENT_COLORS_STORAGE_KEY = 'pbw_recent_colors'; // localStorage 键名

// ================= 视图变换 =================
const view = {
    scale: 1, offsetX: 0, offsetY: 0,
    beadImg: null, codeImg: null, boardImg: null,
};

let panning = false, panStart = null, rafPending = false;
let painting = false, lastCell = null, spaceHeld = false;
let els = {};
let containerRef = null;
let resizeObs = null;

// 每个大类的代表色（用于分组按钮圆点显示）
const GROUP_REPRESENTATIVE_COLORS = {
    "黄色系": "#F4D738",
    "绿色系": "#35E352",
    "蓝色系": "#41CCFF",
    "紫色系": "#858EDD",
    "红色系": "#FC3D46",
    "棕色系": "#E1B383",
    "黑白灰": "#89858C",
    "特殊色": "#F2A5E8",
};

// ================= 色板 =================

// 当前系统的色板：{ hex: { hex, code, systems } }
// 其中 systems 保持原始结构 { MARD: "A01", COCO: "E02", ... }
const PALETTE = {};
function buildPalette() {
    // COLOR_PALETTE 是以 HEX 为 key 的对象，每个值包含各系统的色号
    for (const [hex, systems] of Object.entries(COLOR_PALETTE)) {
        const code = systems[state.system] || '';
        PALETTE[hex.toUpperCase()] = { hex, code, systems };
    }
}

// ================= 最近使用颜色 =================

/** 从 localStorage 加载最近使用的颜色 */
function loadRecentColors() {
    try {
        const stored = localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
        if (stored) {
            state.recentColors = JSON.parse(stored);
        }
    } catch (e) {
        state.recentColors = [];
    }
}

/** 保存最近使用的颜色到 localStorage */
function saveRecentColors() {
    try {
        localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(state.recentColors));
    } catch (e) {
        // 忽略存储错误
    }
}

/** 添加颜色到最近使用列表（去重，新颜色在最前面，最多保存 RECENT_COLORS_MAX 个） */
function addRecentColor(hex, systems) {
    if (!hex) return;
    const key = hex.toUpperCase();
    // 移除已存在的相同颜色
    state.recentColors = state.recentColors.filter(c => c.hex.toUpperCase() !== key);
    // 添加到最前面
    state.recentColors.unshift({ hex, systems: systems || PALETTE[key]?.systems || null });
    // 限制数量
    if (state.recentColors.length > RECENT_COLORS_MAX) {
        state.recentColors = state.recentColors.slice(0, RECENT_COLORS_MAX);
    }
    saveRecentColors();
    renderRecentColors();
}

/** 渲染最近使用颜色面板 */
function renderRecentColors() {
    const container = containerRef?.querySelector('#pbwRecentColors');
    if (!container) return;
    
    if (!state.recentColors.length) {
        container.innerHTML = '<div class="pbw-recent-empty">暂无使用记录</div>';
        return;
    }
    
    container.innerHTML = state.recentColors.map(c => {
        const code = (c.systems && c.systems[state.system]) || '';
        const isActive = state.selected && state.selected.hex === c.hex;
        return `<button class="pbw-recent-color${isActive ? ' active' : ''}" data-hex="${c.hex}" title="${code ? code + ' · ' : ''}${c.hex}">
            <span class="pbw-recent-sw" style="background:${c.hex}"></span>
            ${code ? `<span class="pbw-recent-code">${code}</span>` : ''}
        </button>`;
    }).join('');
    
    container.querySelectorAll('.pbw-recent-color').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.dataset.hex;
            state.selected = { hex, systems: PALETTE[hex.toUpperCase()]?.systems || null };
            if (state.tool === 'hand' || state.tool === 'eyedropper' || state.tool === 'eraser') {
                state.tool = 'brush'; updateToolUI();
            }
            renderCurrent(); renderSwatches(); renderRecentColors();
        });
    });
}

// ================= 入口 =================
export function mountCraft(container) {
    containerRef = container;
    buildPalette();
    loadRecentColors(); // 加载最近使用的颜色
    renderSetup(container);
}

export function unmountCraft() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    els = {};
    state.cells = null;
    state.history = [];
    state.redo = [];
    state.stats = [];
    view.beadImg = null;
    view.codeImg = null;
    view.boardImg = null;
    panning = false;
    panStart = null;
    painting = false;
    lastCell = null;
    containerRef = null;
}

// ================= 设置界面 =================
function renderSetup(container) {
    // 回到设置页时画布已销毁，停掉尺寸监听避免对着已移除节点重绘
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    els = {};
    view.beadImg = null;
    view.codeImg = null;
    view.boardImg = null;
    container.innerHTML = `
        <div class="pbw-setup">
            <h2 class="pbw-setup-title">✏️ 拼豆编辑器</h2>
            <p class="pbw-setup-desc">从空白画布自由手绘，或导入已有 CSV 图纸继续编辑。</p>
            <div class="pbw-setup-presets">
                ${PRESETS.map((p, i) => `
                    <button class="pbw-preset-btn" data-idx="${i}">
                        <span class="pbw-preset-label">${p.label}</span>
                        <span class="pbw-preset-size">${p.N} × ${p.M}</span>
                    </button>
                `).join('')}
            </div>
            <div class="pbw-setup-custom">
                <label class="pbw-setup-label">自定义尺寸</label>
                <div class="pbw-setup-inputs">
                    <input type="number" id="pbwCustomN" min="5" max="150" value="50" class="pbw-input" placeholder="宽">
                    <span class="pbw-input-x">×</span>
                    <input type="number" id="pbwCustomM" min="5" max="150" value="50" class="pbw-input" placeholder="高">
                </div>
            </div>
            <div class="pbw-setup-actions">
                <button class="pbw-btn pbw-btn-primary" id="pbwCreate">创建空白画布</button>
                <button class="pbw-btn" id="pbwImport">导入 CSV</button>
                <input type="file" id="pbwImportFile" accept=".csv" style="display:none">
            </div>
        </div>
    `;

    container.querySelectorAll('.pbw-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = PRESETS[parseInt(btn.dataset.idx)];
            state.N = p.N; state.M = p.M;
            createBlank(p.N, p.M);
        });
    });

    container.querySelector('#pbwCreate').addEventListener('click', () => {
        const n = parseInt(container.querySelector('#pbwCustomN').value, 10);
        const m = parseInt(container.querySelector('#pbwCustomM').value, 10);
        if (isNaN(n) || isNaN(m) || n < 5 || m < 5 || n > 150 || m > 150) {
            alert('请输入 5~150 之间的整数'); return;
        }
        createBlank(n, m);
    });

    const importBtn = container.querySelector('#pbwImport');
    const importFile = container.querySelector('#pbwImportFile');
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) importCsv(f);
    });
}

// ================= 创建画布 =================
function createBlank(N, M) {
    state.N = N; state.M = M;
    state.cells = makeEmptyGrid(N, M);
    state.history = []; state.redo = [];
    state.stats = [];
    state.tool = 'hand';
    state.selected = null;
    buildPalette();
    renderEditor(containerRef);
}

function makeEmptyGrid(N, M) {
    return Array.from({ length: M }, () =>
        Array.from({ length: N }, () => ({ hex: null, transparent: true, systems: null }))
    );
}

function gridSize() { return { N: state.N, M: state.M }; }

// ================= CSV 导入 =================
function importCsv(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const text = e.target.result.replace(/^\uFEFF/, '');
        const rows = text.split(/\r?\n/).filter(r => r.trim());
        const M = rows.length;
        const N = Math.max(...rows.map(r => r.split(',').length));
        if (N > 150 || M > 150) { alert('图纸过大（最大 150×150）'); return; }
        state.N = N; state.M = M;
        state.cells = rows.map(row => {
            const cells = row.split(',');
            return Array.from({ length: N }, (_, i) => {
                const hex = (cells[i] || '').trim().toUpperCase();
                if (!hex || !/^#[0-9A-F]{6}$/.test(hex)) return { hex: null, transparent: true, systems: null };
                const pal = PALETTE[hex];
                return { hex, transparent: false, systems: pal ? pal.systems : null };
            });
        });
        state.history = []; state.redo = [];
        state.tool = 'hand';
        state.selected = null;
        buildPalette();
        renderEditor(containerRef);
    };
    reader.readAsText(file);
}

// ================= 编辑器界面 =================
function renderEditor(container) {
    const { N, M } = gridSize();
    container.innerHTML = `
        <div class="pbw-workbench">
            <!-- 顶部栏 -->
            <div class="pbw-topbar">
                <div class="pbw-topbar-left">
                    <div class="pbw-logo">
                        <div class="pbw-logo-icon">✏️</div>
                        <span class="pbw-logo-text">拼豆工作台</span>
                    </div>
                    <span class="pbw-grid-size">${N} × ${M}</span>
                </div>
                <div class="pbw-topbar-center">
                    <select class="pbw-system-select" id="pbwSystemSelect">
                        ${COLOR_SYSTEMS.map(s => `<option value="${s}" ${s === state.system ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <div class="pbw-display-options">
                        <label class="pbw-checkbox-label">
                            <input type="checkbox" id="pbwShowCode" ${state.showCode ? 'checked' : ''}>
                            显示色号
                        </label>
                        <label class="pbw-checkbox-label">
                            <input type="checkbox" id="pbwShowTexture" ${state.showTexture ? 'checked' : ''}>
                            豆子质感
                        </label>
                    </div>
                </div>
                <div class="pbw-topbar-right">
                    <button class="pbw-btn-new" id="pbwNewBtn">新建</button>
                </div>
            </div>

            <!-- 三列主体 -->
            <div class="pbw-main-body">
                <!-- 左列：画布 + 快捷操作 -->
                <div class="pbw-col-canvas">
                    <div class="pbw-canvas-header">
                        <span class="pbw-canvas-hint">点击/拖动绘制 · 空格或抓手平移 · 滚轮缩放</span>
                        <button class="pbw-btn-fullscreen" id="pbwFullscreenBtn" title="全屏展示">
                            <svg id="pbwFullscreenIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <polyline points="9 21 3 21 3 15"></polyline>
                                <line x1="21" y1="3" x2="14" y2="10"></line>
                                <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="pbw-canvas-container">
                        <canvas id="pbwCanvas"></canvas>
                        <div class="pbw-tooltip hidden" id="pbwTooltip"></div>
                    </div>

                    <!-- 色板面板（画布下方） -->
                    <div class="pbw-panel pbw-palette-panel pbw-palette-below">
                        <div class="pbw-panel-title">色板<span class="pbw-panel-badge" id="pbwCurrentBadge"></span></div>
                        <div class="pbw-swatches" id="pbwSwatches"></div>
                    </div>
                </div>

                <!-- 中列：工具 + 最近使用 + 导出 -->
                <div class="pbw-col-tools">
                    <!-- 工具面板 -->
                    <div class="pbw-panel">
                        <div class="pbw-panel-title">工具</div>
                        <div class="pbw-tools-grid">
                            <button class="pbw-tool-btn" data-tool="brush" title="画笔 (B)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M9.5 14.5 4 20l3 .8.8 3 5.5-5.5"></path>
                                        <path d="M13.3 18.3 5.7 10.7a1.5 1.5 0 0 1 0-2.1l5-5a1.5 1.5 0 0 1 2.1 0l7.6 7.6a1.5 1.5 0 0 1 0 2.1l-5 5a1.5 1.5 0 0 1-2.1 0Z"></path>
                                        <path d="m8.6 7.8 7.6 7.6"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">画笔</span>
                                <span class="pbw-tool-key">B</span>
                            </button>
                            <button class="pbw-tool-btn" data-tool="eraser" title="橡皮 (E)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M8.2 20H20"></path>
                                        <path d="M16.8 20H9.3l-4.6-4.6a1.6 1.6 0 0 1 0-2.3l8-8a1.6 1.6 0 0 1 2.3 0l4.6 4.6a1.6 1.6 0 0 1 0 2.3Z"></path>
                                        <path d="m10.4 8.1 5.5 5.5"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">橡皮</span>
                                <span class="pbw-tool-key">E</span>
                            </button>
                            <button class="pbw-tool-btn" data-tool="fill" title="填充 (G)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11.5 3.5 4.6 10.4a1.4 1.4 0 0 0 0 2l5.5 5.5a1.4 1.4 0 0 0 2 0l6.9-6.9Z"></path>
                                        <path d="m8 7 7.8 7.8"></path>
                                        <path d="M19.5 14.5s1.8 2.2 1.8 3.4a1.8 1.8 0 1 1-3.6 0c0-1.2 1.8-3.4 1.8-3.4Z"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">填充</span>
                                <span class="pbw-tool-key">G</span>
                            </button>
                            <button class="pbw-tool-btn" data-tool="eyedropper" title="取色 (I)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="m17.5 3.8 2.7 2.7a2 2 0 0 1 0 2.8l-1.4 1.4-5.5-5.5 1.4-1.4a2 2 0 0 1 2.8 0Z"></path>
                                        <path d="m13.3 5.2 5.5 5.5"></path>
                                        <path d="M15.4 9.4 8 16.8l-3.6 1.1a1 1 0 0 0-.6.6L3 21l1.5-.8a1 1 0 0 0 .6-.6l1.1-3.6 7.4-7.4"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">取色</span>
                                <span class="pbw-tool-key">I</span>
                            </button>
                            <button class="pbw-tool-btn active" data-tool="hand" title="抓手 (H)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M18 11.5V7a1.7 1.7 0 0 0-3.4 0"></path>
                                        <path d="M14.6 10.5V5.2a1.7 1.7 0 0 0-3.4 0v5.3"></path>
                                        <path d="M11.2 10.8V6.5a1.7 1.7 0 0 0-3.4 0V14"></path>
                                        <path d="M7.8 13.6V9.4a1.7 1.7 0 0 0-3.4 0V15a6 6 0 0 0 6 6h1.8a5.8 5.8 0 0 0 5.8-5.8v-3.7"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">抓手</span>
                                <span class="pbw-tool-key">H</span>
                            </button>
                            <button class="pbw-tool-btn" id="pbwResetView" title="复位视图">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect>
                                        <path d="M8.5 8.5h7v7h-7z"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">复位</span>
                                <span class="pbw-tool-key">R</span>
                            </button>
                            <button class="pbw-tool-btn" id="pbwToggleGrid" title="切换网格 (N)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                                        <path d="M3 9h18M3 15h18M9 3v18M15 3v18"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">网格</span>
                                <span class="pbw-tool-key">N</span>
                            </button>
                            <button class="pbw-tool-btn" id="pbwToggleMirror" title="镜像模式 (M)">
                                <span class="pbw-tool-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 3v18M3 7l4 4-4 4M21 7l-4 4 4 4"></path>
                                    </svg>
                                </span>
                                <span class="pbw-tool-name">镜像</span>
                                <span class="pbw-tool-key">M</span>
                            </button>
                        </div>
                        <div class="pbw-tools-row">
                            <button class="pbw-act-btn" id="pbwUndo" title="撤销 (Ctrl+Z)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 5 3 11 9 11"></polyline>
                                    <path d="M5.3 15.4a8.5 8.5 0 1 0 2-8.9L3 11"></path>
                                </svg>
                                <span>撤销</span>
                            </button>
                            <button class="pbw-act-btn" id="pbwRedo" title="重做 (Ctrl+Y)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="21 5 21 11 15 11"></polyline>
                                    <path d="M18.7 15.4a8.5 8.5 0 1 1-2-8.9L21 11"></path>
                                </svg>
                                <span>重做</span>
                            </button>
                            <button class="pbw-act-btn pbw-act-danger" id="pbwClear" title="清空画布">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 7h16"></path>
                                    <path d="M18 7v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7m3 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
                                    <path d="M10 11v6M14 11v6"></path>
                                </svg>
                                <span>清空</span>
                            </button>
                        </div>
                    </div>

                    <!-- 最近使用颜色 -->
                    <div class="pbw-panel">
                        <div class="pbw-panel-title">最近使用</div>
                        <div class="pbw-recent-colors" id="pbwRecentColors">
                            <div class="pbw-recent-empty">暂无使用记录</div>
                        </div>
                    </div>

                    <!-- 导出面板 -->
                    <div class="pbw-panel">
                        <div class="pbw-panel-title">导出</div>
                        <div class="pbw-export-buttons">
                            <button class="pbw-export-btn pbw-export-primary" id="pbwExportPng">导出图纸 PNG</button>
                            <button class="pbw-export-btn" id="pbwExportList">导出色号清单</button>
                            <button class="pbw-export-btn" id="pbwExportCsv">导出 CSV</button>
                        </div>
                    </div>
                </div>

                <!-- 右列：统计 -->
                <div class="pbw-col-stats">
                    <div class="pbw-panel pbw-panel-stats">
                        <div class="pbw-panel-title">统计</div>
                        <div class="pbw-stats-content" id="pbwStats">
                            <div class="pbw-stats-empty">
                                <div class="pbw-stats-empty-icon">🎨</div>
                                <div>开始绘制后</div>
                                <div>这里显示颜色用量</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 缓存 DOM 引用
    els = {
        currentBadge: container.querySelector('#pbwCurrentBadge'),
        systemSelect: container.querySelector('#pbwSystemSelect'),
        showCode: container.querySelector('#pbwShowCode'),
        showTexture: container.querySelector('#pbwShowTexture'),
        newBtn: container.querySelector('#pbwNewBtn'),
        canvas: container.querySelector('#pbwCanvas'),
        tooltip: container.querySelector('#pbwTooltip'),
        swatches: container.querySelector('#pbwSwatches'),
        stats: container.querySelector('#pbwStats'),
    };

    bindEditorEvents(container);
    buildBoardLayer();
    buildBeadLayer();
    buildCodeLayer();
    resetView();
    updateToolUI();
    paint();
    renderSwatches();
    renderCurrent();
    renderStats();
    renderRecentColors(); // 渲染最近使用颜色面板

    // 容器宽高变化（响应式 / 侧栏折叠）时重新适配，避免出现空白边
    if (resizeObs) resizeObs.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(() => handleResize());
        resizeObs.observe(els.canvas.parentElement);
    }
}

// ================= 事件绑定 =================
function bindEditorEvents(container) {
    // 顶部栏
    els.systemSelect.addEventListener('change', () => {
        state.system = els.systemSelect.value;
        buildPalette();
        buildCodeLayer();
        paint();
        renderCurrent();
        renderSwatches();
        renderStats();
    });
    els.showCode.addEventListener('change', () => { state.showCode = els.showCode.checked; paint(); });
    els.showTexture.addEventListener('change', () => { state.showTexture = els.showTexture.checked; buildBeadLayer(); paint(); });
    els.newBtn.addEventListener('click', () => { renderSetup(container); });

    // 全屏切换
    container.querySelector('#pbwFullscreenBtn').addEventListener('click', toggleFullscreen);
    // 画布复位
    container.querySelector('#pbwResetView').addEventListener('click', doResetView);

    // 网格/镜像切换按钮
    container.querySelector('#pbwToggleGrid').addEventListener('click', doToggleGrid);
    container.querySelector('#pbwToggleMirror').addEventListener('click', doToggleMirror);

    // 工具按钮
    container.querySelectorAll('.pbw-tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tool = btn.dataset.tool;
            updateToolUI();
        });
    });

    // 撤销/重做/清空
    container.querySelector('#pbwUndo').addEventListener('click', doUndo);
    container.querySelector('#pbwRedo').addEventListener('click', doRedo);
    container.querySelector('#pbwClear').addEventListener('click', doClear);

    // 导出
    container.querySelector('#pbwExportPng').addEventListener('click', () => exportPng());
    container.querySelector('#pbwExportList').addEventListener('click', () => exportColorList());
    container.querySelector('#pbwExportCsv').addEventListener('click', exportCsv);

    // 画布交互
    const canvas = els.canvas;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseleave', () => { els.tooltip.classList.add('hidden'); });
    // 先摘再挂：renderEditor 可能被"新建"/导入反复调用，避免同一处理器叠加
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
}

function doResetView() {
    resetView();
    paint();
}

function doZoomIn() {
    if (!view.beadImg) return;
    const cw = els.canvas.width, ch = els.canvas.height;
    const cx = cw / 2, cy = ch / 2;
    const before = screenToImage(cx, cy);
    view.scale = Math.min(MAX_SCALE, view.scale * 1.3);
    view.offsetX = cx - before.x * view.scale;
    view.offsetY = cy - before.y * view.scale;
    clampView();
    paint();
}

function doZoomOut() {
    if (!view.beadImg) return;
    const cw = els.canvas.width, ch = els.canvas.height;
    const cx = cw / 2, cy = ch / 2;
    const before = screenToImage(cx, cy);
    view.scale = Math.max(minFitScale(), view.scale / 1.3);
    view.offsetX = cx - before.x * view.scale;
    view.offsetY = cy - before.y * view.scale;
    clampView();
    paint();
}

function doZoomFit() {
    if (!view.beadImg) return;
    resetView();
    paint();
}

function doToggleGrid() {
    state.showGrid = !state.showGrid;
    const btn = containerRef?.querySelector('#pbwToggleGrid');
    if (btn) btn.classList.toggle('active', state.showGrid);
    paint();
}

function doToggleMirror() {
    state.mirrorMode = !state.mirrorMode;
    const btn = containerRef?.querySelector('#pbwToggleMirror');
    if (btn) btn.classList.toggle('active', state.mirrorMode);
    paint();
}

// ================= 全屏切换 =================
const FULLSCREEN_ENTER_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const FULLSCREEN_EXIT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;

function toggleFullscreen() {
    const mainBody = containerRef?.querySelector('.pbw-main-body');
    const icon = containerRef?.querySelector('#pbwFullscreenIcon');
    const btn = containerRef?.querySelector('#pbwFullscreenBtn');
    if (!mainBody) return;
    const isFullscreen = mainBody.classList.contains('pbw-fullscreen-mode');
    if (isFullscreen) {
        mainBody.classList.remove('pbw-fullscreen-mode');
        if (icon) icon.outerHTML = FULLSCREEN_ENTER_SVG.replace('<svg', '<svg id="pbwFullscreenIcon"');
        if (btn) btn.title = '全屏展示';
    } else {
        mainBody.classList.add('pbw-fullscreen-mode');
        if (icon) icon.outerHTML = FULLSCREEN_EXIT_SVG.replace('<svg', '<svg id="pbwFullscreenIcon"');
        if (btn) btn.title = '退出全屏';
    }
    // 全屏切换后画布容器尺寸变化，需要重新适配
    setTimeout(() => {
        fitCanvasToArea();
        resetView();
        paint();
    }, 50);
}

const TOOL_CURSOR = {
    brush: 'crosshair',
    eraser: 'crosshair',
    fill: 'crosshair',
    eyedropper: 'crosshair',
    hand: 'grab',
};

function updateToolUI() {
    const container = containerRef;
    if (!container) return;
    container.querySelectorAll('.pbw-tool-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === state.tool);
    });
    if (els.canvas) els.canvas.style.cursor = TOOL_CURSOR[state.tool] || 'default';
    updateHint();
}

function updateHint() {
    const hint = containerRef?.querySelector('.pbw-canvas-hint');
    if (!hint) return;
    const hints = {
        brush: '点击/拖动绘制 · 空格或抓手平移 · 滚轮缩放',
        eraser: '点击/拖动擦除 · 空格或抓手平移 · 滚轮缩放',
        fill: '点击填充区域 · 空格或抓手平移 · 滚轮缩放',
        eyedropper: '点击取色 · 空格或抓手平移 · 滚轮缩放',
        hand: '拖动平移画布 · 滚轮缩放',
    };
    hint.textContent = hints[state.tool] || hints.hand;
}

// ================= 离屏渲染 =================
const BEAD_CELL = 24;
const CODE_MIN_SCALE = 0.55;
const MIN_SCALE = 0.05, MAX_SCALE = 20;
// 网格线：细线 / 每 10 格的粗线
const GRID_MINOR_MIN_PX = 7;   // 单格小于此像素时不画细线
const GRID_MAJOR_EVERY = 10;
// 底板配色
const BOARD_BG = '#fcfaf4';
const BOARD_PEG = 'rgba(178, 165, 142, 0.30)';
const GRID_MINOR = 'rgba(150, 136, 112, 0.22)';
const GRID_MAJOR = 'rgba(120, 106, 84, 0.42)';
const BOARD_EDGE = 'rgba(120, 106, 84, 0.55)';

/**
 * 底板层：空白格的钉子底纹。与豆子层同尺寸，绘制在豆子之下。
 */
function buildBoardLayer() {
    const { N, M } = gridSize();
    const off = document.createElement('canvas');
    off.width = N * BEAD_CELL; off.height = M * BEAD_CELL;
    const ctx = off.getContext('2d');
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, off.width, off.height);
    // 钉板小凸点
    const c = BEAD_CELL / 2;
    const pegR = BEAD_CELL * 0.13;
    ctx.fillStyle = BOARD_PEG;
    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            ctx.beginPath();
            ctx.arc(i * BEAD_CELL + c, j * BEAD_CELL + c, pegR, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    view.boardImg = off;
}

function buildBeadLayer() {
    const { N, M } = gridSize();
    view.N = N; view.M = M;
    if (!state.cells) { view.beadImg = null; return; }
    const off = document.createElement('canvas');
    off.width = N * BEAD_CELL; off.height = M * BEAD_CELL;
    const ctx = off.getContext('2d');
    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const cell = state.cells[j][i];
            if (!cell || cell.transparent || !cell.hex) continue;
            if (state.showTexture) drawBeadTextured(ctx, i * BEAD_CELL, j * BEAD_CELL, cell.hex);
            else drawBeadFlat(ctx, i * BEAD_CELL, j * BEAD_CELL, cell.hex);
        }
    }
    view.beadImg = off;
}

/**
 * 有质感：立体圆环豆子 —— 外圈渐变 + 上缘高光 + 下缘暗边 + 中心孔洞
 */
function drawBeadTextured(ctx, x, y, hex) {
    const s = BEAD_CELL;
    const cx = x + s / 2, cy = y + s / 2;
    // 半径留 1.2px 余量：豆子与落影都落在本格内，单格重绘才不会污染邻格
    const r = s / 2 - 1.2;
    const holeR = r * 0.30;

    // 落影
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.10, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90, 78, 60, 0.20)';
    ctx.fill();
    ctx.restore();

    // 主体：斜向渐变（左上亮 → 右下暗）
    const body = ctx.createLinearGradient(cx - r * 0.7, cy - r * 0.7, cx + r * 0.7, cy + r * 0.7);
    body.addColorStop(0, shade(hex, 0.30));
    body.addColorStop(0.42, hex);
    body.addColorStop(1, shade(hex, -0.26));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // 左上高光斑
    const hl = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.40, 0, cx - r * 0.34, cy - r * 0.40, r * 0.72);
    hl.addColorStop(0, 'rgba(255,255,255,0.62)');
    hl.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = hl;
    ctx.fillRect(x, y, s, s);
    ctx.restore();

    // 内壁：中心孔 + 孔口暗环，形成管状感
    const ring = ctx.createRadialGradient(cx, cy, holeR * 0.5, cx, cy, holeR * 2.1);
    ring.addColorStop(0, 'rgba(0,0,0,0.42)');
    ring.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    ring.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, holeR * 2.1, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    // 孔本体
    ctx.beginPath();
    ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
    ctx.fillStyle = shade(hex, -0.55);
    ctx.fill();
    // 孔下缘反光
    ctx.beginPath();
    ctx.arc(cx, cy + holeR * 0.22, holeR * 0.82, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(0.5, s * 0.022);
    ctx.stroke();

    // 外缘描边
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = shade(hex, -0.42);
    ctx.lineWidth = Math.max(0.6, s * 0.03);
    ctx.stroke();
}

/**
 * 无质感：纯色圆点，扁平清晰，方便看图与数格
 */
function drawBeadFlat(ctx, x, y, hex) {
    const s = BEAD_CELL;
    const cx = x + s / 2, cy = y + s / 2;
    const r = s / 2 - 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.strokeStyle = shade(hex, -0.20);
    ctx.lineWidth = Math.max(0.5, s * 0.028);
    ctx.stroke();
}

/** 明暗调整：t>0 变亮，t<0 变暗 */
function shade(hex, t) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const f = v => {
        const n = t >= 0 ? v + (255 - v) * t : v * (1 + t);
        return Math.max(0, Math.min(255, Math.round(n)));
    };
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function buildCodeLayer() {
    const { N, M } = gridSize();
    if (!state.cells) { view.codeImg = null; return; }
    const off = document.createElement('canvas');
    off.width = N * BEAD_CELL; off.height = M * BEAD_CELL;
    const ctx = off.getContext('2d');
    setCodeFont(ctx);
    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) drawCodeAt(ctx, i, j);
    }
    view.codeImg = off;
}

function setCodeFont(ctx) {
    ctx.font = `700 ${(BEAD_CELL * 0.36).toFixed(1)}px 'Nunito', 'Noto Sans SC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = BEAD_CELL * 0.12;
}

function drawCodeAt(ctx, i, j) {
    const cell = state.cells[j][i];
    if (!cell || cell.transparent || !cell.hex || !cell.systems) return;
    const code = cell.systems[state.system] || '';
    if (!code) return;
    const x = i * BEAD_CELL + BEAD_CELL / 2;
    const y = j * BEAD_CELL + BEAD_CELL / 2;
    const dark = isDark(cell.hex);
    // 先描一圈反色轮廓，压住豆子中心孔的暗部，保证色号可读
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.78)';
    ctx.strokeText(code, x, y);
    ctx.fillStyle = dark ? '#fff' : '#241c12';
    ctx.fillText(code, x, y);
}

/**
 * 增量重绘单格：裁剪到本格范围，清空后重画豆子与色号。
 * 色号描边可能溢出格边，所以把 3×3 邻域的文字一起裁剪重绘回来。
 */
function redrawCell(i, j) {
    if (!view.beadImg || !state.cells) return;
    const { N, M } = gridSize();
    const x = i * BEAD_CELL, y = j * BEAD_CELL;

    const bctx = view.beadImg.getContext('2d');
    bctx.save();
    bctx.beginPath(); bctx.rect(x, y, BEAD_CELL, BEAD_CELL); bctx.clip();
    bctx.clearRect(x, y, BEAD_CELL, BEAD_CELL);
    const cell = state.cells[j][i];
    if (cell && !cell.transparent && cell.hex) {
        if (state.showTexture) drawBeadTextured(bctx, x, y, cell.hex);
        else drawBeadFlat(bctx, x, y, cell.hex);
    }
    bctx.restore();

    if (view.codeImg) {
        const cctx = view.codeImg.getContext('2d');
        cctx.save();
        cctx.beginPath(); cctx.rect(x, y, BEAD_CELL, BEAD_CELL); cctx.clip();
        cctx.clearRect(x, y, BEAD_CELL, BEAD_CELL);
        setCodeFont(cctx);
        for (let jj = Math.max(0, j - 1); jj <= Math.min(M - 1, j + 1); jj++) {
            for (let ii = Math.max(0, i - 1); ii <= Math.min(N - 1, i + 1); ii++) {
                drawCodeAt(cctx, ii, jj);
            }
        }
        cctx.restore();
    }
}

function isDark(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 <= 0.6;
}

function textColorFor(hex) {
    return isDark(hex) ? '#fff' : '#333';
}

/** 视口内可缩到的最小比例：图纸整体刚好铺满可视区（不留四周空白） */
function minFitScale() {
    if (!view.beadImg) return MIN_SCALE;
    const cw = els.canvas.width, ch = els.canvas.height;
    const iw = view.beadImg.width, ih = view.beadImg.height;
    if (!iw || !ih) return MIN_SCALE;
    return Math.min(cw / iw, ch / ih);
}

function resetView() {
    if (!view.beadImg) return;
    fitCanvasToArea();
    view.scale = Math.max(MIN_SCALE, minFitScale());
    clampView();
}

/**
 * 约束平移与缩放：
 * - 缩放下限 = 恰好铺满视口，避免缩小后四周全是空白
 * - 图纸大于视口时，拖动不能把图纸边缘拖进视口内
 * - 图纸某一轴小于视口时，该轴居中锁定
 */
function clampView() {
    if (!view.beadImg) return;
    const cw = els.canvas.width, ch = els.canvas.height;
    const minS = minFitScale();
    view.scale = Math.min(MAX_SCALE, Math.max(minS, view.scale));
    const dw = view.beadImg.width * view.scale;
    const dh = view.beadImg.height * view.scale;
    // 允许 0.5px 容差，避免浮点误差导致边缘缝隙
    if (dw <= cw + 0.5) view.offsetX = (cw - dw) / 2;
    else view.offsetX = Math.min(0, Math.max(cw - dw, view.offsetX));
    if (dh <= ch + 0.5) view.offsetY = (ch - dh) / 2;
    else view.offsetY = Math.min(0, Math.max(ch - dh, view.offsetY));
}

function fitCanvasToArea() {
    const area = els.canvas.parentElement;
    if (!area) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(240, Math.round(area.clientWidth * dpr));
    const h = Math.max(240, Math.round(area.clientHeight * dpr));
    if (els.canvas.width !== w) els.canvas.width = w;
    if (els.canvas.height !== h) els.canvas.height = h;
}

/** 容器尺寸变化时保持画布铺满且不越界 */
function handleResize() {
    if (!els.canvas || !view.beadImg) return;
    const prevW = els.canvas.width, prevH = els.canvas.height;
    fitCanvasToArea();
    if (els.canvas.width === prevW && els.canvas.height === prevH) return;
    clampView();
    paint();
}

function paint() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
        rafPending = false;
        if (!view.beadImg || !els.canvas) return;
        const ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        const dw = view.beadImg.width * view.scale;
        const dh = view.beadImg.height * view.scale;
        // 底板 + 豆子用平滑缩放，圆形边缘才不会锯齿
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (view.boardImg) ctx.drawImage(view.boardImg, view.offsetX, view.offsetY, dw, dh);
        ctx.drawImage(view.beadImg, view.offsetX, view.offsetY, dw, dh);
        if (state.showGrid) drawGridLines(ctx, dw, dh);
        if (state.showCode && view.codeImg && view.scale >= CODE_MIN_SCALE) {
            ctx.drawImage(view.codeImg, view.offsetX, view.offsetY, dw, dh);
        }
    });
}

/**
 * 网格线：细线（单格）+ 每 10 格粗线 + 外框。
 * 单格过小时细线自动淡出直到隐藏，只留粗线做计数参考，避免糊成一片。
 */
function drawGridLines(ctx, dw, dh) {
    const cellPx = BEAD_CELL * view.scale;
    const x0 = view.offsetX, y0 = view.offsetY;
    const left = Math.round(x0) + 0.5, top = Math.round(y0) + 0.5;
    const right = Math.round(x0 + dw) + 0.5, bottom = Math.round(y0 + dh) + 0.5;
    ctx.save();

    // 细线：cellPx 从 GRID_MINOR_MIN_PX 到 2 倍区间内渐隐
    const minorAlpha = Math.max(0, Math.min(1, (cellPx - GRID_MINOR_MIN_PX) / GRID_MINOR_MIN_PX));
    if (minorAlpha > 0.02) {
        ctx.globalAlpha = minorAlpha;
        ctx.strokeStyle = GRID_MINOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < view.N; i++) {
            if (i % GRID_MAJOR_EVERY === 0) continue;
            const x = Math.round(x0 + i * cellPx) + 0.5;
            ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        }
        for (let j = 1; j < view.M; j++) {
            if (j % GRID_MAJOR_EVERY === 0) continue;
            const y = Math.round(y0 + j * cellPx) + 0.5;
            ctx.moveTo(left, y); ctx.lineTo(right, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // 每 10 格粗线
    const majorPx = cellPx * GRID_MAJOR_EVERY;
    if (majorPx >= 10) {
        ctx.strokeStyle = GRID_MAJOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = GRID_MAJOR_EVERY; i < view.N; i += GRID_MAJOR_EVERY) {
            const x = Math.round(x0 + i * cellPx) + 0.5;
            ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        }
        for (let j = GRID_MAJOR_EVERY; j < view.M; j += GRID_MAJOR_EVERY) {
            const y = Math.round(y0 + j * cellPx) + 0.5;
            ctx.moveTo(left, y); ctx.lineTo(right, y);
        }
        ctx.stroke();
    }

    // 外框
    ctx.strokeStyle = BOARD_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();
}

// ================= 视图交互 =================
function screenToImage(sx, sy) {
    return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

function eventToCanvas(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (els.canvas.width / rect.width),
        y: (e.clientY - rect.top) * (els.canvas.height / rect.height),
    };
}

function onWheel(e) {
    if (!view.beadImg) return;
    e.preventDefault();
    const p = eventToCanvas(e);
    const before = screenToImage(p.x, p.y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.scale = Math.min(MAX_SCALE, Math.max(minFitScale(), view.scale * factor));
    view.offsetX = p.x - before.x * view.scale;
    view.offsetY = p.y - before.y * view.scale;
    clampView();
    paint();
}

function onMouseDown(e) {
    if (!view.beadImg) return;
    if (e.button !== 0) return;
    const p = eventToCanvas(e);
    const img = screenToImage(p.x, p.y);
    let i = Math.floor(img.x / BEAD_CELL);
    let j = Math.floor(img.y / BEAD_CELL);
    // 镜像模式：水平翻转坐标
    if (state.mirrorMode) {
        i = state.N - 1 - i;
    }

    // 抓手模式或按住空格 → 平移
    if (state.tool === 'hand' || spaceHeld) {
        panning = true;
        panStart = { x: p.x, y: p.y, ox: view.offsetX, oy: view.offsetY };
        els.canvas.style.cursor = 'grabbing';
        els.tooltip.classList.add('hidden');
        return;
    }

    // 绘画操作
    if (i < 0 || j < 0 || i >= state.N || j >= state.M) return;
    if (state.tool === 'brush' || state.tool === 'eraser') {
        if (!state.selected && state.tool === 'brush') return;
        pushHistory();
        painting = true;
        lastCell = { i, j };
        applyTool(i, j);
        if (state.mirrorMode) {
            const mi = state.N - 1 - i;
            if (mi !== i) { applyTool(mi, j); }
        }
        commitCell(i, j);
        if (state.mirrorMode) {
            const mi = state.N - 1 - i;
            if (mi !== i) { commitCell(mi, j); }
        }
    } else if (state.tool === 'fill') {
        if (!state.selected) return;
        pushHistory();
        floodFill(i, j, state.selected.hex);
        if (state.mirrorMode) {
            const mi = state.N - 1 - i;
            if (mi !== i) floodFill(mi, j, state.selected.hex);
        }
        commitChange();
    } else if (state.tool === 'eyedropper') {
        const cell = state.cells[j][i];
        if (cell && !cell.transparent && cell.hex) {
            state.selected = { hex: cell.hex, systems: cell.systems || PALETTE[cell.hex.toUpperCase()] || null };
            state.tool = 'brush';
            updateToolUI();
            renderCurrent();
            renderSwatches();
            // 记录最近使用的颜色
            addRecentColor(cell.hex, cell.systems);
        }
    }
}

function onMouseMove(e) {
    if (panning && panStart) {
        const p = eventToCanvas(e);
        view.offsetX = panStart.ox + (p.x - panStart.x);
        view.offsetY = panStart.oy + (p.y - panStart.y);
        clampView();
        paint();
        return;
    }
    if (painting && lastCell && (state.tool === 'brush' || state.tool === 'eraser')) {
        const p = eventToCanvas(e);
        const img = screenToImage(p.x, p.y);
        const i = Math.floor(img.x / BEAD_CELL);
        const j = Math.floor(img.y / BEAD_CELL);
        if (i === lastCell.i && j === lastCell.j) return;
        if (i >= 0 && j >= 0 && i < state.N && j < state.M) {
            applyTool(i, j);
            if (state.mirrorMode) {
                const mi = state.N - 1 - i;
                if (mi !== i) applyTool(mi, j);
            }
            lastCell = { i, j };
            commitCell(i, j);
            if (state.mirrorMode) {
                const mi = state.N - 1 - i;
                if (mi !== i) commitCell(mi, j);
            }
        }
    }
    updateTooltip(e);
}

function onMouseUp() {
    if (panning) {
        panning = false;
        panStart = null;
        els.canvas.style.cursor = TOOL_CURSOR[state.tool] || 'default';
    }
    if (painting) {
        painting = false;
        lastCell = null;
        flushStats();
    }
}

function updateTooltip(e) {
    if (!view.beadImg || !state.cells) return;
    const rect = els.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        els.tooltip.classList.add('hidden');
        return;
    }
    const p = eventToCanvas(e);
    const img = screenToImage(p.x, p.y);
    const i = Math.floor(img.x / BEAD_CELL);
    const j = Math.floor(img.y / BEAD_CELL);
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
    els.tooltip.innerHTML = `<span class="pbw-tooltip-sw" style="background:${cell.hex}"></span> ${code} · ${cell.hex}`;
    els.tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
    els.tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
    els.tooltip.classList.remove('hidden');
}

// ================= 绘画操作 =================
function applyTool(i, j) {
    const cell = state.cells[j][i];
    if (state.tool === 'brush' && state.selected) {
        cell.hex = state.selected.hex;
        cell.transparent = false;
        cell.systems = state.selected.systems || PALETTE[state.selected.hex.toUpperCase()] || null;
        // 记录最近使用的颜色
        addRecentColor(state.selected.hex, state.selected.systems);
    } else if (state.tool === 'eraser') {
        cell.hex = null;
        cell.transparent = true;
        cell.systems = null;
    }
}

function floodFill(si, sj, hex) {
    const { N, M } = gridSize();
    const target = state.cells[sj][si];
    const targetHex = target.hex;
    if (targetHex === hex) return;
    const stack = [[si, sj]];
    const visited = new Set();
    while (stack.length) {
        const [i, j] = stack.pop();
        const key = j * N + i;
        if (visited.has(key)) continue;
        if (i < 0 || j < 0 || i >= N || j >= M) continue;
        const cell = state.cells[j][i];
        if (cell.hex !== targetHex) continue;
        visited.add(key);
        cell.hex = hex;
        cell.transparent = false;
        cell.systems = PALETTE[hex.toUpperCase()]?.systems || null;
        stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
}

// ================= 历史 =================
function cloneCells(cells) {
    return cells.map(row => row.map(c => ({ ...c, systems: c.systems ? { ...c.systems } : null })));
}

function pushHistory() {
    state.history.push(cloneCells(state.cells));
    if (state.history.length > 50) state.history.shift();
    state.redo = [];
}

/** 整张重建：填充 / 撤销 / 清空 / 切换质感等大范围变化 */
function commitChange() {
    buildBeadLayer();
    buildCodeLayer();
    paint();
    flushStats();
}

/** 单格提交：只重绘该格，统计留到抬手时结算，保证拖动绘制流畅 */
function commitCell(i, j) {
    redrawCell(i, j);
    paint();
}

function flushStats() {
    state.stats = recount();
    renderStats();
}

function doUndo() {
    if (!state.history.length) return;
    state.redo.push(cloneCells(state.cells));
    state.cells = state.history.pop();
    commitChange();
}

function doRedo() {
    if (!state.redo.length) return;
    state.history.push(cloneCells(state.cells));
    state.cells = state.redo.pop();
    commitChange();
}

function doClear() {
    if (!state.cells) return;
    if (!confirm('清空画布？此操作可撤销。')) return;
    pushHistory();
    const { N, M } = gridSize();
    state.cells = makeEmptyGrid(N, M);
    commitChange();
}

// ================= 统计 =================
function recount() {
    const map = new Map();
    if (!state.cells) return [];
    for (const row of state.cells) {
        for (const cell of row) {
            if (!cell || cell.transparent || !cell.hex) continue;
            const key = cell.hex.toUpperCase();
            if (!map.has(key)) map.set(key, { hex: cell.hex, systems: cell.systems, count: 0 });
            map.get(key).count++;
        }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ================= 右栏渲染 =================
function renderCurrent() {
    if (!els.currentBadge) return;
    if (!state.selected) {
        els.currentBadge.innerHTML = '';
        return;
    }
    const code = (state.selected.systems && state.selected.systems[state.system]) || '自定义';
    els.currentBadge.innerHTML = `
        <span class="pbw-badge-sw" style="background:${state.selected.hex}"></span>
        <span class="pbw-badge-code">${code}</span>
        <span class="pbw-badge-hex">${state.selected.hex}</span>
    `;
}

/** 选中态：勾选标记用反差色，浅色豆子用深勾、深色豆子用浅勾 */
const CHECK_SVG = `<svg class="pbw-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4.5 4.5L19 7.5"></path></svg>`;

/**
 * 渲染色板：大类标签 + 小类颜色网格。
 * 点击大类标签筛选该组颜色，点击"全部"显示所有颜色。
 */
function renderSwatches() {
    if (!els.swatches) return;
    const hexes = Object.keys(PALETTE);
    if (!state.selected && hexes.length > 0) {
        const firstHex = hexes[0];
        state.selected = { hex: firstHex, systems: PALETTE[firstHex]?.systems || null };
    }

    // 根据当前选中的大类筛选颜色
    let filteredHexes = hexes;
    if (state.activeGroup) {
        const prefixes = COLOR_GROUPS[state.activeGroup] || [];
        filteredHexes = hexes.filter(hex => {
            const pal = PALETTE[hex];
            if (!pal) return false;
            const mard = pal.systems?.MARD || '';
            return prefixes.some(p => mard.startsWith(p));
        });
    }

    // 构建大类标签栏（带彩色圆点）
    const groupNames = Object.keys(COLOR_GROUPS);
    if (!state.activeGroup) state.activeGroup = groupNames[0];
    const tabsHtml = `
        <div class="pbw-color-groups">
            ${groupNames.map(name => {
                const count = hexes.filter(hex => {
                    const pal = PALETTE[hex];
                    if (!pal) return false;
                    const mard = pal.systems?.MARD || '';
                    const prefixes = COLOR_GROUPS[name] || [];
                    return prefixes.some(p => mard.startsWith(p));
                }).length;
                const dotColor = GROUP_REPRESENTATIVE_COLORS[name] || '#999';
                return `<button class="pbw-group-tab${state.activeGroup === name ? ' active' : ''}" data-group="${name}"><span class="pbw-group-dot" style="background:${dotColor}"></span><span class="group-name">${name}</span><span class="pbw-group-count">${count}</span></button>`;
            }).join('')}
        </div>
    `;

    // 构建颜色网格
    const swatchesHtml = filteredHexes.map(hex => {
        const active = state.selected && state.selected.hex === hex;
        const pal = PALETTE[hex];
        const code = (pal && pal.systems && pal.systems[state.system]) || '';
        const cls = `pbw-swatch${active ? ' active' : ''}${isDark(hex) ? ' is-dark' : ''}`;
        return `<button class="${cls}" data-hex="${hex}" style="--sw:${hex}" title="${code ? code + ' · ' : ''}${hex}">${active ? CHECK_SVG : ''}</button>`;
    }).join('');

    els.swatches.innerHTML = tabsHtml + `<div class="pbw-swatches-grid">${swatchesHtml}</div>`;

    // 绑定大类标签点击事件
    els.swatches.querySelectorAll('.pbw-group-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            state.activeGroup = tab.dataset.group;
            renderSwatches();
        });
    });

    // 绑定颜色点击事件
    els.swatches.querySelectorAll('.pbw-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.dataset.hex;
            state.selected = { hex, systems: PALETTE[hex]?.systems || null };
            if (state.tool === 'hand' || state.tool === 'eyedropper' || state.tool === 'eraser') {
                state.tool = 'brush'; updateToolUI();
            }
            // 记录最近使用的颜色
            addRecentColor(hex, PALETTE[hex]?.systems);
            renderCurrent(); renderSwatches(); renderRecentColors();
        });
    });
}

function renderStats() {
    if (!els.stats) return;
    if (!state.stats || !state.stats.length) {
        els.stats.innerHTML = `
            <div class="pbw-stats-empty">
                <div class="pbw-stats-empty-icon"></div>
                <div>开始绘制后</div>
                <div>这里显示颜色用量</div>
            </div>
        `;
        return;
    }
    const total = state.stats.reduce((s, c) => s + c.count, 0);
    const items = state.stats.map(s => {
        const code = (s.systems && s.systems[state.system]) || '?';
        return `<button class="pbw-stat" data-hex="${s.hex}" title="选中此色">
            <span class="pbw-stat-sw" style="background:${s.hex}"></span>
            <span class="pbw-stat-code">${code}</span>
            <span class="pbw-stat-count">×${s.count}</span>
        </button>`;
    }).join('');
    els.stats.innerHTML = `
        <div class="pbw-stats-head">共 ${state.stats.length} 种颜色 · ${total} 颗豆子</div>
        <div class="pbw-stats-list">${items}</div>
    `;
    els.stats.querySelectorAll('.pbw-stat').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.dataset.hex;
            state.selected = { hex, systems: PALETTE[hex]?.systems || null };
            if (state.tool !== 'brush' && state.tool !== 'fill') { state.tool = 'brush'; updateToolUI(); }
            // 记录最近使用的颜色
            addRecentColor(hex, PALETTE[hex]?.systems);
            renderCurrent(); renderSwatches(); renderRecentColors();
        });
    });
}

// ================= 导出 =================
function exportPng() {
    if (!state.cells) return;
    const { N, M } = gridSize();
    const cellSize = 30;
    const canvas = document.createElement('canvas');
    canvas.width = N * cellSize; canvas.height = M * cellSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let j = 0; j < M; j++) {
        for (let i = 0; i < N; i++) {
            const cell = state.cells[j][i];
            if (cell && !cell.transparent && cell.hex) {
                ctx.fillStyle = cell.hex;
                ctx.fillRect(i * cellSize, j * cellSize, cellSize, cellSize);
            }
        }
    }
    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= N; i++) {
        ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, M * cellSize); ctx.stroke();
    }
    for (let j = 0; j <= M; j++) {
        ctx.beginPath(); ctx.moveTo(0, j * cellSize); ctx.lineTo(N * cellSize, j * cellSize); ctx.stroke();
    }
    // 色号
    if (state.showCode) {
        ctx.font = `${Math.floor(cellSize * 0.35)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let j = 0; j < M; j++) {
            for (let i = 0; i < N; i++) {
                const cell = state.cells[j][i];
                if (!cell || cell.transparent || !cell.hex || !cell.systems) continue;
                const code = cell.systems[state.system] || '';
                if (!code) continue;
                ctx.fillStyle = textColorFor(cell.hex);
                ctx.fillText(code, i * cellSize + cellSize / 2, j * cellSize + cellSize / 2);
            }
        }
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `拼豆图纸_${N}x${M}.png`;
    document.body.appendChild(a); a.click(); a.remove();
}

function exportColorList() {
    if (!state.stats || !state.stats.length) { alert('没有颜色数据'); return; }
    const lines = ['色号,颜色,数量'];
    for (const s of state.stats) {
        const code = (s.systems && s.systems[state.system]) || '?';
        lines.push(`${code},${s.hex},${s.count}`);
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `色号清单_${state.system}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
    if (!state.cells) return;
    const { N, M } = gridSize();
    const body = state.cells.map(row => row.map(c => c.transparent ? '' : c.hex).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `拼豆图纸_${N}x${M}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ================= 键盘 =================
function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
        const mainBody = containerRef?.querySelector('.pbw-main-body');
        if (mainBody && mainBody.classList.contains('pbw-fullscreen-mode')) {
            e.preventDefault();
            toggleFullscreen();
            return;
        }
    }
    if (e.key === ' ') { spaceHeld = true; e.preventDefault(); }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); doRedo(); return; }
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && k === 'r') { e.preventDefault(); doResetView(); return; }
    const keyTool = { b: 'brush', e: 'eraser', g: 'fill', i: 'eyedropper', h: 'hand' };
    if (!e.ctrlKey && !e.metaKey && keyTool[k]) {
        state.tool = keyTool[k]; updateToolUI();
    }
    if (!e.ctrlKey && !e.metaKey && k === 'n') { e.preventDefault(); doToggleGrid(); }
    if (!e.ctrlKey && !e.metaKey && k === 'm') { e.preventDefault(); doToggleMirror(); }
}

function onKeyUp(e) {
    if (e.key === ' ') spaceHeld = false;
}