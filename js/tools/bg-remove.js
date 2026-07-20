/**
 * AI 抠图工具（画布编辑器版）
 * 使用 @imgly/background-removal 在浏览器本地处理，图片不上传。
 *
 * 流程：上传 → 编辑器（画布 + 右侧设置）→ 预览 → 下载
 * 核心：向库请求灰度 mask，再用 compose.js 合成，支持保护框/主体框/边缘精修。
 * 优化：缓存原图 ImageData 与原始 mask，只有换模型才重跑昂贵的 removeBackground。
 */

import { CanvasEditor } from './bg-remove/canvas-editor.js';
import { composeResult, composeFromSamMask } from './bg-remove/compose.js';
import { getSamCore, encodeImage as samEncode, decodePrompt as samDecode, resizeMask } from './bg-remove/sam-core.js';
// AI 去背景复用共享模块：同源本地模型（publicPath 指向 models/imgly/dist/），
// 库版本固定 1.4.5 与数据包匹配，避免各工具各自维护一份 imgly 加载逻辑导致版本分裂。
import { runForeground, maybeDownscale, imageToData, resetState as resetBgState } from './shared/bg-removal.js';

const SAM_MAX_DIM = 1024; // SAM 编码前降采样尺寸

// SAM 状态（懒加载，切到 SAM 模式时才初始化）
let samState = null; // { encoded, samCanvas, candidates, candIdx, maskData, maskW, maskH }

// 模块级引用，供 unmount 清理
let editor = null;
let objectUrls = new Set();

function trackUrl(url) { objectUrls.add(url); return url; }
function revokeAllUrls() {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls.clear();
}

