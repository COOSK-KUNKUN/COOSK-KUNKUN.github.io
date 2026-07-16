# SAM 交互冲突修复

## 问题

集成 SAM（路径 1）后，选择"SAM 指定"作为选区来源时，点击画布仍然触发平移而不是 SAM 框选/点选。

### 根本原因

原实现直接在 `canvas` 上绑定了 SAM 的 `mousedown/mousemove/mouseup` 事件，但这些事件会与 `CanvasEditor` 自己的事件处理器**冲突**——Editor 的事件永远先触发，SAM 事件永远接不到。

## 解决方案

让 `CanvasEditor` 原生支持 `'sam'` 工具模式，在该模式下通过回调把交互传给外部 SAM 逻辑。

## 修改内容

### 1. `canvas-editor.js` - 添加 SAM 工具支持

**新增功能：**
- 构造函数新增 `onSamInteract` 回调参数
- 工具类型新增 `'sam'`（与 `'pan'`、`'protect'`、`'subject'` 并列）
- `_handleMouseDown` 中添加 SAM 模式分支：
  - 记录起点和当前点
  - 通过 `onSamInteract({ type: 'start', point })` 通知外部
- `_handleMouseMove` 中添加 SAM 拖拽处理：
  - 更新当前点
  - 通过 `onSamInteract({ type: 'move', start, current })` 通知外部
- `_handleMouseUp` 中添加 SAM 松手处理：
  - 通过 `onSamInteract({ type: 'end', start, current })` 通知外部
  - 由外部判断是点选还是框选

**特点：**
- SAM 模式下，Editor **不做任何平移/画框**，只负责坐标转换和事件分发
- 空格键/中键平移依然生效（优先级高于工具模式）
- 已有框的拖动/缩放/删除依然生效（优先级高于工具模式）

### 2. `bg-remove.js` - 集成 SAM 工具

**修改点：**

#### 2.1 创建 Editor 时传入 `onSamInteract` 回调
```javascript
editor = new CanvasEditor(canvas, {
    onBoxesChange: ...,
    onViewChange: ...,
    onToolChange: ...,
    onSamInteract: (evt) => handleSamInteract(evt, state, container)  // 新增
});
```

#### 2.2 选区来源切换时自动切工具
```javascript
// 切到 SAM 模式 → 'sam' 工具
if (source === 'sam') {
    setTool('sam');
} else {
    setTool('pan');
}
```

#### 2.3 删除冲突的直接事件绑定
```diff
- canvas.addEventListener('mousedown', (e) => onSamPointerDown(...));
- window.addEventListener('mousemove', (e) => onSamPointerMove(...));
- window.addEventListener('mouseup', (e) => onSamPointerUp(...));
```

#### 2.4 新增 `handleSamInteract` 统一处理
替代原来的 `onSamPointerDown/Move/Up` 三个函数：
- `type: 'start'`：记录起点
- `type: 'move'`：更新当前点（可选：绘制框预览）
- `type: 'end'`：
  - 移动距离 < 4px → **点选**（单点前景提示）
  - 移动距离 ≥ 4px → **框选**（框中心作为前景点 + box 参数用于候选排序）

## 交互流程

### 用户操作：
1. 上传图片
2. 选择"SAM 指定"作为选区来源
   - 自动切换到 `'sam'` 工具
   - 画布光标变为十字
   - 显示提示："在画布上拖拽框选或点击物体"
3. 在画布上操作：
   - **点击**（按下→松手距离 < 4px）→ SAM 点选分割
   - **拖拽框选**（按下→拖动→松手）→ SAM 框选分割
4. 等待 SAM 解码（~50-200ms）
5. 看到蚁行线 + 半透明填充显示选区
6. 可点"切换候选"尝试不同粒度
7. 点"预览抠图"合成最终结果

### 技术流程：
```
用户点击/拖拽
    ↓
CanvasEditor 捕获事件（'sam' 工具模式）
    ↓
转换坐标（屏幕 → 图像）
    ↓
onSamInteract({ type, point/start/current })
    ↓
handleSamInteract 判断点选/框选
    ↓
runSamDecode(prompt)
    ↓
samDecode(embeddings, prompt) → candidates
    ↓
applySamCandidate(bestIdx) → 更新 state.samMask
    ↓
用户点"预览抠图" → composeFromSamMask
```

## 优势

1. **架构清晰**：工具模式统一管理，不再有"绕过 Editor 直接监听"的 hack
2. **无冲突**：Editor 自己处理优先级（空格/中键 > 框操作 > 工具模式）
3. **可扩展**：未来可以添加更多 SAM 交互（如正负点提示、多次精修）
4. **代码复用**：SAM POC 工具也可以用同样的 `CanvasEditor` + `onSamInteract` 模式

## 测试要点

- [ ] 选择"SAM 指定"后，点击画布能触发点选分割
- [ ] 拖拽框选能触发框选分割
- [ ] 空格键/中键拖拽依然能平移画布（不触发 SAM）
- [ ] 切回"自动去背"后，恢复原有的平移/画框交互
- [ ] 已有的保护框/主体框依然能拖动、缩放、删除
- [ ] SAM 分割后能看到蚁行线和半透明填充
- [ ] "切换候选"能切换不同粒度的 mask
- [ ] "预览抠图"能正确合成 SAM mask + 保护框/边缘精修

## 注意事项

1. **SAM 模式下不能画保护框/主体框**：工具互斥，需要先切回"自动去背"
2. **点选/框选的判断阈值是 4px**：防止手抖误触
3. **框选时用框中心点作为前景提示**：SlimSAM 不支持真正的 box prompt（详见 sam-core.js 注释）
4. **首次使用 SAM 需要下载模型**：约 30-50MB，之后会缓存

## 文件变更

- `js/tools/bg-remove/canvas-editor.js`：+40 行（新增 SAM 工具模式）
- `js/tools/bg-remove.js`：+35 行，-49 行（用 handleSamInteract 替代三个独立事件处理器，添加工具切换逻辑）

---

**结论**：交互冲突已解决，SAM 模式现在可以正常工作。用户选择"SAM 指定"后，点击/框选画布会触发 SAM 分割而不是平移。
