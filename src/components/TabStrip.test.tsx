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

function stubRect(element: HTMLElement, left: number, width: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 30,
      width,
      height: 30,
      toJSON: () => ({})
    }))
  });
}

describe("TabStrip", () => {
  it("marks the active tab distinctly for styling and accessibility", () => {
    render(
      <TabStrip
        tabs={[createTab(0), createTab(1)]}
        activeTabId="tab-1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).not.toHaveClass("active");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveClass("active");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });

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

  it("forwards tab context menu targets", () => {
    const onContextMenu = vi.fn();
    render(
      <TabStrip
        tabs={[createTab(0), createTab(1)]}
        activeTabId="tab-0"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onContextMenu={onContextMenu}
      />
    );

    fireEvent.contextMenu(screen.getAllByRole("tab")[1], { clientX: 44, clientY: 22 });

    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: "tab-1" }), { x: 44, y: 22 });
  });

  it("reports pointer tab reorder placement with insertion feedback", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <TabStrip
        tabs={[createTab(0), createTab(1), createTab(2)]}
        activeTabId="tab-0"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={onReorder}
      />
    );
    const tabStrip = screen.getByRole("tablist", { name: "Open CSV tabs" });
    const tabs = screen.getAllByRole("tab");
    stubRect(tabStrip, 0, 500);
    stubRect(tabs[1], 100, 120);
    stubRect(tabs[2], 224, 120);

    fireEvent.pointerDown(tabs[0], { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    fireEvent.pointerMove(tabs[0], { pointerId: 1, clientX: 218, clientY: 15 });

    expect(tabs[0]).toHaveClass("dragging");
    expect(tabs[2]).toHaveClass("drop-before");
    const indicator = container.querySelector(".tab-drop-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveStyle({ left: "222px", top: "-3px", height: "36px" });

    fireEvent.pointerUp(tabs[0], { pointerId: 1, clientX: 218, clientY: 15 });

    expect(onReorder).toHaveBeenCalledWith("tab-0", "tab-2", "before");
    expect(container.querySelector(".tab-drop-indicator")).not.toBeInTheDocument();
  });
});
