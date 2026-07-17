/**
 * 证件照裁剪编辑器
 * 在 Canvas 上显示去背景后的图像，支持拖拽、缩放，按证件照尺寸裁剪
 */

export class IdPhotoEditor {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // 回调
        this.onChange = options.onChange || (() => {});
        
        // 状态
        this.img = null;           // 去背景后的图像（ImageData 或 HTMLImageElement）
        this.imgData = null;       // 原始 ImageData（用于重绘）
        this.targetSize = null;    // 目标尺寸 { width, height }
        this.bgColor = null;       // 当前底色（null = 显示透明棋盘格）
        this.guide = null;         // 构图参考 { headTop, headHeight }，null = 不显示
        this.showGuide = false;    // 是否显示参考线（默认不显示）
        this.faceBox = null;       // 检测到的人脸框（原图坐标），供合规检测
        
        // 变换参数
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        
        // 拖拽状态
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartOffsetX = 0;
        this.dragStartOffsetY = 0;
        
        // 画布显示参数
        this.displayWidth = 0;
        this.displayHeight = 0;
        this.canvasScale = 1;  // canvas 物理像素 / CSS 像素
        
        this._bindEvents();
    }
    
    /**
     * 设置图像（去背景后的 ImageData）
     */
    setImage(imageData, onReady) {
        this.imgData = imageData;

        // 创建临时 canvas 把 ImageData 转成可绘制的 image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

        const img = new Image();
        img.onload = () => {
            this.img = img;
            this._fitToView();
            this._render();
            this.onChange();
            if (typeof onReady === 'function') onReady();
        };
        img.src = tempCanvas.toDataURL();
    }
    
    /**
     * 设置目标证件照尺寸
     */
    setTargetSize(width, height) {
        this.targetSize = { width, height };
        this._fitToView();
        this._render();
        this.onChange();
    }

    /**
     * 设置底色（编辑态所见即所得）。传 null / 'transparent' 显示棋盘格。
     * @param {string|null} color - 纯色 hex 或 linear-gradient(...)
     */
    setBgColor(color) {
        this.bgColor = (color === 'transparent') ? null : color;
        this._render();
        this.onChange();
    }

    /**
     * 设置构图参考规范 { headTop, headHeight }（比例）。传 null 关闭。
     */
    setGuide(guide) {
        this.guide = guide;
        this._render();
        this.onChange();
    }

    /**
     * 按检测到的人脸框自动定位：缩放+平移，使头部落进参考线。
     * faceBox 为原图像素坐标 { x, y, width, height }（BlazeFace 框≈脸部）。
     * @returns {boolean} 是否成功应用
     */
    fitFaceToGuide(faceBox) {
        if (!this.img || !this.targetSize || !faceBox) return false;
        this.faceBox = faceBox; // 记住，供合规检测用
        const guide = this.guide || { headTop: 0.10, headHeight: 0.65 };
        const targetW = this.targetSize.width;
        const targetH = this.targetSize.height;

        // BlazeFace 框大致覆盖眉到下巴，比“发顶到下巴”的整头矮。
        // 经验系数：整头高 ≈ 人脸框高 / 0.78。
        const FACE_TO_HEAD = 0.78;
        const headPx = faceBox.height / FACE_TO_HEAD;

        // 目标：整头高占裁剪框 headHeight 比例
        const desiredHeadH = targetH * guide.headHeight;
        this.scale = desiredHeadH / headPx;

        // 人脸框中心（原图坐标）
        const faceCx = faceBox.x + faceBox.width / 2;
        const faceCy = faceBox.y + faceBox.height / 2;

        // 头顶（发顶）在原图的估计位置：脸框顶再往上补一点
        const headTopImgY = faceBox.y - (headPx - faceBox.height) * 0.6;

        // 目标里头顶应落在 headTop 处；水平居中对齐脸中心
        const targetHeadTopY = targetH * guide.headTop;
        this.offsetY = targetHeadTopY - headTopImgY * this.scale;
        this.offsetX = targetW / 2 - faceCx * this.scale;

        this._render();
        this.onChange();
        return true;
    }

    /**
     * 切换参考线显隐（导出时不含参考线）
     */
    setShowGuide(show) {
        this.showGuide = show;
        this._render();
    }

    /**
     * 把底色应用到 ctx.fillStyle（纯色或竖向线性渐变）。
     * gradientHeight 用于渐变的终点坐标（编辑态传显示高度，导出传目标高度）。
     * 返回 true 表示已成功设置填充样式。
     */
    _applyBgFill(ctx, color, gradientHeight) {
        if (!color || color === 'transparent') return false;
        if (color.startsWith('linear-gradient')) {
            const match = color.match(/#[0-9a-fA-F]{6}/g);
            if (match && match.length >= 2) {
                const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
                gradient.addColorStop(0, match[0]);
                gradient.addColorStop(1, match[1]);
                ctx.fillStyle = gradient;
                return true;
            }
            return false;
        }
        ctx.fillStyle = color;
        return true;
    }
    
    /**
     * 获取当前变换参数
     */
    getTransform() {
        return {
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };
    }
    
    /**
     * 设置变换参数
     */
    setTransform(scale, offsetX, offsetY) {
        this.scale = scale;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this._render();
        this.onChange();
    }
    
    /**
     * 适应视图：将图像缩放到适合裁剪框的大小
     */
    _fitToView() {
        if (!this.img || !this.targetSize) return;
        
        const imgW = this.img.naturalWidth;
        const imgH = this.img.naturalHeight;
        const targetW = this.targetSize.width;
        const targetH = this.targetSize.height;
        
        // 计算画布显示尺寸（保持目标比例的容器内）
        const containerMaxW = 400;
        const containerMaxH = 500;
        
        // 按目标比例计算容器尺寸
        const targetRatio = targetW / targetH;
        let containerW, containerH;
        if (containerMaxW / containerMaxH > targetRatio) {
            containerH = containerMaxH;
            containerW = containerH * targetRatio;
        } else {
            containerW = containerMaxW;
            containerH = containerW / targetRatio;
        }
        
        this.displayWidth = Math.round(containerW);
        this.displayHeight = Math.round(containerH);
        
        // 设置 canvas CSS 尺寸
        this.canvas.style.width = this.displayWidth + 'px';
        this.canvas.style.height = this.displayHeight + 'px';
        
        // 设置 canvas 物理分辨率
        const dpr = window.devicePixelRatio || 1;
        this.canvasScale = dpr;
        this.canvas.width = Math.round(this.displayWidth * dpr);
        this.canvas.height = Math.round(this.displayHeight * dpr);
        
        // 计算缩放：让图像宽度匹配目标宽度
        this.scale = targetW / imgW;
        
        // 居中
        const scaledImgW = imgW * this.scale;
        const scaledImgH = imgH * this.scale;
        this.offsetX = (targetW - scaledImgW) / 2;
        this.offsetY = (targetH - scaledImgH) / 2;
    }
    
    /**
     * 渲染
     */
    _render() {
        if (!this.img || !this.targetSize) return;
        
        const ctx = this.ctx;
        const dpr = this.canvasScale;
        const targetW = this.targetSize.width;
        const targetH = this.targetSize.height;
        
        // 计算显示缩放（目标尺寸 -> canvas 显示尺寸）
        const displayScale = this.displayWidth / targetW;
        
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

        // 背景：选了底色就实时铺底色（所见即所得），否则棋盘格表示透明
        if (this._applyBgFill(ctx, this.bgColor, this.displayHeight)) {
            ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
        } else {
            this._drawCheckerboard(ctx, displayScale);
        }
        
        // 裁剪到目标区域
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.displayWidth, this.displayHeight);
        ctx.clip();
        
        // 绘制图像
        const imgW = this.img.naturalWidth;
        const imgH = this.img.naturalHeight;
        const drawX = this.offsetX * displayScale;
        const drawY = this.offsetY * displayScale;
        const drawW = imgW * this.scale * displayScale;
        const drawH = imgH * this.scale * displayScale;
        
        ctx.drawImage(this.img, drawX, drawY, drawW, drawH);
        ctx.restore();
        
        // 绘制裁剪框边框
        this._drawCropBorder(ctx);

        // 绘制构图参考线（头顶留白 / 下巴线 / 居中线 / 头部椭圆）
        if (this.showGuide && this.guide) {
            this._drawGuide(ctx);
        }
    }

    /**
     * 绘制人头构图参考层：帮助用户把脸对进标准位置
     */
    _drawGuide(ctx) {
        const w = this.displayWidth;
        const h = this.displayHeight;
        const { headTop, headHeight } = this.guide;

        const topY = h * headTop;               // 头顶线
        const chinY = h * (headTop + headHeight); // 下巴线
        const cx = w / 2;

        ctx.save();

        // 头顶 / 下巴 水平参考线（虚线）
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, topY); ctx.lineTo(w, topY);
        ctx.moveTo(0, chinY); ctx.lineTo(w, chinY);
        ctx.stroke();

        // 垂直居中线
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.4)';
        ctx.beginPath();
        ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
        ctx.stroke();

        // 头部椭圆轮廓（把头放进这个范围）
        const headH = chinY - topY;
        const headW = headH * 0.72; // 头宽约为头高的 0.72
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, (topY + chinY) / 2, headW / 2, headH / 2, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 顶部标注
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(74, 158, 255, 0.9)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText('头顶', 4, topY - 1);
        ctx.textBaseline = 'top';
        ctx.fillText('下巴', 4, chinY + 2);

        ctx.restore();
    }
    
    /**
     * 绘制棋盘格背景
     */
    _drawCheckerboard(ctx, displayScale) {
        const size = 8;
        const colors = ['#e0e0e0', '#ffffff'];
        const w = this.displayWidth;
        const h = this.displayHeight;
        
        for (let y = 0; y < h; y += size) {
            for (let x = 0; x < w; x += size) {
                const idx = ((x / size) + (y / size)) % 2;
                ctx.fillStyle = colors[idx];
                ctx.fillRect(x, y, size, size);
            }
        }
    }
    
    /**
     * 绘制裁剪框边框
     */
    _drawCropBorder(ctx) {
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(1, 1, this.displayWidth - 2, this.displayHeight - 2);
        ctx.setLineDash([]);
        
        // 四角标记
        const cornerLen = 15;
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 3;
        
        // 左上
        ctx.beginPath();
        ctx.moveTo(0, cornerLen);
        ctx.lineTo(0, 0);
        ctx.lineTo(cornerLen, 0);
        ctx.stroke();
        
        // 右上
        ctx.beginPath();
        ctx.moveTo(this.displayWidth - cornerLen, 0);
        ctx.lineTo(this.displayWidth, 0);
        ctx.lineTo(this.displayWidth, cornerLen);
        ctx.stroke();
        
        // 左下
        ctx.beginPath();
        ctx.moveTo(0, this.displayHeight - cornerLen);
        ctx.lineTo(0, this.displayHeight);
        ctx.lineTo(cornerLen, this.displayHeight);
        ctx.stroke();
        
        // 右下
        ctx.beginPath();
        ctx.moveTo(this.displayWidth - cornerLen, this.displayHeight);
        ctx.lineTo(this.displayWidth, this.displayHeight);
        ctx.lineTo(this.displayWidth, this.displayHeight - cornerLen);
        ctx.stroke();
    }
    
    /**
     * 绑定交互事件
     */
    _bindEvents() {
        // 鼠标事件
        this.canvas.addEventListener('mousedown', (e) => this._onPointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onPointerMove(e));
        this.canvas.addEventListener('mouseup', (e) => this._onPointerUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this._onPointerUp(e));
        
        // 触摸事件
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this._onPointerDown(touch);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this._onPointerMove(touch);
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this._onPointerUp(e);
        });
        
        // 滚轮缩放
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this._onWheel(e);
        }, { passive: false });
    }
    
    _getPointerPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    
    _onPointerDown(e) {
        const pos = this._getPointerPos(e);
        this.isDragging = true;
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
        this.dragStartOffsetX = this.offsetX;
        this.dragStartOffsetY = this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    }
    
    _onPointerMove(e) {
        if (!this.isDragging) return;
        
        const pos = this._getPointerPos(e);
        const dx = pos.x - this.dragStartX;
        const dy = pos.y - this.dragStartY;
        
        // 将屏幕位移转换为图像坐标位移
        const displayScale = this.displayWidth / this.targetSize.width;
        this.offsetX = this.dragStartOffsetX + dx / displayScale;
        this.offsetY = this.dragStartOffsetY + dy / displayScale;
        
        this._render();
        this.onChange();
    }
    
    _onPointerUp(e) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }
    
    _onWheel(e) {
        if (!this.img) return;
        
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.1, Math.min(10, this.scale * delta));
        
        // 以鼠标位置为中心缩放
        const pos = this._getPointerPos(e);
        const displayScale = this.displayWidth / this.targetSize.width;
        
        // 鼠标在图像坐标中的位置
        const imgX = (pos.x / displayScale - this.offsetX) / this.scale;
        const imgY = (pos.y / displayScale - this.offsetY) / this.scale;
        
        this.scale = newScale;
        
        // 调整偏移，保持鼠标位置不变
        this.offsetX = pos.x / displayScale - imgX * this.scale;
        this.offsetY = pos.y / displayScale - imgY * this.scale;
        
        this._render();
        this.onChange();
    }
    
    /**
     * 导出裁剪后的 ImageData
     */
    exportImageData() {
        if (!this.img || !this.targetSize) return null;
        
        const targetW = this.targetSize.width;
        const targetH = this.targetSize.height;
        
        // 创建目标尺寸的 canvas
        const outCanvas = document.createElement('canvas');
        outCanvas.width = targetW;
        outCanvas.height = targetH;
        const outCtx = outCanvas.getContext('2d');
        
        // 绘制图像（按当前变换）
        const imgW = this.img.naturalWidth;
        const imgH = this.img.naturalHeight;
        outCtx.drawImage(
            this.img,
            this.offsetX, this.offsetY,
            imgW * this.scale, imgH * this.scale
        );
        
        return outCtx.getImageData(0, 0, targetW, targetH);
    }
    
    /**
     * 导出为 Blob
     */
    async exportBlob(bgColor = '#ffffff') {
        const imageData = this.exportImageData();
        if (!imageData) return null;

        const targetW = this.targetSize.width;
        const targetH = this.targetSize.height;

        // 创建带背景色的 canvas
        const outCanvas = document.createElement('canvas');
        outCanvas.width = targetW;
        outCanvas.height = targetH;
        const outCtx = outCanvas.getContext('2d');

        // 绘制背景色（与编辑态同一套解析逻辑，保证所见即所得）
        if (this._applyBgFill(outCtx, bgColor, targetH)) {
            outCtx.fillRect(0, 0, targetW, targetH);
        }

        // 用 drawImage 合成前景，保留 alpha 混合（putImageData 会覆盖背景色）
        const fgCanvas = document.createElement('canvas');
        fgCanvas.width = targetW;
        fgCanvas.height = targetH;
        fgCanvas.getContext('2d').putImageData(imageData, 0, 0);
        outCtx.drawImage(fgCanvas, 0, 0);

        // 证件照统一输出 PNG（无损，quality 对 PNG 无效）
        return new Promise(resolve => {
            outCanvas.toBlob(resolve, 'image/png');
        });
    }
    
    /**
     * 销毁
     */
    destroy() {
        this.img = null;
        this.imgData = null;
        this.faceBox = null;
    }
}