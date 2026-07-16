/**
 * 抠图合成：把 imgly 的 foreground 结果、原图、用户画的框、边缘精修组合成最终 ImageData
 *
 * 这里全是纯函数，不碰 DOM，方便复用与测试。
 * 坐标约定：boxes 里的 x/y/w/h 都是「原图像素坐标」，与 foreground 尺寸一致。
 *
 * 框类型：
 *   - protect（保护框）：框内 alpha 强制拉满，救回被误切的区域（如深色丝袜/腿）
 *   - subject（主体框）：只要存在至少一个主体框，所有主体框之外的 alpha 归零
 */

/**
 * 由 imgly 的 foreground 结果 + 原图 + 用户框，生成最终 ImageData。
 *
 * 关键：base 用 imgly 已经处理好的 foreground（RGB 已去色边、alpha 已硬化），
 * 这与最初版本一致，保证抠图质量。框选和精修只在它之上做后处理。
 *
 * @param {ImageData} fgData    imgly foreground 输出（RGBA，alpha 即抠图结果）
 * @param {ImageData} srcData   原图像素（RGBA），仅用于保护框恢复原始像素
 * @param {Array} boxes         [{ type:'protect'|'subject', x, y, w, h }]，原图像素坐标
 * @param {Object} options      { refineEdge }
 * @returns {ImageData}
 */
export function composeResult(fgData, srcData, boxes, options = {}) {
    const { refineEdge = false } = options;
    const w = fgData.width;
    const h = fgData.height;
    const fg = fgData.data;
    const src = srcData.data;

    // 输出先拷贝一份 foreground（RGB + alpha 都用 imgly 的）
    const out = new ImageData(w, h);
    const outData = out.data;
    outData.set(fg);

    // alpha 单独抽出来做区域运算，最后写回
    let alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = fg[i * 4 + 3];

    // 1. 主体框：若存在，框外 alpha 归零
    const subjectBoxes = boxes.filter(b => b.type === 'subject');
    if (subjectBoxes.length > 0) {
        const keep = new Uint8Array(w * h);
        for (const b of subjectBoxes) markRegion(keep, w, h, b, 1);
        for (let i = 0; i < w * h; i++) {
            if (keep[i] === 0) alpha[i] = 0;
        }
    }

    // 2. 保护框：框内 alpha 拉满，且 RGB 用原图恢复
    //    （foreground 在被切掉处的 RGB 可能是透明黑，直接留会发黑边）
    const protectBoxes = boxes.filter(b => b.type === 'protect');
    for (const b of protectBoxes) {
        restoreRegion(outData, src, alpha, w, h, b);
    }

    // 3. 边缘精修：收缩 1px 去白边，再羽化柔化锯齿
    if (refineEdge) {
        alpha = erodeAlpha(alpha, w, h, 1);
        alpha = featherAlpha(alpha, w, h, 1);
    }

    // 4. 把处理后的 alpha 写回输出
    for (let i = 0; i < w * h; i++) {
        outData[i * 4 + 3] = alpha[i];
    }
    return out;
}

// 保护框：框内 RGB 用原图恢复、alpha 拉满
function restoreBox(outData, src, alpha, w, h, box) {
    const { x0, y0, x1, y1 } = clampBox(box, w, h);
    for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
            const i = row + x;
            const p = i * 4;
            outData[p] = src[p];
            outData[p + 1] = src[p + 1];
            outData[p + 2] = src[p + 2];
            alpha[i] = 255;
        }
    }
}

// 把矩形区域在标记数组里置为 value（用于主体框「保留」标记）
function markBox(arr, w, h, box, value) {
    const { x0, y0, x1, y1 } = clampBox(box, w, h);
    for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
            arr[row + x] = value;
        }
    }
}

// ---------- 区域分发：矩形走 box 版，多边形走 poly 版 ----------

// 恢复区域：RGB 用原图、alpha 拉满（保护框/保护多边形通用）
function restoreRegion(outData, src, alpha, w, h, region) {
    if (region.shape === 'polygon') restorePoly(outData, src, alpha, w, h, region);
    else restoreBox(outData, src, alpha, w, h, region);
}

// 标记区域为 value（主体框/主体多边形通用）
function markRegion(arr, w, h, region, value) {
    if (region.shape === 'polygon') markPoly(arr, w, h, region, value);
    else markBox(arr, w, h, region, value);
}

// 多边形保护：多边形内 RGB 用原图恢复、alpha 拉满
function restorePoly(outData, src, alpha, w, h, poly) {
    forEachPixelInPoly(poly.points, w, h, (i) => {
        const p = i * 4;
        outData[p] = src[p];
        outData[p + 1] = src[p + 1];
        outData[p + 2] = src[p + 2];
        alpha[i] = 255;
    });
}

// 多边形标记：多边形内置为 value
function markPoly(arr, w, h, poly, value) {
    forEachPixelInPoly(poly.points, w, h, (i) => { arr[i] = value; });
}

