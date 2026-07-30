/**
 * 像素编辑核心 — 画笔/橡皮/吸管/填充/撤销重做
 * 参考：拼豆参考/perler-beads-master/src/utils/pixelEditingUtils.ts
 */

const HISTORY_LIMIT = 50;

/** 透明格子 */
export const TRANSPARENT_CELL = { hex: null, systems: null, transparent: true };

/**
 * 深拷贝 cells 二维数组
 */
export function cloneCells(cells) {
    return cells.map(row => row.map(cell => ({ ...cell })));
}

/**
 * 单格上色
 * @param {Array<Array>} cells 当前网格
 * @param {number} row 行
 * @param {number} col 列
 * @param {object} colorData { hex, systems } 颜色数据
 * @returns {{ cells: Array, changed: boolean, prevCell: object }}
 */
export function paintCell(cells, row, col, colorData) {
    const newCells = cloneCells(cells);
    const prevCell = { ...newCells[row][col] };
    const cur = newCells[row][col];
    if (cur.hex === colorData.hex && !cur.transparent && !colorData.transparent) {
        return { cells, changed: false, prevCell };
    }
    newCells[row][col] = { hex: colorData.hex, systems: colorData.systems, transparent: false };
    return { cells: newCells, changed: true, prevCell };
}

/**
 * 擦除单格（设为透明）
 */
export function eraseCell(cells, row, col) {
    const newCells = cloneCells(cells);
    const prevCell = { ...newCells[row][col] };
    if (newCells[row][col].transparent) {
        return { cells, changed: false, prevCell };
    }
    newCells[row][col] = { ...TRANSPARENT_CELL };
    return { cells: newCells, changed: true, prevCell };
}

/**
 * 吸管取色 — 返回该格的颜色数据
 */
export function pickColor(cells, row, col) {
    const cell = cells[row][col];
    if (cell.transparent) return null;
    return { hex: cell.hex, systems: cell.systems };
}

/**
 * 洪水填充 — 连通区域填色
 * @param {Array<Array>} cells 当前网格
 * @param {number} startRow 起始行
 * @param {number} startCol 起始列
 * @param {object} colorData 目标颜色
 * @param {number} N 列数
 * @param {number} M 行数
 * @returns {{ cells: Array, changed: boolean }}
 */
export function floodFill(cells, startRow, startCol, colorData, N, M) {
    const target = cells[startRow][startCol];
    if (target.transparent && colorData.transparent) {
        return { cells, changed: false };
    }
    if (!target.transparent && target.hex === colorData.hex) {
        return { cells, changed: false };
    }

    const newCells = cloneCells(cells);
    const visited = Array.from({ length: M }, () => Array(N).fill(false));
    const stack = [{ row: startRow, col: startCol }];
    let changed = false;

    while (stack.length > 0) {
        const { row, col } = stack.pop();
        if (row < 0 || row >= M || col < 0 || col >= N || visited[row][col]) continue;
        const cur = newCells[row][col];
        const isTarget = target.transparent
            ? cur.transparent
            : (!cur.transparent && cur.hex === target.hex);
        if (!isTarget) continue;
        visited[row][col] = true;
        newCells[row][col] = colorData.transparent
            ? { ...TRANSPARENT_CELL }
            : { hex: colorData.hex, systems: colorData.systems, transparent: false };
        changed = true;
        stack.push(
            { row: row - 1, col },
            { row: row + 1, col },
            { row, col: col - 1 },
            { row, col: col + 1 }
        );
    }

    return { cells: newCells, changed };
}

/**
 * 保存快照到撤销栈
 * @param {Array} history 撤销栈
 * @param {Array} cells 当前网格
 * @returns {Array} 新撤销栈
 */
export function pushHistory(history, cells) {
    const newHistory = [...history, cloneCells(cells)];
    if (newHistory.length > HISTORY_LIMIT) {
        newHistory.shift();
    }
    return newHistory;
}

/**
 * 撤销
 * @returns {{ cells, history, redoStack }} 或 null（无法撤销）
 */
export function undo(history, redoStack, currentCells) {
    if (history.length === 0) return null;
    const prev = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const newRedoStack = [...redoStack, cloneCells(currentCells)];
    return { cells: prev, history: newHistory, redoStack: newRedoStack };
}

/**
 * 重做
 * @returns {{ cells, history, redoStack }} 或 null（无法重做）
 */
export function redo(history, redoStack, currentCells) {
    if (redoStack.length === 0) return null;
    const next = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    const newHistory = [...history, cloneCells(currentCells)];
    return { cells: next, history: newHistory, redoStack: newRedoStack };
}

/**
 * 重新统计颜色
 */
export function recountColors(cells) {
    const counts = new Map();
    for (const row of cells) {
        for (const cell of row) {
            if (cell.transparent || !cell.hex) continue;
            const key = cell.hex.toUpperCase();
            if (!counts.has(key)) {
                counts.set(key, { hex: cell.hex, systems: cell.systems, count: 0 });
            }
            counts.get(key).count++;
        }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}
