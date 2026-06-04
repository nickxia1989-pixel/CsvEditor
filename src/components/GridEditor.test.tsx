import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GridEditor } from "./GridEditor";
import type { CsvTab } from "../types";
import { singleCellSelection } from "../types";

function createTab(overrides: Partial<CsvTab> = {}): CsvTab {
  return {
    id: "tab-1",
    name: "monster.csv",
    path: "Sample/monster.csv",
    fileRef: {
      source: "sample",
      name: "monster.csv",
      path: "Sample/monster.csv",
      writable: false,
      read: async () => ({
        text: "",
        version: { lastModified: 1, size: 1 }
      })
    },
    data: [
      ["ID", "Name"],
      ["1001", "Training Slime"],
      ["1002", "Forest Wolf"]
    ],
    delimiter: ",",
    newline: "\n",
    hasBom: false,
    encoding: "utf-8",
    version: { lastModified: 1, size: 1 },
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    findQuery: "wolf",
    replaceValue: "fox",
    lockedCells: [],
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
    undoStack: [],
    redoStack: [],
    ...overrides
  };
}

function renderGrid(tab = createTab()) {
  const props = {
    tab,
    onSelectionChange: vi.fn(),
    onSetCell: vi.fn(),
    onPaste: vi.fn(),
    onClearRange: vi.fn(),
    onToggleLock: vi.fn(),
    onSetZoom: vi.fn(),
    onSetFreeze: vi.fn(),
    onSetColWidth: vi.fn(),
    onSetAutoRefresh: vi.fn(),
    onSetFindQuery: vi.fn(),
    onSetReplaceValue: vi.fn(),
    onReplaceCurrent: vi.fn(),
    onReplaceAll: vi.fn(),
    canUndo: tab.undoStack.length > 0,
    canRedo: tab.redoStack.length > 0,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onInsertRows: vi.fn(),
    onDeleteRows: vi.fn(),
    onInsertColumns: vi.fn(),
    onDeleteColumns: vi.fn(),
    onAddRow: vi.fn(),
    onAddColumn: vi.fn()
  };
  render(<GridEditor {...props} />);
  return props;
}

describe("GridEditor toolbar", () => {
  it("jumps to the next matching cell from the find control", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "下一处" }));
    expect(props.onSelectionChange).toHaveBeenCalledWith(singleCellSelection(2, 1));
  });

  it("toggles auto refresh for the active tab", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "自动热刷" }));
    expect(props.onSetAutoRefresh).toHaveBeenCalledWith(false);
  });

  it("fires undo and redo toolbar callbacks", () => {
    const snapshot = {
      data: [["old"]],
      lockedCells: [],
      selection: singleCellSelection(0, 0),
      colWidths: {},
      dirty: false
    };
    const props = renderGrid(createTab({ undoStack: [snapshot], redoStack: [snapshot] }));

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getByRole("button", { name: "重做" }));

    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onRedo).toHaveBeenCalledTimes(1);
  });

  it("fires replace toolbar callbacks", () => {
    const props = renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));

    expect(props.onReplaceCurrent).toHaveBeenCalledTimes(1);
    expect(props.onReplaceAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the original anchor while dragging a cell range", async () => {
    const props = renderGrid();

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A1" }), {
      clientX: 80,
      clientY: 70,
      pointerId: 1
    });

    await waitFor(() => {
      expect(props.onSelectionChange).toHaveBeenCalledWith(singleCellSelection(0, 0));
    });

    fireEvent.pointerEnter(screen.getByRole("gridcell", { name: "B2" }));

    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 0,
      anchorCol: 0,
      focusRow: 1,
      focusCol: 1
    });
  });

  it("selects whole columns and rows from the headers", () => {
    const props = renderGrid();

    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column B" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 0,
      anchorCol: 1,
      focusRow: 2,
      focusCol: 1
    });

    fireEvent.pointerDown(screen.getByRole("rowheader", { name: "Row 2" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 1,
      anchorCol: 0,
      focusRow: 1,
      focusCol: 1
    });
  });

  it("selects the used data range from the corner header", () => {
    const props = renderGrid();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Select all cells" }));

    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 0,
      anchorCol: 0,
      focusRow: 2,
      focusCol: 1
    });
  });
});
