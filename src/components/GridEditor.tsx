import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Lock,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  Rows3,
  Search,
  Undo2,
  Unlock
} from "lucide-react";
import {
  findCell,
  maxColumnCount,
  matrixToTsv,
  parseTsv,
  readCell
} from "../lib/csv";
import type { CsvMatrix, CsvSelection, CsvTab } from "../types";
import { cellKey, normalizeSelection, singleCellSelection } from "../types";

const ROW_HEADER_WIDTH = 56;
const COLUMN_HEADER_HEIGHT = 30;
const DEFAULT_COL_WIDTH = 122;
const DEFAULT_ROW_HEIGHT = 28;
const MIN_COL_WIDTH = 54;
const OVERSCAN = 6;

type GridEditorProps = {
  tab: CsvTab;
  onSelectionChange(selection: CsvSelection): void;
  onSetCell(row: number, col: number, value: string): void;
  onPaste(startRow: number, startCol: number, values: string[][]): void;
  onClearRange(startRow: number, startCol: number, endRow: number, endCol: number): void;
  onToggleLock(startRow: number, startCol: number, endRow: number, endCol: number, locked: boolean): void;
  onSetZoom(zoom: number): void;
  onSetFreeze(rows: number, cols: number): void;
  onSetColWidth(col: number, width: number): void;
  onSetAutoRefresh(enabled: boolean): void;
  onSetFindQuery(query: string): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onInsertRows(startRow: number, endRow: number): void;
  onDeleteRows(startRow: number, endRow: number): void;
  onInsertColumns(startCol: number, endCol: number): void;
  onDeleteColumns(startCol: number, endCol: number): void;
  onAddRow(): void;
  onAddColumn(): void;
};

type ViewportState = {
  width: number;
  height: number;
  scrollTop: number;
  scrollLeft: number;
};

type EditingCell = {
  row: number;
  col: number;
  value: string;
} | null;

