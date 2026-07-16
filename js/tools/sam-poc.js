/**
 * SAM 框选分割 —— 可行性验证 POC
 *
 * 目的：验证浏览器端跑 SlimSAM（Segment Anything 剪枝版）做「框/点提示分割」是否可行。
 * 评估三件事：
 *   1) 模型下载体积（看浏览器 Network 面板；控制台也会打印）
 *   2) 编码耗时（每张图一次，重）+ 解码耗时（每次提示一次，应极轻）
 *   3) mask 边缘质量（贴不贴合物体，蚁行线好不好看）
 *
 * 全程浏览器本地，图片不上传，与现有 imgly 抠图定位一致。
 * 库：@huggingface/transformers（transformers.js v3，CDN import）。
 * 模型：Xenova/slimsam-77-uniform。
 *
 * 这是独立 POC 工具，不改动现有 AI 抠图。验证通过后再谈如何并入。
 */

// transformers.js v3。用 @3 让 CDN 解析到最新的 3.x，避免写死补丁号导致 404。
const TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm';
const MODEL_ID = 'Xenova/slimsam-77-uniform';
// 模型下载镜像：huggingface.co 国内不可达，改用 hf-mirror.com。库本体/WASM 仍走 jsdelivr。
const HF_MIRROR = 'https://hf-mirror.com';
const MAX_DIM = 1024; // 编码前把长边降到这个值，控制耗时/内存

// 库与模型：模块级缓存，切走再切回不用重下
let tf = null;             // transformers.js 模块
let samModel = null;
let samProcessor = null;
let loadPromise = null;

// 当前会话状态（每次 mount 重置）
let S = null;

function log(...args) { console.log('[SAM-POC]', ...args); }

export function mount(container) {
    container.innerHTML = `
        <h2>SAM 框选分割 <span style="font-size:0.6em;opacity:0.6;">POC</span></h2>
        <p class="tool-hint">浏览器本地跑 SlimSAM，框选或点击自动识别物体并画出边缘（蚁行线）。适合抠<b>人物、主体</b>这类完整物体；眼睛、眼镜、发丝等细小部件超出该模型精度，请整体选取。首次需下载模型。</p>

        <div class="upload-area" id="samUpload">
            <div style="font-size:3rem;margin-bottom:1rem;">🎯</div>
            <div>点击或拖拽图片到此处</div>
            <div style="font-size:0.75rem;margin-top:0.5rem;opacity:0.7;">支持 JPG / PNG / WebP</div>
            <input type="file" id="samFile" accept="image/*" style="display:none;">
        </div>

        <div class="sam-editor hidden" id="samEditor">
            <div class="sam-canvas-wrap">
                <div class="sam-stage" id="samStage">
                    <canvas id="samBase"></canvas>
                    <canvas id="samAnts" class="sam-ants"></canvas>
                </div>
                <div class="sam-bar">
                    <span class="sam-seg" id="samMode">
                        <button class="bg-seg-btn active" data-m="box">框选</button>
                        <button class="bg-seg-btn" data-m="point">点选</button>
                    </span>
                    <button class="tool-btn tool-btn-sm hidden" id="samCycle">切换候选</button>
                    <button class="tool-btn tool-btn-sm" id="samClear">清除选区</button>
                    <button class="tool-btn tool-btn-sm" id="samReset">换图</button>
                </div>
            </div>

            <aside class="sam-panel">
                <div class="sam-stat" id="samStat">准备中…</div>
                <div class="sam-hint" id="samHint"></div>
                <div class="bg-progress hidden" id="samProg">
                    <div class="bg-progress-bar"><div class="bg-progress-fill" id="samProgFill"></div></div>
                    <span class="sam-hint" id="samProgText"></span>
                </div>
                <button class="tool-btn tool-btn-primary hidden" id="samExport">导出选区为透明 PNG</button>
                <a class="tool-btn hidden" id="samDownload" download="sam-cutout.png">下载</a>
            </aside>
        </div>
    `;
    initSam(container);
}

