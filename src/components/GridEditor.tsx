import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Filter,
  Lock,
  Minus,
  PaintBucket,
  Pause,
  Play,
  Plus,
  Redo2,
  Rows3,
  Search,
  Star,
  Type,
  Undo2,
  Unlock,
  X
} from "lucide-react";
import {
  maxColumnCount,
  matrixToTsv,
  parseTsv,
  readCell,
  rowsToTsv,
  writeCell
} from "../lib/csv";
import type {
  CsvCellStyle,
  CsvCellUpdate,
  CsvFindSnapshot,
  CsvMatrix,
  CsvSelection,
  CsvTab,
  FindResultCell,
  GridScrollPosition
} from "../types";
import { cellKey, normalizeSelection, singleCellSelection } from "../types";

const ROW_HEADER_WIDTH = 56;
const COLUMN_HEADER_HEIGHT = 30;
const DEFAULT_COL_WIDTH = 122;
const DEFAULT_ROW_HEIGHT = 28;
const MIN_COL_WIDTH = 54;
const OVERSCAN = 6;
const DRAG_SELECTION_THRESHOLD_PX = 8;
const FILTER_IGNORED_ROW_COUNT = 2;
export const COMMIT_ACTIVE_EDIT_EVENT = "csv-editor:commit-active-edit";
const TEXT_COLOR_PRESETS = ["#172026", "#b42318", "#0f766e", "#1d4ed8"];
const BACKGROUND_COLOR_PRESETS = ["#ffffff", "#fff3bf", "#dff0ee", "#eaf3ff"];

