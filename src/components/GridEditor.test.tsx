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
    sourceRows: [],
    trailingNewline: false,
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
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveClass("copied");
  });

  it("reports a copy failure when the browser clipboard API is unavailable", async () => {
    const props = renderGrid();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "c", ctrlKey: true });

    await waitFor(() => expect(props.onSetStatus).toHaveBeenCalledWith("复制失败：浏览器未允许剪贴板写入"));
  });

  it("cuts the selected TSV range only after clipboard write succeeds", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const props = renderGrid(createTab({
      selection: {
        anchorRow: 2,
        anchorCol: 1,
        focusRow: 1,
        focusCol: 0
      }
    }));

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "x", ctrlKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1001\tTraining Slime\n1002\tForest Wolf"));
    expect(props.onClearRange).toHaveBeenCalledWith(1, 0, 2, 1);
    expect(props.onSetStatus).toHaveBeenCalledWith("已剪切 2 x 2");
  });

  it("does not clear the selected range when cut clipboard write fails", async () => {
    const props = renderGrid();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "x", ctrlKey: true });

    await waitFor(() => expect(props.onSetStatus).toHaveBeenCalledWith("剪切失败：浏览器未允许剪贴板写入"));
    expect(props.onClearRange).not.toHaveBeenCalled();
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
      sourceRows: [],
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

  it("starts paste from the selection top-left and tiles into a larger selected range", () => {
    const props = renderGrid(createTab({
      selection: {
        anchorRow: 2,
        anchorCol: 1,
        focusRow: 1,
        focusCol: 0
      }
    }));

    fireEvent.paste(screen.getByRole("grid", { name: "CSV grid" }), {
      clipboardData: {
        getData: () => "X"
      }
    });

    expect(props.onPaste).toHaveBeenCalledWith(1, 0, [
      ["X", "X"],
      ["X", "X"]
    ]);
  });

  it("copies and pastes through the keyboard proxy when it owns focus", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const props = renderGrid(createTab({
      selection: {
        anchorRow: 2,
        anchorCol: 1,
        focusRow: 1,
        focusCol: 0
      }
    }));
    const keyProxy = screen.getByLabelText("Grid keyboard input");

    fireEvent.keyDown(keyProxy, { key: "c", ctrlKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1001\tTraining Slime\n1002\tForest Wolf"));
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveClass("copied");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveClass("copied");

    fireEvent.paste(keyProxy, {
      clipboardData: {
        getData: () => "X"
      }
    });

    expect(props.onPaste).toHaveBeenCalledWith(1, 0, [
      ["X", "X"],
      ["X", "X"]
    ]);
  });

  it("cuts through the keyboard proxy when it owns focus", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const props = renderGrid();
    const keyProxy = screen.getByLabelText("Grid keyboard input");

    fireEvent.keyDown(keyProxy, { key: "x", ctrlKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ID"));
    expect(props.onClearRange).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(props.onSetStatus).toHaveBeenCalledWith("已剪切 1 x 1");
  });

  it("selects the used range with Ctrl+A from the keyboard proxy", () => {
    const props = renderGrid();
    const keyProxy = screen.getByLabelText("Grid keyboard input");

    fireEvent.keyDown(keyProxy, { key: "a", ctrlKey: true });

    expect(props.onSelectionChange).toHaveBeenCalledWith({
      anchorRow: 2,
      anchorCol: 1,
      focusRow: 0,
      focusCol: 0
    });
    expect(props.onSetStatus).toHaveBeenCalledWith("已全选已用区域");
  });

  it("opens an editor from keyboard input and returns focus to the keyboard proxy after Enter", async () => {
    const { container, props } = renderGridWithResult();
    const grid = screen.getByRole("grid", { name: "CSV grid" });
    const keyProxy = screen.getByLabelText("Grid keyboard input");

    fireEvent.keyDown(grid, { key: "x" });
    const editor = container.querySelector(".cell-editor") as HTMLInputElement;
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue("x");

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(props.onSetCell).toHaveBeenCalledWith(0, 0, "x");
    expect(props.onSelectionChange).toHaveBeenCalledWith(singleCellSelection(1, 0));
    await waitFor(() => expect(document.activeElement).toBe(keyProxy));
  });

  it("uses the keyboard proxy for focus while keeping arrow keys on grid navigation", async () => {
    const props = renderGrid();
    const keyProxy = screen.getByLabelText("Grid keyboard input");

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A1" }));
    await waitFor(() => expect(document.activeElement).toBe(keyProxy));

    fireEvent.keyDown(keyProxy, { key: "ArrowRight" });

    expect(props.onSelectionChange).toHaveBeenLastCalledWith(singleCellSelection(0, 1));
  });

  it("lets the keyboard proxy input event seed text editing instead of printable keydown", () => {
    const { container } = renderGridWithResult();
    const keyProxy = screen.getByLabelText("Grid keyboard input") as HTMLInputElement;

    fireEvent.keyDown(keyProxy, { key: "n" });
    expect(container.querySelector(".cell-editor")).not.toBeInTheDocument();

    fireEvent.change(keyProxy, { target: { value: "n" } });

    const editor = container.querySelector(".cell-editor") as HTMLInputElement;
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue("n");
  });

  it("opens editing from an IME composition committed through the keyboard proxy", () => {
    const { container } = renderGridWithResult();
    const keyProxy = screen.getByLabelText("Grid keyboard input") as HTMLInputElement;

    fireEvent.compositionStart(keyProxy);
    fireEvent.change(keyProxy, { target: { value: "ni" } });
    expect(container.querySelector(".cell-editor")).not.toBeInTheDocument();

    keyProxy.value = "你";
    fireEvent.compositionEnd(keyProxy, { data: "你" });

    const editor = container.querySelector(".cell-editor") as HTMLInputElement;
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue("你");
  });

  it("lets the inline editor handle pointer selection without changing the grid selection", () => {
    const { container, props } = renderGridWithResult();

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = container.querySelector(".cell-editor") as HTMLInputElement;
    fireEvent.pointerDown(editor, { clientX: 82, clientY: 70 });

    expect(props.onSelectionChange).not.toHaveBeenCalled();
  });

  it("selects whole columns and rows from the headers", () => {
    const props = renderGrid();

    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column B" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 2,
      anchorCol: 1,
      focusRow: 0,
      focusCol: 1
    });

    fireEvent.pointerDown(screen.getByRole("rowheader", { name: "Row 2" }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 1,
      anchorCol: 1,
      focusRow: 1,
      focusCol: 0
    });
  });

  it("selects the used data range from the corner header", () => {
    const props = renderGrid();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Select all cells" }));

    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      anchorRow: 2,
      anchorCol: 1,
      focusRow: 0,
      focusCol: 0
    });
  });

  it("does not scroll back to the first cell when selecting row or column headers", async () => {
    const { props, rerender } = renderGridWithResult();
    const grid = screen.getByRole("grid", { name: "CSV grid" }) as HTMLElement;
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 96 });
    Object.defineProperty(grid, "clientWidth", { configurable: true, value: 180 });

    grid.scrollTop = 240;
    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column B" }));
    const columnSelection = props.onSelectionChange.mock.calls.at(-1)?.[0];
    rerender(<GridEditor {...props} tab={createTab({ selection: columnSelection })} />);

    await waitFor(() => expect(grid.scrollTop).toBe(240));

    grid.scrollLeft = 260;
    fireEvent.pointerDown(screen.getByRole("rowheader", { name: "Row 2" }));
    const rowSelection = props.onSelectionChange.mock.calls.at(-1)?.[0];
    rerender(<GridEditor {...props} tab={createTab({ selection: rowSelection })} />);

    await waitFor(() => expect(grid.scrollLeft).toBe(260));
  });

  it("does not scroll back to the first cell when selecting all with Ctrl+A", async () => {
    const { props, rerender } = renderGridWithResult();
    const grid = screen.getByRole("grid", { name: "CSV grid" }) as HTMLElement;
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 96 });
    Object.defineProperty(grid, "clientWidth", { configurable: true, value: 180 });
    grid.scrollTop = 240;
    grid.scrollLeft = 260;

    fireEvent.keyDown(screen.getByLabelText("Grid keyboard input"), { key: "a", ctrlKey: true });
    const allSelection = props.onSelectionChange.mock.calls.at(-1)?.[0];
    rerender(<GridEditor {...props} tab={createTab({ selection: allSelection })} />);

    await waitFor(() => {
      expect(grid.scrollTop).toBe(240);
      expect(grid.scrollLeft).toBe(260);
    });
  });

  it("still scrolls focused cells into view for normal selection changes", async () => {
    const { props, rerender } = renderGridWithResult(createTab({ selection: singleCellSelection(10, 10) }));
    const grid = screen.getByRole("grid", { name: "CSV grid" }) as HTMLElement;
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 96 });
    Object.defineProperty(grid, "clientWidth", { configurable: true, value: 180 });
    grid.scrollTop = 240;
    grid.scrollLeft = 260;

    rerender(<GridEditor {...props} tab={createTab({ selection: singleCellSelection(0, 0) })} />);

    await waitFor(() => {
      expect(grid.scrollTop).toBe(0);
      expect(grid.scrollLeft).toBe(0);
    });
  });

  it("renders frozen rows and columns in sticky layers without scroll transforms", () => {
    renderGrid(createTab({ freezeRows: 1, freezeCols: 1 }));

    const grid = screen.getByRole("grid", { name: "CSV grid" });
    grid.scrollTop = 84;
    grid.scrollLeft = 244;
    fireEvent.scroll(grid);

    expect(grid.style.getPropertyValue("--grid-scroll-top")).toBe("");
    expect(grid.style.getPropertyValue("--grid-scroll-left")).toBe("");

    expect(screen.getByRole("columnheader", { name: "Column A" })).toHaveClass("frozen-col");
    expect(screen.getByRole("rowheader", { name: "Row 1" })).toHaveClass("frozen-row");

    const corner = screen.getByRole("button", { name: "Select all cells" });
    expect(corner.style.left).toBe("0px");
    expect(corner.style.top).toBe("0px");
    expect(corner.style.transform).toBe("");

    const frozenCornerCell = screen.getByRole("gridcell", { name: "A1" });
    expect(frozenCornerCell).toHaveClass("frozen", "frozen-row", "frozen-col");
    expect(frozenCornerCell.style.transform).toBe("");
    expect(screen.getByTestId("grid-freeze-corner")).toContainElement(frozenCornerCell);

    expect(screen.getByTestId("grid-freeze-top")).toContainElement(screen.getByRole("gridcell", { name: "B1" }));
    expect(screen.getByTestId("grid-freeze-left")).toContainElement(screen.getByRole("gridcell", { name: "A2" }));
    expect(screen.getByRole("gridcell", { name: "B2" })).not.toHaveClass("frozen");
  });
});