function initSam(container) {
    const $ = (id) => container.querySelector(id);
    const upload = $('#samUpload');
    const fileInput = $('#samFile');
    const editor = $('#samEditor');
    const base = $('#samBase');
    const ants = $('#samAnts');

    S = {
        img: null,          // 降采样后的 HTMLCanvasElement/Image
        rawImage: null,     // transformers.js RawImage（喂给 processor）
        embeddings: null,   // 编码结果（每图一次）
        fit: 1,             // 图像像素 → 显示像素 的缩放
        mode: 'box',
        drawing: false,
        boxStart: null,     // 框选起点（图像坐标）
        boxCur: null,
        edgePts: null,      // 当前 mask 的边缘点（图像坐标），供蚁行线动画
        maskData: null,     // 当前 mask 的 Uint8（0/255），图像尺寸，供导出
        antsRAF: null,
        antsPhase: 0,
        objectUrls: new Set()
    };

    // ---------- 上传 ----------
    upload.addEventListener('click', () => fileInput.click());
    upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
    upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
    upload.addEventListener('drop', (e) => {
        e.preventDefault(); upload.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) handleFile(f);
    });
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    // ---------- 模式切换 ----------
    $('#samMode').addEventListener('click', (e) => {
        const b = e.target.closest('.bg-seg-btn');
        if (!b) return;
        $('#samMode').querySelectorAll('.bg-seg-btn').forEach(x => x.classList.toggle('active', x === b));
        S.mode = b.dataset.m;
        setHint();
    });

    $('#samCycle').addEventListener('click', cycleCandidate);
    $('#samClear').addEventListener('click', clearSelection);
    $('#samReset').addEventListener('click', resetAll);
    $('#samExport').addEventListener('click', exportCutout);

    // ---------- 画布交互 ----------
    ants.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    S._onDown = onDown; S._onMove = onMove; S._onUp = onUp;

    function setStat(t) { $('#samStat').innerHTML = t; }
    function setHint() {
        $('#samHint').textContent = S.mode === 'box'
            ? '拖拽框住整个目标物体（如整个人），松手即分割。结果不对时点「切换候选」换粒度。'
            : '在物体上点一下即分割，点物体中心效果最好。结果不对时点「切换候选」换粒度。';
    }
    function showProg(show, pct = 0, text = '') {
        $('#samProg').classList.toggle('hidden', !show);
        if (show) { $('#samProgFill').style.width = pct + '%'; $('#samProgText').textContent = text; }
    }

    async function handleFile(file) {
        const url = trackUrl(URL.createObjectURL(file));
        const im = new Image();
        im.onload = async () => {
            const canvas = downscale(im, MAX_DIM);
            S.img = canvas;
            upload.classList.add('hidden');
            editor.classList.remove('hidden');
            layout();
            clearSelection();
            setHint();
            await encodeImage(canvas);
        };
        im.onerror = () => alert('图片加载失败');
        im.src = url;
    }

    // 编码：加载库/模型（首次）→ 计算图像 embedding（每图一次）
    async function encodeImage(canvas) {
        try {
            setStat('加载模型中…');
            showProg(true, 0, '首次需下载模型，请稍候…');
            const t0 = performance.now();
            await ensureModel((pct, text) => showProg(true, pct, text));
            const t1 = performance.now();

            setStat('编码图像中…');
            const { RawImage } = tf;
            S.rawImage = await RawImage.fromCanvas(canvas);
            const inputs = await samProcessor(S.rawImage);
            S._inputs = inputs;
            S.embeddings = await samModel.get_image_embeddings(inputs);
            const t2 = performance.now();

            showProg(false);
            const enc = Math.round(t2 - t1);
            const load = Math.round(t1 - t0);
            setStat(`就绪 · 模型加载 ${load}ms · 编码 ${enc}ms · 设备 ${S.device}`);
            log(`load=${load}ms encode=${enc}ms device=${S.device}`);
        } catch (err) {
            console.error(err);
            showProg(false);
            setStat('❌ 失败：' + err.message);
            $('#samHint').textContent = '可能原因：模型 404 / 浏览器不支持 WebGPU/WASM / 网络问题。详见控制台。';
        }
    }

    // ---------- 交互坐标 ----------
    function localImgPt(e) {
        const r = ants.getBoundingClientRect();
        return { x: (e.clientX - r.left) / S.fit, y: (e.clientY - r.top) / S.fit };
    }

    function onDown(e) {
        if (!S.embeddings || e.button !== 0) return;
        const p = localImgPt(e);
        if (S.mode === 'box') {
            S.drawing = true;
            S.boxStart = p; S.boxCur = p;
        } else {
            // 单点提示：一个前景点（label 1）
            runDecode({ points: [[p.x, p.y]], labels: [1] });
        }
    }
    function onMove(e) {
        if (!S.drawing) return;
        S.boxCur = localImgPt(e);
        drawBoxPreview();
    }
    function onUp() {
        if (!S.drawing) return;
        S.drawing = false;
        const a = S.boxStart, b = S.boxCur;
        if (!a || !b) return;
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        if (x1 - x0 < 4 || y1 - y0 < 4) { clearAnts(); return; }
        // 这个 SlimSAM 导出只有 input_points/input_labels，其 prompt encoder 不支持
        // 框角点（label 2/3）——喂角点会让它把小框的前景/背景搞反。所以框选只用
        // 模型确定支持的前景点：取框中心当 label=1 的前景点。框本身留着给候选排序用
        //（优先框内占比高的 mask），并挡掉占满整图的背景反转。
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        runDecode({
            points: [[cx, cy]],
            labels: [1],
            box: [x0, y0, x1, y1]
        });
    }

    // ---------- 解码：提示 → mask（每次提示一次，应很快）----------
    async function runDecode(prompt) {
        if (!S.embeddings) return;
        try {
            const t0 = performance.now();

            // 坐标缩放/张量构造全交给官方 processor，避免手搓出错。
            // 复用已缓存的 rawImage（processor 会重跑轻量图像预处理，但不碰昂贵的视觉编码器）。
            // 统一走 input_points/input_labels：
            //   - 点选：一个 label=1 的前景点
            //   - 框选：两个角点，左上 label=2、右下 label=3（SAM 的框编码惯例）
            // input_points 形状 [batch, point_batch, nb_points, 2]；input_labels 形状 [batch, point_batch, nb_points]
            const inputs = await samProcessor(S.rawImage, {
                input_points: [[prompt.points]],
                input_labels: [[prompt.labels]]
            });

            // 复用编码结果（image_embeddings / image_positional_embeddings），
            // 把 processor 生成的提示张量喂进去，跳过昂贵的视觉编码。
            const modelInput = { ...S.embeddings };
            if (inputs.input_points) modelInput.input_points = inputs.input_points;
            if (inputs.input_labels) modelInput.input_labels = inputs.input_labels;
            const outputs = await samModel(modelInput);

            const masks = await samProcessor.post_process_masks(
                outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes
            );
            const scores = outputs.iou_scores.data;
            storeCandidates(masks[0], scores, prompt.box || null);
            const t1 = performance.now();
            setStat(`${setStatText()} · 解码 ${Math.round(t1 - t0)}ms`);
            log(`decode=${Math.round(t1 - t0)}ms scores=`, Array.from(scores));
        } catch (err) {
            console.error(err);
            setStat('❌ 解码失败：' + err.message);
        }
    }

    function setStatText() { return $('#samStat').textContent.split(' · 解码')[0]; }

    // maskTensor.dims = [1, num_masks, H, W]。SAM 对一个提示返回多张不同粒度的候选
    // （如：整个人 / 上半身 / 头部）。全部存下，允许手动切换。
    // 选默认候选：
    //   - 点选：IoU 最高（模型自评最准的那张）
    //   - 框选：优先「框内占比」最高的——即 mask 大部分落在框里、几乎不溢出。
    //     这直接治「选到大片背景」：背景 mask 会大量溢出框外，占比低。
    function storeCandidates(maskTensor, scores, box) {
        const dims = maskTensor.dims;               // [1, num, H, W]
        const num = dims[1], H = dims[2], W = dims[3];
        const data = maskTensor.data;
        const plane = H * W;

        // 框（图像坐标）转 mask 网格坐标；mask 尺寸即原图尺寸，与 box 同坐标系，但仍按比例换算以防不一致
        let bx0 = 0, by0 = 0, bx1 = W, by1 = H;
        if (box) {
            const sx = W / S.img.width, sy = H / S.img.height;
            bx0 = Math.max(0, Math.floor(box[0] * sx));
            by0 = Math.max(0, Math.floor(box[1] * sy));
            bx1 = Math.min(W, Math.ceil(box[2] * sx));
            by1 = Math.min(H, Math.ceil(box[3] * sy));
        }

        S.maskW = W; S.maskH = H;
        S.candidates = [];
        for (let m = 0; m < num; m++) {
            const mask = new Uint8Array(plane);
            const base = m * plane;
            let area = 0, inBox = 0;
            for (let y = 0; y < H; y++) {
                const row = y * W;
                const inRowBox = box && y >= by0 && y < by1;
                for (let x = 0; x < W; x++) {
                    const on = data[base + row + x] ? 255 : 0;
                    mask[row + x] = on;
                    if (on) {
                        area++;
                        if (inRowBox && x >= bx0 && x < bx1) inBox++;
                    }
                }
            }
            // containment：mask 有多少比例落在框里（1 = 完全在框内，越低越溢出）
            const containment = area ? inBox / area : 0;
            S.candidates.push({ mask, score: scores[m] ?? 0, area, containment });
        }

        let best = 0;
        if (box) {
            // 框选排序：
            //   - 占满整图（>85%）的几乎必是背景反转，直接踩到最低
            //   - 太小的碎块（<框面积 0.3%）不优先，避免噪点
            //   - 其余按「框内占比」高者优先
            const boxArea = Math.max(1, (bx1 - bx0) * (by1 - by0));
            const rank = (c) => {
                if (c.area / plane > 0.85) return -2;          // 背景反转
                if (c.area / boxArea < 0.003) return -1;        // 碎点
                return c.containment;
            };
            for (let i = 1; i < num; i++) if (rank(S.candidates[i]) > rank(S.candidates[best])) best = i;
        } else {
            // 点选：IoU 最高
            for (let i = 1; i < num; i++) if (S.candidates[i].score > S.candidates[best].score) best = i;
        }
        S.candIdx = best;
        applyCandidate();
        $('#samExport').classList.remove('hidden');
        $('#samCycle').classList.remove('hidden');
        log(`candidates: ` + S.candidates.map((c, i) =>
            `#${i} score=${c.score.toFixed(3)} area=${(c.area / plane * 100).toFixed(1)}% inBox=${(c.containment * 100).toFixed(0)}%`).join('  '));
    }

    // 应用当前选中的候选 mask：更新填充、边缘、状态
    function applyCandidate() {
        const c = S.candidates[S.candIdx];
        S.maskData = c.mask;
        S._fillCanvas = null;
        S.edgePts = extractEdges(c.mask, S.maskW, S.maskH);
        const pct = (c.area / (S.maskW * S.maskH) * 100).toFixed(1);
        $('#samCycle').textContent = `候选 ${S.candIdx + 1}/${S.candidates.length}（占比 ${pct}% · 分 ${c.score.toFixed(2)}）`;
        startAnts();
    }

    function cycleCandidate() {
        if (!S.candidates || !S.candidates.length) return;
        S.candIdx = (S.candIdx + 1) % S.candidates.length;
        applyCandidate();
    }

    // ---------- 蚁行线动画 ----------
    const ANTS_STEP_MS = 140;   // 每 140ms 走一格，越大越慢
    function startAnts() {
        if (S.antsRAF) cancelAnimationFrame(S.antsRAF);
        S._antsLast = 0;
        const loop = (ts) => {
            // 按时间推进相位，与帧率解耦：高刷屏也不会更快闪
            if (ts - S._antsLast >= ANTS_STEP_MS) {
                S.antsPhase = (S.antsPhase + 1) % 8;
                S._antsLast = ts;
                drawAnts();
            }
            S.antsRAF = requestAnimationFrame(loop);
        };
        S.antsRAF = requestAnimationFrame(loop);
    }
    function clearAnts() {
        if (S.antsRAF) { cancelAnimationFrame(S.antsRAF); S.antsRAF = null; }
        const ctx = ants.getContext('2d');
        ctx.clearRect(0, 0, ants.width, ants.height);
    }
    function drawAnts() {
        const dpr = window.devicePixelRatio || 1;
        const ctx = ants.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, ants.width / dpr, ants.height / dpr);
        if (!S.edgePts) return;
        // 半透明填充提示选区
        if (S.maskData) drawMaskFill(ctx);
        // 蚁行线：黑白交替的点，随 phase 移动。
        // 关键：坐标取整对齐像素网格，用 1 CSS 像素实心点——比之前的 1.5 细，
        // 又不会因小数坐标 + 抗锯齿被摊成半透明看不见。
        const f = S.fit, W = S.maskW;
        for (let k = 0; k < S.edgePts.length; k += 2) {
            const idx = S.edgePts[k + 1];
            const px = Math.round((idx % W) * f);
            const py = Math.round(((idx / W) | 0) * f);
            const on = ((S.edgePts[k] + S.antsPhase) >> 1) & 1;
            ctx.fillStyle = on ? '#fff' : '#000';
            ctx.fillRect(px, py, 1, 1);
        }
    }
    function drawMaskFill(ctx) {
        // 用低分辨率覆盖：把 mask 画到离屏再缩放贴上，避免逐像素慢
        const W = S.maskW, H = S.maskH;
        if (!S._fillCanvas) {
            S._fillCanvas = document.createElement('canvas');
            S._fillCanvas.width = W; S._fillCanvas.height = H;
            const fctx = S._fillCanvas.getContext('2d');
            const id = fctx.createImageData(W, H);
            for (let i = 0; i < W * H; i++) {
                if (S.maskData[i]) {
                    id.data[i * 4] = 74; id.data[i * 4 + 1] = 158; id.data[i * 4 + 2] = 255;
                    id.data[i * 4 + 3] = 90;
                }
            }
            fctx.putImageData(id, 0, 0);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(S._fillCanvas, 0, 0, W * S.fit, H * S.fit);
    }

    function drawBoxPreview() {
        const dpr = window.devicePixelRatio || 1;
        const ctx = ants.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, ants.width / dpr, ants.height / dpr);
        const a = S.boxStart, b = S.boxCur;
        if (!a || !b) return;
        ctx.strokeStyle = '#4a9eff';
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(a.x * S.fit, a.y * S.fit, (b.x - a.x) * S.fit, (b.y - a.y) * S.fit);
    }

    // ---------- 布局 ----------
    function layout() {
        if (!S.img) return;
        const stage = $('#samStage');
        const availW = Math.min(stage.parentElement.clientWidth || 520, 520);
        const W = S.img.width, H = S.img.height;
        const maxH = 480;
        S.fit = Math.min(availW / W, maxH / H);
        const dispW = Math.round(W * S.fit), dispH = Math.round(H * S.fit);
        stage.style.width = dispW + 'px';
        stage.style.height = dispH + 'px';

        const dpr = window.devicePixelRatio || 1;
        for (const c of [base, ants]) {
            c.width = Math.round(dispW * dpr);
            c.height = Math.round(dispH * dpr);
            c.style.width = dispW + 'px';
            c.style.height = dispH + 'px';
        }
        const bctx = base.getContext('2d');
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bctx.drawImage(S.img, 0, 0, dispW, dispH);
    }

    function clearSelection() {
        S.edgePts = null; S.maskData = null; S._fillCanvas = null;
        S.candidates = null; S.candIdx = 0;
        S.boxStart = S.boxCur = null;
        clearAnts();
        $('#samExport').classList.add('hidden');
        $('#samCycle').classList.add('hidden');
        $('#samDownload').classList.add('hidden');
    }

    // ---------- 导出选区为透明 PNG ----------
    function exportCutout() {
        if (!S.maskData || !S.img) return;
        const W = S.maskW, H = S.maskH;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(S.img, 0, 0, W, H);
        const id = ctx.getImageData(0, 0, W, H);
        for (let i = 0; i < W * H; i++) {
            if (!S.maskData[i]) id.data[i * 4 + 3] = 0; // 选区外透明
        }
        ctx.putImageData(id, 0, 0);
        c.toBlob((blob) => {
            const url = trackUrl(URL.createObjectURL(blob));
            const dl = $('#samDownload');
            dl.href = url;
            dl.classList.remove('hidden');
            dl.textContent = '下载透明 PNG ✓';
        }, 'image/png');
    }

    function resetAll() {
        clearSelection();
        S.img = null; S.rawImage = null; S.embeddings = null; S._inputs = null;
        fileInput.value = '';
        revokeUrls();
        editor.classList.add('hidden');
        upload.classList.remove('hidden');
    }

    function trackUrl(u) { S.objectUrls.add(u); return u; }
    function revokeUrls() { for (const u of S.objectUrls) URL.revokeObjectURL(u); S.objectUrls.clear(); }
    S._revokeUrls = revokeUrls;

    window.addEventListener('resize', layout);
    S._onResize = layout;
}

