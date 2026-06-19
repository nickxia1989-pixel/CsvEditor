import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabSwitcherOverlay } from "./TabSwitcherOverlay";
import type { CsvTab } from "../types";
import { singleCellSelection } from "../types";

function createTab(index: number, overrides: Partial<CsvTab> = {}): CsvTab {
  const name = `table-${String(index).padStart(2, "0")}.csv`;
  return {
    id: `tab-${index}`,
    name,
    path: `Tables/${name}`,
    fileRef: {
      source: "local",
      name,
      path: `Tables/${name}`,
      writable: true,
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

describe("TabSwitcherOverlay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("keeps the selected option visible while cycling through a long list", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const tabs = Array.from({ length: 18 }, (_, index) => createTab(index));

    const { rerender } = render(
      <TabSwitcherOverlay
        tabs={tabs}
        selectedTabId="tab-12"
        originTabId="tab-0"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: /table-12\.csv/ })).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });

    rerender(
      <TabSwitcherOverlay
        tabs={tabs}
        selectedTabId="tab-17"
        originTabId="tab-0"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: /table-17\.csv/ })).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("scrolls the floating list with the mouse wheel", () => {
    const tabs = Array.from({ length: 18 }, (_, index) => createTab(index));
    render(
      <TabSwitcherOverlay
        tabs={tabs}
        selectedTabId="tab-0"
        originTabId="tab-0"
        onSelect={vi.fn()}
      />
    );
    const listbox = screen.getByRole("listbox", { name: "打开的表格" });
    Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 300 });
    listbox.scrollTop = 10;
    listbox.scrollLeft = 4;

    fireEvent.wheel(listbox, {
      deltaY: 120,
      deltaX: 6
    });

    expect(listbox.scrollTop).toBe(130);
    expect(listbox.scrollLeft).toBe(10);
  });

  it("keeps mouse hover separate from the keyboard selection", () => {
    const tabs = Array.from({ length: 4 }, (_, index) => createTab(index));
    const onSelect = vi.fn();
    render(
      <TabSwitcherOverlay
        tabs={tabs}
        selectedTabId="tab-0"
        originTabId="tab-0"
        onSelect={onSelect}
      />
    );

    const hovered = screen.getByRole("option", { name: /table-02\.csv/ });
    fireEvent.mouseEnter(hovered);

    expect(hovered).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /table-00\.csv/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(hovered);

    expect(onSelect).toHaveBeenCalledWith("tab-2");
  });
});