const INFO_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
</svg>`;

// 独立的 ⓘ 图标（可键盘聚焦），用于标签旁。text 里可用 \n 换行。
function infoIcon(text) {
    const safe = String(text).replace(/"/g, '&quot;');
    return `<span class="bg-info" tabindex="0" role="button" aria-label="说明" data-tip="${safe}">${INFO_SVG}</span>`;
}

// 嵌在按钮内部的 ⓘ（不可聚焦，避免按钮里嵌交互元素）。
// tooltip 由按钮的悬停/聚焦触发（见 initTooltips）。
function infoDot(text) {
    const safe = String(text).replace(/"/g, '&quot;');
    return `<span class="bg-info bg-info-dot" aria-hidden="true" data-tip="${safe}">${INFO_SVG}</span>`;
}

// 为容器内所有 .bg-info 绑定 tooltip：悬停/聚焦显示一个浮层，按视口边界翻转
function initTooltips(container) {
    let tip = null;

    const show = (el) => {
        hide();
        const text = el.getAttribute('data-tip');
        if (!text) return;
        tip = document.createElement('div');
        tip.className = 'bg-tooltip';
        // data-tip 里的 \n 转成换行
        tip.textContent = text.replace(/\\n/g, '\n');
        document.body.appendChild(tip);

        const r = el.getBoundingClientRect();
        const tr = tip.getBoundingClientRect();
        // 默认放上方居中，空间不够则放下方
        let top = r.top - tr.height - 8;
        let placeBelow = false;
        if (top < 8) { top = r.bottom + 8; placeBelow = true; }
        let left = r.left + r.width / 2 - tr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
        tip.style.top = `${top + window.scrollY}px`;
        tip.style.left = `${left + window.scrollX}px`;
        tip.classList.toggle('below', placeBelow);
    };

    const hide = () => {
        if (tip) { tip.remove(); tip = null; }
    };

    // 找触发元素：直接命中 .bg-info，或命中一个内含 .bg-info-dot 的按钮
    const findTrigger = (target) => {
        const direct = target.closest('.bg-info');
        if (direct) return direct;
        const btn = target.closest('button');
        if (btn) return btn.querySelector('.bg-info-dot');
        return null;
    };

    // 鼠标：只在悬停 ⓘ 本身时触发（不响应整个按钮）
    container.addEventListener('mouseover', (e) => {
        const el = e.target.closest('.bg-info');
        if (el) show(el);
    });
    container.addEventListener('mouseout', (e) => {
        if (e.target.closest('.bg-info')) hide();
    });
    // 键盘：ⓘ 本身可聚焦时直接显示；按钮内的 ⓘ 不可聚焦，靠聚焦按钮显示
    container.addEventListener('focusin', (e) => {
        // 仅键盘聚焦（focus-visible）时显示，避免鼠标点击按钮也弹出 tooltip
        if (e.target.matches && !e.target.matches(':focus-visible')) return;
        const el = findTrigger(e.target);
        if (el) show(el);
    });
    container.addEventListener('focusout', (e) => {
        if (findTrigger(e.target)) hide();
    });
    // 存到 container 上，unmount 时清理残留 tooltip
    container.__hideTooltip = hide;
}

export function mount(container) {
    container.innerHTML = `
        <h2>AI 抠图</h2>

        <div class="upload-area" id="uploadArea">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📷</div>
            <div>点击或拖拽图片到此处</div>
            <div style="font-size: 0.75rem; margin-top: 0.5rem; opacity: 0.7;">支持 JPG / PNG / WebP</div>
            <input type="file" id="fileInput" accept="image/*" style="display: none;">
        </div>

        <div class="bg-editor hidden" id="bgEditor">
            <!-- 左：画布 -->
            <div class="bg-canvas-wrap">
                <div class="bg-canvas-stage" id="canvasStage">
                    <canvas id="bgCanvas"></canvas>
                    <canvas id="samOverlay" class="sam-overlay"></canvas>
                    <!-- 画布浮动工具条：主入口，与右侧分段控件双向同步 -->
                    <div class="bg-tools" id="canvasTools" role="toolbar" aria-label="画布工具">
                        <button class="bg-tool active" data-tool="pan" title="平移（默认）：拖拽移动画布" aria-label="平移">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0-2-2 2 2 0 0 0-2 2v0a2 2 0 0 0-2-2 2 2 0 0 0-2 2v9"/>
                                <path d="M6 13.5V7a2 2 0 0 1 4 0"/>
                                <path d="M6 12c-.7-.7-1.8-.7-2.5 0s-.7 1.8 0 2.5L7 20a6 6 0 0 0 5 3h1a6 6 0 0 0 6-6v-6"/>
                            </svg>
                        </button>
                        <button class="bg-tool tool-polygon bg-tool-box" data-tool="polygon" title="多边形保护框：依次点击描轮廓，双击或点回起点闭合（Enter 闭合 / Esc 取消）" aria-label="画多边形保护框">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3l7 5-2.5 8.5h-9L5 8z"/>
                                <circle cx="12" cy="3" r="1.5" fill="currentColor"/>
                                <circle cx="19" cy="8" r="1.5" fill="currentColor"/>
                                <circle cx="16.5" cy="16.5" r="1.5" fill="currentColor"/>
                                <circle cx="7.5" cy="16.5" r="1.5" fill="currentColor"/>
                                <circle cx="5" cy="8" r="1.5" fill="currentColor"/>
                            </svg>
                        </button>
                        <button class="bg-tool tool-polygon-subject bg-tool-box" data-tool="polygon-subject" title="多边形主体框：依次点击描轮廓，只保留多边形内主体（双击/Enter 闭合 · Esc 取消）" aria-label="画多边形主体框">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3l7 5-2.5 8.5h-9L5 8z"/>
                                <circle cx="12" cy="10" r="1.8"/>
                                <path d="M8.8 15.5a3.2 3.2 0 0 1 6.4 0"/>
                            </svg>
                        </button>
                        <button class="bg-tool tool-sam bg-tool-sam hidden" data-tool="sam" title="精准选取：点选或框选物体，SAM 自动识别" aria-label="精准选取">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="bg-canvas-bar">
                    <span id="zoomLabel">100%</span>
                    <button class="tool-btn tool-btn-sm" id="fitBtn">适应</button>
                    <span class="bg-canvas-tip" id="canvasTip">滚轮缩放 · 空格/中键拖拽平移</span>
                </div>
            </div>

            <!-- 右：设置面板 -->
            <aside class="bg-settings">
                <div class="bg-settings-scroll">
                    <div class="bg-field-row">
                        <span class="bg-field-label">模型</span>
                        ${infoIcon('换模型会重新运行 AI，深色区表现各有差异。fp16 精度更高体积更大，quint8 更快更小。')}
                    </div>
                    <select class="bg-select" id="modelSelect">
                        <option value="small">通用（默认）</option>
                        <option value="medium">高精度（较大）</option>
                    </select>

                    <!-- 选区来源：imgly 自动 / SAM 指定 -->
                    <div class="bg-field-row" style="margin-top: 0.75rem;">
                        <span class="bg-field-label">选区来源</span>
                        ${infoIcon('imgly 自动去背适合整图；SAM 可框选/点选指定某个物体，边缘更贴合。')}
                    </div>
                    <div class="bg-seg" id="sourceSeg">
                        <button class="bg-seg-btn active" data-source="imgly">
                            自动去背${infoDot('imgly 整图去背，发丝/边缘好。')}
                        </button>
                        <button class="bg-seg-btn" data-source="sam">
                            精准选取${infoDot('框选或点选物体，SAM 精确贴合物体轮廓。')}
                        </button>
                    </div>

                    <!-- SAM 交互提示（仅 SAM 模式显示） -->
                    <div class="bg-field-hint hidden" id="samHint" style="margin-top: 0.5rem; color: #4a9eff;">
                        💡 在画布上拖拽框选或点击物体，SAM 会生成精确选区
                    </div>
                    <div class="bg-sam-bar hidden" id="samBar" style="margin-top: 0.5rem;">
                        <button class="tool-btn tool-btn-sm" id="samCycleBtn">切换候选</button>
                        <span class="bg-field-hint" id="samCandInfo" style="margin-left: 0.5rem;"></span>
                    </div>

                    <!-- 高级调整：默认折叠 -->
                    <button class="bg-advanced-toggle" id="advToggle" aria-expanded="false">
                        <div class="bg-adv-toggle-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </div>
                        <span class="bg-adv-toggle-text">高级调整</span>
                        <span class="bg-adv-toggle-sub">框选 · 边缘精修</span>
                        <svg class="bg-adv-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </button>

                    <div class="bg-advanced collapsed" id="advPanel">
                        <!-- 框选模式：仅 imgly 自动去背模式下可用，精准选取模式隐藏 -->
                        <div id="boxModeGroup">
                            <div class="bg-adv-section">
                                <div class="bg-adv-section-header">
                                    <span class="bg-adv-section-title">框选模式</span>
                                    ${infoIcon('选择框选类型，在画布上拖拽绘制矩形区域')}
                                </div>
                                <div class="bg-adv-mode-grid" id="modeSeg">
                                    <button class="bg-adv-mode-btn" data-mode="protect">
                                        <span class="bg-adv-mode-icon-wrap bg-protect-color">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/>
                                                <path d="M12 8v8M8 12h8"/>
                                            </svg>
                                        </span>
                                        <span class="bg-adv-mode-name">保护框</span>
                                        ${infoDot('框内像素强制保留（如被误切的深色区），可画多个。')}
                                    </button>
                                    <button class="bg-adv-mode-btn" data-mode="subject">
                                        <span class="bg-adv-mode-icon-wrap bg-subject-color">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/>
                                                <circle cx="12" cy="9.5" r="2.5"/>
                                                <path d="M7 18a5 5 0 0 1 10 0"/>
                                            </svg>
                                        </span>
                                        <span class="bg-adv-mode-name">主体框</span>
                                        ${infoDot('只保留框内主体，框外一律透明，可画多个。')}
                                    </button>
                                </div>
                                <p class="bg-adv-hint">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                                    </svg>
                                    选保护框/主体框后，在空白处拖拽画框；点框可拖动、拉四角缩放，框顶红点或 Delete 键删除。
                                </p>

                                <!-- 计数 + 删除/清空：仅在画了框时显示 -->
                                <div class="bg-box-bar hidden" id="boxBar">
                                    <div class="bg-box-counts">
                                        <span class="bg-box-count-item bg-subject-color">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                                            主体框 <b id="cntSubject">0</b>
                                        </span>
                                        <span class="bg-box-count-item bg-protect-color">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                                            保护框 <b id="cntProtect">0</b>
                                        </span>
                                    </div>
                                    <div class="bg-box-actions">
                                        <button class="bg-icon-btn danger" id="delBtn" title="删除选中框" aria-label="删除选中">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                        </button>
                                        <button class="bg-icon-btn secondary" id="clearBtn" title="清空所有框" aria-label="清空">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="bg-adv-divider"></div>

                        <label class="bg-adv-check">
                            <div class="bg-adv-check-left">
                                <div class="bg-adv-check-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                                    </svg>
                                </div>
                                <div class="bg-adv-check-info">
                                    <span class="bg-adv-check-name">边缘精修</span>
                                </div>
                            </div>
                            <div class="bg-adv-switch">
                                <input type="checkbox" id="refineChk">
                                <span class="bg-adv-switch-slider"></span>
                            </div>
                            ${infoIcon('对边缘做收缩 + 羽化，去除白边、柔化锯齿。发丝多的图慎用。')}
                        </label>
                    </div>

                    <div class="bg-progress hidden" id="progressWrap">
                        <div class="bg-progress-bar"><div class="bg-progress-fill" id="progressFill"></div></div>
                        <span class="bg-field-hint" id="progressText">准备中…</span>
                    </div>
                </div>

                <!-- sticky 底部操作栏 -->
                <div class="bg-settings-actions">
                    <button class="tool-btn" id="reselectBtn">重新选择</button>
                    <button class="tool-btn tool-btn-primary bg-preview-btn" id="previewBtn">
                        <span class="bg-preview-wrapper">
                            <span class="bg-preview-text">预览抠图</span>${infoDot('抠图无法 100% 精确抠出所有细节（发丝、半透明边缘等）。')}
                        </span>
                    </button>
                    <a class="tool-btn tool-btn-primary hidden" id="downloadBtn" download="bg-removed.png">下载 PNG</a>
                </div>
            </aside>
        </div>

        <!-- 结果预览覆盖层 -->
        <div class="bg-result hidden" id="resultArea">
            <h3 class="bg-result-title">抠图结果</h3>
            <div class="bg-result-canvas checker" id="resultStage">
                <canvas id="resultCanvas"></canvas>
            </div>
            <div class="tool-actions" style="justify-content:center;">
                <a class="tool-btn tool-btn-primary" id="resultDownloadBtn" download="bg-removed.png">下载 PNG</a>
                <button class="tool-btn" id="backToEditBtn">继续调整</button>
                <button class="tool-btn" id="processAnotherBtn">处理另一张</button>
            </div>
        </div>
    `;

    initEditor(container);
}

function initEditor(container) {
    const $ = (id) => container.querySelector(id);

    const uploadArea = $('#uploadArea');
    const fileInput = $('#fileInput');
    const bgEditor = $('#bgEditor');
    const resultArea = $('#resultArea');
    const canvas = $('#bgCanvas');

    // 编辑器内部状态
    const state = {
        img: null,          // HTMLImageElement（可能已降采样）
        srcData: null,      // 原图 ImageData（缓存，供保护框恢复原始像素）
        fgData: null,       // imgly foreground ImageData（缓存，抠图结果）
        currentModel: null, // 生成 fgData 时用的模型
        processing: false,
        // SAM 相关
        source: 'imgly',    // 'imgly' | 'sam'
        samEncoded: null,   // SAM 编码结果（每图一次）
        samCanvas: null,    // SAM 用的降采样 canvas
        samMask: null,      // SAM 生成的 mask（Uint8Array，原图尺寸）
        samCandidates: null,
        samCandIdx: 0,
        samDrawing: false,  // SAM 框选中
        samBoxStart: null,
        samBoxCur: null,
        // SAM 可视化
        samEdgePts: null,   // 边缘点数组 [order0, idx0, order1, idx1, ...]
        samAntsRAF: null,   // 蚁行线动画 RAF ID
        samAntsPhase: 0,    // 蚁行线相位（0-7）
        samAntsLast: 0      // 上次动画时间戳
    };

    // 创建画布编辑器
    editor = new CanvasEditor(canvas, {
        onBoxesChange: (counts) => {
            $('#cntSubject').textContent = counts.subject;
            $('#cntProtect').textContent = counts.protect;
            // 计数区仅在有框时显示
            $('#boxBar').classList.toggle('hidden', counts.subject + counts.protect === 0);
        },
        onViewChange: (pct) => {
            $('#zoomLabel').textContent = pct + '%';
            // 视图变化时重绘 SAM 可视化（缩放/平移后位置会变）
            if (state.samEdgePts && state.samAntsRAF) {
                const overlay = container.querySelector('#samOverlay');
                if (overlay) {
                    syncOverlayToEditor(overlay, state);
                    drawSamAnts(overlay, state);
                }
            }
        },
        // 编辑器内部切换工具时（目前仅外部触发，预留）同步 UI
        onToolChange: (tool) => syncToolUI(tool),
        // SAM 交互回调
        onSamInteract: (evt) => handleSamInteract(evt, state, container)
    });

    // 高级调整折叠切换
    const advToggle = $('#advToggle');
    const setAdvExpanded = (expanded) => {
        advToggle.setAttribute('aria-expanded', String(expanded));
        advToggle.classList.toggle('open', expanded);
        $('#advPanel').classList.toggle('collapsed', !expanded);
    };
    advToggle.addEventListener('click', () => {
        setAdvExpanded(advToggle.getAttribute('aria-expanded') !== 'true');
    });

    // ---------- 工具选择：画布工具条为主入口，右侧分段控件双向同步 ----------
    const canvasTools = $('#canvasTools');

    // 工具映射：多边形工具 ↔ 右侧面板模式按钮
    const TOOL_TO_MODE = { 'polygon': 'protect', 'polygon-subject': 'subject' };
    const MODE_TO_TOOL = { 'protect': 'polygon', 'subject': 'polygon-subject' };

    // 只更新 UI 高亮，不回写编辑器（供 onToolChange 回调用）
    function syncToolUI(tool) {
        canvasTools.querySelectorAll('.bg-tool').forEach(b =>
            b.classList.toggle('active', b.dataset.tool === tool));
        // 右侧模式按钮：pan 时都不高亮，多边形工具时高亮对应项
        const mode = TOOL_TO_MODE[tool] || null;
        $('#modeSeg').querySelectorAll('.bg-adv-mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === mode));
    }

    // 设置工具：更新编辑器 + UI，选画框工具时自动展开高级调整
    function setTool(tool) {
        editor.setTool(tool, false); // 不触发 onToolChange，避免打转
        syncToolUI(tool);
        if (tool === 'polygon' || tool === 'polygon-subject') setAdvExpanded(true);
    }

    canvasTools.addEventListener('click', (e) => {
        const btn = e.target.closest('.bg-tool');
        if (btn) setTool(btn.dataset.tool);
    });

    // 根据选区来源联动所有相关 UI：工具条按钮显隐、SAM 提示、框选模式区、面板标题
    function applySourceUI(source) {
        const isSam = source === 'sam';
        // 画布工具条：SAM 模式隐藏画框按钮、显示 SAM 按钮；imgly 模式显示画框
        canvasTools.querySelectorAll('.bg-tool-box').forEach(b => b.classList.toggle('hidden', isSam));
        canvasTools.querySelector('.bg-tool-sam').classList.toggle('hidden', !isSam);
        // SAM 提示与候选栏
        $('#samHint').classList.toggle('hidden', !isSam);
        $('#samBar').classList.toggle('hidden', !isSam);
        // 高级调整里的框选模式区：SAM 模式隐藏（框选对 SAM 无意义），保留边缘精修
        $('#boxModeGroup').classList.toggle('hidden', isSam);
        // 面板标题随之调整
        const advSubLabel = advToggle.querySelector('.bg-adv-toggle-sub');
        if (advSubLabel) advSubLabel.textContent = isSam ? '边缘精修' : '框选 · 边缘精修';
    }

    // tooltip 定位：悬停/聚焦时按视口边界智能摆放
    initTooltips(container);

    // 初始化 UI 状态（显示 imgly 模式的工具按钮）
    applySourceUI('imgly');

    // ---------- 上传 ----------
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleFile(file);
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    async function handleFile(file) {
        const url = trackUrl(URL.createObjectURL(file));
        const img = new Image();
        img.onload = () => {
            // 降采样超大图
            const { image, downscaled } = maybeDownscale(img);
            state.img = image;
            state.srcData = imageToData(image);
            state.fgData = null;        // 换图作废旧结果
            state.currentModel = null;

            uploadArea.classList.add('hidden');
            resultArea.classList.add('hidden');
            bgEditor.classList.remove('hidden');
            $('#downloadBtn').classList.add('hidden');

            // 统一采用左图右设置布局（横图/竖图一致），实测比上下布局更好用

            // 编辑器需要能拿到尺寸，等一帧让 flex 布局定好再 setImage
            requestAnimationFrame(() => editor.setImage(image));

            $('#canvasTip').textContent = downscaled
                ? '图片较大已自动缩小 · 拖拽平移 · 滚轮缩放 · 右上角切换画框'
                : '拖拽平移 · 滚轮缩放 · 右上角图标切换画框工具';
        };
        img.onerror = () => alert('图片加载失败，请换一张试试');
        img.src = url;
    }

    // ---------- 设置面板交互 ----------
    // 右侧模式按钮：点了就切到对应多边形工具（双向同步的另一半）
    const modeSeg = $('#modeSeg');
    modeSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('.bg-adv-mode-btn');
        if (!btn) return;
        const tool = MODE_TO_TOOL[btn.dataset.mode];
        if (tool) setTool(tool);
    });

    $('#delBtn').addEventListener('click', () => editor.deleteSelected());
    $('#clearBtn').addEventListener('click', () => editor.clearBoxes());
    $('#fitBtn').addEventListener('click', () => editor.fit());
    $('#reselectBtn').addEventListener('click', resetAll);

    // 换模型：作废缓存结果，下次预览会重跑 AI
    $('#modelSelect').addEventListener('change', () => {
        state.fgData = null;
        state.currentModel = null;
    });

    // ---------- 选区来源切换 ----------
    const sourceSeg = $('#sourceSeg');
    sourceSeg.addEventListener('click', async (e) => {
        const btn = e.target.closest('.bg-seg-btn');
        if (!btn) return;
        const source = btn.dataset.source;
        if (source === state.source) return;

        sourceSeg.querySelectorAll('.bg-seg-btn').forEach(b =>
            b.classList.toggle('active', b === btn));
        state.source = source;

        // 联动所有随来源变化的 UI（工具条、提示、框选模式区、标题）
        applySourceUI(source);

        // 切换工具模式：SAM 模式 → 'sam' 工具；imgly 模式 → 'pan' 工具
        if (source === 'sam') {
            setTool('sam');
        } else {
            setTool('pan');
            // 切回 imgly 时清除 SAM 可视化
            clearSamVisuals(state, container);
        }

        // 切到 SAM 模式时，初始化 SAM 编码
        if (source === 'sam' && state.img && !state.samEncoded) {
            try {
                showProgress(container, true, 0, '加载 SAM 模型中…');
                await initSamForImage(container, state);
                showProgress(container, false);
            } catch (err) {
                console.error('SAM 初始化失败:', err);
                showProgress(container, false);
                alert('SAM 模型加载失败：' + err.message);
                // 切回 imgly
                state.source = 'imgly';
                sourceSeg.querySelectorAll('.bg-seg-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.source === 'imgly'));
                applySourceUI('imgly');
                setTool('pan');
            }
        }
    });

    // SAM 切换候选
    $('#samCycleBtn').addEventListener('click', () => {
        if (!state.samCandidates || state.samCandidates.length === 0) return;
        state.samCandIdx = (state.samCandIdx + 1) % state.samCandidates.length;
        applySamCandidate(state, container);
    });

    // 边缘精修 / 框变化不需要重跑 AI，这里不作废 mask

    // ---------- 预览（核心流程） ----------
    $('#previewBtn').addEventListener('click', () => runPreview());

    async function runPreview() {
        if (!state.srcData || state.processing) return;
        state.processing = true;
        const previewBtn = $('#previewBtn');
        previewBtn.disabled = true;

        try {
            const model = $('#modelSelect').value;
            const useSam = state.source === 'sam' && state.samMask;

            let out;

            if (useSam) {
                // SAM 模式：用 SAM mask 作为 alpha，原图 RGB 作为前景
                out = composeFromSamMask(state.samMask, state.srcData, editor.getBoxes(), {
                    refineEdge: $('#refineChk').checked
                });
            } else {
                // imgly 模式：原有流程
                // 只有 foreground 缺失或模型变了才重跑 AI
                if (!state.fgData || state.currentModel !== model) {
                    showProgress(container, true, 0, '加载 AI 模型中…');
                    state.fgData = await runForeground(state.img, model, (pct, text) => {
                        showProgress(container, true, pct, text);
                    });
                    state.currentModel = model;
                    showProgress(container, false);
                }

                // 廉价合成：foreground + 框 + 边缘精修
                const boxes = editor.getBoxes();
                out = composeResult(state.fgData, state.srcData, boxes, {
                    refineEdge: $('#refineChk').checked
                });
            }

            renderResult(container, out);
        } catch (err) {
            console.error('抠图失败:', err);
            showProgress(container, false);
            alert('抠图失败：' + err.message + '\n\n可能原因：浏览器不支持 WASM/WebGPU，或模型加载失败。');
        } finally {
            state.processing = false;
            previewBtn.disabled = false;
        }
    }

    // ---------- 结果区按钮 ----------
    $('#backToEditBtn').addEventListener('click', () => {
        resultArea.classList.add('hidden');
        bgEditor.classList.remove('hidden');
        editor.fit();
    });
    $('#processAnotherBtn').addEventListener('click', resetAll);

    function resetAll() {
        state.img = null;
        state.srcData = null;
        state.fgData = null;
        state.currentModel = null;
        // 复位 SAM 相关状态
        state.source = 'imgly';
        state.samEncoded = null;
        state.samCanvas = null;
        state.samMask = null;
        state.samCandidates = null;
        state.samCandIdx = 0;
        fileInput.value = '';
        editor.clearBoxes();
        setTool('pan');
        setAdvExpanded(false);
        revokeAllUrls();
        clearSamVisuals(state, container);
        // 选区来源分段控件复位到「自动去背」，并联动 UI
        sourceSeg.querySelectorAll('.bg-seg-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.source === 'imgly'));
        applySourceUI('imgly');
        uploadArea.classList.remove('hidden');
        bgEditor.classList.add('hidden');
        resultArea.classList.add('hidden');
    }
}

// runForeground / maybeDownscale / imageToData 已抽到 ./shared/bg-removal.js 复用（见文件头 import）

// 把合成结果 ImageData 画到结果 canvas 并生成下载链接
function renderResult(container, imageData) {
    const bgEditor = container.querySelector('#bgEditor');
    const resultArea = container.querySelector('#resultArea');
    const rc = container.querySelector('#resultCanvas');
    rc.width = imageData.width;
    rc.height = imageData.height;
    rc.getContext('2d').putImageData(imageData, 0, 0);

    rc.toBlob((blob) => {
        const url = trackUrl(URL.createObjectURL(blob));
        container.querySelector('#resultDownloadBtn').href = url;
        const dl = container.querySelector('#downloadBtn');
        dl.href = url;
        dl.classList.remove('hidden');
    }, 'image/png');

    bgEditor.classList.add('hidden');
    resultArea.classList.remove('hidden');
}

function showProgress(container, show, pct = 0, text = '') {
    const wrap = container.querySelector('#progressWrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !show);
    if (show) {
        container.querySelector('#progressFill').style.width = pct + '%';
        container.querySelector('#progressText').textContent = text;
    }
}

// ---------- SAM 相关辅助函数 ----------

// 为当前图像初始化 SAM：降采样 → 编码（每图一次）
async function initSamForImage(container, state) {
    const img = state.img;
    const W = img.naturalWidth, H = img.naturalHeight;

    // 降采样到 SAM_MAX_DIM
    const maxSide = Math.max(W, H);
    const ratio = maxSide > SAM_MAX_DIM ? SAM_MAX_DIM / maxSide : 1;
    const sw = Math.round(W * ratio);
    const sh = Math.round(H * ratio);
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    sc.getContext('2d').drawImage(img, 0, 0, sw, sh);

    showProgress(container, true, 30, '编码图像中…');
    const encoded = await samEncode(sc);

    state.samEncoded = encoded;
    state.samCanvas = sc;
    state.samMask = null;
    state.samCandidates = null;
    state.samCandIdx = 0;
}

// 应用当前 SAM 候选：更新 mask 并显示信息
function applySamCandidate(state, container) {
    if (!state.samCandidates || state.samCandidates.length === 0) return;
    const c = state.samCandidates[state.samCandIdx];
    const imgW = state.img.naturalWidth, imgH = state.img.naturalHeight;

    // 将 mask 缩放到原图尺寸
    state.samMask = resizeMask(c.mask, state.samCanvas.width, state.samCanvas.height, imgW, imgH);

    const pct = (c.area / (state.samCanvas.width * state.samCanvas.height) * 100).toFixed(1);
    container.querySelector('#samCandInfo').textContent =
        `候选 ${state.samCandIdx + 1}/${state.samCandidates.length}（占比 ${pct}% · 分 ${c.score.toFixed(2)}）`;

    // 提取边缘并启动蚁行线动画
    state.samEdgePts = extractSamEdges(state.samMask, imgW, imgH);
    startSamAnts(state, container);
}

// SAM 交互处理：CanvasEditor 在 'sam' 工具模式下的回调
async function handleSamInteract(evt, state, container) {
    // sam 模式：sam 来源 + 已编码
    if (state.source !== 'sam' || !state.samEncoded) return;

    if (evt.type === 'start') {
        // 按下：判断是否为点击（后续会在 end 时确认）
        state.samBoxStart = evt.point;
        state.samBoxCur = evt.point;
    } else if (evt.type === 'move') {
        // 拖拽中：更新当前点
        state.samBoxCur = evt.current;
        // 这里可以绘制框预览，暂省略
    } else if (evt.type === 'end') {
        // 松手：判断是点选还是框选
        const a = evt.start, b = evt.current;
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);

        if (dx < 4 && dy < 4) {
            // 点选：移动距离很小，视为点击
            await runSamDecode(state, container, {
                points: [[a.x, a.y]],
                labels: [1]
            });
        } else {
            // 框选：拖出了一个框
            const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
            const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

            // box 需要附带原图尺寸，供 sam-core 做坐标映射
            const box = [x0, y0, x1, y1];
            box._imgW = state.img.naturalWidth;
            box._imgH = state.img.naturalHeight;

            await runSamDecode(state, container, {
                points: [[cx, cy]],
                labels: [1],
                box: box
            });
        }
    }
}

async function runSamDecode(state, container, prompt) {
    try {
        showProgress(container, true, 0, 'SAM 解码中…');

        // 坐标系转换：CanvasEditor 给的是原图坐标（0..naturalWidth），
        // 但 SAM 编码用的是降采样画布（samCanvas）。点坐标必须缩放到
        // 降采样空间，否则 processor 会把点定位错（点眼睛选中背景/整图）。
        const sx = state.samCanvas.width / state.img.naturalWidth;
        const sy = state.samCanvas.height / state.img.naturalHeight;
        const scaledPrompt = {
            points: prompt.points.map(([x, y]) => [x * sx, y * sy]),
            labels: prompt.labels
        };
        // box 仅用于候选排序（storeCandidates 内部按 _imgW/_imgH 自行映射），
        // 保持原图坐标即可，无需在这里缩放。
        if (prompt.box) scaledPrompt.box = prompt.box;

        const result = await samDecode(state.samEncoded, scaledPrompt);
        state.samCandidates = result.candidates;
        state.samCandIdx = result.bestIdx;

        // 显示候选
        applySamCandidate(state, container);
        showProgress(container, false);
        container.querySelector('#samBar').classList.remove('hidden');
    } catch (err) {
        console.error('SAM 解码失败:', err);
        showProgress(container, false);
        alert('SAM 解码失败：' + err.message);
    }
}

// ========== SAM 可视化：蚁行线动画 ==========

/**
 * 提取 mask 边缘点：像素为前景且四邻域有背景 → 边缘
 * 返回扁平数组 [order0, idx0, order1, idx1, ...]，order 供蚁行线相位错开
 */
function extractSamEdges(mask, W, H) {
    const pts = [];
    let order = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (!mask[i]) continue;
            const up = y > 0 ? mask[i - W] : 0;
            const dn = y < H - 1 ? mask[i + W] : 0;
            const lf = x > 0 ? mask[i - 1] : 0;
            const rt = x < W - 1 ? mask[i + 1] : 0;
            if (!up || !dn || !lf || !rt) {
                pts.push(order++, i);
            }
        }
    }
    return pts;
}

/**
 * 启动 SAM 蚁行线动画
 */
function startSamAnts(state, container) {
    stopSamAnts(state);
    if (!state.samEdgePts || state.samEdgePts.length === 0) return;

    const overlay = container.querySelector('#samOverlay');
    if (!overlay) return;

    // 同步 overlay 尺寸和变换到主 canvas
    syncOverlayToEditor(overlay, state);

    const ANTS_STEP_MS = 140; // 每 140ms 走一格
    state.samAntsLast = 0;

    const loop = (ts) => {
        if (ts - state.samAntsLast >= ANTS_STEP_MS) {
            state.samAntsPhase = (state.samAntsPhase + 1) % 8;
            state.samAntsLast = ts;
            drawSamAnts(overlay, state);
        }
        state.samAntsRAF = requestAnimationFrame(loop);
    };
    state.samAntsRAF = requestAnimationFrame(loop);
}

/**
 * 停止 SAM 蚁行线动画
 */
function stopSamAnts(state) {
    if (state.samAntsRAF) {
        cancelAnimationFrame(state.samAntsRAF);
        state.samAntsRAF = null;
    }
}

/**
 * 同步 overlay canvas 的尺寸和位置到主画布
 */
function syncOverlayToEditor(overlay, state) {
    if (!editor || !state.img) return;

    // overlay 的 CSS 尺寸和物理分辨率与主 canvas 一致
    const mainCanvas = overlay.previousElementSibling; // bgCanvas
    const rect = mainCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);
}

/**
 * 绘制 SAM 蚁行线和半透明填充
 */
function drawSamAnts(overlay, state) {
    const ctx = overlay.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);

    if (!state.samEdgePts || !state.img || !editor) return;

    const imgW = state.img.naturalWidth;
    const imgH = state.img.naturalHeight;

    // 绘制半透明填充
    if (state.samMask) {
        drawSamFill(ctx, state, imgW, imgH);
    }

    // 绘制蚁行线（黑白交替的点）
    for (let k = 0; k < state.samEdgePts.length; k += 2) {
        const order = state.samEdgePts[k];
        const idx = state.samEdgePts[k + 1];
        const x = idx % imgW;
        const y = Math.floor(idx / imgW);

        // 图像坐标 → 屏幕坐标
        const sp = editor.imageToScreen(x, y);
        const on = ((order + state.samAntsPhase) >> 1) & 1;
        ctx.fillStyle = on ? '#fff' : '#000';
        ctx.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1);
    }
}

/**
 * 绘制半透明蓝色填充（标识选区范围）
 */
function drawSamFill(ctx, state, imgW, imgH) {
    // 创建低分辨率填充 canvas 缓存
    if (!state._samFillCanvas) {
        state._samFillCanvas = document.createElement('canvas');
        state._samFillCanvas.width = imgW;
        state._samFillCanvas.height = imgH;
        const fctx = state._samFillCanvas.getContext('2d');
        const id = fctx.createImageData(imgW, imgH);
        for (let i = 0; i < imgW * imgH; i++) {
            if (state.samMask[i]) {
                id.data[i * 4] = 74;
                id.data[i * 4 + 1] = 158;
                id.data[i * 4 + 2] = 255;
                id.data[i * 4 + 3] = 90;
            }
        }
        fctx.putImageData(id, 0, 0);
    }

    // 画到 overlay 上：从图像坐标缩放到屏幕坐标
    const scale = editor.scale;
    const offsetX = editor.offsetX;
    const offsetY = editor.offsetY;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        state._samFillCanvas,
        offsetX, offsetY,
        imgW * scale, imgH * scale
    );
}

/**
 * 清除 SAM 可视化
 */
function clearSamVisuals(state, container) {
    stopSamAnts(state);
    state.samEdgePts = null;
    state._samFillCanvas = null;
    const overlay = container.querySelector('#samOverlay');
    if (overlay) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
}

export function unmount() {
    if (editor) { editor.destroy(); editor = null; }
    // 清理 SAM 动画
    if (typeof state !== 'undefined' && state.samAntsRAF) {
        cancelAnimationFrame(state.samAntsRAF);
    }
    // 清理可能残留的 tooltip 浮层
    document.querySelectorAll('.bg-tooltip').forEach(el => el.remove());
    revokeAllUrls();
    resetBgState();
}