// 加载 transformers.js + SlimSAM（模块级缓存，只跑一次）。
// onProgress(pct, text)：把库的下载进度透出到 UI。
async function ensureModel(onProgress) {
    if (samModel && samProcessor) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        tf = await import(TF_CDN);
        const { SamModel, AutoProcessor, env } = tf;

        // 允许远程加载 hub 模型；关掉本地路径查找
        env.allowLocalModels = false;
        // huggingface.co 国内不可达 → 换镜像站下模型权重
        env.remoteHost = HF_MIRROR;
        // 关掉浏览器缓存里的本地库查找，强制走 remoteHost
        if (env.backends?.onnx?.wasm) {
            // WASM 后端文件走 jsdelivr（与库同源，国内可达）
            env.backends.onnx.wasm.wasmPaths =
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/';
        }

        // 优先 WebGPU，不支持则回退 WASM
        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
        S.device = hasWebGPU ? 'webgpu' : 'wasm';
        const dtype = hasWebGPU ? 'fp16' : 'fp32';

        const progress_callback = (p) => {
            if (p.status === 'progress' && p.total) {
                const pct = Math.round((p.loaded / p.total) * 100);
                onProgress(pct, `下载 ${p.file || '模型'} ${pct}%`);
            } else if (p.status === 'done') {
                onProgress(100, '模型就绪，编码中…');
            }
        };

        log('device=', S.device, 'dtype=', dtype);
        samModel = await SamModel.from_pretrained(MODEL_ID, { dtype, device: S.device, progress_callback });
        samProcessor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
    })();

    try {
        await loadPromise;
    } catch (e) {
        loadPromise = null; // 失败后允许重试
        throw e;
    }
}

// 长边降到 maxDim，返回 canvas（保留 width/height 供直接使用）
function downscale(img, maxDim) {
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    const ratio = maxSide > maxDim ? maxDim / maxSide : 1;
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
}

// 提取 mask 边缘点：某像素为前景且四邻域有背景 → 边缘。
// 返回扁平数组 [order0, idx0, order1, idx1, ...]，order 供蚁行线相位错开。
function extractEdges(mask, W, H) {
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

export function unmount() {
    if (S) {
        if (S.antsRAF) cancelAnimationFrame(S.antsRAF);
        if (S._onMove) window.removeEventListener('mousemove', S._onMove);
        if (S._onUp) window.removeEventListener('mouseup', S._onUp);
        if (S._onResize) window.removeEventListener('resize', S._onResize);
        if (S._revokeUrls) S._revokeUrls();
        S = null;
    }
    // 库与模型保留缓存，切回工具不必重下
}


