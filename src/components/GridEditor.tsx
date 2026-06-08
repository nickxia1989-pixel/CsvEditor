import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Lock,
  Minus,
  PaintBucket,
  Pause,
  Play,
  Plus,
  Redo2,
  Rows3,
  Search,
  Type,
  Undo2,
  Unlock
} from "lucide-react";
import {
  maxColumnCount,
  matrixToTsv,
  parseTsv,
  readCell,
  writeCell
} from "../lib/csv";
import type { CsvCellStyle, CsvMatrix, CsvSelection, CsvTab, FindResultCell, GridScrollPosition } from "../types";
import { cellKey, normalizeSelection, singleCellSelection } from "../types";

const ROW_HEADER_WIDTH = 56;
const COLUMN_HEADER_HEIGHT = 30;
const DEFAULT_COL_WIDTH = 122;
const DEFAULT_ROW_HEIGHT = 28;
const MIN_COL_WIDTH = 54;
const OVERSCAN = 6;
export const COMMIT_ACTIVE_EDIT_EVENT = "csv-editor:commit-active-edit";
const TEXT_COLOR_PRESETS = ["#172026", "#b42318", "#0f766e", "#1d4ed8"];
const BACKGROUND_COLOR_PRESETS = ["#ffffff", "#fff3bf", "#dff0ee", "#eaf3ff"];

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
  onSetReplaceValue(value: string): void;
  onSetStatus(status: string): void;
  onEditDraftDirtyChange(dirty: boolean): void;
  scrollPosition: GridScrollPosition;
  onScrollPositionChange(tabId: string, position: GridScrollPosition): void;
  onReplaceCurrent(): void;
  onReplaceAll(): void;
  onReplaceFindResults(results: FindResultCell[]): void;
  onApplyCellStyle(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    stylePatch: Partial<CsvCellStyle>
  ): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onSaveRequest(): void;
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
  onSetReplaceValue,
  onSetStatus,
  onEditDraftDirtyChange,
  scrollPosition,
  onScrollPositionChange,
  onReplaceCurrent,
  onReplaceAll,
  onReplaceFindResults,
  onApplyCellStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSaveRequest,
  onInsertRows,
  onDeleteRows,
  onInsertColumns,
  onDeleteColumns,
  onAddRow,
  onAddColumn
}: GridEditorProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keyProxyRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const composingInputRef = useRef(false);
  const suppressNextSelectionScrollRef = useRef(false);
  const pendingGridFocusRef = useRef(false);
  const [viewport, setViewport] = useState<ViewportState>({
    width: 800,
    height: 500,
    scrollTop: 0,
    scrollLeft: 0
  });
  const [editing, setEditing] = useState<EditingCell>(null);
  const [dragging, setDragging] = useState(false);
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findInSelection, setFindInSelection] = useState(false);
  const [resizeState, setResizeState] = useState<{
    col: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [copiedRange, setCopiedRange] = useState<ReturnType<typeof normalizeSelection> | null>(null);
  const copiedTextRef = useRef<string | null>(null);
  const clipboardEventSerialRef = useRef(0);

  useEffect(() => {
    setFindPanelOpen(false);
    setFindInSelection(false);
  }, [tab.id]);

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

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = clamp(scrollPosition.scrollTop, 0, Math.max(0, totalHeight - element.clientHeight));
    const nextScrollLeft = clamp(scrollPosition.scrollLeft, 0, Math.max(0, totalWidth - element.clientWidth));
    suppressNextSelectionScrollRef.current = true;
    element.scrollTop = nextScrollTop;
    element.scrollLeft = nextScrollLeft;
    const nextViewport = {
      width: element.clientWidth,
      height: element.clientHeight,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft
    };
    setViewport(nextViewport);
    onScrollPositionChange(tab.id, {
      scrollTop: nextViewport.scrollTop,
      scrollLeft: nextViewport.scrollLeft
    });
  }, [tab.id]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return undefined;
    }
    const updateViewportNow = () => {
      const nextViewport = {
        width: element.clientWidth,
        height: element.clientHeight,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft
      };
      setViewport(nextViewport);
      onScrollPositionChange(tab.id, {
        scrollTop: nextViewport.scrollTop,
        scrollLeft: nextViewport.scrollLeft
      });
    };
    const scheduleViewportUpdate = () => {
      if (viewportFrameRef.current !== null) {
        return;
      }
      viewportFrameRef.current = window.requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        const nextViewport = {
          width: element.clientWidth,
          height: element.clientHeight,
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft
        };
        setViewport(nextViewport);
        onScrollPositionChange(tab.id, {
          scrollTop: nextViewport.scrollTop,
          scrollLeft: nextViewport.scrollLeft
        });
      });
    };
    const observer = new ResizeObserver(updateViewportNow);
    observer.observe(element);
    element.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
    updateViewportNow();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", scheduleViewportUpdate);
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
      }
    };
  }, [onScrollPositionChange, tab.id]);

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
    if (!dragging) {
      return undefined;
    }
    const stopDragging = () => {
      dragAnchorRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointerup", stopDragging, { once: true });
    window.addEventListener("blur", stopDragging, { once: true });
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("blur", stopDragging);
    };
  }, [dragging]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }
    if (suppressNextSelectionScrollRef.current) {
      suppressNextSelectionScrollRef.current = false;
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
  const selectedStyle = tab.cellStyles[cellKey(tab.selection.focusRow, tab.selection.focusCol)] ?? {};
  const editingDirty = Boolean(
    editing &&
      !lockedSet.has(cellKey(editing.row, editing.col)) &&
      editing.value !== readCell(tab.data, editing.row, editing.col)
  );
  const rangeLocked = rangeHasLocked(lockedSet, selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
  const findAvailable = tab.findQuery.trim().length > 0;
  const realEndRow = Math.max(0, tab.data.length - 1);
  const realEndCol = Math.max(0, maxColumnCount(tab.data) - 1);
  const freezeRowCount = clamp(tab.freezeRows, 0, rowCount);
  const freezeColCount = clamp(tab.freezeCols, 0, maxCols);
  const frozenRows = useMemo(() => numberRange(freezeRowCount), [freezeRowCount]);
  const frozenCols = useMemo(() => numberRange(freezeColCount), [freezeColCount]);
  const bodyRows = useMemo(() => visibleRows.filter((row) => row >= freezeRowCount), [freezeRowCount, visibleRows]);
  const bodyCols = useMemo(() => visibleCols.filter((col) => col >= freezeColCount), [freezeColCount, visibleCols]);
  const frozenWidth = colOffsets[freezeColCount] ?? 0;
  const frozenHeight = freezeRowCount * rowHeight;
  const stickyTopHeight = headerHeight + frozenHeight;
  const stickyLeftWidth = rowHeaderWidth + frozenWidth;

  const clearCopiedState = () => {
    copiedTextRef.current = null;
    setCopiedRange(null);
  };

  const markClipboardEventHandled = () => {
    clipboardEventSerialRef.current += 1;
  };

  useEffect(() => {
    setEditing(null);
    setResizeState(null);
    clearCopiedState();
    onEditDraftDirtyChange(false);
    dragAnchorRef.current = null;
    pendingGridFocusRef.current = false;
    setDragging(false);
  }, [onEditDraftDirtyChange, tab.id]);

  const resetKeyProxyValue = () => {
    if (keyProxyRef.current) {
      keyProxyRef.current.value = "";
    }
  };

  const focusGridInput = () => {
    resetKeyProxyValue();
    const target = keyProxyRef.current ?? viewportRef.current;
    target?.focus({ preventScroll: true });
  };

  const focusGridInputSoon = () => {
    pendingGridFocusRef.current = true;
    focusGridInput();
    window.requestAnimationFrame(() => {
      if (!pendingGridFocusRef.current) {
        return;
      }
      pendingGridFocusRef.current = false;
      focusGridInput();
    });
  };

  const commitEditing = (refocusGrid = false) => {
    if (!editing) {
      return;
    }
    if (!lockedSet.has(cellKey(editing.row, editing.col))) {
      onSetCell(editing.row, editing.col, editing.value);
    }
    setEditing(null);
    onEditDraftDirtyChange(false);
    composingInputRef.current = false;
    resetKeyProxyValue();
    if (refocusGrid) {
      focusGridInputSoon();
    }
  };

  const runAfterCommittingEditAndClearingCopiedRange = (action: () => void) => {
    commitEditing(false);
    clearCopiedState();
    action();
  };

  const runAfterCommittingEdit = (action: () => void) => {
    commitEditing(false);
    action();
  };

  const commitEditingAndRequestSave = () => {
    commitEditing(true);
    window.setTimeout(onSaveRequest, 0);
  };

  const beginEdit = (row = tab.selection.focusRow, col = tab.selection.focusCol, seed?: string) => {
    if (lockedSet.has(cellKey(row, col))) {
      return;
    }
    clearCopiedState();
    composingInputRef.current = false;
    resetKeyProxyValue();
    const currentValue = readCell(tab.data, row, col);
    const nextValue = seed ?? currentValue;
    onEditDraftDirtyChange(nextValue !== currentValue);
    setEditing({
      row,
      col,
      value: nextValue
    });
  };

  const beginEditFromKeyboardText = (text: string) => {
    if (!text) {
      return;
    }
    beginEdit(tab.selection.focusRow, tab.selection.focusCol, text);
    if (keyProxyRef.current) {
      keyProxyRef.current.value = "";
    }
  };

  const handleKeyProxyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (editing || composingInputRef.current) {
      return;
    }
    beginEditFromKeyboardText(event.currentTarget.value);
  };

  const handleKeyProxyCompositionEnd = (event: React.CompositionEvent<HTMLInputElement>) => {
    composingInputRef.current = false;
    beginEditFromKeyboardText(event.currentTarget.value || event.data);
  };

  useEffect(() => {
    if (!editing) {
      resetKeyProxyValue();
      composingInputRef.current = false;
    }
  }, [editing, tab.selection.anchorCol, tab.selection.anchorRow, tab.selection.focusCol, tab.selection.focusRow]);

  useLayoutEffect(() => {
    if (!pendingGridFocusRef.current || editing) {
      return;
    }
    pendingGridFocusRef.current = false;
    focusGridInput();
  }, [editing, tab.selection.anchorCol, tab.selection.anchorRow, tab.selection.focusCol, tab.selection.focusRow]);

  useEffect(() => {
    const handleCommitActiveEdit = () => commitEditing(false);
    window.addEventListener(COMMIT_ACTIVE_EDIT_EVENT, handleCommitActiveEdit);
    return () => window.removeEventListener(COMMIT_ACTIVE_EDIT_EVENT, handleCommitActiveEdit);
  });

  const updateDragSelection = (row: number, col: number) => {
    const anchor = dragAnchorRef.current;
    if (!anchor) {
      return;
    }
    onSelectionChange({
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      focusRow: clamp(row, 0, rowCount - 1),
      focusCol: clamp(col, 0, maxCols - 1)
    });
  };

  const updateDragSelectionFromPointer = (clientX: number, clientY: number) => {
    const element = viewportRef.current;
    const anchor = dragAnchorRef.current;
    if (!element || !anchor) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const edgeSize = 34;
    let nextScrollTop = element.scrollTop;
    let nextScrollLeft = element.scrollLeft;

    if (clientY > rect.bottom - edgeSize) {
      nextScrollTop += rowHeight;
    } else if (clientY < rect.top + edgeSize) {
      nextScrollTop -= rowHeight;
    }
    if (clientX > rect.right - edgeSize) {
      nextScrollLeft += DEFAULT_COL_WIDTH * tab.zoom;
    } else if (clientX < rect.left + edgeSize) {
      nextScrollLeft -= DEFAULT_COL_WIDTH * tab.zoom;
    }

    element.scrollTop = Math.max(0, nextScrollTop);
    element.scrollLeft = Math.max(0, nextScrollLeft);

    const offsetX = Math.max(0, clientX - rect.left + element.scrollLeft - rowHeaderWidth);
    const offsetY = Math.max(0, clientY - rect.top + element.scrollTop - headerHeight);
    const row = clamp(Math.floor(offsetY / rowHeight), 0, rowCount - 1);
    const col = clamp(findColumnAtOffset(colOffsets, offsetX), 0, maxCols - 1);
    updateDragSelection(row, col);
  };

  const setSelectionFocus = (row: number, col: number, extend: boolean) => {
    const nextRow = clamp(row, 0, rowCount - 1);
    const nextCol = clamp(col, 0, maxCols - 1);
    onSelectionChange(
      extend
        ? { ...tab.selection, focusRow: nextRow, focusCol: nextCol }
        : singleCellSelection(nextRow, nextCol)
    );
  };

  const moveSelection = (rowDelta: number, colDelta: number, extend: boolean) => {
    setSelectionFocus(tab.selection.focusRow + rowDelta, tab.selection.focusCol + colDelta, extend);
  };

  const moveSelectionToUsedEdge = (direction: "up" | "down" | "left" | "right", extend: boolean) => {
    if (direction === "up") {
      setSelectionFocus(0, tab.selection.focusCol, extend);
    } else if (direction === "down") {
      setSelectionFocus(realEndRow, tab.selection.focusCol, extend);
    } else if (direction === "left") {
      setSelectionFocus(tab.selection.focusRow, 0, extend);
    } else {
      setSelectionFocus(tab.selection.focusRow, realEndCol, extend);
    }
  };

  const pageRowDelta = Math.max(1, Math.floor(Math.max(rowHeight, (viewport.height || 500) - headerHeight) / rowHeight));

  const dataWithEditingDraft = () =>
    editing && !lockedSet.has(cellKey(editing.row, editing.col))
      ? writeCell(tab.data, editing.row, editing.col, editing.value)
      : tab.data;

  const findResults = useMemo(() => {
    const query = tab.findQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const searchableData = dataWithEditingDraft();
    const usedEndRow = searchableData.length - 1;
    const usedEndCol = maxColumnCount(searchableData) - 1;
    if (usedEndRow < 0 || usedEndCol < 0) {
      return [];
    }

    const scope = findInSelection
      ? {
          startRow: Math.max(0, selectionRange.startRow),
          endRow: Math.min(selectionRange.endRow, usedEndRow),
          startCol: Math.max(0, selectionRange.startCol),
          endCol: Math.min(selectionRange.endCol, usedEndCol)
        }
      : {
          startRow: 0,
          endRow: usedEndRow,
          startCol: 0,
          endCol: usedEndCol
        };

    if (scope.startRow > scope.endRow || scope.startCol > scope.endCol) {
      return [];
    }

    const results: Array<FindResultCell & { value: string; locked: boolean }> = [];
    for (let row = scope.startRow; row <= scope.endRow; row += 1) {
      for (let col = scope.startCol; col <= scope.endCol; col += 1) {
        const value = readCell(searchableData, row, col);
        if (value.toLowerCase().includes(query)) {
          results.push({ row, col, value, locked: lockedSet.has(cellKey(row, col)) });
        }
      }
    }
    return results;
  }, [
    editing,
    findInSelection,
    lockedSet,
    selectionRange.endCol,
    selectionRange.endRow,
    selectionRange.startCol,
    selectionRange.startRow,
    tab.data,
    tab.findQuery
  ]);

  const activeFindResultIndex = findResults.findIndex(
    (result) => result.row === tab.selection.focusRow && result.col === tab.selection.focusCol
  );
  const visibleFindResults = findResults.slice(0, 100);

  const copySelectionToInternalBuffer = (statusSuffix = "") => {
    const text = matrixToTsv(
      tab.data,
      selectionRange.startRow,
      selectionRange.startCol,
      selectionRange.endRow,
      selectionRange.endCol
    );
    copiedTextRef.current = text;
    setCopiedRange(selectionRange);
    onSetStatus(
      `已复制 ${selectionRange.endRow - selectionRange.startRow + 1} x ${selectionRange.endCol - selectionRange.startCol + 1}${statusSuffix}`
    );
    return text;
  };

  const pasteTextIntoSelection = (text: string) => {
    if (!text) {
      return;
    }
    try {
      clearCopiedState();
      onPaste(
        selectionRange.startRow,
        selectionRange.startCol,
        expandPasteValues(
          parseTsv(text),
          selectionRange.endRow - selectionRange.startRow + 1,
          selectionRange.endCol - selectionRange.startCol + 1
        )
      );
    } catch (error) {
      onSetStatus(error instanceof Error ? error.message : "粘贴内容解析失败");
    }
  };

  const cutSelectionToInternalBuffer = (statusSuffix = "") => {
    clearCopiedState();
    if (rangeHasLocked(lockedSet, selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol)) {
      onSetStatus("选区包含锁定格，不能剪切");
      return;
    }
    const text = matrixToTsv(
      tab.data,
      selectionRange.startRow,
      selectionRange.startCol,
      selectionRange.endRow,
      selectionRange.endCol
    );
    copiedTextRef.current = text;
    setCopiedRange(selectionRange);
    onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
    onSetStatus(`已剪切 ${selectionRange.endRow - selectionRange.startRow + 1} x ${selectionRange.endCol - selectionRange.startCol + 1}${statusSuffix}`);
  };

  const scheduleKeyboardClipboardFallback = (type: "copy" | "paste" | "cut") => {
    const serial = clipboardEventSerialRef.current;
    window.setTimeout(() => {
      if (clipboardEventSerialRef.current !== serial) {
        return;
      }
      if (type === "copy") {
        copySelectionToInternalBuffer("（仅编辑器内可粘贴）");
        return;
      }
      if (type === "cut") {
        cutSelectionToInternalBuffer("（仅编辑器内可粘贴）");
        return;
      }
      if (copiedRange && copiedTextRef.current) {
        pasteTextIntoSelection(copiedTextRef.current);
      }
    }, 0);
  };

  const focusFindInput = () => {
    setFindPanelOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
      findInputRef.current?.select();
    });
  };

  const applySelectionStyle = (stylePatch: Partial<CsvCellStyle>) => {
    runAfterCommittingEditAndClearingCopiedRange(() =>
      onApplyCellStyle(
        selectionRange.startRow,
        selectionRange.startCol,
        selectionRange.endRow,
        selectionRange.endCol,
        stylePatch
      )
    );
  };

  const runFind = (direction: "next" | "previous") => {
    setFindPanelOpen(true);
    const nextIndex = getAdjacentFindResultIndex(
      findResults,
      tab.selection.focusRow,
      tab.selection.focusCol,
      direction
    );
    commitEditing(false);
    if (nextIndex >= 0) {
      const result = findResults[nextIndex];
      onSelectionChange(singleCellSelection(result.row, result.col));
    } else if (findAvailable) {
      onSetStatus(findInSelection ? "选区内没有匹配内容" : "没有匹配内容");
    }
  };

  const handleGridKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      clearCopiedState();
      if (event.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      clearCopiedState();
      onRedo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusFindInput();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      suppressNextSelectionScrollRef.current = true;
      onSelectionChange({ anchorRow: realEndRow, anchorCol: realEndCol, focusRow: 0, focusCol: 0 });
      onSetStatus("已全选已用区域");
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      scheduleKeyboardClipboardFallback("copy");
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      scheduleKeyboardClipboardFallback("paste");
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      scheduleKeyboardClipboardFallback("cut");
      return;
    }

    if (event.key === "Escape" && copiedRange) {
      event.preventDefault();
      clearCopiedState();
      onSetStatus("已取消复制选区");
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdit();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearCopiedState();
      onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelectionFocus(event.ctrlKey || event.metaKey ? 0 : tab.selection.focusRow, 0, event.shiftKey);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setSelectionFocus(
        event.ctrlKey || event.metaKey ? realEndRow : tab.selection.focusRow,
        realEndCol,
        event.shiftKey
      );
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      moveSelection(-pageRowDelta, 0, event.shiftKey);
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      moveSelection(pageRowDelta, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        moveSelectionToUsedEdge("up", event.shiftKey);
      } else {
        moveSelection(-1, 0, event.shiftKey);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        moveSelectionToUsedEdge("down", event.shiftKey);
      } else {
        moveSelection(1, 0, event.shiftKey);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        moveSelectionToUsedEdge("left", event.shiftKey);
      } else {
        moveSelection(0, -1, event.shiftKey);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        moveSelectionToUsedEdge("right", event.shiftKey);
      } else {
        moveSelection(0, 1, event.shiftKey);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelection(0, event.shiftKey ? -1 : 1, false);
      return;
    }
    if (event.nativeEvent.isComposing || event.key === "Process") {
      return;
    }
    if (event.target === keyProxyRef.current) {
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      beginEdit(tab.selection.focusRow, tab.selection.focusCol, event.key);
    }
  };

  const handleGridBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }
    if (event.target === keyProxyRef.current) {
      return;
    }
    const nativeEvent = event.nativeEvent as InputEvent;
    const text = nativeEvent.data;
    if (!text || nativeEvent.inputType === "insertLineBreak") {
      return;
    }
    event.preventDefault();
    beginEdit(tab.selection.focusRow, tab.selection.focusCol, text);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }
    markClipboardEventHandled();
    const clipboardText = event.clipboardData?.getData("text/plain") ?? "";
    const text = clipboardText || (copiedRange ? copiedTextRef.current ?? "" : "");
    if (!text) {
      return;
    }
    event.preventDefault();
    pasteTextIntoSelection(text);
  };

  const handleCopy = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }
    markClipboardEventHandled();
    event.preventDefault();
    const text = copySelectionToInternalBuffer();
    try {
      if (!event.clipboardData) {
        throw new Error("Clipboard event data unavailable");
      }
      event.clipboardData.setData("text/plain", text);
    } catch {
      onSetStatus(
        `已复制 ${selectionRange.endRow - selectionRange.startRow + 1} x ${selectionRange.endCol - selectionRange.startCol + 1}（仅编辑器内可粘贴）`
      );
    }
  };

  const handleCut = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) {
      return;
    }
    markClipboardEventHandled();
    event.preventDefault();
    clearCopiedState();
    if (rangeHasLocked(lockedSet, selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol)) {
      onSetStatus("选区包含锁定格，不能剪切");
      return;
    }
    const text = matrixToTsv(
      tab.data,
      selectionRange.startRow,
      selectionRange.startCol,
      selectionRange.endRow,
      selectionRange.endCol
    );
    try {
      if (!event.clipboardData) {
        throw new Error("Clipboard event data unavailable");
      }
      event.clipboardData.setData("text/plain", text);
      onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
      onSetStatus(`已剪切 ${selectionRange.endRow - selectionRange.startRow + 1} x ${selectionRange.endCol - selectionRange.startCol + 1}`);
    } catch {
      onSetStatus("剪切失败：浏览器未允许剪贴板写入");
    }
  };

  const renderColumnHeader = (col: number, keyPrefix: string, className = "") => (
    <div
      key={`${keyPrefix}-h-${col}`}
      className={`column-header ${className}`}
      role="columnheader"
      aria-label={`Column ${columnName(col)}`}
      style={{
        left: rowHeaderWidth + colOffsets[col],
        top: 0,
        width: colWidths[col],
        height: headerHeight
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        commitEditing(false);
        suppressNextSelectionScrollRef.current = true;
        onSelectionChange({ anchorRow: realEndRow, anchorCol: col, focusRow: 0, focusCol: col });
        focusGridInput();
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

  const renderRowHeader = (row: number, keyPrefix: string, className = "") => (
    <div
      key={`${keyPrefix}-r-${row}`}
      className={`row-header ${className}`}
      role="rowheader"
      aria-label={`Row ${row + 1}`}
      style={{
        left: 0,
        top: headerHeight + row * rowHeight,
        width: rowHeaderWidth,
        height: rowHeight
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        commitEditing(false);
        suppressNextSelectionScrollRef.current = true;
        onSelectionChange({ anchorRow: row, anchorCol: realEndCol, focusRow: row, focusCol: 0 });
        focusGridInput();
      }}
    >
      {row + 1}
    </div>
  );

  const renderCell = (row: number, col: number, keyPrefix: string, className = "") => {
    const key = cellKey(row, col);
    const selected =
      row >= selectionRange.startRow &&
      row <= selectionRange.endRow &&
      col >= selectionRange.startCol &&
      col <= selectionRange.endCol;
    const focus = row === tab.selection.focusRow && col === tab.selection.focusCol;
    const locked = lockedSet.has(key);
    const isEditing = editing?.row === row && editing.col === col;
    const customStyle = tab.cellStyles[key];
    const copied =
      copiedRange &&
      row >= copiedRange.startRow &&
      row <= copiedRange.endRow &&
      col >= copiedRange.startCol &&
      col <= copiedRange.endCol;

    return (
      <div
        key={`${keyPrefix}-${row}-${col}`}
        className={`grid-cell ${selected ? "selected" : ""} ${focus ? "focus" : ""} ${copied ? "copied" : ""} ${
          locked ? "locked" : ""
        } ${className}`}
        role="gridcell"
        aria-label={`${columnName(col)}${row + 1}`}
        style={{
          left: rowHeaderWidth + colOffsets[col],
          top: headerHeight + row * rowHeight,
          width: colWidths[col],
          height: rowHeight,
          lineHeight: `${rowHeight - 2}px`,
          color: customStyle?.textColor,
          backgroundColor: customStyle?.backgroundColor
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".cell-editor")) {
            return;
          }
          event.preventDefault();
          commitEditing(false);
          dragAnchorRef.current = { row, col };
          setDragging(true);
          onSelectionChange(singleCellSelection(row, col));
          focusGridInput();
        }}
        onPointerEnter={() => {
          updateDragSelection(row, col);
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".cell-editor")) {
            return;
          }
          beginEdit(row, col);
        }}
        title={locked ? "该格已锁定" : undefined}
      >
        {isEditing ? (
          <input
            className="cell-editor"
            value={editing.value}
            autoFocus
            onPointerDown={(event) => {
              event.stopPropagation();
              dragAnchorRef.current = null;
              setDragging(false);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setEditing({ row, col, value: event.target.value });
              onEditDraftDirtyChange(event.target.value !== readCell(tab.data, row, col));
            }}
            onBlur={() => commitEditing(false)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
                event.preventDefault();
                event.stopPropagation();
                focusFindInput();
              } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                event.stopPropagation();
                commitEditingAndRequestSave();
              } else if (event.key === "Enter") {
                event.preventDefault();
                commitEditing(true);
                moveSelection(1, 0, false);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(null);
                onEditDraftDirtyChange(false);
                resetKeyProxyValue();
                composingInputRef.current = false;
                focusGridInputSoon();
              } else if (event.key === "Tab") {
                event.preventDefault();
                commitEditing(true);
                moveSelection(0, event.shiftKey ? -1 : 1, false);
              }
            }}
          />
        ) : (
          readCell(tab.data, row, col)
        )}
      </div>
    );
  };

  return (
    <section className="grid-shell">
      <div className="formula-bar">
        <span className="cell-name">{selectedLabel}</span>
        <input
          value={selectedValue}
          onChange={(event) => {
            clearCopiedState();
            onSetCell(tab.selection.focusRow, tab.selection.focusCol, event.target.value);
          }}
          disabled={selectedLocked}
          aria-label="Selected cell value"
        />
        <span className={`lock-state ${selectedLocked ? "locked" : ""}`}>{selectedLocked ? "已锁定" : "可编辑"}</span>
      </div>

      <div className="grid-tools">
        <div className="tool-group history-tools">
          <button
            className="icon-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(onUndo)}
            disabled={!canUndo && !editingDirty}
            title="撤销"
            aria-label="撤销"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(onRedo)}
            disabled={!canRedo}
            title="重做"
            aria-label="重做"
          >
            <Redo2 size={15} />
          </button>
        </div>
        <div className="tool-group view-tools">
          <button
            className="tool-button"
            onClick={() =>
              runAfterCommittingEdit(() => onToggleLock(
                selectionRange.startRow,
                selectionRange.startCol,
                selectionRange.endRow,
                selectionRange.endCol,
                !rangeLocked
              ))
            }
            title={rangeLocked ? "解除选区锁定" : "锁定选区，防止误改"}
          >
            {rangeLocked ? <Unlock size={15} /> : <Lock size={15} />}
            {rangeLocked ? "解锁" : "锁定"}
          </button>
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEdit(() => onSetFreeze(tab.selection.focusRow, tab.selection.focusCol))}
            title="冻结到当前格，保持左上区域可见"
          >
            <Rows3 size={15} />
            冻结
          </button>
          <button className="tool-button" onClick={() => runAfterCommittingEdit(() => onSetFreeze(0, 0))} title="取消冻结">
            <Columns3 size={15} />
            取消
          </button>
          <button className="icon-button" onClick={() => onSetZoom(Math.max(0.7, tab.zoom - 0.1))} title="缩小格子" aria-label="缩小格子">
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
          <button className="icon-button" onClick={() => onSetZoom(Math.min(1.7, tab.zoom + 0.1))} title="放大格子" aria-label="放大格子">
            <Plus size={15} />
          </button>
          <span className="zoom-label">{Math.round(tab.zoom * 100)}%</span>
        </div>
        <div className="tool-group structure-tools">
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(() => onInsertRows(selectionRange.startRow, selectionRange.endRow))}
          >
            <Plus size={15} />
            插行
          </button>
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(() => onDeleteRows(selectionRange.startRow, selectionRange.endRow))}
          >
            <Minus size={15} />
            删行
          </button>
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(() => onInsertColumns(selectionRange.startCol, selectionRange.endCol))}
          >
            <Plus size={15} />
            插列
          </button>
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(() => onDeleteColumns(selectionRange.startCol, selectionRange.endCol))}
          >
            <Minus size={15} />
            删列
          </button>
          <button className="tool-button" onClick={() => runAfterCommittingEditAndClearingCopiedRange(onAddRow)}>
            增行
          </button>
          <button className="tool-button" onClick={() => runAfterCommittingEditAndClearingCopiedRange(onAddColumn)}>
            增列
          </button>
        </div>
        <div className="tool-group find-tools">
          <label className="grid-search">
            <Search size={15} />
            <input
              ref={findInputRef}
              value={tab.findQuery}
              onFocus={() => setFindPanelOpen(true)}
              onChange={(event) => {
                setFindPanelOpen(true);
                onSetFindQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runFind(event.shiftKey ? "previous" : "next");
                }
              }}
              placeholder="查找"
              aria-label="查找"
            />
          </label>
          <label className={`toggle-chip ${findInSelection ? "active-toggle" : ""}`} title="只在当前选区内查找和替换结果">
            <input
              type="checkbox"
              checked={findInSelection}
              onChange={(event) => {
                setFindPanelOpen(true);
                setFindInSelection(event.target.checked);
              }}
              aria-label="仅在选区查找"
            />
            选区内
          </label>
          <span className="find-count" title="当前查找结果数量">
            {findAvailable ? `${findResults.length} 项` : "0 项"}
          </span>
          <label className="grid-search replace-box">
            <input
              value={tab.replaceValue}
              onChange={(event) => onSetReplaceValue(event.target.value)}
              placeholder="替换为"
              aria-label="替换为"
            />
          </label>
          <button className="icon-button" onClick={() => runFind("previous")} disabled={!findAvailable} title="上一处" aria-label="上一处">
            <ChevronUp size={15} />
          </button>
          <button className="icon-button" onClick={() => runFind("next")} disabled={!findAvailable} title="下一处" aria-label="下一处">
            <ChevronDown size={15} />
          </button>
          <button className="tool-button" onClick={() => runAfterCommittingEditAndClearingCopiedRange(onReplaceCurrent)} disabled={!findAvailable}>
            替换
          </button>
          <button
            className="tool-button"
            onClick={() => runAfterCommittingEditAndClearingCopiedRange(() => onReplaceFindResults(findResults))}
            disabled={!findAvailable || findResults.length === 0}
          >
            替换结果
          </button>
          <button className="tool-button" onClick={() => runAfterCommittingEditAndClearingCopiedRange(onReplaceAll)} disabled={!findAvailable}>
            全部替换
          </button>
        </div>
        <div className="tool-group color-tools" role="group" aria-label="单元格颜色">
          <label className="color-picker" title="文字颜色">
            <Type size={14} />
            <input
              type="color"
              value={selectedStyle.textColor ?? "#172026"}
              onChange={(event) => applySelectionStyle({ textColor: event.target.value })}
              aria-label="文字颜色"
            />
          </label>
          {TEXT_COLOR_PRESETS.map((color) => (
            <button
              key={`text-${color}`}
              className="color-swatch"
              style={{ backgroundColor: color }}
              onClick={() => applySelectionStyle({ textColor: color })}
              title={`文字颜色 ${color}`}
              aria-label={`文字颜色 ${color}`}
            />
          ))}
          <label className="color-picker" title="背景颜色">
            <PaintBucket size={14} />
            <input
              type="color"
              value={selectedStyle.backgroundColor ?? "#ffffff"}
              onChange={(event) => applySelectionStyle({ backgroundColor: event.target.value })}
              aria-label="背景颜色"
            />
          </label>
          {BACKGROUND_COLOR_PRESETS.map((color) => (
            <button
              key={`background-${color}`}
              className="color-swatch background"
              style={{ backgroundColor: color }}
              onClick={() => applySelectionStyle({ backgroundColor: color })}
              title={`背景颜色 ${color}`}
              aria-label={`背景颜色 ${color}`}
            />
          ))}
          <button
            className="tool-button compact"
            onClick={() => applySelectionStyle({ textColor: undefined, backgroundColor: undefined })}
            title="清除单元格临时颜色"
          >
            清除
          </button>
        </div>
        <div className="tool-group refresh-tools">
          <button
            className={`tool-button ${tab.autoRefresh ? "active-toggle" : ""}`}
            onClick={() => runAfterCommittingEdit(() => onSetAutoRefresh(!tab.autoRefresh))}
            title={tab.autoRefresh ? "磁盘变化时自动刷新干净页签" : "暂停自动应用磁盘变化，只标记提示"}
          >
            {tab.autoRefresh ? <Play size={15} /> : <Pause size={15} />}
            {tab.autoRefresh ? "自动热刷" : "热刷暂停"}
          </button>
        </div>
      </div>

      {findPanelOpen && findAvailable ? (
        <div className="find-results-panel" aria-label="查找结果">
          <div className="find-results-summary">
            <Search size={14} />
            <span>
              {findInSelection ? "选区" : "全表"}找到 {findResults.length} 项
              {activeFindResultIndex >= 0 ? `，当前第 ${activeFindResultIndex + 1} 项` : ""}
            </span>
            <button className="icon-button" onClick={() => setFindPanelOpen(false)} title="收起查找结果" aria-label="收起查找结果">
              <ChevronUp size={14} />
            </button>
          </div>
          <div className="find-result-list">
            {visibleFindResults.length > 0 ? (
              visibleFindResults.map((result, index) => (
                <button
                  key={`${result.row}:${result.col}`}
                  className={`find-result ${activeFindResultIndex === index ? "active" : ""}`}
                  onClick={() => {
                    commitEditing(false);
                    onSelectionChange(singleCellSelection(result.row, result.col));
                    focusGridInputSoon();
                  }}
                  title={result.value}
                  aria-label={`跳转到 ${columnName(result.col)}${result.row + 1}`}
                >
                  <span className="find-result-cell">{columnName(result.col)}{result.row + 1}</span>
                  <span className="find-result-preview">{formatCellValuePreview(result.value)}</span>
                  {result.locked ? <span className="find-result-lock">锁</span> : null}
                </button>
              ))
            ) : (
              <span className="find-result-empty">没有匹配内容</span>
            )}
            {findResults.length > visibleFindResults.length ? (
              <span className="find-result-more">仅显示前 {visibleFindResults.length} 项</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className="grid-viewport"
        role="grid"
        aria-label="CSV grid"
        ref={viewportRef}
        tabIndex={0}
        onFocus={(event) => {
          if (!editing && event.target === viewportRef.current) {
            focusGridInputSoon();
          }
        }}
        onKeyDown={handleGridKeyDown}
        onBeforeInput={handleGridBeforeInput}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onPointerMove={(event) => {
          if (dragging) {
            updateDragSelectionFromPointer(event.clientX, event.clientY);
          }
        }}
      >
        <input
          ref={keyProxyRef}
          className="grid-key-proxy"
          aria-label="Grid keyboard input"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          tabIndex={-1}
          onChange={handleKeyProxyChange}
          onCompositionStart={() => {
            composingInputRef.current = true;
          }}
          onCompositionEnd={handleKeyProxyCompositionEnd}
        />

        <div
          className="grid-freeze-layer grid-freeze-top"
          data-testid="grid-freeze-top"
          style={{ width: totalWidth, height: stickyTopHeight, marginBottom: -stickyTopHeight }}
        >
          {bodyCols.map((col) => renderColumnHeader(col, "freeze-top", "frozen-row"))}
          {frozenRows.flatMap((row) =>
            bodyCols.map((col) => renderCell(row, col, "freeze-top", "frozen frozen-row"))
          )}
        </div>

        <div
          className="grid-freeze-layer grid-freeze-left"
          data-testid="grid-freeze-left"
          style={{ width: stickyLeftWidth, height: totalHeight, marginBottom: -totalHeight }}
        >
          {bodyRows.map((row) => renderRowHeader(row, "freeze-left", "frozen-col"))}
          {bodyRows.flatMap((row) =>
            frozenCols.map((col) => renderCell(row, col, "freeze-left", "frozen frozen-col"))
          )}
        </div>

        <div
          className="grid-freeze-layer grid-freeze-corner"
          data-testid="grid-freeze-corner"
          style={{ width: stickyLeftWidth, height: stickyTopHeight, marginBottom: -stickyTopHeight }}
        >
          <div
            className="grid-corner"
            role="button"
            aria-label="Select all cells"
            style={{
              width: rowHeaderWidth,
              height: headerHeight,
              left: 0,
              top: 0
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              commitEditing(false);
              suppressNextSelectionScrollRef.current = true;
              onSelectionChange({ anchorRow: realEndRow, anchorCol: realEndCol, focusRow: 0, focusCol: 0 });
              onSetStatus("已全选已用区域");
              focusGridInput();
            }}
          />
          {frozenCols.map((col) => renderColumnHeader(col, "freeze-corner", "frozen-row frozen-col"))}
          {frozenRows.map((row) => renderRowHeader(row, "freeze-corner", "frozen-row frozen-col"))}
          {frozenRows.flatMap((row) =>
            frozenCols.map((col) => renderCell(row, col, "freeze-corner", "frozen frozen-row frozen-col"))
          )}
        </div>

        <div className="grid-canvas" style={{ width: totalWidth, height: totalHeight }}>
          {bodyRows.flatMap((row) => bodyCols.map((col) => renderCell(row, col, "body")))}
        </div>
      </div>

      <div className="grid-status">
        <span>
          {tab.data.length} 行 / {maxColumnCount(tab.data)} 列
        </span>
        <span>选区 {selectionRange.endRow - selectionRange.startRow + 1} x {selectionRange.endCol - selectionRange.startCol + 1}</span>
        <span>冻结 {tab.freezeRows} 行 / {tab.freezeCols} 列</span>
        <span>{tab.status ?? "就绪"}</span>
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

function numberRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
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

function expandPasteValues(values: string[][], targetRows: number, targetCols: number): string[][] {
  if (values.length === 0 || targetRows <= 0 || targetCols <= 0) {
    return values;
  }
  const sourceRows = values.length;
  const sourceCols = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (sourceCols === 0) {
    return values;
  }
  const targetIsLarger = targetRows > sourceRows || targetCols > sourceCols;
  const canTile = targetRows % sourceRows === 0 && targetCols % sourceCols === 0;
  if (!targetIsLarger || !canTile) {
    return values;
  }
  return Array.from({ length: targetRows }, (_, row) =>
    Array.from({ length: targetCols }, (_, col) => values[row % sourceRows]?.[col % sourceCols] ?? "")
  );
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

function getAdjacentFindResultIndex(
  results: FindResultCell[],
  row: number,
  col: number,
  direction: "next" | "previous"
): number {
  if (results.length === 0) {
    return -1;
  }
  const exactIndex = results.findIndex((result) => result.row === row && result.col === col);
  if (exactIndex >= 0) {
    return direction === "next"
      ? (exactIndex + 1) % results.length
      : (exactIndex - 1 + results.length) % results.length;
  }
  if (direction === "next") {
    const afterIndex = results.findIndex((result) => compareCellPosition(result, row, col) > 0);
    return afterIndex >= 0 ? afterIndex : 0;
  }
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (compareCellPosition(results[index], row, col) < 0) {
      return index;
    }
  }
  return results.length - 1;
}

function compareCellPosition(cell: FindResultCell, row: number, col: number): number {
  if (cell.row !== row) {
    return cell.row - row;
  }
  return cell.col - col;
}

function formatCellValuePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact || "(空)";
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
