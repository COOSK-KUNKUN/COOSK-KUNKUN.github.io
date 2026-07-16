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
const VERTEX_R = 5;         // 多边形顶点手柄半径（屏幕像素）
const VERTEX_HIT = 11;      // 顶点命中容差（屏幕像素）
const CLOSE_HIT = 12;       // 距起点多近算闭合（屏幕像素）
const EDGE_MID_R = 4;       // 边中点插入手柄半径（屏幕像素）
const EDGE_MID_HIT = 9;     // 边中点命中容差（屏幕像素）

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
        this.action = null;        // 'draw' | 'move' | 'resize' | 'pan' | 'moveVertex' | 'movePoly'
        this.dragStart = null;     // 屏幕坐标
        this.dragBoxStart = null;  // 拖动前框的快照
        this.resizeCorner = null;  // 'nw'|'ne'|'sw'|'se'
        this.spaceHeld = false;
        this._rafId = null;

        // 多边形绘制状态
        this._drawingPoly = null;  // 正在绘制的多边形 { id, type, shape:'polygon', points, closed:false }
        this._polyMouse = null;    // 绘制中鼠标当前图像坐标（橡皮筋预览）
        this._activeVertex = null; // 正在拖动/选中的顶点索引

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
        // 返回归一化后的框（正宽高）/ 多边形，供合成使用
        return this.boxes.map(b => {
            if (b.shape === 'polygon') {
                return { type: b.type, shape: 'polygon', points: b.points.map(p => ({ ...p })) };
            }
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
        this._onDblClick = (e) => this._handleDblClick(e);
        this._onMouseMove = (e) => this._handleMouseMove(e);
        this._onMouseUp = (e) => this._handleMouseUp(e);
        this._onKeyDown = (e) => this._handleKeyDown(e);
        this._onKeyUp = (e) => this._handleKeyUp(e);
        this._onResize = () => this.fit();
        this._onContextMenu = (e) => e.preventDefault(); // 右键用于删顶点，屏蔽系统菜单

        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        this.canvas.addEventListener('dblclick', this._onDblClick);
        this.canvas.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('resize', this._onResize);
    }

    _unbindEvents() {
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('dblclick', this._onDblClick);
        this.canvas.removeEventListener('contextmenu', this._onContextMenu);
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
        // 绘制多边形中：ESC 取消，Enter 闭合（够 3 点）
        if (this._drawingPoly) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this._drawingPoly = null;
                this._polyMouse = null;
                this.render();
                return;
            }
            if (e.key === 'Enter' && this._drawingPoly.points.length >= 3) {
                e.preventDefault();
                const poly = this._drawingPoly;
                poly.closed = true;
                this.boxes.push(poly);
                this.selectedId = poly.id;
                this._drawingPoly = null;
                this._polyMouse = null;
                this._notifyBoxes();
                this.render();
                return;
            }
        }
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
        // 右键：删除选中多边形上命中的顶点（至少保留 3 个）
        if (e.button === 2) {
            if (this.selectedId != null) {
                const selBox = this._getBox(this.selectedId);
                if (selBox && selBox.shape === 'polygon') {
                    const vi = this._hitVertex(p, selBox);
                    if (vi != null && selBox.points.length > 3) {
                        selBox.points.splice(vi, 1);
                        this._notifyBoxes();
                        this.render();
                    }
                }
            }
            return;
        }
        if (e.button !== 0) return;

        // 正在绘制多边形：每次点击加顶点；点回起点则闭合
        if (this._drawingPoly) {
            const poly = this._drawingPoly;
            const first = poly.points[0];
            const fs = first && this.imageToScreen(first.x, first.y);
            if (poly.points.length >= 3 && fs &&
                Math.abs(p.x - fs.x) <= CLOSE_HIT && Math.abs(p.y - fs.y) <= CLOSE_HIT) {
                // 闭合
                poly.closed = true;
                this.boxes.push(poly);
                this.selectedId = poly.id;
                this._drawingPoly = null;
                this._polyMouse = null;
                this._notifyBoxes();
                this.render();
                return;
            }
            // 加一个顶点
            const ip = this.screenToImage(p.x, p.y);
            poly.points.push({ x: ip.x, y: ip.y });
            this.render();
            return;
        }

        // 已选中框时，优先判断删除按钮 / 拉角手柄 / 多边形顶点 / 边中点
        if (this.selectedId != null) {
            if (this._hitDelete(p)) {
                this.deleteSelected();
                return;
            }
            const selBox = this._getBox(this.selectedId);
            if (selBox && selBox.shape === 'polygon') {
                // 命中顶点 → 拖动顶点
                const vi = this._hitVertex(p, selBox);
                if (vi != null) {
                    this.action = 'moveVertex';
                    this._activeVertex = vi;
                    return;
                }
                // 命中边中点 → 插入新顶点并立即拖动
                const ei = this._hitEdgeMid(p, selBox);
                if (ei != null) {
                    const a = selBox.points[ei];
                    const b = selBox.points[(ei + 1) % selBox.points.length];
                    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                    selBox.points.splice(ei + 1, 0, mid);
                    this.action = 'moveVertex';
                    this._activeVertex = ei + 1;
                    this.render();
                    return;
                }
            } else if (selBox) {
                const corner = this._hitHandle(p);
                if (corner) {
                    this.action = 'resize';
                    this.resizeCorner = corner;
                    this.dragBoxStart = { ...selBox };
                    return;
                }
            }
        }

        // 点在某个框体内 → 选中并准备移动（任何工具下都优先，方便挪已有框）
        const hit = this._hitBox(p);
        if (hit) {
            this.selectedId = hit.id;
            if (hit.shape === 'polygon') {
                this.action = 'movePoly';
                this.dragBoxStart = { points: hit.points.map(pt => ({ ...pt })) };
            } else {
                this.action = 'move';
                this.dragBoxStart = { ...hit };
            }
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
            // SAM 模式：记录起点，通过回调把交互传给外部逻辑
            this.action = this.tool;
            const imgPt = this.screenToImage(p.x, p.y);
            this._samStart = imgPt;
            this._samCur = imgPt;
            this.onSamInteract({ type: 'start', point: imgPt, tool: this.tool });
            return;
        }

        // 多边形工具：第一次点击开始绘制（polygon=保护 / polygon-subject=主体）
        if (this.tool === 'polygon' || this.tool === 'polygon-subject') {
            const ip = this.screenToImage(p.x, p.y);
            this._drawingPoly = {
                id: this._nextId++,
                type: this.tool === 'polygon-subject' ? 'subject' : 'protect',
                shape: 'polygon',
                points: [{ x: ip.x, y: ip.y }],
                closed: false
            };
            this._polyMouse = { x: ip.x, y: ip.y };
            this.selectedId = null;
            this.render();
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

    // 双击闭合正在绘制的多边形（去掉双击第二下产生的重复顶点）
    _handleDblClick(e) {
        if (!this._drawingPoly) return;
        const poly = this._drawingPoly;
        // 双击的两次 mousedown 会各加一个近乎重合的点，去掉末尾一个
        if (poly.points.length >= 2) {
            const a = poly.points[poly.points.length - 1];
            const b = poly.points[poly.points.length - 2];
            const sa = this.imageToScreen(a.x, a.y);
            const sb = this.imageToScreen(b.x, b.y);
            if (Math.abs(sa.x - sb.x) <= 3 && Math.abs(sa.y - sb.y) <= 3) {
                poly.points.pop();
            }
        }
        if (poly.points.length < 3) return; // 点不够，不闭合
        e.preventDefault();
        poly.closed = true;
        this.boxes.push(poly);
        this.selectedId = poly.id;
        this._drawingPoly = null;
        this._polyMouse = null;
        this._notifyBoxes();
        this.render();
    }

    _handleMouseMove(e) {
        // 绘制多边形中：更新橡皮筋预览点
        if (this._drawingPoly) {
            const p = this._localPoint(e);
            this._polyMouse = this.screenToImage(p.x, p.y);
            // 靠近起点时提示可闭合
            const first = this._drawingPoly.points[0];
            const fs = first && this.imageToScreen(first.x, first.y);
            const canClose = this._drawingPoly.points.length >= 3 && fs &&
                Math.abs(p.x - fs.x) <= CLOSE_HIT && Math.abs(p.y - fs.y) <= CLOSE_HIT;
            this.canvas.style.cursor = canClose ? 'pointer' : 'crosshair';
            this.render();
            return;
        }

        if (!this.action) {
            // 无操作时更新光标：删除按钮 > 顶点/边中点/拉角手柄 > 框体(移动) > 工具默认
            if (this.img && !this.spaceHeld) {
                const p = this._localPoint(e);
                const selBox = this.selectedId != null ? this._getBox(this.selectedId) : null;
                if (this.selectedId != null && this._hitDelete(p)) {
                    this.canvas.style.cursor = 'pointer';
                } else if (selBox && selBox.shape === 'polygon' && this._hitVertex(p, selBox) != null) {
                    this.canvas.style.cursor = 'pointer';
                } else if (selBox && selBox.shape === 'polygon' && this._hitEdgeMid(p, selBox) != null) {
                    this.canvas.style.cursor = 'copy';
                } else if (selBox && selBox.shape !== 'polygon' && this._hitHandle(p)) {
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
            this.onSamInteract({ type: 'move', start: this._samStart, current: cur, tool: this.action });
            return;
        }

        // 拖动多边形顶点
        if (this.action === 'moveVertex') {
            const box = this._getBox(this.selectedId);
            if (box && box.points[this._activeVertex]) {
                const ip = this.screenToImage(p.x, p.y);
                box.points[this._activeVertex] = { x: ip.x, y: ip.y };
                this.render();
            }
            return;
        }

        // 整体移动多边形
        if (this.action === 'movePoly') {
            const box = this._getBox(this.selectedId);
            if (box && this.dragBoxStart) {
                const start = this.screenToImage(this.dragStart.x, this.dragStart.y);
                const cur = this.screenToImage(p.x, p.y);
                const dx = cur.x - start.x, dy = cur.y - start.y;
                box.points = this.dragBoxStart.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
                this.render();
            }
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
            this.onSamInteract({ type: 'end', start: this._samStart, current: this._samCur, tool: this.action });
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
        } else if (this.action === 'move' || this.action === 'resize' ||
                   this.action === 'moveVertex' || this.action === 'movePoly') {
            this._notifyBoxes();
        }
        this.action = null;
        this.resizeCorner = null;
        this.dragBoxStart = null;
        this._activeVertex = null;
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
            if (b.shape === 'polygon') {
                if (this._pointInPoly(p, b)) return { ...b };
                continue;
            }
            const s = this._normScreenRect(b);
            if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
                return { ...b };
            }
        }
        return null;
    }

    // 多边形顶点在屏幕坐标下的数组
    _polyScreenPoints(poly) {
        return poly.points.map(pt => this.imageToScreen(pt.x, pt.y));
    }

    // 命中检测：点是否落在多边形某个顶点手柄上，返回顶点索引或 null
    _hitVertex(p, poly) {
        const pts = this._polyScreenPoints(poly);
        for (let i = 0; i < pts.length; i++) {
            if (Math.abs(p.x - pts[i].x) <= VERTEX_HIT && Math.abs(p.y - pts[i].y) <= VERTEX_HIT) {
                return i;
            }
        }
        return null;
    }

    // 命中检测：点是否落在多边形某条边的中点手柄上，返回边起点索引或 null
    _hitEdgeMid(p, poly) {
        const pts = this._polyScreenPoints(poly);
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (Math.abs(p.x - mx) <= EDGE_MID_HIT && Math.abs(p.y - my) <= EDGE_MID_HIT) {
                return i;
            }
        }
        return null;
    }

    // 射线法：屏幕坐标点 p 是否在多边形内（多边形顶点先转屏幕坐标）
    _pointInPoly(p, poly) {
        const pts = this._polyScreenPoints(poly);
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // 多边形在屏幕坐标下的包围盒（供删除按钮定位）
    _polyScreenBBox(poly) {
        const pts = this._polyScreenPoints(poly);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of pts) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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
        const s = b.shape === 'polygon' ? this._polyScreenBBox(b) : this._normScreenRect(b);
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
            const selected = b.id === this.selectedId;
            if (b.shape === 'polygon') {
                this._drawPolygon(ctx, b, selected);
                continue;
            }
            const s = this._normScreenRect(b);
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

        // 正在绘制的多边形（橡皮筋预览）
        if (this._drawingPoly) {
            this._drawPolygonInProgress(ctx);
        }
        ctx.restore();
    }

    // 绘制一个已闭合的多边形（描边 + 半透明填充 + 选中时的顶点/边中点手柄）
    _drawPolygon(ctx, poly, selected) {
        const pts = this._polyScreenPoints(poly);
        if (pts.length < 2) return;
        const color = poly.type === 'protect' ? '#f0c040' : '#4a9eff';

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();

        ctx.fillStyle = poly.type === 'protect'
            ? 'rgba(240,192,64,0.12)'
            : 'rgba(74,158,255,0.12)';
        ctx.fill();

        ctx.lineWidth = selected ? 2 : 1.5;
        ctx.setLineDash(selected ? [6, 4] : []);
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.setLineDash([]);

        if (selected) {
            // 边中点手柄（空心小方块，提示可插入顶点）
            const n = pts.length;
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            for (let i = 0; i < n; i++) {
                const a = pts[i], b = pts[(i + 1) % n];
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                ctx.beginPath();
                ctx.arc(mx, my, EDGE_MID_R, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            // 顶点手柄（实心圆）
            ctx.fillStyle = color;
            for (const pt of pts) {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, VERTEX_R, 0, Math.PI * 2);
                ctx.fill();
            }
            this._drawDeleteButton(ctx, poly);
        }
    }

    // 绘制正在创建中的多边形：已有顶点连线 + 到鼠标的橡皮筋段
    _drawPolygonInProgress(ctx) {
        const poly = this._drawingPoly;
        const pts = this._polyScreenPoints(poly);
        if (pts.length === 0) return;
        const color = poly.type === 'subject' ? '#4a9eff' : '#f0c040';

        // 已确定的折线
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        // 橡皮筋：最后一个顶点连到当前鼠标
        if (this._polyMouse) {
            const m = this.imageToScreen(this._polyMouse.x, this._polyMouse.y);
            ctx.lineTo(m.x, m.y);
        }
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.setLineDash([]);

        // 顶点小圆；起点更大，够 3 点时高亮提示可闭合
        for (let i = 0; i < pts.length; i++) {
            const isFirst = i === 0;
            const canClose = isFirst && pts.length >= 3;
            ctx.beginPath();
            ctx.arc(pts[i].x, pts[i].y, canClose ? VERTEX_R + 2 : VERTEX_R, 0, Math.PI * 2);
            ctx.fillStyle = canClose ? '#fff' : color;
            ctx.fill();
            if (canClose) {
                ctx.lineWidth = 2;
                ctx.strokeStyle = color;
                ctx.stroke();
            }
        }
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
