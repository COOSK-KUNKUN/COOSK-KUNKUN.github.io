/**
 * 证件照制作工具
 * 流程：上传 → AI 去背景 → 选择尺寸/底色 → 调整位置 → 预览/下载/排版打印
 */

import { runForeground, maybeDownscale, imageToData, resetState as resetBgState } from './shared/bg-removal.js';
import { IdPhotoEditor } from './id-photo/editor.js';
import { generateLayout, generateLayoutPreview } from './id-photo/layout.js';
import { detectFace, resetDetector } from './id-photo/face-detect.js';
import { ID_PHOTO_SIZES, BG_COLORS, PAPER_SIZES, DEFAULT_SETTINGS, DEFAULT_GUIDE } from './id-photo/sizes.js';

let editor = null;
let objectUrls = new Set();

function trackUrl(url) { objectUrls.add(url); return url; }
function revokeAllUrls() {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls.clear();
}

// 状态
const state = {
    step: 'upload',      // 'upload' | 'processing' | 'edit' | 'preview' | 'layout'
    mode: null,          // 'auto'（AI 去背景）| 'manual'（已去背景，直接编辑）
    img: null,           // 原始图像
    fgData: null,        // 去背景后的 ImageData
    sizeId: DEFAULT_SETTINGS.sizeId,
    bgColorId: DEFAULT_SETTINGS.bgColorId,
    model: DEFAULT_SETTINGS.model,
    resultBlob: null,    // 最终结果
};

