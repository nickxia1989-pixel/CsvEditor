import { fireEvent, render, screen } from "@testing-library/react";
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
    version: { lastModified: 1, size: 1 },
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    findQuery: "wolf",
    lockedCells: [],
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
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
});
