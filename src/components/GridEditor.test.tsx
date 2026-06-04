import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function createGridProps(tab = createTab()) {
  return {
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
    onSetStatus: vi.fn(),
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
}

function renderGrid(tab = createTab()) {
  const props = createGridProps(tab);
  render(<GridEditor {...props} />);
  return props;
}

function renderGridWithResult(tab = createTab()) {
  const props = createGridProps(tab);
  const result = render(<GridEditor {...props} />);
  return { ...result, props };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("GridEditor editing workflow", () => {
  it("copies the selected TSV range and reports copy status", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const props = renderGrid();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "c", ctrlKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ID"));
    expect(props.onSetStatus).toHaveBeenCalledWith("已复制 1 x 1");
  });

  it("reports a copy failure when the browser clipboard API is unavailable", async () => {
    const props = renderGrid();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "c", ctrlKey: true });

    await waitFor(() => expect(props.onSetStatus).toHaveBeenCalledWith("复制失败：浏览器未允许剪贴板写入"));
  });

  it("cancels inline editing when switching to another tab", () => {
    const { container, props, rerender } = renderGridWithResult(createTab({ id: "tab-1" }));

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    expect(container.querySelector(".cell-editor")).toBeInTheDocument();

    rerender(<GridEditor {...props} tab={createTab({ id: "tab-2", data: [["Other"]] })} />);

    expect(container.querySelector(".cell-editor")).not.toBeInTheDocument();
  });
});

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

  it("uses scroll CSS variables for frozen rows and columns", () => {
    renderGrid(createTab({ freezeRows: 1, freezeCols: 1 }));

    const grid = screen.getByRole("grid", { name: "CSV grid" });
    grid.scrollTop = 84;
    grid.scrollLeft = 244;
    fireEvent.scroll(grid);

    expect(grid.style.getPropertyValue("--grid-scroll-top")).toBe("84px");
    expect(grid.style.getPropertyValue("--grid-scroll-left")).toBe("244px");

    expect(screen.getByRole("columnheader", { name: "Column A" })).toHaveClass("frozen-col");
    expect(screen.getByRole("rowheader", { name: "Row 1" })).toHaveClass("frozen-row");

    const corner = screen.getByRole("button", { name: "Select all cells" });
    expect(corner.style.left).toBe("0px");
    expect(corner.style.top).toBe("0px");
    expect(corner.style.transform).toBe("translateX(var(--grid-scroll-left)) translateY(var(--grid-scroll-top))");

    const frozenCornerCell = screen.getByRole("gridcell", { name: "A1" });
    expect(frozenCornerCell).toHaveClass("frozen", "frozen-row", "frozen-col");
    expect(frozenCornerCell.style.transform).toBe("translateX(var(--grid-scroll-left)) translateY(var(--grid-scroll-top))");

    expect(screen.getByRole("gridcell", { name: "B1" }).style.transform).toBe("translateY(var(--grid-scroll-top))");
    expect(screen.getByRole("gridcell", { name: "A2" }).style.transform).toBe("translateX(var(--grid-scroll-left))");
    expect(screen.getByRole("gridcell", { name: "B2" }).style.transform).toBe("");
  });
});
