/**
 * SAM 核心模块 —— 模型加载、编码、解码
 *
 * 从 sam-poc.js 抽取，供 AI 抠图（bg-remove）和 SAM POC 共用。
 * 模型：Xenova/slimsam-77-uniform（SlimSAM 剪枝版）
 * 库：@huggingface/transformers v3（CDN）
 *
 * 用法：
 *   const sam = await getSamCore(onProgress);
 *   const embeddings = await sam.encode(canvas);
 *   const candidates = await sam.decode(embeddings, rawImage, prompt);
 */

const TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm';
const MODEL_ID = 'Xenova/slimsam-77-uniform';

// 按运行环境选择模型源：
// - 本地（localhost / 127.0.0.1 / 局域网 IP / file 协议）：中国网络下 huggingface.co 访问困难，
//   走 hf-mirror.com 镜像（同源本地页面不受镜像缺失 CORS 头的影响）。
// - 线上（GitHub Pages 等跨域）：hf-mirror.com 未设置 Access-Control-Allow-Origin，会被 CORS 拦截，
//   必须走支持 CORS 的官方域名 huggingface.co。
function resolveRemoteHost() {
    if (typeof location === 'undefined') return 'https://huggingface.co';
    const h = location.hostname;
    const isLocal =
        location.protocol === 'file:' ||
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h === '::1' ||
        h === '' ||
        /^192\.168\./.test(h) ||
        /^10\./.test(h) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    return isLocal ? 'https://hf-mirror.com' : 'https://huggingface.co';
}

const HF_MIRROR = resolveRemoteHost();

// 模块级单例
let tf = null;
let samModel = null;
let samProcessor = null;
let loadPromise = null;

export async function getSamCore(onProgress = () => {}) {
    if (samModel && samProcessor) return { tf, samModel, samProcessor };
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        tf = await import(TF_CDN);
        const { SamModel, AutoProcessor, env } = tf;

        env.allowLocalModels = false;
        env.remoteHost = HF_MIRROR;
        if (env.backends?.onnx?.wasm) {
            env.backends.onnx.wasm.wasmPaths =
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/';
        }

        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
        const device = hasWebGPU ? 'webgpu' : 'wasm';
        const dtype = hasWebGPU ? 'fp16' : 'fp32';

        const progress_callback = (p) => {
            if (p.status === 'progress' && p.total) {
                const pct = Math.round((p.loaded / p.total) * 100);
                onProgress(pct, `下载 ${p.file || '模型'} ${pct}%`);
            } else if (p.status === 'done') {
                onProgress(100, '模型就绪');
            }
        };

        console.log('[SAM] device=', device, 'dtype=', dtype, 'remoteHost=', HF_MIRROR);
        samModel = await SamModel.from_pretrained(MODEL_ID, { dtype, device, progress_callback });
        samProcessor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });

        return { tf, samModel, samProcessor, device };
    })();

    try {
        return await loadPromise;
    } catch (e) {
        loadPromise = null;
        throw e;
    }
}

/**
 * 编码图像：计算 image embeddings（每图一次，较耗时）
 * @param {HTMLCanvasElement} canvas - 降采样后的图像 canvas
 * @returns {{ embeddings, rawImage, inputs }}
 */
export async function encodeImage(canvas) {
    const { tf, samModel, samProcessor } = await getSamCore();
    const { RawImage } = tf;

    const rawImage = await RawImage.fromCanvas(canvas);
    const inputs = await samProcessor(rawImage);
    const embeddings = await samModel.get_image_embeddings(inputs);

    return { embeddings, rawImage, inputs };
}

/**
 * 解码：根据提示（点/框）生成 mask 候选
 * @param {{ embeddings, rawImage }} encoded - encodeImage 的返回值
 * @param {{ points: [[x,y]], labels: [number], box?: [x0,y0,x1,y1] }} prompt
 * @returns {{ candidates: Array<{mask: Uint8Array, score: number, area: number, containment: number}>, W: number, H: number }}
 */