type GridEditorProps = {
  tab: CsvTab;
  dirtyCount: number;
  selectedStats: string;
  notice: {
    tone: "info" | "success" | "warning" | "error";
    message: string;
  } | null;
  onSelectionChange(selection: CsvSelection): void;
  onSetCell(row: number, col: number, value: string): void;
  onPaste(startRow: number, startCol: number, values: string[][]): void;
  onPasteCells(updates: CsvCellUpdate[]): void;
  onClearRange(startRow: number, startCol: number, endRow: number, endCol: number): void;
  onClearCells(cells: FindResultCell[]): void;
  onToggleLock(startRow: number, startCol: number, endRow: number, endCol: number, locked: boolean): void;
  onToggleLockCells(cells: FindResultCell[], locked: boolean): void;
  onSetZoom(zoom: number): void;
  onSetFreeze(rows: number, cols: number): void;
  onSetColWidth(col: number, width: number): void;
  onSetColumnFilter(col: number, selectedValues: string[] | null): void;
  onClearAllFilters(): void;
  onSetAutoRefresh(enabled: boolean): void;
  onSetFindQuery(query: string): void;
  onSetReplaceValue(value: string): void;
  onSetFindSnapshot(snapshot: CsvFindSnapshot | null): void;
  onSetStatus(status: string): void;
  onEditDraftDirtyChange(dirty: boolean): void;
  canAddActiveFavorite: boolean;
  isActiveFavorite: boolean;
  onAddActiveFavorite(): void;
  scrollPosition: GridScrollPosition;
  onScrollPositionChange(tabId: string, position: GridScrollPosition): void;
  onReplaceCurrent(query: string): void;
  onReplaceFindResults(results: FindResultCell[], query: string): void;
  onApplyCellStyle(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    stylePatch: Partial<CsvCellStyle>
  ): void;
  onApplyCellStyleToCells(cells: FindResultCell[], stylePatch: Partial<CsvCellStyle>): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onSaveRequest(): void;
  onInsertRows(startRow: number, endRow: number): void;
  onDeleteRows(startRow: number, endRow: number): void;
  onDeleteRowsByIndexes(rows: number[]): void;
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

type DragSelectionOrigin = {
  startX: number;
  startY: number;
  active: boolean;
};

type DragSelectionState = DragSelectionOrigin &
  (
    | {
        kind: "cell";
        row: number;
        col: number;
      }
    | {
        kind: "row";
        row: number;
      }
    | {
        kind: "column";
        col: number;
      }
  );

type CopiedRange = ReturnType<typeof normalizeSelection> & {
  rows?: number[];
};

type FilterMenuState = {
  col: number;
  left: number;
  top: number;
  search: string;
  draftSelectedValues: string[];
  addSearchSelectionToFilter: boolean;
};

type FilterValueOption = {
  value: string;
  label: string;
  count: number;
};

export function GridEditor({
  tab,
  dirtyCount,
  selectedStats,
  notice,
  onSelectionChange,
  onSetCell,
  onPaste,
  onPasteCells,
  onClearRange,
  onClearCells,
  onToggleLock,
  onToggleLockCells,
  onSetZoom,
  onSetFreeze,
  onSetColWidth,
  onSetColumnFilter,
  onClearAllFilters,
  onSetAutoRefresh,
  onSetFindQuery,
  onSetReplaceValue,
  onSetFindSnapshot,
  onSetStatus,
  onEditDraftDirtyChange,
  canAddActiveFavorite,
  isActiveFavorite,
  onAddActiveFavorite,
  scrollPosition,
  onScrollPositionChange,
  onReplaceCurrent,
  onReplaceFindResults,
  onApplyCellStyle,
  onApplyCellStyleToCells,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSaveRequest,
  onInsertRows,
  onDeleteRows,
  onDeleteRowsByIndexes,
  onInsertColumns,
  onDeleteColumns,
  onAddRow,
  onAddColumn
}: GridEditorProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keyProxyRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const filterSelectAllRef = useRef<HTMLInputElement | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<DragSelectionState | null>(null);
  const composingInputRef = useRef(false);
  const pendingSelectionScrollRef = useRef(false);
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
  const [resizeState, setResizeState] = useState<{
    col: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [copiedRange, setCopiedRange] = useState<CopiedRange | null>(null);
  const [filterMenu, setFilterMenu] = useState<FilterMenuState | null>(null);
  const copiedTextRef = useRef<string | null>(null);
  const clipboardEventSerialRef = useRef(0);

  useEffect(() => {
    setFindPanelOpen(false);
    setFilterMenu(null);
  }, [tab.id]);

  const selectionRange = normalizeSelection(tab.selection);
  const selectedValue = readCell(tab.data, tab.selection.focusRow, tab.selection.focusCol);
  const lockedSet = useMemo(() => new Set(tab.lockedCells), [tab.lockedCells]);
  const maxCols = Math.max(20, maxColumnCount(tab.data) + 4);
  const rowCount = Math.max(40, tab.data.length + 12);
  const columnFilterEntries = useMemo(
    () =>
      Object.entries(tab.columnFilters)
        .map(([colText, values]) => ({
          col: Number(colText),
          values: new Set(values)
        }))
        .filter((entry) => Number.isInteger(entry.col) && entry.col >= 0),
    [tab.columnFilters]
  );
  const hasActiveFilters = columnFilterEntries.length > 0;
  const displayRows = useMemo(() => {
    if (!hasActiveFilters) {
      return null;
    }
    const rows: number[] = [];
    for (let row = 0; row < Math.min(FILTER_IGNORED_ROW_COUNT, tab.data.length); row += 1) {
      rows.push(row);
    }
    for (let row = FILTER_IGNORED_ROW_COUNT; row < tab.data.length; row += 1) {
      if (rowPassesColumnFilters(tab.data, row, columnFilterEntries)) {
        rows.push(row);
      }
    }
    const appendedRows = Math.max(12, 40 - rows.length);
    for (let row = tab.data.length; row < tab.data.length + appendedRows; row += 1) {
      rows.push(row);
    }
    return rows.length > 0 ? rows : [0];
  }, [columnFilterEntries, hasActiveFilters, tab.data]);
  const displayRowCount = displayRows ? displayRows.length : rowCount;
  const rowDisplayIndexMap = useMemo(() => {
    if (!displayRows) {
      return null;
    }
    return new Map(displayRows.map((row, index) => [row, index]));
  }, [displayRows]);
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
  const totalHeight = headerHeight + displayRowCount * rowHeight;

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = clamp(scrollPosition.scrollTop, 0, Math.max(0, totalHeight - element.clientHeight));
    const nextScrollLeft = clamp(scrollPosition.scrollLeft, 0, Math.max(0, totalWidth - element.clientWidth));
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

  const getDisplayIndexForRow = (row: number) => {
    if (!rowDisplayIndexMap) {
      return clamp(row, 0, displayRowCount - 1);
    }
    return rowDisplayIndexMap.get(row) ?? -1;
  };

  const getRowAtDisplayIndex = (index: number) => {
    const nextIndex = clamp(index, 0, displayRowCount - 1);
    return displayRows ? displayRows[nextIndex] ?? displayRows[displayRows.length - 1] ?? 0 : nextIndex;
  };

  const isRowVisible = (row: number) => !rowDisplayIndexMap || rowDisplayIndexMap.has(row);

  const getRowTop = (row: number) => {
    const displayIndex = getDisplayIndexForRow(row);
    return headerHeight + Math.max(0, displayIndex) * rowHeight;
  };

  const getNearestVisibleRow = (row: number) => {
    if (!displayRows) {
      return clamp(row, 0, rowCount - 1);
    }
    const exactIndex = rowDisplayIndexMap?.get(row);
    if (exactIndex !== undefined) {
      return row;
    }
    const insertionIndex = findFirstSortedIndexAtLeast(displayRows, row);
    return displayRows[insertionIndex] ?? displayRows[insertionIndex - 1] ?? 0;
  };

  const getHiddenRowCountBefore = (row: number) => {
    if (!displayRows) {
      return 0;
    }
    const displayIndex = rowDisplayIndexMap?.get(row);
    if (displayIndex === undefined || displayIndex <= 0) {
      return 0;
    }
    const previousRow = displayRows[displayIndex - 1];
    return Math.max(0, row - previousRow - 1);
  };

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }
    if (!pendingSelectionScrollRef.current) {
      return;
    }
    pendingSelectionScrollRef.current = false;
    const selectedDisplayIndex = getDisplayIndexForRow(tab.selection.focusRow);
    if (selectedDisplayIndex < 0) {
      return;
    }
    const selectedLeft = rowHeaderWidth + colOffsets[tab.selection.focusCol];
    const selectedRight = rowHeaderWidth + colOffsets[tab.selection.focusCol + 1];
    const selectedTop = headerHeight + selectedDisplayIndex * rowHeight;
    const selectedBottom = selectedTop + rowHeight;
    const freezeRowCount = clamp(tab.freezeRows, 0, displayRowCount);
    const freezeColCount = clamp(tab.freezeCols, 0, maxCols);
    const frozenWidth = colOffsets[freezeColCount] ?? 0;
    const frozenHeight = freezeRowCount * rowHeight;
    const selectedInFrozenRows = selectedDisplayIndex < freezeRowCount;
    const selectedInFrozenCols = tab.selection.focusCol < freezeColCount;
    const visibleLeftInset = rowHeaderWidth + (selectedInFrozenCols ? 0 : frozenWidth);
    const visibleTopInset = headerHeight + (selectedInFrozenRows ? 0 : frozenHeight);

    if (!selectedInFrozenCols) {
      if (selectedLeft < viewportElement.scrollLeft + visibleLeftInset) {
        viewportElement.scrollLeft = Math.max(0, selectedLeft - visibleLeftInset);
      } else if (selectedRight > viewportElement.scrollLeft + viewportElement.clientWidth) {
        viewportElement.scrollLeft = selectedRight - viewportElement.clientWidth;
      }
    }

    if (!selectedInFrozenRows) {
      if (selectedTop < viewportElement.scrollTop + visibleTopInset) {
        viewportElement.scrollTop = Math.max(0, selectedTop - visibleTopInset);
      } else if (selectedBottom > viewportElement.scrollTop + viewportElement.clientHeight) {
        viewportElement.scrollTop = selectedBottom - viewportElement.clientHeight;
      }
    }
  }, [
    colOffsets,
    displayRowCount,
    headerHeight,
    maxCols,
    rowDisplayIndexMap,
    rowHeaderWidth,
    rowHeight,
    tab.freezeCols,
    tab.freezeRows,
    tab.selection.focusCol,
    tab.selection.focusRow
  ]);

  const visibleRows = useMemo(() => {
    const start = clamp(Math.floor((viewport.scrollTop - headerHeight) / rowHeight) - OVERSCAN, 0, displayRowCount - 1);
    const end = clamp(
      Math.ceil((viewport.scrollTop + viewport.height - headerHeight) / rowHeight) + OVERSCAN,
      0,
      displayRowCount - 1
    );
    const rows = new Set<number>();
    for (let displayIndex = 0; displayIndex < tab.freezeRows && displayIndex < displayRowCount; displayIndex += 1) {
      rows.add(getRowAtDisplayIndex(displayIndex));
    }
    for (let displayIndex = start; displayIndex <= end; displayIndex += 1) {
      rows.add(getRowAtDisplayIndex(displayIndex));
    }
    return [...rows].sort((left, right) => getDisplayIndexForRow(left) - getDisplayIndexForRow(right));
  }, [displayRowCount, displayRows, headerHeight, rowDisplayIndexMap, rowHeight, tab.freezeRows, viewport.height, viewport.scrollTop]);

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
  const selectionColumnCount = selectionRange.endCol - selectionRange.startCol + 1;
  const selectedVisibleRows = useMemo(
    () => getRowsInSelection(selectionRange.startRow, selectionRange.endRow, displayRows, rowCount),
    [displayRows, rowCount, selectionRange.endRow, selectionRange.startRow]
  );
  const selectedVisibleCells = useMemo(
    () => buildCellList(selectedVisibleRows, selectionRange.startCol, selectionRange.endCol),
    [selectedVisibleRows, selectionRange.endCol, selectionRange.startCol]
  );
  const selectedVisibleRowCount = selectedVisibleRows.length;
  const hiddenRowsInSelection = Math.max(0, selectionRange.endRow - selectionRange.startRow + 1 - selectedVisibleRowCount);
  const editingDirty = Boolean(
    editing &&
      !lockedSet.has(cellKey(editing.row, editing.col)) &&
      editing.value !== readCell(tab.data, editing.row, editing.col)
  );
  const rangeLocked = selectedVisibleCells.some((cell) => lockedSet.has(cellKey(cell.row, cell.col)));
  const findAvailable = tab.findQuery.trim().length > 0;
  const realEndRow = Math.max(0, tab.data.length - 1);
  const realEndCol = Math.max(0, maxColumnCount(tab.data) - 1);
  const freezeRowCount = clamp(tab.freezeRows, 0, displayRowCount);
  const freezeColCount = clamp(tab.freezeCols, 0, maxCols);
  const frozenRows = useMemo(
    () => numberRange(freezeRowCount).map((displayIndex) => getRowAtDisplayIndex(displayIndex)),
    [displayRows, displayRowCount, freezeRowCount]
  );
  const frozenCols = useMemo(() => numberRange(freezeColCount), [freezeColCount]);
  const bodyRows = useMemo(
    () => visibleRows.filter((row) => getDisplayIndexForRow(row) >= freezeRowCount),
    [freezeRowCount, rowDisplayIndexMap, visibleRows]
  );
  const bodyCols = useMemo(() => visibleCols.filter((col) => col >= freezeColCount), [freezeColCount, visibleCols]);
  const frozenWidth = colOffsets[freezeColCount] ?? 0;
  const frozenHeight = freezeRowCount * rowHeight;
  const stickyTopHeight = headerHeight + frozenHeight;
  const stickyLeftWidth = rowHeaderWidth + frozenWidth;

  useEffect(() => {
    if (!hasActiveFilters || isRowVisible(tab.selection.focusRow)) {
      return;
    }
    const nextRow = getNearestVisibleRow(tab.selection.focusRow);
    requestSelectionScroll();
    onSelectionChange(singleCellSelection(nextRow, tab.selection.focusCol));
  }, [displayRows, hasActiveFilters, onSelectionChange, rowDisplayIndexMap, tab.selection.focusCol, tab.selection.focusRow]);

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

  const activateDragSelection = (clientX: number, clientY: number) => {
    const dragState = dragAnchorRef.current;
    if (!dragState) {
      return false;
    }
    if (dragState.active) {
      return true;
    }
    const deltaX = clientX - dragState.startX;
    const deltaY = clientY - dragState.startY;
    if (deltaX * deltaX + deltaY * deltaY < DRAG_SELECTION_THRESHOLD_PX * DRAG_SELECTION_THRESHOLD_PX) {
      return false;
    }
    dragAnchorRef.current = { ...dragState, active: true };
    return true;
  };

  const updateDragSelection = (row: number, col: number) => {
    const dragState = dragAnchorRef.current;
    if (!dragState?.active) {
      return;
    }
    if (dragState.kind === "row") {
      onSelectionChange({
        anchorRow: dragState.row,
        anchorCol: realEndCol,
        focusRow: getNearestVisibleRow(row),
        focusCol: 0
      });
      return;
    }
    if (dragState.kind === "column") {
      onSelectionChange({
        anchorRow: getLastVisibleUsedRow(displayRows, realEndRow),
        anchorCol: dragState.col,
        focusRow: getFirstVisibleUsedRow(displayRows),
        focusCol: clamp(col, 0, maxCols - 1)
      });
      return;
    }
    onSelectionChange({
      anchorRow: dragState.row,
      anchorCol: dragState.col,
      focusRow: getNearestVisibleRow(row),
      focusCol: clamp(col, 0, maxCols - 1)
    });
  };

  const updateDragSelectionFromPointer = (clientX: number, clientY: number) => {
    const element = viewportRef.current;
    const anchor = dragAnchorRef.current;
    if (!element || !anchor) {
      return;
    }
    if (!activateDragSelection(clientX, clientY)) {
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
    const row = getRowAtDisplayIndex(Math.floor(offsetY / rowHeight));
    const col = clamp(findColumnAtOffset(colOffsets, offsetX), 0, maxCols - 1);
    updateDragSelection(row, col);
  };

  function requestSelectionScroll() {
    pendingSelectionScrollRef.current = true;
  }

  const setSelectionFocus = (row: number, col: number, extend: boolean) => {
    const nextRow = getNearestVisibleRow(row);
    const nextCol = clamp(col, 0, maxCols - 1);
    requestSelectionScroll();
    onSelectionChange(
      extend
        ? { ...tab.selection, focusRow: nextRow, focusCol: nextCol }
        : singleCellSelection(nextRow, nextCol)
    );
  };

  const moveSelection = (rowDelta: number, colDelta: number, extend: boolean) => {
    const nextRow =
      rowDelta !== 0 && hasActiveFilters
        ? getRowAtDisplayIndex(getDisplayIndexForRow(tab.selection.focusRow) + rowDelta)
        : tab.selection.focusRow + rowDelta;
    setSelectionFocus(nextRow, tab.selection.focusCol + colDelta, extend);
  };

  const moveSelectionToUsedEdge = (direction: "up" | "down" | "left" | "right", extend: boolean) => {
    if (direction === "up") {
      setSelectionFocus(getFirstVisibleUsedRow(displayRows), tab.selection.focusCol, extend);
    } else if (direction === "down") {
      setSelectionFocus(getLastVisibleUsedRow(displayRows, realEndRow), tab.selection.focusCol, extend);
    } else if (direction === "left") {
      setSelectionFocus(tab.selection.focusRow, 0, extend);
    } else {
      setSelectionFocus(tab.selection.focusRow, realEndCol, extend);
    }
  };

  const pageRowDelta = Math.min(
    displayRowCount - 1,
    Math.max(1, Math.floor(Math.max(rowHeight, (viewport.height || 500) - headerHeight) / rowHeight))
  );

  const dataWithEditingDraft = () =>
    editing && !lockedSet.has(cellKey(editing.row, editing.col))
      ? writeCell(tab.data, editing.row, editing.col, editing.value)
      : tab.data;

  const buildFindSnapshot = (): CsvFindSnapshot | null => {
    const normalizedQuery = tab.findQuery.trim();
    if (!normalizedQuery) {
      return null;
    }
    const searchableData = dataWithEditingDraft();
    const usedEndRow = searchableData.length - 1;
    const usedEndCol = maxColumnCount(searchableData) - 1;
    if (usedEndRow < 0 || usedEndCol < 0) {
      return {
        query: normalizedQuery,
        scope: {
          mode: "table",
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 0,
          visibleOnly: hasActiveFilters
        },
        results: []
      };
    }

    const selectedCellCount =
      (selectionRange.endRow - selectionRange.startRow + 1) * (selectionRange.endCol - selectionRange.startCol + 1);
    const useSelectionScope = selectedCellCount > 1;
    const scope = useSelectionScope
      ? {
          mode: "selection" as const,
          startRow: Math.max(0, selectionRange.startRow),
          endRow: Math.min(selectionRange.endRow, usedEndRow),
          startCol: Math.max(0, selectionRange.startCol),
          endCol: Math.min(selectionRange.endCol, usedEndCol),
          visibleOnly: hasActiveFilters
        }
      : {
          mode: "table" as const,
          startRow: 0,
          endRow: usedEndRow,
          startCol: 0,
          endCol: usedEndCol,
          visibleOnly: hasActiveFilters
        };

    if (scope.startRow > scope.endRow || scope.startCol > scope.endCol) {
      return { query: normalizedQuery, scope, results: [] };
    }

    const results: CsvFindSnapshot["results"] = [];
    const lowerQuery = normalizedQuery.toLowerCase();
    for (let row = scope.startRow; row <= scope.endRow; row += 1) {
      if (hasActiveFilters && !isRowVisible(row)) {
        continue;
      }
      for (let col = scope.startCol; col <= scope.endCol; col += 1) {
        const value = readCell(searchableData, row, col);
        if (value.toLowerCase().includes(lowerQuery)) {
          results.push({ row, col, value, locked: lockedSet.has(cellKey(row, col)) });
        }
      }
    }
    return { query: normalizedQuery, scope, results };
  };

  const findResults = tab.findSnapshot?.results ?? [];
  const findSnapshotMatchesInput = Boolean(tab.findSnapshot && tab.findSnapshot.query === tab.findQuery.trim());
  const activeFindResultIndex = findResults.findIndex(
    (result) => result.row === tab.selection.focusRow && result.col === tab.selection.focusCol
  );
  const visibleFindResults = findResults.slice(0, 500);

  const copySelectionToInternalBuffer = (statusSuffix = "") => {
    const text = hasActiveFilters
      ? matrixRowsToTsv(tab.data, selectedVisibleRows, selectionRange.startCol, selectionRange.endCol)
      : matrixToTsv(
          tab.data,
          selectionRange.startRow,
          selectionRange.startCol,
          selectionRange.endRow,
          selectionRange.endCol
        );
    copiedTextRef.current = text;
    setCopiedRange(hasActiveFilters ? { ...selectionRange, rows: selectedVisibleRows } : selectionRange);
    const copiedRowCount = hasActiveFilters ? selectedVisibleRowCount : selectionRange.endRow - selectionRange.startRow + 1;
    onSetStatus(
      `已复制 ${copiedRowCount} x ${selectionColumnCount}${hasActiveFilters ? "（仅可见）" : ""}${statusSuffix}`
    );
    return text;
  };

  const pasteTextIntoSelection = (text: string) => {
    if (!text) {
      return;
    }
    try {
      clearCopiedState();
      const parsed = parseTsv(text);
      if (hasActiveFilters) {
        onPasteCells(createVisiblePasteUpdates(parsed, selectedVisibleRows, selectionRange, displayRows, rowCount));
      } else {
        onPaste(
          selectionRange.startRow,
          selectionRange.startCol,
          expandPasteValues(
            parsed,
            selectionRange.endRow - selectionRange.startRow + 1,
            selectionRange.endCol - selectionRange.startCol + 1
          )
        );
      }
    } catch (error) {
      onSetStatus(error instanceof Error ? error.message : "粘贴内容解析失败");
    }
  };

  const cutSelectionToInternalBuffer = (statusSuffix = "") => {
    clearCopiedState();
    if (selectedVisibleCells.some((cell) => lockedSet.has(cellKey(cell.row, cell.col)))) {
      onSetStatus("选区包含锁定格，不能剪切");
      return;
    }
    const text = hasActiveFilters
      ? matrixRowsToTsv(tab.data, selectedVisibleRows, selectionRange.startCol, selectionRange.endCol)
      : matrixToTsv(
          tab.data,
          selectionRange.startRow,
          selectionRange.startCol,
          selectionRange.endRow,
          selectionRange.endCol
        );
    copiedTextRef.current = text;
    setCopiedRange(hasActiveFilters ? { ...selectionRange, rows: selectedVisibleRows } : selectionRange);
    if (hasActiveFilters) {
      onClearCells(selectedVisibleCells);
    } else {
      onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
    }
    const cutRowCount = hasActiveFilters ? selectedVisibleRowCount : selectionRange.endRow - selectionRange.startRow + 1;
    onSetStatus(`已剪切 ${cutRowCount} x ${selectionColumnCount}${hasActiveFilters ? "（仅可见）" : ""}${statusSuffix}`);
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

  const openFindPanel = () => {
    setFindPanelOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
      findInputRef.current?.select();
    });
  };

  const closeFindPanel = () => {
    setFindPanelOpen(false);
    focusGridInputSoon();
  };

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (findPanelOpen) {
          closeFindPanel();
        } else {
          openFindPanel();
        }
      }
    };
    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, [findPanelOpen]);

  const applySelectionStyle = (stylePatch: Partial<CsvCellStyle>) => {
    runAfterCommittingEditAndClearingCopiedRange(() => {
      if (hasActiveFilters) {
        onApplyCellStyleToCells(selectedVisibleCells, stylePatch);
        return;
      }
      onApplyCellStyle(
        selectionRange.startRow,
        selectionRange.startCol,
        selectionRange.endRow,
        selectionRange.endCol,
        stylePatch
      );
    });
  };

  const jumpToFindResult = (result: FindResultCell) => {
    requestSelectionScroll();
    onSelectionChange(singleCellSelection(result.row, result.col));
  };

  const confirmFind = (select: "first" | "last" | "none" = "first") => {
    setFindPanelOpen(true);
    commitEditing(false);
    const snapshot = buildFindSnapshot();
    onSetFindSnapshot(snapshot);
    if (!snapshot) {
      onSetStatus("请输入查找内容");
      return null;
    }
    const scopeText = describeFindScope(snapshot.scope);
    if (snapshot.results.length === 0) {
      onSetStatus(`${scopeText}没有匹配内容`);
      return snapshot;
    }
    if (select !== "none") {
      jumpToFindResult(select === "first" ? snapshot.results[0] : snapshot.results[snapshot.results.length - 1]);
    }
    onSetStatus(`${scopeText}找到 ${snapshot.results.length} 项`);
    return snapshot;
  };

  const runFind = (direction: "next" | "previous") => {
    setFindPanelOpen(true);
    if (!tab.findQuery.trim()) {
      onSetStatus("请输入查找内容");
      return;
    }
    if (!tab.findSnapshot || !findSnapshotMatchesInput) {
      confirmFind(direction === "next" ? "first" : "last");
      return;
    }
    const nextIndex = getAdjacentFindResultIndex(
      findResults,
      tab.selection.focusRow,
      tab.selection.focusCol,
      direction
    );
    commitEditing(false);
    if (nextIndex >= 0) {
      const result = findResults[nextIndex];
      jumpToFindResult(result);
    } else {
      onSetStatus(`${describeFindScope(tab.findSnapshot.scope)}没有匹配内容`);
    }
  };

  const replaceCurrentMatch = () => {
    const query = tab.findSnapshot && findSnapshotMatchesInput ? tab.findSnapshot.query : tab.findQuery.trim();
    if (!query) {
      onSetStatus("请输入查找内容");
      return;
    }
    runAfterCommittingEditAndClearingCopiedRange(() => onReplaceCurrent(query));
  };

  const replaceAllMatches = () => {
    let snapshot = tab.findSnapshot && findSnapshotMatchesInput ? tab.findSnapshot : null;
    if (!snapshot) {
      snapshot = confirmFind("none");
    }
    if (!snapshot) {
      return;
    }
    if (snapshot.results.length === 0) {
      onSetStatus(`${describeFindScope(snapshot.scope)}没有可替换的匹配内容`);
      return;
    }
    runAfterCommittingEditAndClearingCopiedRange(() => onReplaceFindResults(snapshot.results, snapshot.query));
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

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectionChange({
        anchorRow: getLastVisibleUsedRow(displayRows, realEndRow),
        anchorCol: realEndCol,
        focusRow: getFirstVisibleUsedRow(displayRows),
        focusCol: 0
      });
      onSetStatus(hasActiveFilters ? "已全选筛选可见区域" : "已全选已用区域");
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
      if (hasActiveFilters) {
        onClearCells(selectedVisibleCells);
      } else {
        onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
      }
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
    if (event.key === "Tab" && (event.ctrlKey || event.metaKey)) {
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
        `已复制 ${hasActiveFilters ? selectedVisibleRowCount : selectionRange.endRow - selectionRange.startRow + 1} x ${selectionColumnCount}${
          hasActiveFilters ? "（仅可见）" : ""
        }（仅编辑器内可粘贴）`
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
    if (selectedVisibleCells.some((cell) => lockedSet.has(cellKey(cell.row, cell.col)))) {
      onSetStatus("选区包含锁定格，不能剪切");
      return;
    }
    const text = hasActiveFilters
      ? matrixRowsToTsv(tab.data, selectedVisibleRows, selectionRange.startCol, selectionRange.endCol)
      : matrixToTsv(
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
      if (hasActiveFilters) {
        onClearCells(selectedVisibleCells);
      } else {
        onClearRange(selectionRange.startRow, selectionRange.startCol, selectionRange.endRow, selectionRange.endCol);
      }
      onSetStatus(
        `已剪切 ${hasActiveFilters ? selectedVisibleRowCount : selectionRange.endRow - selectionRange.startRow + 1} x ${selectionColumnCount}${
          hasActiveFilters ? "（仅可见）" : ""
        }`
      );
    } catch {
      onSetStatus("剪切失败：浏览器未允许剪贴板写入");
    }
  };

  const openColumnFilterMenu = (col: number, button: HTMLElement) => {
    const allValues = getColumnFilterOptions(tab.data, col, [], col).map((option) => option.value);
    const hasColumnFilter = Object.prototype.hasOwnProperty.call(tab.columnFilters, col);
    const rect = button.getBoundingClientRect();
    setFilterMenu({
      col,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      top: rect.bottom + 5,
      search: "",
      draftSelectedValues: hasColumnFilter ? [...tab.columnFilters[col]] : allValues,
      addSearchSelectionToFilter: false
    });
  };

  const filterMenuOptions = useMemo(
    () =>
      filterMenu
        ? getColumnFilterOptions(tab.data, filterMenu.col, columnFilterEntries, filterMenu.col)
        : [],
    [columnFilterEntries, filterMenu, tab.data]
  );
  const filterMenuAllValues = useMemo(
    () => (filterMenu ? getColumnFilterOptions(tab.data, filterMenu.col, [], filterMenu.col).map((option) => option.value) : []),
    [filterMenu, tab.data]
  );
  const filterMenuSelectedSet = useMemo(
    () => new Set(filterMenu?.draftSelectedValues ?? []),
    [filterMenu?.draftSelectedValues]
  );
  const filterMenuSearchQuery = filterMenu?.search.trim().toLowerCase() ?? "";
  const filterMenuHasSearch = filterMenuSearchQuery.length > 0;
  const filterMenuHasColumnFilter = Boolean(
    filterMenu && Object.prototype.hasOwnProperty.call(tab.columnFilters, filterMenu.col)
  );
  const displayedFilterMenuOptions = useMemo(() => {
    if (!filterMenuSearchQuery) {
      return filterMenuOptions;
    }
    return filterMenuOptions.filter((option) => option.label.toLowerCase().includes(filterMenuSearchQuery));
  }, [filterMenuOptions, filterMenuSearchQuery]);
  const displayedFilterMenuValues = useMemo(
    () => displayedFilterMenuOptions.map((option) => option.value),
    [displayedFilterMenuOptions]
  );
  const selectedDisplayedFilterValueCount = displayedFilterMenuValues.filter((value) =>
    filterMenuSelectedSet.has(value)
  ).length;
  const allDisplayedFilterValuesSelected =
    displayedFilterMenuValues.length > 0 && selectedDisplayedFilterValueCount === displayedFilterMenuValues.length;
  const someDisplayedFilterValuesSelected = selectedDisplayedFilterValueCount > 0;
  const selectAllFilterLabel = filterMenuHasSearch ? "全选搜索结果" : "全选";
  const canApplyFilterMenu = !filterMenuHasSearch || displayedFilterMenuValues.length > 0;

  useEffect(() => {
    if (filterSelectAllRef.current) {
      filterSelectAllRef.current.indeterminate =
        someDisplayedFilterValuesSelected && !allDisplayedFilterValuesSelected;
    }
  }, [allDisplayedFilterValuesSelected, someDisplayedFilterValuesSelected]);

  const setFilterMenuDraftValues = (updater: (current: Set<string>) => Set<string>) => {
    setFilterMenu((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        draftSelectedValues: [...updater(new Set(current.draftSelectedValues))]
      };
    });
  };

  const toggleDisplayedFilterValues = () => {
    setFilterMenuDraftValues((current) => {
      if (displayedFilterMenuValues.length === 0) {
        return current;
      }
      if (displayedFilterMenuValues.every((value) => current.has(value))) {
        displayedFilterMenuValues.forEach((value) => current.delete(value));
      } else {
        displayedFilterMenuValues.forEach((value) => current.add(value));
      }
      return current;
    });
  };

  const toggleFilterValue = (value: string) => {
    setFilterMenuDraftValues((current) => {
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      return current;
    });
  };

  const applyFilterMenu = () => {
    if (!filterMenu) {
      return;
    }
    const draftSelectedSet = new Set(filterMenu.draftSelectedValues);
    const displayedValueSet = new Set(displayedFilterMenuValues);
    const scopedSelectedSet = filterMenuHasSearch
      ? new Set([...draftSelectedSet].filter((value) => displayedValueSet.has(value)))
      : draftSelectedSet;
    const finalSelectedSet =
      filterMenuHasSearch && filterMenu.addSearchSelectionToFilter && filterMenuHasColumnFilter
        ? new Set([...(tab.columnFilters[filterMenu.col] ?? []), ...scopedSelectedSet])
        : scopedSelectedSet;
    const selectedValues = filterMenuAllValues.filter((value) => finalSelectedSet.has(value));
    const selectedValueSet = new Set(selectedValues);
    const selectedAllValues =
      filterMenuAllValues.length === selectedValues.length &&
      filterMenuAllValues.every((value) => selectedValueSet.has(value));
    onSetColumnFilter(filterMenu.col, selectedAllValues ? null : selectedValues);
    setFilterMenu(null);
  };

  useEffect(() => {
    if (!filterMenu) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".column-filter-popover") || target?.closest(".column-filter-button")) {
        return;
      }
      setFilterMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilterMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterMenu]);

  const renderColumnHeader = (col: number, keyPrefix: string, className = "") => (
    <div
      key={`${keyPrefix}-h-${col}`}
      className={`column-header ${tab.columnFilters[col] !== undefined ? "filtered" : ""} ${className}`}
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
        dragAnchorRef.current = {
          kind: "column",
          col,
          startX: event.clientX,
          startY: event.clientY,
          active: false
        };
        setDragging(true);
        onSelectionChange({
          anchorRow: getLastVisibleUsedRow(displayRows, realEndRow),
          anchorCol: col,
          focusRow: getFirstVisibleUsedRow(displayRows),
          focusCol: col
        });
        focusGridInput();
      }}
      onPointerEnter={(event) => {
        if (activateDragSelection(event.clientX, event.clientY)) {
          updateDragSelection(getFirstVisibleUsedRow(displayRows), col);
        }
      }}
    >
      <span className="column-label">{columnName(col)}</span>
      <button
        type="button"
        className={`column-filter-button ${tab.columnFilters[col] !== undefined ? "active" : ""}`}
        title={`筛选 ${columnName(col)} 列`}
        aria-label={`筛选 ${columnName(col)} 列`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openColumnFilterMenu(col, event.currentTarget);
        }}
      >
        <Filter size={13} />
      </button>
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

  const renderRowHeader = (row: number, keyPrefix: string, className = "") => {
    const hiddenRowCountBefore = getHiddenRowCountBefore(row);
    return (
      <div
        key={`${keyPrefix}-r-${row}`}
        className={`row-header ${hiddenRowCountBefore > 0 ? "hidden-gap-before" : ""} ${className}`}
        role="rowheader"
        aria-label={`Row ${row + 1}`}
        style={{
          left: 0,
          top: getRowTop(row),
          width: rowHeaderWidth,
          height: rowHeight
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          commitEditing(false);
          dragAnchorRef.current = {
            kind: "row",
            row,
            startX: event.clientX,
            startY: event.clientY,
            active: false
          };
          setDragging(true);
          onSelectionChange({ anchorRow: row, anchorCol: realEndCol, focusRow: row, focusCol: 0 });
          focusGridInput();
        }}
        onPointerEnter={(event) => {
          if (activateDragSelection(event.clientX, event.clientY)) {
            updateDragSelection(row, 0);
          }
        }}
        title={hiddenRowCountBefore > 0 ? `上方已隐藏 ${hiddenRowCountBefore} 行` : undefined}
      >
        {row + 1}
      </div>
    );
  };

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
      (!copiedRange.rows || copiedRange.rows.includes(row)) &&
      col >= copiedRange.startCol &&
      col <= copiedRange.endCol;

    return (
      <div
        key={`${keyPrefix}-${row}-${col}`}
        className={`grid-cell ${selected ? "selected" : ""} ${focus ? "focus" : ""} ${isEditing ? "editing" : ""} ${copied ? "copied" : ""} ${
          locked ? "locked" : ""
        } ${className}`}
        role="gridcell"
        aria-label={`${columnName(col)}${row + 1}`}
        style={{
          left: rowHeaderWidth + colOffsets[col],
          top: getRowTop(row),
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
          const anchor = event.shiftKey
            ? { row: tab.selection.anchorRow, col: tab.selection.anchorCol }
            : { row, col };
          dragAnchorRef.current = {
            kind: "cell",
            row: anchor.row,
            col: anchor.col,
            startX: event.clientX,
            startY: event.clientY,
            active: false
          };
          setDragging(true);
          onSelectionChange(
            event.shiftKey
              ? {
                  anchorRow: anchor.row,
                  anchorCol: anchor.col,
                  focusRow: row,
                  focusCol: col
                }
              : singleCellSelection(row, col)
          );
          focusGridInput();
        }}
        onPointerEnter={(event) => {
          if (activateDragSelection(event.clientX, event.clientY)) {
            updateDragSelection(row, col);
          }
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
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onPointerDown={(event) => {
              event.stopPropagation();
              dragAnchorRef.current = null;
              setDragging(false);
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setEditing({ row, col, value: event.target.value });
              onEditDraftDirtyChange(event.target.value !== readCell(tab.data, row, col));
            }}
            onBlur={() => commitEditing(false)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
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
    <section className={`grid-shell ${findPanelOpen ? "has-find-panel" : ""} ${hasActiveFilters ? "has-active-filters" : ""}`}>
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
              runAfterCommittingEdit(() => {
                if (hasActiveFilters) {
                  onToggleLockCells(selectedVisibleCells, !rangeLocked);
                  return;
                }
                onToggleLock(
                  selectionRange.startRow,
                  selectionRange.startCol,
                  selectionRange.endRow,
                  selectionRange.endCol,
                  !rangeLocked
                );
              })
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
            onClick={() =>
              runAfterCommittingEditAndClearingCopiedRange(() => {
                if (hasActiveFilters) {
                  const firstVisibleRow = selectedVisibleRows[0] ?? selectionRange.startRow;
                  onInsertRows(firstVisibleRow, firstVisibleRow + selectedVisibleRowCount - 1);
                  return;
                }
                onInsertRows(selectionRange.startRow, selectionRange.endRow);
              })
            }
          >
            <Plus size={15} />
            插行
          </button>
          <button
            className="tool-button"
            onClick={() =>
              runAfterCommittingEditAndClearingCopiedRange(() => {
                if (hasActiveFilters) {
                  onDeleteRowsByIndexes(selectedVisibleRows);
                  return;
                }
                onDeleteRows(selectionRange.startRow, selectionRange.endRow);
              })
            }
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
          <button
            className={`tool-button favorite-active-button ${isActiveFavorite ? "active" : ""}`}
            onClick={() => runAfterCommittingEdit(onAddActiveFavorite)}
            disabled={!canAddActiveFavorite || isActiveFavorite}
            title={isActiveFavorite ? "当前文档已在收藏中" : "将当前文档加入收藏"}
          >
            <Star size={15} fill={isActiveFavorite ? "currentColor" : "none"} />
            加入收藏
          </button>
        </div>
      </div>

      <div className="formula-bar">
        <span className="cell-name">{selectedLabel}</span>
        <textarea
          rows={1}
          value={selectedValue}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            clearCopiedState();
            onSetCell(tab.selection.focusRow, tab.selection.focusCol, event.target.value);
          }}
          disabled={selectedLocked}
          aria-label="Selected cell value"
        />
        <span className={`lock-state ${selectedLocked ? "locked" : ""}`}>{selectedLocked ? "已锁定" : "可编辑"}</span>
      </div>

      {filterMenu ? (
        <div
          className="column-filter-popover"
          role="dialog"
          aria-label={`筛选 ${columnName(filterMenu.col)} 列`}
          style={{ left: filterMenu.left, top: filterMenu.top }}
        >
          <div className="column-filter-title">
            <span>{columnName(filterMenu.col)} 列筛选</span>
            <button className="icon-button" onClick={() => setFilterMenu(null)} title="关闭筛选" aria-label="关闭筛选">
              <X size={14} />
            </button>
          </div>
          <label className="column-filter-search">
            <Search size={14} />
            <input
              value={filterMenu.search}
              onChange={(event) =>
                setFilterMenu((current) =>
                  current ? { ...current, search: event.target.value, addSearchSelectionToFilter: false } : current
                )
              }
              placeholder="搜索值"
              aria-label="搜索筛选值"
            />
          </label>
          <label className="column-filter-option select-all">
            <input
              ref={filterSelectAllRef}
              type="checkbox"
              checked={allDisplayedFilterValuesSelected}
              disabled={displayedFilterMenuOptions.length === 0}
              onChange={toggleDisplayedFilterValues}
              aria-label={selectAllFilterLabel}
            />
            <span>{selectAllFilterLabel}</span>
            <span className="column-filter-count">{displayedFilterMenuOptions.length}</span>
          </label>
          {filterMenuHasSearch && filterMenuHasColumnFilter ? (
            <label className="column-filter-option add-current-selection">
              <input
                type="checkbox"
                checked={filterMenu.addSearchSelectionToFilter}
                onChange={(event) =>
                  setFilterMenu((current) =>
                    current ? { ...current, addSearchSelectionToFilter: event.target.checked } : current
                  )
                }
                aria-label="添加当前选择到筛选"
              />
              <span>添加当前选择到筛选</span>
            </label>
          ) : null}
          <div className="column-filter-values">
            {displayedFilterMenuOptions.length > 0 ? (
              displayedFilterMenuOptions.map((option) => (
                <label className="column-filter-option" key={option.value}>
                  <input
                    type="checkbox"
                    checked={filterMenuSelectedSet.has(option.value)}
                    onChange={() => toggleFilterValue(option.value)}
                    aria-label={`筛选值 ${option.label}`}
                  />
                  <span className="column-filter-value" title={option.label}>
                    {option.label}
                  </span>
                  <span className="column-filter-count">{option.count}</span>
                </label>
              ))
            ) : (
              <span className="column-filter-empty">没有可选值</span>
            )}
          </div>
          <div className="column-filter-actions">
            <button
              className="tool-button"
              onClick={() => {
                onSetColumnFilter(filterMenu.col, null);
                setFilterMenu(null);
              }}
              disabled={tab.columnFilters[filterMenu.col] === undefined}
            >
              清除筛选
            </button>
            <button
              className="tool-button"
              onClick={() => {
                onClearAllFilters();
                setFilterMenu(null);
              }}
              disabled={!hasActiveFilters}
            >
              全部清除
            </button>
            <button className="tool-button primary-filter-action" onClick={applyFilterMenu} disabled={!canApplyFilterMenu}>
              确定
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid-workarea">
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
          if (dragAnchorRef.current) {
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
              onSelectionChange({
                anchorRow: getLastVisibleUsedRow(displayRows, realEndRow),
                anchorCol: realEndCol,
                focusRow: getFirstVisibleUsedRow(displayRows),
                focusCol: 0
              });
              onSetStatus(hasActiveFilters ? "已全选筛选可见区域" : "已全选已用区域");
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

      {findPanelOpen ? (
        <aside className="find-side-panel" aria-label="查找与替换">
          <div className="find-panel-header">
            <span>查找与替换</span>
            <button className="icon-button" onClick={() => setFindPanelOpen(false)} title="关闭查找" aria-label="关闭查找">
              <X size={14} />
            </button>
          </div>

          <div className="find-panel-fields">
            <label className="find-field">
              <span>查找内容</span>
              <div className="find-field-input">
                <Search size={15} />
                <input
                  ref={findInputRef}
                  value={tab.findQuery}
                  onChange={(event) => onSetFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmFind(event.shiftKey ? "last" : "first");
                    }
                  }}
                  aria-label="查找内容"
                />
              </div>
            </label>
            <label className="find-field">
              <span>替换为</span>
              <input
                className="find-replace-input"
                value={tab.replaceValue}
                onChange={(event) => onSetReplaceValue(event.target.value)}
                aria-label="替换为"
              />
            </label>
          </div>

          <div className="find-panel-actions">
            <button className="tool-button primary-find-action" onClick={() => confirmFind("first")} disabled={!findAvailable}>
              <Search size={15} />
              查找
            </button>
            <button className="tool-button" onClick={() => onSetFindSnapshot(null)} disabled={!tab.findSnapshot}>
              <X size={15} />
              清除结果
            </button>
            <button className="tool-button" onClick={() => runFind("previous")} disabled={!findAvailable}>
              <ChevronUp size={15} />
              上一处
            </button>
            <button className="tool-button" onClick={() => runFind("next")} disabled={!findAvailable}>
              <ChevronDown size={15} />
              下一处
            </button>
            <button className="tool-button" onClick={replaceCurrentMatch} disabled={!findAvailable}>
              替换
            </button>
            <button className="tool-button" onClick={replaceAllMatches} disabled={!findAvailable}>
              全部替换
            </button>
          </div>

          <div className="find-results-summary">
            {tab.findSnapshot ? (
              <span>
                {findResults.length} 项 · {describeFindScope(tab.findSnapshot.scope)}
                {activeFindResultIndex >= 0 ? ` · 第 ${activeFindResultIndex + 1} 项` : ""}
                {!findSnapshotMatchesInput ? ` · 来自 "${formatInlinePreview(tab.findSnapshot.query)}"` : ""}
              </span>
            ) : (
              <span>0 项</span>
            )}
          </div>

          <div className="find-result-list">
            {tab.findSnapshot && visibleFindResults.length > 0 ? (
              visibleFindResults.map((result, index) => (
                <button
                  key={`${result.row}:${result.col}`}
                  className={`find-result ${activeFindResultIndex === index ? "active" : ""}`}
                  onClick={() => {
                    commitEditing(false);
                    jumpToFindResult(result);
                    focusGridInputSoon();
                  }}
                  title={result.value}
                  aria-label={`跳转到 ${columnName(result.col)}${result.row + 1}`}
                >
                  <span className="find-result-cell">
                    {columnName(result.col)}
                    {result.row + 1}
                  </span>
                  <span className="find-result-preview">{formatCellValuePreview(result.value)}</span>
                  {result.locked ? <span className="find-result-lock">锁</span> : null}
                </button>
              ))
            ) : (
              <span className="find-result-empty">{tab.findSnapshot ? "没有匹配内容" : "无结果"}</span>
            )}
            {findResults.length > visibleFindResults.length ? (
              <span className="find-result-more">仅显示前 {visibleFindResults.length} 项</span>
            ) : null}
          </div>
        </aside>
      ) : null}
      </div>

      <div className={`grid-status ${hasActiveFilters ? "filtered" : ""}`}>
        <span className={dirtyCount > 0 ? "status-warning" : ""}>未保存 {dirtyCount}</span>
        <span>{selectedStats}</span>
        <span className={hasActiveFilters ? "filter-status" : ""}>
          {tab.data.length} 行 / {maxColumnCount(tab.data)} 列
          {hasActiveFilters ? ` / 筛选显示 ${Math.max(0, displayRows!.filter((row) => row < tab.data.length).length - 1)} 行` : ""}
        </span>
        <span>
          选区 {hasActiveFilters ? selectedVisibleRowCount : selectionRange.endRow - selectionRange.startRow + 1} x {selectionColumnCount}
          {hasActiveFilters && hiddenRowsInSelection > 0 ? `（隐藏 ${hiddenRowsInSelection} 行）` : ""}
        </span>
        <span>冻结 {tab.freezeRows} 行 / {tab.freezeCols} 列</span>
        <span>{tab.status ?? "就绪"}</span>
        {notice ? <span className={`notice ${notice.tone}`}>{notice.message}</span> : null}
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

function matrixRowsToTsv(data: CsvMatrix, rows: number[], startCol: number, endCol: number): string {
  return rowsToTsv(
    rows.map((row) => {
      const values: string[] = [];
      for (let col = startCol; col <= endCol; col += 1) {
        values.push(readCell(data, row, col));
      }
      return values;
    })
  );
}

function getRowsInSelection(
  startRow: number,
  endRow: number,
  displayRows: number[] | null,
  rowCount: number
): number[] {
  if (displayRows) {
    return displayRows.filter((row) => row >= startRow && row <= endRow);
  }
  const rows: number[] = [];
  const start = clamp(startRow, 0, rowCount - 1);
  const end = clamp(endRow, 0, rowCount - 1);
  for (let row = start; row <= end; row += 1) {
    rows.push(row);
  }
  return rows;
}

function buildCellList(rows: number[], startCol: number, endCol: number): FindResultCell[] {
  const cells: FindResultCell[] = [];
  for (const row of rows) {
    for (let col = startCol; col <= endCol; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function createVisiblePasteUpdates(
  values: string[][],
  selectedRows: number[],
  selectionRange: ReturnType<typeof normalizeSelection>,
  displayRows: number[] | null,
  rowCount: number
): CsvCellUpdate[] {
  const sourceRows = values.length;
  const sourceCols = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (sourceRows === 0 || sourceCols === 0) {
    return [];
  }
  const selectedColCount = selectionRange.endCol - selectionRange.startCol + 1;
  const rangePaste = selectedRows.length > 1 || selectedColCount > 1;
  const targetRows = rangePaste
    ? selectedRows
    : getVisibleRowsFromStart(selectionRange.startRow, sourceRows, displayRows, rowCount);
  const targetCols = numberRange(rangePaste ? selectedColCount : sourceCols).map(
    (offset) => selectionRange.startCol + offset
  );
  const expandedValues = rangePaste ? expandPasteValues(values, targetRows.length, targetCols.length) : values;
  const updates: CsvCellUpdate[] = [];
  expandedValues.forEach((line, rowOffset) => {
    const row = targetRows[rowOffset];
    if (row === undefined) {
      return;
    }
    line.forEach((value, colOffset) => {
      const col = targetCols[colOffset];
      if (col !== undefined) {
        updates.push({ row, col, value });
      }
    });
  });
  return updates;
}

function getVisibleRowsFromStart(
  startRow: number,
  count: number,
  displayRows: number[] | null,
  rowCount: number
): number[] {
  if (!displayRows) {
    return numberRange(count).map((offset) => startRow + offset);
  }
  const startIndex = findFirstSortedIndexAtLeast(displayRows, startRow);
  const rows = displayRows.slice(startIndex, startIndex + count);
  let nextRow = rows[rows.length - 1] ?? Math.max(startRow, rowCount);
  while (rows.length < count) {
    nextRow += 1;
    rows.push(nextRow);
  }
  return rows;
}

function getColumnFilterOptions(
  data: CsvMatrix,
  col: number,
  filters: Array<{ col: number; values: Set<string> }>,
  ignoredCol: number
): FilterValueOption[] {
  const counts = new Map<string, number>();
  for (let row = FILTER_IGNORED_ROW_COUNT; row < data.length; row += 1) {
    if (!rowPassesColumnFilters(data, row, filters, ignoredCol)) {
      continue;
    }
    const value = readCell(data, row, col);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({
    value,
    label: value === "" ? "(空白)" : value,
    count
  }));
}

function rowPassesColumnFilters(
  data: CsvMatrix,
  row: number,
  filters: Array<{ col: number; values: Set<string> }>,
  ignoredCol?: number
): boolean {
  if (row < FILTER_IGNORED_ROW_COUNT) {
    return true;
  }
  for (const filter of filters) {
    if (filter.col === ignoredCol) {
      continue;
    }
    if (!filter.values.has(readCell(data, row, filter.col))) {
      return false;
    }
  }
  return true;
}

function getFirstVisibleUsedRow(displayRows: number[] | null): number {
  if (!displayRows) {
    return 0;
  }
  return displayRows[0] ?? 0;
}

function getLastVisibleUsedRow(displayRows: number[] | null, realEndRow: number): number {
  if (!displayRows) {
    return realEndRow;
  }
  let last = displayRows[0] ?? 0;
  for (const row of displayRows) {
    if (row > realEndRow) {
      break;
    }
    last = row;
  }
  return last;
}

function findFirstSortedIndexAtLeast(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
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

function formatInlinePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact || "(空)";
}

function describeFindScope(scope: CsvFindSnapshot["scope"]): string {
  const label =
    scope.mode === "selection"
      ? `选区 ${columnName(scope.startCol)}${scope.startRow + 1}:${columnName(scope.endCol)}${scope.endRow + 1}`
      : "全表";
  return scope.visibleOnly ? `${label}（可见行）` : label;
}