export function mount(container) {
    container.innerHTML = `
        <h2>📷 证件照制作</h2>
        <p class="id-photo-desc">上传照片制作标准证件照。可选择 AI 自动去背景，或直接上传已去好背景的照片。AI 去背景第一次加载需要等待约 3 分钟，后续通过浏览器缓存可以快速进入。</p>

        <!-- 步骤 1: 上传（双入口） -->
        <div class="id-photo-step" id="stepUpload">
            <div class="id-photo-upload-cards">
                <!-- 卡片 A：自动去背景 -->
                <div class="id-photo-upload-card" id="uploadAuto">
                    <span class="id-photo-upload-badge">推荐</span>
                    <div class="id-photo-upload-card-icon">
                        <svg class="ai-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>
                            <circle cx="24" cy="24" r="12" fill="currentColor" opacity="0.1"/>
                            <path d="M24 16V32M16 24H32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                            <circle cx="24" cy="24" r="4" fill="currentColor"/>
                            <circle cx="36" cy="12" r="3" fill="currentColor" opacity="0.6"/>
                            <circle cx="12" cy="36" r="3" fill="currentColor" opacity="0.6"/>
                        </svg>
                    </div>
                    <div class="id-photo-upload-card-title">自动去背景</div>
                    <div class="id-photo-upload-card-desc">上传照片，AI 自动去除背景</div>
                    <div class="id-photo-format-hint">支持 <code>JPG</code> <code>PNG</code> <code>WebP</code></div>
                </div>
                <!-- 卡片 B：已去背景 -->
                <div class="id-photo-upload-card" id="uploadManual">
                    <div class="id-photo-upload-card-icon">
                        <svg class="check-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="8" y="10" width="32" height="28" rx="3" stroke="currentColor" stroke-width="2"/>
                            <rect x="12" y="14" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <rect x="18" y="20" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <rect x="24" y="14" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <rect x="30" y="20" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <rect x="12" y="26" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <rect x="24" y="26" width="6" height="6" fill="currentColor" opacity="0.15"/>
                            <circle cx="36" cy="34" r="8" fill="#34c759"/>
                            <path d="M32.5 34L35 36.5L39.5 31.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div class="id-photo-upload-card-title">已有透明底照片</div>
                    <div class="id-photo-upload-card-desc">跳过 AI 处理，直接进入编辑</div>
                    <div class="id-photo-format-hint">推荐 <code>PNG</code> <code>WebP</code>（支持透明）</div>
                </div>
            </div>
            <div class="id-photo-upload-tips">💡 也可以直接把图片拖拽到对应卡片</div>
            <input type="file" id="fileInputAuto" accept="image/*" style="display: none;">
            <input type="file" id="fileInputManual" accept="image/*" style="display: none;">
        </div>

        <!-- 步骤 2: 处理中 -->
        <div class="id-photo-step hidden" id="stepProcessing">
            <div class="id-photo-processing">
                <div class="id-photo-spinner"></div>
                <div class="id-photo-progress-text" id="progressText">AI 处理中…</div>
                <div class="bg-progress">
                    <div class="bg-progress-bar"><div class="bg-progress-fill" id="progressFill"></div></div>
                </div>
            </div>
        </div>

        <!-- 步骤 3: 编辑 -->
        <div class="id-photo-step hidden" id="stepEdit">
            <div class="id-photo-editor-wrap">
                <!-- 左侧：预览画布 -->
                <div class="id-photo-canvas-area">
                    <div class="id-photo-canvas-container" id="canvasContainer">
                        <canvas id="idPhotoCanvas"></canvas>
                    </div>
                    <div class="id-photo-canvas-tip">拖拽移动 · 滚轮缩放</div>
                    <div class="id-photo-compliance" id="complianceHint"></div>
                </div>

                <!-- 右侧：设置面板 -->
                <div class="id-photo-settings">
                    <!-- 尺寸选择 -->
                    <div class="id-photo-field">
                        <label class="id-photo-label">尺寸规格</label>
                        <div class="id-photo-size-list" id="sizeList">
                            ${renderSizeList()}
                        </div>
                    </div>

                    <!-- 背景颜色 -->
                    <div class="id-photo-field">
                        <label class="id-photo-label">背景颜色</label>
                        <div class="id-photo-color-list" id="colorList">
                            ${BG_COLORS.map(color => `
                                <button class="id-photo-color-btn ${color.id === state.bgColorId ? 'active' : ''}"
                                        data-color-id="${color.id}"
                                        data-color="${color.value}"
                                        style="--color: ${color.value}"
                                        title="${color.name}${color.use ? ' · ' + color.use : ''}">
                                    ${color.id === state.bgColorId ? '✓' : ''}
                                </button>
                            `).join('')}
                            <label class="id-photo-color-btn id-photo-color-custom" title="自定义颜色（自由取色）">
                                <input type="color" id="customColorInput" value="#438edc">
                            </label>
                        </div>
                        <div class="id-photo-color-use" id="colorUse"></div>
                    </div>

                    <!-- 参考线开关 -->
                    <label class="id-photo-guide-toggle">
                        <input type="checkbox" id="guideToggle">
                        <span>显示构图参考线</span>
                    </label>

                    <!-- 高级设置：默认折叠 -->
                    <details class="id-photo-advanced">
                        <summary>高级设置</summary>
                        <div class="id-photo-field">
                            <label class="id-photo-label" for="modelSelect">AI 模型</label>
                            <select class="id-photo-select" id="modelSelect">
                                <option value="medium">高精度（默认）</option>
                                <option value="small">通用（较快）</option>
                            </select>
                        </div>
                    </details>

                    <!-- 操作按钮 -->
                    <div class="id-photo-actions">
                        <button class="tool-btn" id="reuploadBtn">重新上传</button>
                        <button class="tool-btn tool-btn-primary" id="previewBtn">生成证件照</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 步骤 4: 预览结果 -->
        <div class="id-photo-step hidden" id="stepPreview">
            <div class="id-photo-preview-wrap">
                <div class="id-photo-preview-main">
                    <div class="id-photo-preview-canvas checker" id="previewCanvasWrap">
                        <canvas id="previewCanvas"></canvas>
                    </div>
                    <div class="id-photo-preview-info" id="previewInfo">
                        一寸 (25×35mm) · 295×413px · 白色背景
                    </div>
                </div>
                <div class="id-photo-preview-actions">
                    <button class="tool-btn" id="backToEditBtn">继续调整</button>
                    <button class="tool-btn" id="layoutBtn">排版打印</button>
                    <a class="tool-btn tool-btn-primary" id="downloadBtn" download="id-photo.png">下载证件照</a>
                </div>
            </div>
        </div>

        <!-- 步骤 5: 排版打印 -->
        <div class="id-photo-step hidden" id="stepLayout">
            <div class="id-photo-layout-wrap">
                <div class="id-photo-layout-settings">
                    <div class="id-photo-field">
                        <label class="id-photo-label">纸张大小</label>
                        <select class="id-photo-select" id="paperSelect">
                            ${Object.entries(PAPER_SIZES).map(([id, p]) => `
                                <option value="${id}">${p.name}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="id-photo-field">
                        <label class="id-photo-label">排列数量</label>
                        <div class="id-photo-count-presets" id="countPresets">
                            <button class="tool-btn tool-btn-sm" data-count="0">自动</button>
                            <button class="tool-btn tool-btn-sm" data-count="6">6 张</button>
                            <button class="tool-btn tool-btn-sm" data-count="8">8 张</button>
                        </div>
                        <div class="id-photo-count-control">
                            <button class="tool-btn tool-btn-sm" id="countMinus">−</button>
                            <span class="id-photo-count-value" id="countValue">自动</span>
                            <button class="tool-btn tool-btn-sm" id="countPlus">+</button>
                        </div>
                    </div>
                    <div class="id-photo-layout-info" id="layoutInfo">
                        4R 纸张，最多可放 8 张
                    </div>
                </div>
                <div class="id-photo-layout-preview">
                    <canvas id="layoutCanvas"></canvas>
                </div>
                <div class="id-photo-layout-actions">
                    <button class="tool-btn" id="backToPreviewBtn">返回预览</button>
                    <a class="tool-btn tool-btn-primary" id="layoutDownloadBtn" download="id-photo-print.jpg">下载排版图</a>
                </div>
            </div>
        </div>
    `;

    initUI(container);
}

function renderSizeList() {
    return ID_PHOTO_SIZES.map(size => `
        <button class="id-photo-size-btn ${size.id === state.sizeId ? 'active' : ''}" data-size-id="${size.id}">
            <span class="id-photo-size-name">${size.name}</span>
            <span class="id-photo-size-desc">${size.desc}</span>
            <span class="id-photo-size-check">✓</span>
        </button>
    `).join('');
}

function initUI(container) {
    const $ = (id) => container.querySelector(id);

    const uploadAuto = $('#uploadAuto');
    const uploadManual = $('#uploadManual');
    const fileInputAuto = $('#fileInputAuto');
    const fileInputManual = $('#fileInputManual');
    const canvas = $('#idPhotoCanvas');

    // 创建编辑器
    editor = new IdPhotoEditor(canvas);

    // ========== 上传（双入口） ==========
    // 给一张卡片绑定点击 / 拖拽，选中文件后按 mode 分流处理
    function bindUploadCard(card, input, mode) {
        card.addEventListener('click', () => input.click());
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            card.classList.add('dragover');
        });
        card.addEventListener('dragleave', () => {
            card.classList.remove('dragover');
        });
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                state.mode = mode;
                handleFile(file);
            }
        });
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                state.mode = mode;
                handleFile(file);
            }
        });
    }

    bindUploadCard(uploadAuto, fileInputAuto, 'auto');
    bindUploadCard(uploadManual, fileInputManual, 'manual');

    async function handleFile(file) {
        const url = trackUrl(URL.createObjectURL(file));
        const img = new Image();
        img.onload = () => {
            state.img = img;
            if (state.mode === 'manual') {
                processManual();
            } else {
                processImage();
            }
        };
        img.onerror = () => alert('图片加载失败，请换一张试试');
        img.src = url;
    }

    // ========== 处理图像 ==========
    async function processImage() {
        showStep('processing');
        const progressText = $('#progressText');
        const progressFill = $('#progressFill');

        try {
            // 降采样
            const { image, downscaled } = maybeDownscale(state.img);
            
            // 去背景
            const fgData = await runForeground(image, state.model, (pct, text) => {
                progressText.textContent = text;
                progressFill.style.width = pct + '%';
            });

            // 人脸检测（在原始 RGB 图上更准；失败/无脸则降级为手动定位）
            let faceBox = null;
            try {
                progressText.textContent = '识别人脸位置…';
                faceBox = await detectFace(image);
            } catch (e) {
                console.warn('人脸检测不可用，降级为手动定位:', e);
            }

            // 进入编辑步骤
            enterEdit(fgData, faceBox);

        } catch (err) {
            console.error('处理失败:', err);
            alert('处理失败：' + err.message);
            showStep('upload');
        }
    }

    // ========== 处理已去背景图像（跳过 AI） ==========
    async function processManual() {
        showStep('processing');
        const progressText = $('#progressText');
        const progressFill = $('#progressFill');
        progressText.textContent = '载入图片…';
        progressFill.style.width = '100%';

        try {
            // 直接取上传图像的 ImageData，保留 alpha 通道（透明区域即背景）
            const fgData = imageToData(state.img);

            // 可选人脸检测：在原图上做，帮助自动定位；失败/无脸则降级为手动
            let faceBox = null;
            try {
                progressText.textContent = '识别人脸位置…';
                faceBox = await detectFace(state.img);
            } catch (e) {
                console.warn('人脸检测不可用，降级为手动定位:', e);
            }

            enterEdit(fgData, faceBox);

        } catch (err) {
            console.error('处理失败:', err);
            alert('处理失败：' + err.message);
            showStep('upload');
        }
    }

    // 进入编辑步骤：设置尺寸、底色、参考线并载入图像
    function enterEdit(fgData, faceBox) {
        state.fgData = fgData;
        showStep('edit');

        const size = ID_PHOTO_SIZES.find(s => s.id === state.sizeId);
        editor.setTargetSize(size.width, size.height);
        editor.setBgColor(currentBgColor()); // 编辑态实时铺底色
        editor.setGuide(size.guide || DEFAULT_GUIDE); // 构图参考线
        // 图像就绪后再自动定位（setImage 异步加载）
        editor.setImage(fgData, () => {
            if (faceBox) editor.fitFaceToGuide(faceBox);
        });
        updateColorUse();
    }

    // ========== 尺寸选择 ==========
    const sizeList = $('#sizeList');

    sizeList.addEventListener('click', (e) => {
        const btn = e.target.closest('.id-photo-size-btn');
        if (!btn) return;
        const sizeId = btn.dataset.sizeId;
        state.sizeId = sizeId;
        sizeList.querySelectorAll('.id-photo-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 更新编辑器尺寸
        const size = ID_PHOTO_SIZES.find(s => s.id === sizeId);
        if (size && editor.img) {
            editor.setTargetSize(size.width, size.height);
            editor.setGuide(size.guide || DEFAULT_GUIDE);
        }
    });

    // ========== 背景颜色 ==========
    const colorList = $('#colorList');

    // 清除所有色块的选中态。只在预设色块上放勾（用 ✓ 文本），
    // 自定义色块是 <label> 且内含 <input>，不能改 textContent，靠 CSS class 显示勾。
    function clearColorSelection() {
        colorList.querySelectorAll('.id-photo-color-btn').forEach(b => {
            b.classList.remove('active');
            if (!b.classList.contains('id-photo-color-custom')) b.textContent = '';
        });
    }

    colorList.addEventListener('click', (e) => {
        const btn = e.target.closest('.id-photo-color-btn');
        if (!btn || btn.classList.contains('id-photo-color-custom')) return;
        state.bgColorId = btn.dataset.colorId;
        clearColorSelection();
        btn.classList.add('active');
        btn.textContent = '✓';
        updateColorUse();
        if (editor && editor.img) editor.setBgColor(currentBgColor());
    });

    const customColorInput = $('#customColorInput');
    customColorInput.addEventListener('input', (e) => {
        state.bgColorId = 'custom';
        state.customColor = e.target.value;
        clearColorSelection();
        const customBtn = colorList.querySelector('.id-photo-color-custom');
        customBtn.classList.add('active', 'has-color');
        customBtn.style.setProperty('--color', e.target.value);
        updateColorUse();
        if (editor && editor.img) editor.setBgColor(currentBgColor());
    });

    // ========== 模型选择 ==========
    $('#modelSelect').addEventListener('change', (e) => {
        state.model = e.target.value;
    });

    // ========== 参考线开关 ==========
    $('#guideToggle').addEventListener('change', (e) => {
        if (editor) editor.setShowGuide(e.target.checked);
    });

    // ========== 操作按钮 ==========
    $('#reuploadBtn').addEventListener('click', () => {
        resetAll();
        showStep('upload');
    });

    $('#previewBtn').addEventListener('click', () => {
        generatePreview();
    });

    $('#backToEditBtn').addEventListener('click', () => {
        showStep('edit');
    });

    $('#layoutBtn').addEventListener('click', () => {
        showStep('layout');
        setLayoutCount(layoutCount); // 同步预设高亮 + 生成预览
    });

    // ========== 排版打印 ==========
    const paperSelect = $('#paperSelect');
    const countValue = $('#countValue');
    const layoutInfo = $('#layoutInfo');
    let layoutCount = 0; // 0 = 自动

    const countPresets = $('#countPresets');

    // 统一设置数量：更新显示、同步预设高亮、重排
    function setLayoutCount(n) {
        layoutCount = Math.max(0, n);
        countValue.textContent = layoutCount === 0 ? '自动' : layoutCount;
        // 预设按钮高亮：值匹配才高亮，否则都不亮
        countPresets.querySelectorAll('.tool-btn').forEach(b =>
            b.classList.toggle('active', Number(b.dataset.count) === layoutCount));
        generateLayoutPreviewUI();
    }

    paperSelect.addEventListener('change', () => {
        generateLayoutPreviewUI();
    });

    countPresets.addEventListener('click', (e) => {
        const btn = e.target.closest('.tool-btn');
        if (!btn) return;
        setLayoutCount(Number(btn.dataset.count));
    });

    $('#countMinus').addEventListener('click', () => {
        if (layoutCount > 1) setLayoutCount(layoutCount - 1);
    });

    $('#countPlus').addEventListener('click', () => {
        setLayoutCount(layoutCount + 1);
    });

    async function generateLayoutPreviewUI() {
        if (!state.resultBlob) return;
        
        const size = ID_PHOTO_SIZES.find(s => s.id === state.sizeId);
        const paperId = paperSelect.value;
        const layoutCanvas = $('#layoutCanvas');
        
        try {
            const result = await generateLayoutPreview(
                state.resultBlob,
                size.width, size.height,
                paperId,
                layoutCount
            );
            
            // 显示预览
            const img = new Image();
            img.onload = () => {
                layoutCanvas.width = img.naturalWidth;
                layoutCanvas.height = img.naturalHeight;
                layoutCanvas.getContext('2d').drawImage(img, 0, 0);
                
                // 更新信息
                const paper = PAPER_SIZES[paperId];
                layoutInfo.textContent = `${paper.name}，已排 ${result.count} 张（${result.cols}×${result.rows}）`;
                
                // 更新下载链接
                const downloadBtn = $('#layoutDownloadBtn');
                downloadBtn.href = result.url;
            };
            img.src = result.url;
            
        } catch (err) {
            console.error('排版失败:', err);
            alert('排版失败：' + err.message);
        }
    }

    $('#backToPreviewBtn').addEventListener('click', () => {
        showStep('preview');
    });

    // ========== 生成预览 ==========
    async function generatePreview() {
        showStep('processing');
        const progressText = $('#progressText');
        progressText.textContent = '生成证件照…';

        try {
            const size = ID_PHOTO_SIZES.find(s => s.id === state.sizeId);
            const bgColor = state.bgColorId === 'custom' 
                ? state.customColor 
                : BG_COLORS.find(c => c.id === state.bgColorId)?.value || '#ffffff';

            const blob = await editor.exportBlob(bgColor);
            state.resultBlob = blob;

            // 显示预览
            const previewCanvas = $('#previewCanvas');
            const img = new Image();
            img.onload = () => {
                previewCanvas.width = img.naturalWidth;
                previewCanvas.height = img.naturalHeight;
                previewCanvas.getContext('2d').drawImage(img, 0, 0);

                // 更新信息
                $('#previewInfo').textContent = 
                    `${size.name} (${size.desc}) · ${size.width}×${size.height}px · ${getColorName()}`;

                // 更新下载链接
                const downloadBtn = $('#downloadBtn');
                downloadBtn.href = trackUrl(URL.createObjectURL(blob));
                downloadBtn.download = `id-photo-${size.id}.png`;

                showStep('preview');
            };
            img.src = trackUrl(URL.createObjectURL(blob));

        } catch (err) {
            console.error('生成失败:', err);
            alert('生成失败：' + err.message);
            showStep('edit');
        }
    }

    function getColorName() {
        if (state.bgColorId === 'custom') return '自定义颜色';
        const color = BG_COLORS.find(c => c.id === state.bgColorId);
        return color ? color.name : '白色';
    }

    // 当前底色值（供编辑态实时预览与导出共用）
    function currentBgColor() {
        if (state.bgColorId === 'custom') return state.customColor || '#ffffff';
        return BG_COLORS.find(c => c.id === state.bgColorId)?.value || '#ffffff';
    }

    // 更新底色用途说明
    function updateColorUse() {
        const el = container.querySelector('#colorUse');
        if (!el) return;
        if (state.bgColorId === 'custom') { el.textContent = '自定义颜色'; return; }
        const color = BG_COLORS.find(c => c.id === state.bgColorId);
        el.textContent = color?.use ? `适用：${color.use}` : '';
    }

    // ========== 步骤切换 ==========
    function showStep(step) {
        state.step = step;
        container.querySelectorAll('.id-photo-step').forEach(el => el.classList.add('hidden'));
        const stepEl = container.querySelector(`#step${step.charAt(0).toUpperCase() + step.slice(1)}`);
        if (stepEl) stepEl.classList.remove('hidden');
    }

    function resetAll() {
        state.mode = null;
        state.img = null;
        state.fgData = null;
        state.resultBlob = null;
        state.sizeId = DEFAULT_SETTINGS.sizeId;
        state.bgColorId = DEFAULT_SETTINGS.bgColorId;
        state.model = DEFAULT_SETTINGS.model;
        state.customColor = undefined;
        fileInputAuto.value = '';
        fileInputManual.value = '';
        // 把控件值同步回默认，避免下次进入时 UI 与 state 不一致
        const modelSel = container.querySelector('#modelSelect');
        if (modelSel) modelSel.value = DEFAULT_SETTINGS.model;
        if (editor) editor.destroy();
        revokeAllUrls();
    }
}

export function unmount() {
    if (editor) { editor.destroy(); editor = null; }
    revokeAllUrls();
    resetBgState();
    resetDetector();
}