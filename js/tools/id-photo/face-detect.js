/**
 * 人脸检测模块
 * 用 @mediapipe/tasks-vision 的 FaceDetector 在浏览器本地检测人脸，图片不上传。
 * 供证件照工具在上传后自动定位头部使用。
 *
 * 加载失败（无网络 / 不支持 WASM）时抛错，调用方应降级为手动定位。
 */

const VISION_VER = '0.10.18';
const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VER}`;
const WASM_ROOT = `${VISION_CDN}/wasm`;
// BlazeFace 短距模型，适合证件照这类近距离单人脸
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detector = null;
let loadPromise = null;

/**
 * 确保 FaceDetector 已初始化
 * @returns {Promise<Object>} FaceDetector 实例
 */
export async function ensureDetector() {
    if (detector) return detector;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const { FaceDetector, FilesetResolver } = await import(VISION_CDN);
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL },
            runningMode: 'IMAGE',
        });
        return detector;
    })();
    return loadPromise;
}

/**
 * 检测图像中最主要的人脸
 * @param {HTMLImageElement|HTMLCanvasElement|ImageData} source - 输入图像
 * @returns {Promise<{x, y, width, height}|null>} 人脸包围盒（像素，相对原图），无脸返回 null
 */
export async function detectFace(source) {
    const det = await ensureDetector();

    // MediaPipe 接受 HTMLImageElement/Canvas/ImageBitmap；ImageData 先转 canvas
    let input = source;
    if (source instanceof ImageData) {
        const c = document.createElement('canvas');
        c.width = source.width;
        c.height = source.height;
        c.getContext('2d').putImageData(source, 0, 0);
        input = c;
    }

    const result = det.detect(input);
    if (!result || !result.detections || result.detections.length === 0) return null;

    // 取面积最大的人脸（证件照通常单人，选最主要的）
    let best = null;
    let bestArea = 0;
    for (const d of result.detections) {
        const bb = d.boundingBox;
        if (!bb) continue;
        const area = bb.width * bb.height;
        if (area > bestArea) {
            bestArea = area;
            best = bb;
        }
    }
    if (!best) return null;

    return {
        x: best.originX,
        y: best.originY,
        width: best.width,
        height: best.height,
    };
}

/**
 * 释放检测器（unmount 时清理）
 */
export function resetDetector() {
    if (detector && typeof detector.close === 'function') {
        try { detector.close(); } catch (_) { /* 忽略 */ }
    }
    detector = null;
    loadPromise = null;
}
