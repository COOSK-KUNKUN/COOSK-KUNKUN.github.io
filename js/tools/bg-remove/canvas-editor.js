/**
 * 画布编辑器：显示图片 + 缩放/平移 + 画框/选中/移动/拉角缩放/删除
 *
 * 坐标系统：
 *   - 图像坐标：原图像素 (0..naturalW, 0..naturalH)，boxes 用这个存
 *   - 屏幕坐标：canvas 上的 CSS 像素
 *   - 变换：screen = image * scale + offset
 *
 * 用法：
 *   const editor = new CanvasEditor(canvasEl, { onBoxesChange, onViewChange });
 *   editor.setImage(HTMLImageElement);
 *   editor.setTool('pan' | 'protect' | 'subject');
 *   editor.deleteSelected(); editor.clearBoxes(); editor.fit();
 *   editor.getBoxes();  // 返回图像坐标下的框
 *   editor.destroy();   // 解绑所有事件
 *
 * 交互模型：
 *   - 左键拖空白：平移工具下平移画布；画框工具下画对应类型的框
 *   - 左键在框体内按下：移动该框（任何工具下都优先，方便挪已有框）
 *   - 选中框后：拉四角缩放；框顶显示删除按钮（X）可点删；Delete 键也可删
 *   - 空格 / 中键拖拽：始终平移（不受工具影响）
 */

const HANDLE_SIZE = 8;      // 拉角手柄边长（屏幕像素）
const HANDLE_HIT = 12;      // 手柄命中容差
const MIN_BOX = 6;          // 框最小尺寸（图像像素）
const DEL_R = 9;            // 删除按钮半径（屏幕像素）
const DEL_GAP = 6;          // 删除按钮与框顶的间距

export class CanvasEditor {
    constructor(canvas, { onBoxesChange, onViewChange, onToolChange, onSamInteract } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onBoxesChange = onBoxesChange || (() => {});
        this.onViewChange = onViewChange || (() => {});
        this.onToolChange = onToolChange || (() => {});
        this.onSamInteract = onSamInteract || (() => {});

        this.img = null;
        this.imgW = 0;
        this.imgH = 0;

        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // 当前工具：'pan'（默认，拖拽平移）| 'protect' | 'subject'（拖拽画对应框）
        this.tool = 'pan';
        this.boxes = [];
        this.selectedId = null;
        this._nextId = 1;

        // 交互状态
        this.action = null;        // 'draw' | 'move' | 'resize' | 'pan'
        this.dragStart = null;     // 屏幕坐标
        this.dragBoxStart = null;  // 拖动前框的快照
        this.resizeCorner = null;  // 'nw'|'ne'|'sw'|'se'
        this.spaceHeld = false;
        this._rafId = null;

        this._bindEvents();
    }

    // ---------- 图像与视图 ----------
    setImage(img) {
        this.img = img;
        this.imgW = img.naturalWidth;
        this.imgH = img.naturalHeight;
        this.fit();
    }

    // 适应容器：缩放到刚好放下，居中
    fit() {
        if (!this.img) return;
        this._adaptStageHeight();     // 先按图片比例调整舞台高度，消除大片留白
        this._resizeCanvasToContainer();
        const cw = this.canvas.width / this._dpr();
        const ch = this.canvas.height / this._dpr();
        const s = Math.min(cw / this.imgW, ch / this.imgH);
        this.scale = s > 0 ? s : 1;
        this.offsetX = (cw - this.imgW * this.scale) / 2;
        this.offsetY = (ch - this.imgH * this.scale) / 2;
        this._notifyView();
        this.render();
    }

    // 舞台高度跟随图片宽高比：宽图矮、高图高，在 [MIN,MAX] 间夹取，避免留白
    _adaptStageHeight() {
        const stage = this.canvas.parentElement;
        if (!stage || !this.imgW || !this.imgH) return;
        const MIN = 280, MAX = 520;
        const availW = stage.clientWidth || stage.getBoundingClientRect().width;
        if (!availW) return;
        const idealH = availW * (this.imgH / this.imgW);
        const h = Math.max(MIN, Math.min(MAX, idealH));
        stage.style.height = `${Math.round(h)}px`;
    }

    _dpr() {
        return window.devicePixelRatio || 1;
    }

    // 让 canvas 的位图分辨率匹配 CSS 尺寸 * DPR，避免模糊
    _resizeCanvasToContainer() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = this._dpr();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    // 切换工具。source 用于区分是画布工具条还是外部（右侧分段）触发，
    // 避免双向同步时回调打转；默认只更新光标并通知外部。
    setTool(tool, notify = true) {
        this.tool = tool;
        this._updateIdleCursor();
        if (notify) this.onToolChange(tool);
    }