export async function decodePrompt(encoded, prompt) {
    const { samModel, samProcessor } = await getSamCore();
    const { embeddings, rawImage } = encoded;

    const inputs = await samProcessor(rawImage, {
        input_points: [[prompt.points]],
        input_labels: [[prompt.labels]]
    });

    const modelInput = { ...embeddings };
    if (inputs.input_points) modelInput.input_points = inputs.input_points;
    if (inputs.input_labels) modelInput.input_labels = inputs.input_labels;
    const outputs = await samModel(modelInput);

    const masks = await samProcessor.post_process_masks(
        outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes
    );
    const scores = outputs.iou_scores.data;

    return storeCandidates(masks[0], scores, prompt.box || null);
}

/**
 * 解析 mask 张量，生成候选列表
 */
function storeCandidates(maskTensor, scores, box) {
    const dims = maskTensor.dims;
    const num = dims[1], H = dims[2], W = dims[3];
    const data = maskTensor.data;
    const plane = H * W;

    let bx0 = 0, by0 = 0, bx1 = W, by1 = H;
    if (box) {
        // box 是图像坐标，需要映射到 mask 坐标
        // mask 尺寸 = 降采样后的图像尺寸，与 box 同坐标系
        const sx = W / (box._imgW || W);
        const sy = H / (box._imgH || H);
        bx0 = Math.max(0, Math.floor(box[0] * sx));
        by0 = Math.max(0, Math.floor(box[1] * sy));
        bx1 = Math.min(W, Math.ceil(box[2] * sx));
        by1 = Math.min(H, Math.ceil(box[3] * sy));
    }

    const candidates = [];
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
        const containment = area ? inBox / area : 0;
        candidates.push({ mask, score: scores[m] ?? 0, area, containment });
    }

    // 选最佳候选
    let best = 0;
    if (box) {
        // 框选排序：优先框内占比高的
        const boxArea = Math.max(1, (bx1 - bx0) * (by1 - by0));
        const rank = (c) => {
            if (c.area / plane > 0.85) return -2;          // 背景反转
            if (c.area / boxArea < 0.003) return -1;        // 碎点
            return c.containment;
        };
        for (let i = 1; i < num; i++) {
            if (rank(candidates[i]) > rank(candidates[best])) best = i;
        }
    } else {
        // 点选排序：优先 IoU 分数高的（模型自评最准）
        for (let i = 1; i < num; i++) {
            if (candidates[i].score > candidates[best].score) best = i;
        }
    }

    return { candidates, bestIdx: best, W, H };
}

/**
 * 将 mask 缩放到目标尺寸（双线性插值）
 * @param {Uint8Array} mask - 原始 mask (0/255)
 * @param {number} srcW - 原始宽度
 * @param {number} srcH - 原始高度
 * @param {number} dstW - 目标宽度
 * @param {number} dstH - 目标高度
 * @returns {Uint8Array}
 */
export function resizeMask(mask, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) return mask;

    const out = new Uint8Array(dstW * dstH);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
        const srcY = Math.min(y * yRatio, srcH - 1);
        const y0 = Math.floor(srcY);
        const y1 = Math.min(y0 + 1, srcH - 1);
        const yFrac = srcY - y0;

        for (let x = 0; x < dstW; x++) {
            const srcX = Math.min(x * xRatio, srcW - 1);
            const x0 = Math.floor(srcX);
            const x1 = Math.min(x0 + 1, srcW - 1);
            const xFrac = srcX - x0;

            // 双线性插值
            const v00 = mask[y0 * srcW + x0];
            const v01 = mask[y0 * srcW + x1];
            const v10 = mask[y1 * srcW + x0];
            const v11 = mask[y1 * srcW + x1];

            const v = v00 * (1 - xFrac) * (1 - yFrac)
                    + v01 * xFrac * (1 - yFrac)
                    + v10 * (1 - xFrac) * yFrac
                    + v11 * xFrac * yFrac;

            out[y * dstW + x] = v >= 128 ? 255 : 0;
        }
    }
    return out;
}

/**
 * 重置模型缓存（用于调试或释放内存）
 */
export function resetSamCore() {
    samModel = null;
    samProcessor = null;
    tf = null;
    loadPromise = null;
}