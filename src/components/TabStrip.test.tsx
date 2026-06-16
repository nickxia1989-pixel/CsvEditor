import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabStrip } from "./TabStrip";
import type { CsvTab } from "../types";
import { singleCellSelection } from "../types";

function createTab(index: number, overrides: Partial<CsvTab> = {}): CsvTab {
  const name = `very-long-csv-tab-title-${String(index).padStart(2, "0")}.csv`;
  return {
    id: `tab-${index}`,
    name,
    path: `Sample/${name}`,
    fileRef: {
      source: "sample",
      name,
      path: `Sample/${name}`,
      writable: false,
      read: async () => ({
        text: "",
        version: { lastModified: 1, size: 1 }
      })
    },
    data: [["A"]],
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
    findQuery: "",
    replaceValue: "",
    findSnapshot: null,
    lockedCells: [],
    cellStyles: {},
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
    columnFilters: {},
    undoStack: [],
    redoStack: [],
    ...overrides
  };
}

function setHorizontalOverflow(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
}

describe("TabStrip", () => {
  it("does not hide overflowing tabs behind mouse-wheel horizontal scrolling", () => {
    render(
      <TabStrip
        tabs={Array.from({ length: 12 }, (_, index) => createTab(index))}
        activeTabId="tab-0"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tabStrip = screen.getByRole("tablist", { name: "Open CSV tabs" });
    setHorizontalOverflow(tabStrip, 1600, 500);
    tabStrip.scrollLeft = 40;

    fireEvent.wheel(tabStrip, { deltaY: 180, deltaX: 0 });

    expect(tabStrip.scrollLeft).toBe(40);
    expect(screen.getAllByRole("tab")).toHaveLength(12);
  });

  it("does not consume wheel input when tabs do not overflow", () => {
    render(
      <TabStrip
        tabs={[createTab(0)]}
        activeTabId="tab-0"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tabStrip = screen.getByRole("tablist", { name: "Open CSV tabs" });
    setHorizontalOverflow(tabStrip, 400, 500);
    tabStrip.scrollLeft = 0;

    fireEvent.wheel(tabStrip, { deltaY: 180, deltaX: 0 });

    expect(tabStrip.scrollLeft).toBe(0);
  });
});
