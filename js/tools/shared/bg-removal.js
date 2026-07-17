/**
 * 共享的 AI 去背景模块
 * 使用 @imgly/background-removal 在浏览器本地处理，图片不上传。
 * 供 bg-remove.js 和 id-photo.js 复用。
 */

const IMGLY_CDN = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
const MAX_DIM = 2048; // 最长边超过则降采样，防止大图爆内存

let removeBackgroundFn = null;
let loadPromise = null;

/**
 * 确保 AI 库已加载
 * @returns {Promise<Function>} removeBackground 函数
 */
export async function ensureLibLoaded() {
    if (removeBackgroundFn) return removeBackgroundFn;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const module = await import(IMGLY_CDN);
        removeBackgroundFn = module.removeBackground;
        return removeBackgroundFn;
    })();
    return loadPromise;
}

/**
 * 运行去背景，返回 foreground ImageData（RGBA，alpha 即透明通道）
 * @param {HTMLImageElement|HTMLCanvasElement} img - 输入图像
 * @param {string} model - 模型名称：'isnet' | 'isnet_fp16' | 'isnet_quint8'
 * @param {Function} onProgress - 进度回调 (pct, text) => void
 * @returns {Promise<ImageData>} 与原图同尺寸的 foreground ImageData
 */
export async function runForeground(img, model, onProgress) {
    const removeBackground = await ensureLibLoaded();
    
    // 把图像转成 blob 交给库，确保输出尺寸一致
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.naturalWidth;
    srcCanvas.height = img.naturalHeight;
    srcCanvas.getContext('2d').drawImage(img, 0, 0);
    const srcBlob = await new Promise(res => srcCanvas.toBlob(res, 'image/png'));

    const fgBlob = await removeBackground(srcBlob, {
        model,
        output: { format: 'image/png' },
        progress: (key, current, total) => {
            if (onProgress) {
                const pct = total ? Math.round((current / total) * 100) : 0;
                const label = key && key.includes('fetch') ? '模型启动中…' : '图片处理中…';
                onProgress(pct, `${label} ${pct}%`);
            }
        }
    });

    // foreground blob → ImageData（缩放到原图尺寸）
    const fgImg = await blobToImage(fgBlob);
    const fc = document.createElement('canvas');
    fc.width = img.naturalWidth;
    fc.height = img.naturalHeight;
    const fctx = fc.getContext('2d');
    fctx.drawImage(fgImg, 0, 0, fc.width, fc.height);
    return fctx.getImageData(0, 0, fc.width, fc.height);
}

/**
 * 最长边超过 MAX_DIM 则等比缩小
 * @param {HTMLImageElement} img
 * @returns {{ image: HTMLImageElement|HTMLCanvasElement, downscaled: boolean }}
 */
export function maybeDownscale(img) {
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (maxSide <= MAX_DIM) return { image: img, downscaled: false };

    const ratio = MAX_DIM / maxSide;
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);

    // 给 canvas 补上 naturalWidth/naturalHeight 属性
    Object.defineProperty(c, 'naturalWidth', { value: c.width, configurable: true });
    Object.defineProperty(c, 'naturalHeight', { value: c.height, configurable: true });
    return { image: c, downscaled: true };
}

/**
 * 把 image/canvas 画到离屏 canvas 取 ImageData
 */
export function imageToData(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
}

/**
 * Blob 转 Image
 */
export function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => {
            URL.revokeObjectURL(url);
            resolve(im);
        };
        im.onerror = reject;
        im.src = url;
    });
}

/**
 * 重置模块状态（用于 unmount 时清理）
 */
export function resetState() {
    removeBackgroundFn = null;
    loadPromise = null;
}