export function GridEditor({
  tab,
  onSelectionChange,
  onSetCell,
  onPaste,
  onClearRange,
  onToggleLock,
  onSetZoom,
  onSetFreeze,
  onSetColWidth,
  onSetAutoRefresh,
  onSetFindQuery,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onInsertRows,
  onDeleteRows,
  onInsertColumns,
  onDeleteColumns,
  onAddRow,
  onAddColumn
}: GridEditorProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    width: 800,
    height: 500,
    scrollTop: 0,
    scrollLeft: 0
  });
  const [editing, setEditing] = useState<EditingCell>(null);
  const [dragging, setDragging] = useState(false);
  const [resizeState, setResizeState] = useState<{
    col: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const selectionRange = normalizeSelection(tab.selection);
  const selectedValue = readCell(tab.data, tab.selection.focusRow, tab.selection.focusCol);
  const lockedSet = useMemo(() => new Set(tab.lockedCells), [tab.lockedCells]);
  const maxCols = Math.max(20, maxColumnCount(tab.data) + 4);
  const rowCount = Math.max(40, tab.data.length + 12);
  const rowHeight = Math.round(DEFAULT_ROW_HEIGHT * tab.zoom);
  const headerHeight = Math.round(COLUMN_HEADER_HEIGHT * tab.zoom);
  const rowHeaderWidth = Math.round(ROW_HEADER_WIDTH * tab.zoom);

  const colWidths = useMemo(() => {
    const widths: number[] = [];
    for (let col = 0; col < maxCols; col += 1) {
      widths[col] = Math.round((tab.colWidths[col] ?? DEFAULT_COL_WIDTH) * tab.zoom);
    }
    return widths;
  }, [maxCols, tab.colWidths, tab.zoom]);

  const colOffsets = useMemo(() => {
    const offsets = [0];
    for (let col = 0; col < maxCols; col += 1) {
      offsets[col + 1] = offsets[col] + colWidths[col];
    }
    return offsets;
  }, [colWidths, maxCols]);

  const totalWidth = rowHeaderWidth + colOffsets[maxCols];
  const totalHeight = headerHeight + rowCount * rowHeight;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setViewport((current) => ({
        ...current,
        width: element.clientWidth,
        height: element.clientHeight
      }));
    });
    observer.observe(element);
    setViewport((current) => ({
      ...current,
      width: element.clientWidth,
      height: element.clientHeight
    }));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!resizeState) {
      return undefined;
    }
    const onMove = (event: PointerEvent) => {
      const delta = (event.clientX - resizeState.startX) / tab.zoom;
      onSetColWidth(resizeState.col, Math.max(MIN_COL_WIDTH, Math.round(resizeState.startWidth + delta)));
    };
    const onUp = () => setResizeState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onSetColWidth, resizeState, tab.zoom]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }
    const selectedLeft = rowHeaderWidth + colOffsets[tab.selection.focusCol];
    const selectedRight = rowHeaderWidth + colOffsets[tab.selection.focusCol + 1];
    const selectedTop = headerHeight + tab.selection.focusRow * rowHeight;
    const selectedBottom = selectedTop + rowHeight;

    if (selectedLeft < viewportElement.scrollLeft + rowHeaderWidth) {
      viewportElement.scrollLeft = Math.max(0, selectedLeft - rowHeaderWidth);
    } else if (selectedRight > viewportElement.scrollLeft + viewportElement.clientWidth) {
      viewportElement.scrollLeft = selectedRight - viewportElement.clientWidth;
    }

    if (selectedTop < viewportElement.scrollTop + headerHeight) {
      viewportElement.scrollTop = Math.max(0, selectedTop - headerHeight);
    } else if (selectedBottom > viewportElement.scrollTop + viewportElement.clientHeight) {
      viewportElement.scrollTop = selectedBottom - viewportElement.clientHeight;
    }
  }, [colOffsets, headerHeight, rowHeaderWidth, rowHeight, tab.selection.focusCol, tab.selection.focusRow]);

  const visibleRows = useMemo(() => {
    const start = clamp(Math.floor((viewport.scrollTop - headerHeight) / rowHeight) - OVERSCAN, 0, rowCount - 1);
    const end = clamp(
      Math.ceil((viewport.scrollTop + viewport.height - headerHeight) / rowHeight) + OVERSCAN,
      0,
      rowCount - 1
    );
    const rows = new Set<number>();
    for (let row = 0; row < tab.freezeRows && row < rowCount; row += 1) {
      rows.add(row);
    }
    for (let row = start; row <= end; row += 1) {
      rows.add(row);
    }
    return [...rows].sort((left, right) => left - right);
  }, [headerHeight, rowCount, rowHeight, tab.freezeRows, viewport.height, viewport.scrollTop]);

  const visibleCols = useMemo(() => {
    const left = Math.max(0, viewport.scrollLeft - rowHeaderWidth);
    const right = Math.max(0, viewport.scrollLeft + viewport.width - rowHeaderWidth);
    const start = clamp(findColumnAtOffset(colOffsets, left) - OVERSCAN, 0, maxCols - 1);
    const end = clamp(findColumnAtOffset(colOffsets, right) + OVERSCAN, 0, maxCols - 1);
    const cols = new Set<number>();
    for (let col = 0; col < tab.freezeCols && col < maxCols; col += 1) {
      cols.add(col);
    }
    for (let col = start; col <= end; col += 1) {
      cols.add(col);
    }
    return [...cols].sort((leftCol, rightCol) => leftCol - rightCol);
  }, [colOffsets, maxCols, rowHeaderWidth, tab.freezeCols, viewport.scrollLeft, viewport.width]);

  const selectedLabel = `${columnName(tab.selection.focusCol)}${tab.selection.focusRow + 1}`;
  const selectedLocked = lockedSet.has(cellKey(tab.selection.focusRow, tab.selection.focusCol));
  const rangeLocked = rangeHasLocked(lockedSet, selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
  const findAvailable = tab.findQuery.trim().length > 0;

  const commitEditing = () => {
    if (!editing) {
      return;
    }
    if (!lockedSet.has(cellKey(editing.row, editing.col))) {
      onSetCell(editing.row, editing.col, editing.value);
    }
    setEditing(null);
  };

  const beginEdit = (row = tab.selection.focusRow, col = tab.selection.focusCol, seed?: string) => {
    if (lockedSet.has(cellKey(row, col))) {
      return;
    }
    setEditing({
      row,
      col,
      value: seed ?? readCell(tab.data, row, col)
    });
  };

  const moveSelection = (rowDelta: number, colDelta: number, extend: boolean) => {
    const nextRow = clamp(tab.selection.focusRow + rowDelta, 0, rowCount - 1);
    const nextCol = clamp(tab.selection.focusCol + colDelta, 0, maxCols - 1);
    onSelectionChange(
      extend
        ? { ...tab.selection, focusRow: nextRow, focusCol: nextCol }
        : singleCellSelection(nextRow, nextCol)
    );
  };

  const runFind = (direction: "next" | "previous") => {
    const result = findCell(tab.data, tab.findQuery, tab.selection.focusRow, tab.selection.focusCol, direction);
    if (result) {
      onSelectionChange(singleCellSelection(result.row, result.col));
    }
  };

  const handleGridKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      onRedo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      await navigator.clipboard.writeText(
        matrixToTsv(
          tab.data,
          selectionRange.startRow,
          selectionRange.startCol,
          selectionRange.endRow,
          selectionRange.endCol
        )
      );
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      return;
    }

    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdit();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(0, -1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(0, 1, event.shiftKey);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelection(0, event.shiftKey ? -1 : 1, false);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      beginEdit(tab.selection.focusRow, tab.selection.focusCol, event.key);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!text) {
      return;
    }
    event.preventDefault();
    onPaste(tab.selection.focusRow, tab.selection.focusCol, parseTsv(text));
  };

  return (
    <section className="grid-shell">
      <div className="formula-bar">
        <span className="cell-name">{selectedLabel}</span>
        <input
          value={selectedValue}
          onChange={(event) => onSetCell(tab.selection.focusRow, tab.selection.focusCol, event.target.value)}
          disabled={selectedLocked}
          aria-label="Selected cell value"
        />
        <span className={`lock-state ${selectedLocked ? "locked" : ""}`}>{selectedLocked ? "已锁定" : "可编辑"}</span>
      </div>

      <div className="grid-tools">
        <button className="icon-button" onClick={onUndo} disabled={!canUndo} title="撤销">
          <Undo2 size={15} />
        </button>
        <button className="icon-button" onClick={onRedo} disabled={!canRedo} title="重做">
          <Redo2 size={15} />
        </button>
        <button
          className="tool-button"
          onClick={() =>
            onToggleLock(
              selectionRange.startRow,
              selectionRange.startCol,
              selectionRange.endRow,
              selectionRange.endCol,
              !rangeLocked
            )
          }
          title={rangeLocked ? "解除选区锁定" : "锁定选区，防止误改"}
        >
          {rangeLocked ? <Unlock size={15} /> : <Lock size={15} />}
          {rangeLocked ? "解锁选区" : "锁定选区"}
        </button>
        <button
          className="tool-button"
          onClick={() => onSetFreeze(tab.selection.focusRow, tab.selection.focusCol)}
          title="冻结到当前格，保持左上区域可见"
        >
          <Rows3 size={15} />
          冻结至当前格
        </button>
        <button className="tool-button" onClick={() => onSetFreeze(0, 0)} title="取消冻结">
          <Columns3 size={15} />
          取消冻结
        </button>
        <button className="icon-button" onClick={() => onSetZoom(Math.max(0.7, tab.zoom - 0.1))} title="缩小格子">
          <Minus size={15} />
        </button>
        <input
          className="zoom-slider"
          type="range"
          min="0.7"
          max="1.7"
          step="0.05"
          value={tab.zoom}
          onChange={(event) => onSetZoom(Number(event.target.value))}
          aria-label="Cell zoom"
        />
        <button className="icon-button" onClick={() => onSetZoom(Math.min(1.7, tab.zoom + 0.1))} title="放大格子">
          <Plus size={15} />
        </button>
        <span className="zoom-label">{Math.round(tab.zoom * 100)}%</span>
        <button className="tool-button" onClick={() => onInsertRows(selectionRange.startRow, selectionRange.endRow)}>
          <Plus size={15} />
          插行
        </button>
        <button className="tool-button" onClick={() => onDeleteRows(selectionRange.startRow, selectionRange.endRow)}>
          <Minus size={15} />
          删行
        </button>
        <button className="tool-button" onClick={() => onInsertColumns(selectionRange.startCol, selectionRange.endCol)}>
          <Plus size={15} />
          插列
        </button>
        <button className="tool-button" onClick={() => onDeleteColumns(selectionRange.startCol, selectionRange.endCol)}>
          <Minus size={15} />
          删列
        </button>
        <button className="tool-button" onClick={onAddRow}>
          增行
        </button>
        <button className="tool-button" onClick={onAddColumn}>
          增列
        </button>
        <label className="grid-search">
          <Search size={15} />
          <input
            value={tab.findQuery}
            onChange={(event) => onSetFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runFind(event.shiftKey ? "previous" : "next");
              }
            }}
            placeholder="查找"
          />
        </label>
        <button className="icon-button" onClick={() => runFind("previous")} disabled={!findAvailable} title="上一处">
          <ChevronUp size={15} />
        </button>
        <button className="icon-button" onClick={() => runFind("next")} disabled={!findAvailable} title="下一处">
          <ChevronDown size={15} />
        </button>
        <button
          className={`tool-button ${tab.autoRefresh ? "active-toggle" : ""}`}
          onClick={() => onSetAutoRefresh(!tab.autoRefresh)}
          title={tab.autoRefresh ? "磁盘变化时自动刷新干净页签" : "暂停自动应用磁盘变化，只标记提示"}
        >
          {tab.autoRefresh ? <Play size={15} /> : <Pause size={15} />}
          {tab.autoRefresh ? "自动热刷" : "热刷暂停"}
        </button>
      </div>

      <div
        className="grid-viewport"
        ref={viewportRef}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          setViewport((current) => ({
            ...current,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft
          }));
        }}
        onKeyDown={handleGridKeyDown}
        onPaste={handlePaste}
        onPointerLeave={() => setDragging(false)}
      >
        <div className="grid-canvas" style={{ width: totalWidth, height: totalHeight }}>
          <div
            className="grid-corner"
            style={{
              width: rowHeaderWidth,
              height: headerHeight,
              left: viewport.scrollLeft,
              top: viewport.scrollTop
            }}
          />

          {visibleCols.map((col) => {
            const frozen = col < tab.freezeCols;
            const left = frozen ? viewport.scrollLeft + rowHeaderWidth + colOffsets[col] : rowHeaderWidth + colOffsets[col];
            return (
              <div
                key={`h-${col}`}
                className={`column-header ${frozen ? "frozen" : ""}`}
                style={{
                  left,
                  top: viewport.scrollTop,
                  width: colWidths[col],
                  height: headerHeight
                }}
              >
                {columnName(col)}
                <span
                  className="column-resizer"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setResizeState({
                      col,
                      startX: event.clientX,
                      startWidth: tab.colWidths[col] ?? DEFAULT_COL_WIDTH
                    });
                  }}
                />
              </div>
            );
          })}

          {visibleRows.map((row) => {
            const frozen = row < tab.freezeRows;
            return (
              <div
                key={`r-${row}`}
                className={`row-header ${frozen ? "frozen" : ""}`}
                style={{
                  left: viewport.scrollLeft,
                  top: frozen ? viewport.scrollTop + headerHeight + row * rowHeight : headerHeight + row * rowHeight,
                  width: rowHeaderWidth,
                  height: rowHeight
                }}
              >
                {row + 1}
              </div>
            );
          })}

          {visibleRows.flatMap((row) =>
            visibleCols.map((col) => {
              const key = cellKey(row, col);
              const selected =
                row >= selectionRange.startRow &&
                row <= selectionRange.endRow &&
                col >= selectionRange.startCol &&
                col <= selectionRange.endCol;
              const focus = row === tab.selection.focusRow && col === tab.selection.focusCol;
              const locked = lockedSet.has(key);
              const frozenRow = row < tab.freezeRows;
              const frozenCol = col < tab.freezeCols;
              const left = frozenCol ? viewport.scrollLeft + rowHeaderWidth + colOffsets[col] : rowHeaderWidth + colOffsets[col];
              const top = frozenRow ? viewport.scrollTop + headerHeight + row * rowHeight : headerHeight + row * rowHeight;
              const isEditing = editing?.row === row && editing.col === col;

              return (
                <div
                  key={`${row}-${col}`}
                  className={`grid-cell ${selected ? "selected" : ""} ${focus ? "focus" : ""} ${
                    locked ? "locked" : ""
                  } ${frozenRow || frozenCol ? "frozen" : ""}`}
                  style={{
                    left,
                    top,
                    width: colWidths[col],
                    height: rowHeight,
                    lineHeight: `${rowHeight - 2}px`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setDragging(true);
                    onSelectionChange(singleCellSelection(row, col));
                    viewportRef.current?.focus();
                  }}
                  onPointerEnter={() => {
                    if (dragging) {
                      onSelectionChange({ ...tab.selection, focusRow: row, focusCol: col });
                    }
                  }}
                  onDoubleClick={() => beginEdit(row, col)}
                  title={locked ? "该格已锁定" : undefined}
                >
                  {isEditing ? (
                    <input
                      className="cell-editor"
                      value={editing.value}
                      autoFocus
                      onChange={(event) => setEditing({ row, col, value: event.target.value })}
                      onBlur={commitEditing}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitEditing();
                          moveSelection(1, 0, false);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setEditing(null);
                        } else if (event.key === "Tab") {
                          event.preventDefault();
                          commitEditing();
                          moveSelection(0, event.shiftKey ? -1 : 1, false);
                        }
                      }}
                    />
                  ) : (
                    readCell(tab.data, row, col)
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid-status">
        <span>
          {tab.data.length} 行 / {maxColumnCount(tab.data)} 列
        </span>
        <span>选区 {selectionRange.endRow - selectionRange.startRow + 1} x {selectionRange.endCol - selectionRange.startCol + 1}</span>
        <span>冻结 {tab.freezeRows} 行 / {tab.freezeCols} 列</span>
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function findColumnAtOffset(offsets: number[], target: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid + 1] < target) {
      low = mid + 1;
    } else if (offsets[mid] > target) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(offsets.length - 2, low));
}

function columnName(index: number): string {
  let name = "";
  let cursor = index + 1;
  while (cursor > 0) {
    const mod = (cursor - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    cursor = Math.floor((cursor - mod) / 26);
  }
  return name;
}

function rangeHasLocked(
  lockedSet: Set<string>,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): boolean {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      if (lockedSet.has(cellKey(row, col))) {
        return true;
      }
    }
  }
  return false;
}