// 扫描线填充：遍历多边形内所有像素，对每个像素索引 i 调 cb(i)
// points 为原图像素坐标 [{x,y},...]，与图像尺寸一致
function forEachPixelInPoly(points, w, h, cb) {
    const n = points.length;
    if (n < 3) return;

    // 计算 y 范围并裁剪到图像内
    let minY = Infinity, maxY = -Infinity;
    for (const pt of points) {
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
    }
    const y0 = Math.max(0, Math.ceil(minY));
    const y1 = Math.min(h - 1, Math.floor(maxY));

    for (let y = y0; y <= y1; y++) {
        // 求该扫描线与各边的交点 x
        const xs = [];
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const yi = points[i].y, yj = points[j].y;
            const xi = points[i].x, xj = points[j].x;
            // 边跨过当前扫描线（半开区间避免顶点重复计数）
            if ((yi > y) !== (yj > y)) {
                const t = (y - yi) / (yj - yi);
                xs.push(xi + t * (xj - xi));
            }
        }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        // 交点成对，区间内填充
        for (let k = 0; k + 1 < xs.length; k += 2) {
            let xa = Math.max(0, Math.ceil(xs[k]));
            let xb = Math.min(w - 1, Math.floor(xs[k + 1]));
            const row = y * w;
            for (let x = xa; x <= xb; x++) cb(row + x);
        }
    }
}

// 归一化并裁剪框到图像边界内，返回整数像素范围 [x0,x1) [y0,y1)
function clampBox(box, w, h) {
    let x0 = Math.round(box.x);
    let y0 = Math.round(box.y);
    let x1 = Math.round(box.x + box.w);
    let y1 = Math.round(box.y + box.h);
    // 允许负宽高（拖拽方向反了）
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    x0 = Math.max(0, Math.min(w, x0));
    y0 = Math.max(0, Math.min(h, y0));
    x1 = Math.max(0, Math.min(w, x1));
    y1 = Math.max(0, Math.min(h, y1));
    return { x0, y0, x1, y1 };
}

// 形态学收缩：alpha 边缘向内缩 radius 像素，去掉抠图残留的浅色描边
function erodeAlpha(alpha, w, h, radius) {
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (alpha[i] === 0) { out[i] = 0; continue; }
            let minV = alpha[i];
            for (let dy = -radius; dy <= radius && minV > 0; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= w) continue;
                    const v = alpha[ny * w + nx];
                    if (v < minV) minV = v;
                    if (minV === 0) break;
                }
            }
            out[i] = minV;
        }
    }
    return out;
}

// 盒式模糊羽化 alpha，柔化边缘锯齿（半径小，够用即可）
function featherAlpha(alpha, w, h, radius) {
    // 先横向再纵向的可分离盒式模糊，O(n)
    const tmp = new Uint8ClampedArray(w * h);
    const out = new Uint8ClampedArray(w * h);
    const size = radius * 2 + 1;

    // 横向
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let x = -radius; x <= radius; x++) {
            sum += alpha[row + clamp(x, 0, w - 1)];
        }
        for (let x = 0; x < w; x++) {
            tmp[row + x] = sum / size;
            const outIdx = clamp(x - radius, 0, w - 1);
            const inIdx = clamp(x + radius + 1, 0, w - 1);
            sum += alpha[row + inIdx] - alpha[row + outIdx];
        }
    }
    // 纵向
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) {
            sum += tmp[clamp(y, 0, h - 1) * w + x];
        }
        for (let y = 0; y < h; y++) {
            out[y * w + x] = sum / size;
            const outIdx = clamp(y - radius, 0, h - 1);
            const inIdx = clamp(y + radius + 1, 0, h - 1);
            sum += tmp[inIdx * w + x] - tmp[outIdx * w + x];
        }
    }
    return out;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * 由 SAM mask + 原图 + 用户框，生成最终 ImageData。
 * SAM mask 作为 alpha（0/255），原图 RGB 作为前景。
 *
 * @param {Uint8Array} samMask    SAM 生成的 mask（0/255），原图尺寸
 * @param {ImageData} srcData     原图像素（RGBA）
 * @param {Array} boxes           [{ type:'protect'|'subject', x, y, w, h }]，原图像素坐标
 * @param {Object} options        { refineEdge }
 * @returns {ImageData}
 */
export function composeFromSamMask(samMask, srcData, boxes, options = {}) {
    const { refineEdge = false } = options;
    const w = srcData.width;
    const h = srcData.height;
    const src = srcData.data;

    // 输出：RGB 用原图，alpha 用 SAM mask
    const out = new ImageData(w, h);
    const outData = out.data;

    // 拷贝原图 RGB
    for (let i = 0; i < w * h; i++) {
        outData[i * 4] = src[i * 4];
        outData[i * 4 + 1] = src[i * 4 + 1];
        outData[i * 4 + 2] = src[i * 4 + 2];
    }

    // alpha 用 SAM mask
    let alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
        alpha[i] = samMask[i] || 0;
    }

    // 1. 主体框：若存在，框外 alpha 归零
    const subjectBoxes = boxes.filter(b => b.type === 'subject');
    if (subjectBoxes.length > 0) {
        const keep = new Uint8Array(w * h);
        for (const b of subjectBoxes) markRegion(keep, w, h, b, 1);
        for (let i = 0; i < w * h; i++) {
            if (keep[i] === 0) alpha[i] = 0;
        }
    }

    // 2. 保护框：框内 alpha 拉满，且 RGB 用原图恢复
    const protectBoxes = boxes.filter(b => b.type === 'protect');
    for (const b of protectBoxes) {
        restoreRegion(outData, src, alpha, w, h, b);
    }

    // 3. 边缘精修：收缩 1px 去白边，再羽化柔化锯齿
    if (refineEdge) {
        alpha = erodeAlpha(alpha, w, h, 1);
        alpha = featherAlpha(alpha, w, h, 1);
    }

    // 4. 把处理后的 alpha 写回输出
    for (let i = 0; i < w * h; i++) {
        outData[i * 4 + 3] = alpha[i];
    }
    return out;
}
