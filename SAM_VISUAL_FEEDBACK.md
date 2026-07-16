# SAM 可视化反馈实现

## 概述

在修复了 SAM 交互冲突后，现在添加了**视觉反馈**，让用户在画布上看到 SAM 选中的区域。

## 实现效果

用户点击/框选物体后，画布上会显示：
1. **蚁行线**（marching ants）：黑白交替的动态边缘线，清晰标识选区轮廓
2. **半透明蓝色填充**：覆盖整个选区，提示范围

## 技术实现

### 1. HTML 结构变更

在主画布上方添加一个覆盖层 canvas：

```html
<div class="bg-canvas-stage" id="canvasStage">
    <canvas id="bgCanvas"></canvas>
    <canvas id="samOverlay" class="sam-overlay"></canvas>  <!-- 新增 -->
    <!-- 工具条 -->
</div>
```

### 2. CSS 样式

`.sam-overlay` 绝对定位覆盖在主 canvas 上方，`pointer-events: none` 让点击穿透：

```css
.sam-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;  /* 不拦截鼠标事件 */
    z-index: 1;
}
```

### 3. 核心函数

#### 3.1 `extractSamEdges(mask, W, H)`
从 SAM mask 提取边缘点：
- 遍历每个前景像素
- 检查四邻域，有背景像素 → 该点是边缘
- 返回 `[order0, idx0, order1, idx1, ...]`，order 用于相位错开

#### 3.2 `startSamAnts(state, container)`
启动蚁行线动画：
- 每 140ms 推进一格相位（`state.samAntsPhase` 0-7 循环）
- 用 `requestAnimationFrame` 驱动动画循环
- 调用 `drawSamAnts` 绘制当前帧

#### 3.3 `drawSamAnts(overlay, state)`
绘制蚁行线和填充：
1. 清空 overlay
2. 绘制半透明填充（缓存在 `state._samFillCanvas`）
3. 遍历边缘点，根据相位绘制黑/白点：
   ```javascript
   const on = ((order + state.samAntsPhase) >> 1) & 1;
   ctx.fillStyle = on ? '#fff' : '#000';
   ctx.fillRect(x, y, 1, 1);
   ```

#### 3.4 `syncOverlayToEditor(overlay, state)`
同步 overlay 的尺寸和分辨率到主 canvas：
- CSS 尺寸跟随主 canvas
- 物理分辨率 = CSS 尺寸 × DPR（避免模糊）

#### 3.5 `drawSamFill(ctx, state, imgW, imgH)`
绘制半透明填充：
- 创建低分辨率填充 canvas 缓存（`state._samFillCanvas`）
- 填充颜色：`rgba(74, 158, 255, 0.35)`（半透明蓝）
- 缩放绘制到 overlay（跟随 editor 的缩放和偏移）

#### 3.6 `stopSamAnts(state)` / `clearSamVisuals(state, container)`
清理动画和缓存：
- 取消 `requestAnimationFrame`
- 清空边缘点数组和填充缓存
- 清空 overlay canvas

### 4. 集成点

#### 4.1 应用候选时启动动画
`applySamCandidate` 函数末尾：
```javascript
state.samEdgePts = extractSamEdges(state.samMask, imgW, imgH);
startSamAnts(state, container);
```

#### 4.2 视图变化时重绘
`onViewChange` 回调中：
```javascript
if (state.samEdgePts && state.samAntsRAF) {
    syncOverlayToEditor(overlay, state);
    drawSamAnts(overlay, state);
}
```

#### 4.3 切换模式/重置时清理
- 切回"自动去背" → `clearSamVisuals()`
- 重新选择图片 → `clearSamVisuals()`
- unmount 工具 → 取消动画 RAF

## 性能优化

1. **填充缓存**：半透明填充只生成一次，存在 `state._samFillCanvas`，后续直接缩放绘制
2. **按需重绘**：只在相位变化（140ms 一次）和视图变化时重绘
3. **离屏 canvas**：填充在原始尺寸的离屏 canvas 生成，避免逐像素操作主 canvas

## 坐标变换

SAM mask 是**图像坐标**（原图像素），overlay 是**屏幕坐标**（CSS 像素）：

```javascript
// 图像坐标 → 屏幕坐标
const sp = editor.imageToScreen(x, y);

// 绘制时跟随 editor 的缩放和偏移
ctx.drawImage(fillCanvas, offsetX, offsetY, imgW * scale, imgH * scale);
```

## 蚁行线原理

**相位错开 + 黑白交替**：

- 每个边缘点有一个 `order`（提取顺序）
- 全局相位 `phase` 每 140ms +1（0-7 循环）
- 点的颜色 = `((order + phase) >> 1) & 1`
  - 相邻点 order 相差 1 → 颜色相反 → 黑白相间
  - phase +1 → 所有点颜色翻转 → 行进效果

举例（phase=0 时）：
```
order: 0  1  2  3  4  5  6  7
color: ⚫ ⚪ ⚫ ⚪ ⚫ ⚪ ⚫ ⚪

phase=1:
color: ⚪ ⚫ ⚪ ⚫ ⚪ ⚫ ⚪ ⚫  ← 整体左移
```

## 交互流程

1. 用户点击/框选 → `handleSamInteract`
2. SAM 解码 → `runSamDecode`
3. 应用候选 → `applySamCandidate`
4. **提取边缘** → `extractSamEdges`
5. **启动动画** → `startSamAnts`
6. 每 140ms 推进相位 → `drawSamAnts`
7. 用户拖拽/缩放画布 → `onViewChange` → **立即重绘**
8. 用户点"切换候选" → 重新提取边缘 → 重启动画
9. 切回 imgly / 重置 → `clearSamVisuals` → 停止动画

## 注意事项

1. **overlay 必须 `pointer-events: none`**：否则会拦截鼠标事件，用户无法交互主画布
2. **DPR 适配**：overlay 的物理分辨率要乘 DPR，否则高分屏模糊
3. **坐标同步**：绘制时必须用 `editor.imageToScreen` 转换坐标，跟随缩放/平移
4. **动画清理**：切换模式/unmount 时必须 `cancelAnimationFrame`，避免内存泄漏

## 文件变更

- `js/tools/bg-remove.js`：+190 行（新增 6 个可视化函数 + 集成调用）
- `css/style.css`：+8 行（sam-overlay 样式）

## 测试要点

- [ ] 选择"SAM 指定"后，点击物体能看到**蚁行线动画**
- [ ] 蚁行线应该是**黑白交替的动态边缘**，清晰贴合物体轮廓
- [ ] 选区内有**半透明蓝色填充**
- [ ] 拖拽/缩放画布时，蚁行线和填充**跟随移动**，位置准确
- [ ] 点"切换候选"时，蚁行线更新到新候选的边缘
- [ ] 切回"自动去背"时，蚁行线和填充**消失**
- [ ] 重新选择图片时，旧的蚁行线清除
- [ ] 动画流畅，无明显卡顿（140ms 一帧）

## 后续优化（可选）

1. **框选预览**：拖拽框选时，实时显示拖拽的框（虚线矩形）
2. **可调节透明度**：让用户调整填充的不透明度
3. **可切换填充**：提供"仅蚁行线"/"蚁行线+填充"两种模式
4. **边缘平滑**：对提取的边缘点做简单平滑（去除噪点）

---

**结论**：SAM 选区现在有了清晰的视觉反馈，用户体验和 SAM POC 工具一致。
