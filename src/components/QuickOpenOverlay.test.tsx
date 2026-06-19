import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { QuickOpenOverlay } from "./QuickOpenOverlay";
import type { QuickOpenCandidate } from "../lib/quickOpen";

function createCandidate(index: number, overrides: Partial<QuickOpenCandidate> = {}): QuickOpenCandidate {
  const name = `table-${String(index).padStart(2, "0")}.csv`;
  return {
    id: `candidate-${index}`,
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
    open: false,
    active: false,
    dirty: false,
    externalChanged: false,
    score: 0,
    ...overrides
  };
}

function renderQuickOpen(overrides: Partial<ComponentProps<typeof QuickOpenOverlay>> = {}) {
  const props = {
    query: "",
    candidates: Array.from({ length: 12 }, (_, index) => createCandidate(index)),
    selectedId: "candidate-0",
    loading: false,
    onQueryChange: vi.fn(),
    onMoveSelection: vi.fn(),
    onSelectEdge: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<QuickOpenOverlay {...props} />);
  return props;
}

describe("QuickOpenOverlay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("focuses the input and exposes selected results as a combobox", () => {
    renderQuickOpen();

    const input = screen.getByRole("combobox", { name: "快速打开文件" });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveAttribute("aria-activedescendant", "quick-open-option-0");
    expect(screen.getByRole("option", { name: /table-00\.csv/ })).toHaveAttribute("aria-selected", "true");
  });

  it("forwards keyboard quick-open actions", () => {
    const props = renderQuickOpen();
    const input = screen.getByRole("combobox", { name: "快速打开文件" });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "PageDown" });
    fireEvent.keyDown(input, { key: "PageUp" });
    fireEvent.keyDown(input, { key: "End", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(props.onMoveSelection).toHaveBeenNthCalledWith(1, 1);
    expect(props.onMoveSelection).toHaveBeenNthCalledWith(2, -1);
    expect(props.onMoveSelection).toHaveBeenNthCalledWith(3, 8);
    expect(props.onMoveSelection).toHaveBeenNthCalledWith(4, -8);
    expect(props.onSelectEdge).toHaveBeenCalledWith("last");
    expect(props.onOpen).toHaveBeenCalledWith();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps hover separate from keyboard selection and opens clicked options", () => {
    const props = renderQuickOpen();
    const hovered = screen.getByRole("option", { name: /table-04\.csv/ });

    fireEvent.mouseMove(hovered, { clientX: 40, clientY: 160 });

    expect(hovered).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /table-00\.csv/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(hovered);

    expect(props.onOpen).toHaveBeenCalledWith("candidate-4");
  });

  it("scrolls the floating results with the mouse wheel", () => {
    renderQuickOpen();
    const listbox = screen.getByRole("listbox", { name: "快速打开文件结果" });
    Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 240 });
    listbox.scrollTop = 12;

    fireEvent.wheel(screen.getByRole("dialog", { name: "快速打开文件" }), { deltaY: 120 });

    expect(listbox.scrollTop).toBe(132);
  });

  it("keeps the selected candidate visible", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const candidates = Array.from({ length: 12 }, (_, index) => createCandidate(index));

    const { rerender } = render(
      <QuickOpenOverlay
        query=""
        candidates={candidates}
        selectedId="candidate-6"
        loading={false}
        onQueryChange={vi.fn()}
        onMoveSelection={vi.fn()}
        onSelectEdge={vi.fn()}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });

    rerender(
      <QuickOpenOverlay
        query=""
        candidates={candidates}
        selectedId="candidate-11"
        loading={false}
        onQueryChange={vi.fn()}
        onMoveSelection={vi.fn()}
        onSelectEdge={vi.fn()}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
  });
});