    // 无操作时的默认光标：平移工具用手型，画框/SAM工具用十字
    _updateIdleCursor() {
        if (this.spaceHeld) { this.canvas.style.cursor = 'grab'; return; }
        this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair';
    }

    getBoxes() {
        // 返回归一化后的框（正宽高），供合成使用
        return this.boxes.map(b => {
            let { x, y, w, h, type } = b;
            if (w < 0) { x += w; w = -w; }
            if (h < 0) { y += h; h = -h; }
            return { type, x, y, w, h };
        });
    }

    getCounts() {
        return {
            protect: this.boxes.filter(b => b.type === 'protect').length,
            subject: this.boxes.filter(b => b.type === 'subject').length
        };
    }

    deleteSelected() {
        if (this.selectedId == null) return;
        this.boxes = this.boxes.filter(b => b.id !== this.selectedId);
        this.selectedId = null;
        this._notifyBoxes();
        this.render();
    }

    clearBoxes() {
        this.boxes = [];
        this.selectedId = null;
        this._notifyBoxes();
        this.render();
    }

    // ---------- 坐标变换 ----------
    screenToImage(sx, sy) {
        return {
            x: (sx - this.offsetX) / this.scale,
            y: (sy - this.offsetY) / this.scale
        };
    }

    imageToScreen(ix, iy) {
        return {
            x: ix * this.scale + this.offsetX,
            y: iy * this.scale + this.offsetY
        };
    }

    _notifyBoxes() {
        this.onBoxesChange(this.getCounts());
    }

    _notifyView() {
        this.onViewChange(Math.round(this.scale * 100));
    }

