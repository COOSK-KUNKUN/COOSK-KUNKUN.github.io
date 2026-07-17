/**
 * 证件照排版打印模块
 * 将多张证件照排列在指定纸张上，生成可打印的图片
 */

import { PAPER_SIZES } from './sizes.js';

/**
 * 计算在纸张上最多能放多少张证件照
 * @param {number} paperWidth - 纸张宽度（像素）
 * @param {number} paperHeight - 纸张高度（像素）
 * @param {number} photoWidth - 证件照宽度（像素）
 * @param {number} photoHeight - 证件照高度（像素）
 * @param {number} gap - 间距（像素）
 * @returns {{ cols: number, rows: number, count: number }}
 */
export function calcLayout(paperWidth, paperHeight, photoWidth, photoHeight, gap = 20) {
    const cols = Math.floor((paperWidth + gap) / (photoWidth + gap));
    const rows = Math.floor((paperHeight + gap) / (photoHeight + gap));
    return {
        cols,
        rows,
        count: cols * rows
    };
}

/**
 * 生成排版后的图片
 * @param {Blob|ImageData} photoData - 单张证件照
 * @param {number} photoWidth - 证件照宽度
 * @param {number} photoHeight - 证件照高度
 * @param {string} paperId - 纸张 ID（'4R' | 'A4' | 'A3'）
 * @param {number} count - 要排列的数量（0 = 自动最大）
 * @param {number} gap - 间距（像素）
 * @returns {Promise<{ blob: Blob, count: number, cols: number, rows: number }>}
 */
export async function generateLayout(photoData, photoWidth, photoHeight, paperId = '4R', count = 0, gap = 20) {
    const paper = PAPER_SIZES[paperId];
    if (!paper) throw new Error('无效的纸张尺寸');
    
    const { cols, rows, count: maxCount } = calcLayout(
        paper.width, paper.height,
        photoWidth, photoHeight,
        gap
    );
    
    const actualCount = count > 0 ? Math.min(count, maxCount) : maxCount;
    
    // 创建纸张 canvas
    const canvas = document.createElement('canvas');
    canvas.width = paper.width;
    canvas.height = paper.height;
    const ctx = canvas.getContext('2d');
    
    // 白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, paper.width, paper.height);
    
    // 加载证件照
    let photoImg;
    if (photoData instanceof Blob) {
        photoImg = await blobToImage(photoData);
    } else if (photoData instanceof ImageData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = photoData.width;
        tempCanvas.height = photoData.height;
        tempCanvas.getContext('2d').putImageData(photoData, 0, 0);
        photoImg = await new Promise((resolve, reject) => {
            const url = tempCanvas.toDataURL();
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    } else {
        throw new Error('无效的证件照数据');
    }
    
    // 计算居中偏移
    const totalW = cols * photoWidth + (cols - 1) * gap;
    const totalH = rows * photoHeight + (rows - 1) * gap;
    const offsetX = (paper.width - totalW) / 2;
    const offsetY = (paper.height - totalH) / 2;
    
    // 绘制裁剪线（浅灰色虚线）
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    for (let i = 0; i < actualCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = offsetX + col * (photoWidth + gap);
        const y = offsetY + row * (photoHeight + gap);
        
        // 绘制证件照
        ctx.drawImage(photoImg, x, y, photoWidth, photoHeight);
        
        // 绘制裁剪线
        ctx.strokeRect(x - 1, y - 1, photoWidth + 2, photoHeight + 2);
    }
    
    ctx.setLineDash([]);
    
    // 导出为 Blob
    const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
    
    return {
        blob,
        count: actualCount,
        cols,
        rows,
        width: paper.width,
        height: paper.height
    };
}

/**
 * 生成预览用的缩略图
 */
export async function generateLayoutPreview(photoData, photoWidth, photoHeight, paperId = '4R', count = 0, gap = 20) {
    const result = await generateLayout(photoData, photoWidth, photoHeight, paperId, count, gap);
    
    // 缩放到适合预览的尺寸
    const maxPreviewWidth = 600;
    const scale = Math.min(1, maxPreviewWidth / result.width);
    
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = Math.round(result.width * scale);
    previewCanvas.height = Math.round(result.height * scale);
    
    const previewImg = await blobToImage(result.blob);
    previewCanvas.getContext('2d').drawImage(
        previewImg,
        0, 0,
        previewCanvas.width, previewCanvas.height
    );
    
    return new Promise(resolve => {
        previewCanvas.toBlob(blob => {
            resolve({
                blob,
                url: URL.createObjectURL(blob),
                ...result
            });
        }, 'image/jpeg', 0.9);
    });
}

function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = reject;
        img.src = url;
    });
}