    zoomPercent() {
        return Math.round(this.scale * 100);
    }

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._unbindEvents();
    }

    // ---------- 事件绑定 ----------
    _bindEvents() {
        // 用箭头函数保留 this，并存引用便于解绑
        this._onWheel = (e) => this._handleWheel(e);
        this._onMouseDown = (e) => this._handleMouseDown(e);
        this._onMouseMove = (e) => this._handleMouseMove(e);
        this._onMouseUp = (e) => this._handleMouseUp(e);
        this._onKeyDown = (e) => this._handleKeyDown(e);
        this._onKeyUp = (e) => this._handleKeyUp(e);
        this._onResize = () => this.fit();

        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('resize', this._onResize);
    }

    _unbindEvents() {
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('resize', this._onResize);
    }

    _localPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // 滚轮缩放：以光标为锚点
    _handleWheel(e) {
        if (!this.img) return;
        e.preventDefault();
        const p = this._localPoint(e);
        const before = this.screenToImage(p.x, p.y);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.scale = Math.min(20, Math.max(0.05, this.scale * factor));
        // 保持锚点像素在光标下不动
        this.offsetX = p.x - before.x * this.scale;
        this.offsetY = p.y - before.y * this.scale;
        this._notifyView();
        this.render();
    }

    _handleKeyDown(e) {
        if (e.code === 'Space') {
            this.spaceHeld = true;
            this.canvas.style.cursor = 'grab';
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId != null) {
            // 仅当焦点不在输入框时才删除
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                e.preventDefault();
                this.deleteSelected();
            }
        }
    }

    _handleKeyUp(e) {
        if (e.code === 'Space') {
            this.spaceHeld = false;
            this._updateIdleCursor();
        }
    }

    _handleMouseDown(e) {
        if (!this.img) return;
        const p = this._localPoint(e);
        this.dragStart = p;

        // 空格或中键 → 平移（不受工具影响）
        if (this.spaceHeld || e.button === 1) {
            this.action = 'pan';
            this._panStart = { ox: this.offsetX, oy: this.offsetY };
            this.canvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }
        if (e.button !== 0) return;

        // 已选中框时，优先判断删除按钮 / 拉角手柄
        if (this.selectedId != null) {
            if (this._hitDelete(p)) {
                this.deleteSelected();
                return;
            }
            const corner = this._hitHandle(p);
            if (corner) {
                this.action = 'resize';
                this.resizeCorner = corner;
                this.dragBoxStart = { ...this._getBox(this.selectedId) };
                return;
            }
        }

        // 点在某个框体内 → 选中并准备移动（任何工具下都优先，方便挪已有框）
        const hit = this._hitBox(p);
        if (hit) {
            this.selectedId = hit.id;
            this.action = 'move';
            this.dragBoxStart = { ...hit };
            this._notifyBoxes();
            this.render();
            return;
        }

        // 空白处：平移工具 → 平移画布；SAM 工具 → 通知外部；画框工具 → 画对应类型的新框
        if (this.tool === 'pan') {
            this.action = 'pan';
            this._panStart = { ox: this.offsetX, oy: this.offsetY };
            this.canvas.style.cursor = 'grabbing';
            // 点空白取消选中
            if (this.selectedId != null) { this.selectedId = null; this.render(); }
            return;
        }

        if (this.tool === 'sam') {
            // SAM 模式：记录起点，通过回调把交互传给外部 SAM 逻辑
            this.action = 'sam';
            const imgPt = this.screenToImage(p.x, p.y);
            this._samStart = imgPt;
            this._samCur = imgPt;
            this.onSamInteract({ type: 'start', point: imgPt });
            return;
        }

        const imgPt = this.screenToImage(p.x, p.y);
        const box = {
            id: this._nextId++,
            type: this.tool,
            x: imgPt.x, y: imgPt.y, w: 0, h: 0
        };
        this.boxes.push(box);
        this.selectedId = box.id;
        this.action = 'draw';
        this.dragBoxStart = { ...box };
        this.render();
    }

    _handleMouseMove(e) {
        if (!this.action) {
            // 无操作时更新光标：删除按钮 > 拉角手柄 > 框体(移动) > 工具默认
            if (this.img && !this.spaceHeld) {
                const p = this._localPoint(e);
                if (this.selectedId != null && this._hitDelete(p)) {
                    this.canvas.style.cursor = 'pointer';
                } else if (this.selectedId != null && this._hitHandle(p)) {
                    this.canvas.style.cursor = cornerCursor(this._hitHandle(p));
                } else if (this._hitBox(p)) {
                    this.canvas.style.cursor = 'move';
                } else {
                    this._updateIdleCursor();
                }
            }
            return;
        }
        const p = this._localPoint(e);

        if (this.action === 'pan') {
            this.offsetX = this._panStart.ox + (p.x - this.dragStart.x);
            this.offsetY = this._panStart.oy + (p.y - this.dragStart.y);
            this.render();
            return;
        }

        if (this.action === 'sam') {
            // SAM 拖拽中：更新当前点
            const cur = this.screenToImage(p.x, p.y);
            this._samCur = cur;
            this.onSamInteract({ type: 'move', start: this._samStart, current: cur });
            return;
        }

        const cur = this.screenToImage(p.x, p.y);
        const start = this.screenToImage(this.dragStart.x, this.dragStart.y);
        const dx = cur.x - start.x;
        const dy = cur.y - start.y;
        const box = this._getBox(this.selectedId);
        if (!box) return;

        if (this.action === 'draw') {
            box.w = cur.x - box.x;
            box.h = cur.y - box.y;
        } else if (this.action === 'move') {
            box.x = this.dragBoxStart.x + dx;
            box.y = this.dragBoxStart.y + dy;
        } else if (this.action === 'resize') {
            this._applyResize(box, this.dragBoxStart, this.resizeCorner, dx, dy);
        }
        this.render();
    }

    _handleMouseUp() {
        if (this.action === 'sam') {
            // SAM 松手：通知外部完成，由外部调 SAM 解码
            this.onSamInteract({ type: 'end', start: this._samStart, current: this._samCur });
            this.action = null;
            this._samStart = null;
            this._samCur = null;
            this._updateIdleCursor();
            return;
        }

        if (this.action === 'draw') {
            // 丢弃太小的框（误点）
            const box = this._getBox(this.selectedId);
            if (box && (Math.abs(box.w) < MIN_BOX || Math.abs(box.h) < MIN_BOX)) {
                this.boxes = this.boxes.filter(b => b.id !== box.id);
                this.selectedId = null;
            }
            this._notifyBoxes();
            this.render();
        } else if (this.action === 'move' || this.action === 'resize') {
            this._notifyBoxes();
        }
        this.action = null;
        this.resizeCorner = null;
        this.dragBoxStart = null;
        this._updateIdleCursor();
    }

    _applyResize(box, start, corner, dx, dy) {
        // start 是拖动前的框快照（可能含负宽高，先不管，直接改对应角）
        let { x, y, w, h } = start;
        if (corner.includes('w')) { x = start.x + dx; w = start.w - dx; }
        if (corner.includes('e')) { w = start.w + dx; }
        if (corner.includes('n')) { y = start.y + dy; h = start.h - dy; }
        if (corner.includes('s')) { h = start.h + dy; }
        box.x = x; box.y = y; box.w = w; box.h = h;
    }

    _getBox(id) {
        return this.boxes.find(b => b.id === id);
    }

    // 命中检测：点是否落在某个框内（返回归一化后的框副本 + id）
    _hitBox(p) {
        // 从后往前（后画的在上层）
        for (let i = this.boxes.length - 1; i >= 0; i--) {
            const b = this.boxes[i];
            const s = this._normScreenRect(b);
            if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
                return { ...b };
            }
        }
        return null;
    }

    // 命中检测：点是否落在选中框的某个角手柄上
    _hitHandle(p) {
        const b = this._getBox(this.selectedId);
        if (!b) return null;
        const s = this._normScreenRect(b);
        const corners = {
            nw: { x: s.x, y: s.y },
            ne: { x: s.x + s.w, y: s.y },
            sw: { x: s.x, y: s.y + s.h },
            se: { x: s.x + s.w, y: s.y + s.h }
        };
        for (const [name, c] of Object.entries(corners)) {
            if (Math.abs(p.x - c.x) <= HANDLE_HIT && Math.abs(p.y - c.y) <= HANDLE_HIT) {
                return name;
            }
        }
        return null;
    }

    // 选中框删除按钮的屏幕中心：默认在框顶居中偏上，空间不够则移到框内顶部
    _deleteCenter(b) {
        const s = this._normScreenRect(b);
        const cx = s.x + s.w / 2;
        let cy = s.y - DEL_GAP - DEL_R;
        if (cy - DEL_R < 0) cy = s.y + DEL_GAP + DEL_R; // 顶部超出画布则放到框内
        return { x: cx, y: cy };
    }

    // 命中检测：点是否落在选中框的删除按钮上
    _hitDelete(p) {
        const b = this._getBox(this.selectedId);
        if (!b) return false;
        const c = this._deleteCenter(b);
        const dx = p.x - c.x, dy = p.y - c.y;
        return dx * dx + dy * dy <= (DEL_R + 2) * (DEL_R + 2);
    }

    // 框在屏幕坐标下的归一化矩形（正宽高）
    _normScreenRect(b) {
        const tl = this.imageToScreen(b.x, b.y);
        const br = this.imageToScreen(b.x + b.w, b.y + b.h);
        const x = Math.min(tl.x, br.x);
        const y = Math.min(tl.y, br.y);
        return { x, y, w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y) };
    }

    // ---------- 渲染 ----------
    render() {
        if (this._rafId) return; // 合并同一帧内的多次 render
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._draw();
        });
    }

    _draw() {
        const ctx = this.ctx;
        const dpr = this._dpr();
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 逻辑坐标 = CSS 像素
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

        if (!this.img) { ctx.restore(); return; }

        // 图片
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
            this.img,
            this.offsetX, this.offsetY,
            this.imgW * this.scale, this.imgH * this.scale
        );

        // 框
        for (const b of this.boxes) {
            const s = this._normScreenRect(b);
            const selected = b.id === this.selectedId;
            const color = b.type === 'protect' ? '#f0c040' : '#4a9eff';

            ctx.lineWidth = selected ? 2 : 1.5;
            ctx.setLineDash(selected ? [6, 4] : []);
            ctx.strokeStyle = color;
            ctx.strokeRect(s.x, s.y, s.w, s.h);

            // 半透明填充区分类型
            ctx.fillStyle = b.type === 'protect'
                ? 'rgba(240,192,64,0.12)'
                : 'rgba(74,158,255,0.12)';
            ctx.fillRect(s.x, s.y, s.w, s.h);

            // 选中框画四角手柄 + 删除按钮
            if (selected) {
                ctx.setLineDash([]);
                ctx.fillStyle = color;
                const hs = HANDLE_SIZE;
                const corners = [
                    [s.x, s.y], [s.x + s.w, s.y],
                    [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]
                ];
                for (const [cx, cy] of corners) {
                    ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
                }
                this._drawDeleteButton(ctx, b);
            }
        }
        ctx.restore();
    }

    // 红色圆形删除按钮 + 白色 X
    _drawDeleteButton(ctx, b) {
        const c = this._deleteCenter(b);
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, DEL_R, 0, Math.PI * 2);
        ctx.fillStyle = '#e53e3e';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.lineCap = 'round';
        const k = DEL_R * 0.45;
        ctx.beginPath();
        ctx.moveTo(c.x - k, c.y - k); ctx.lineTo(c.x + k, c.y + k);
        ctx.moveTo(c.x + k, c.y - k); ctx.lineTo(c.x - k, c.y + k);
        ctx.stroke();
        ctx.restore();
    }
}

function cornerCursor(corner) {
    if (corner === 'nw' || corner === 'se') return 'nwse-resize';
    if (corner === 'ne' || corner === 'sw') return 'nesw-resize';
    return 'default';
}
