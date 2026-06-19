import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { GlobalSearchOverlay } from "./GlobalSearchOverlay";
import type { GlobalSearchSnapshot } from "../types";

function snapshot(overrides: Partial<GlobalSearchSnapshot> = {}): GlobalSearchSnapshot {
  return {
    id: "history-1",
    query: "alpha",
    createdAt: 1000,
    rootName: "Tables",
    rootPath: "Tables",
    searchedFileCount: 2,
    matchedFileCount: 1,
    results: [
      {
        id: "Tables/skill.csv:1:1",
        fileName: "skill.csv",
        filePath: "Tables/skill.csv",
        relativePath: "skill/skill.csv",
        row: 1,
        col: 1,
        cell: "B2",
        value: "Alpha Strike",
        preview: "Alpha Strike",
        primaryKey: "1",
        fieldName: "Name",
        contextBefore: "Name",
        contextAfter: "Beta Strike",
        rowContext: "1 / Alpha Strike"
      }
    ],
    errors: [],
    ...overrides
  };
}

function renderOverlay(overrides: Partial<ComponentProps<typeof GlobalSearchOverlay>> = {}) {
  const activeSnapshot = snapshot();
  const props = {
    query: "alpha",
    snapshot: activeSnapshot,
    history: [activeSnapshot],
    selectedHistoryId: activeSnapshot.id,
    selectedResultId: null,
    resultsScrollTop: 0,
    searching: false,
    progress: { phase: "idle" as const, scannedFiles: 0, totalFiles: 0 },
    canSearch: true,
    onQueryChange: vi.fn(),
    onRunSearch: vi.fn(),
    onSelectHistory: vi.fn(),
    onDeleteHistory: vi.fn(),
    onOpenResult: vi.fn(),
    onResultsScroll: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<GlobalSearchOverlay {...props} />);
  return props;
}

describe("GlobalSearchOverlay", () => {
  it("runs a full-table search from Enter and the search button", () => {
    const props = renderOverlay({ query: "monster", snapshot: null, history: [] });
    const input = screen.getByRole("textbox", { name: "全表搜索内容" });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(props.onRunSearch).toHaveBeenNthCalledWith(1, "monster");
    expect(props.onRunSearch).toHaveBeenNthCalledWith(2, "monster");
  });

  it("shows saved history records and loads a selected record", () => {
    const props = renderOverlay();

    const history = screen.getByLabelText("全表搜索历史");
    fireEvent.click(within(history).getByTitle("alpha - Tables"));

    expect(within(history).getByTitle("alpha - Tables")).toHaveClass("active");
    expect(props.onSelectHistory).toHaveBeenCalledWith("history-1");
  });

  it("deletes one saved search record without selecting it", () => {
    const props = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "删除搜索记录 alpha" }));

    expect(props.onDeleteHistory).toHaveBeenCalledWith("history-1");
    expect(props.onSelectHistory).not.toHaveBeenCalled();
  });

  it("opens clicked search results", () => {
    const props = renderOverlay();

    fireEvent.click(screen.getByRole("listitem", { name: /skill\.csv/ }));

    expect(props.onOpenResult).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "skill.csv",
        row: 1,
        col: 1
      })
    );
  });

  it("renders matched content, table name, primary key, and field name", () => {
    renderOverlay({ selectedResultId: "Tables/skill.csv:1:1" });

    const result = screen.getByRole("listitem", { name: /Alpha Strike/ });

    expect(result).toHaveClass("active");
    expect(within(result).getAllByText("Alpha")[0].tagName).toBe("MARK");
    expect(result).toHaveTextContent(/表格\s*skill\.csv/);
    expect(result).toHaveTextContent(/ID\s*1/);
    expect(result).toHaveTextContent(/字段\s*Name/);
    expect(result).not.toHaveTextContent("1 / Alpha Strike");
    expect(result).not.toHaveTextContent("Beta Strike");
    expect(result).not.toHaveTextContent("skill/skill.csv");
    expect(result).not.toHaveTextContent("B2");
    expect(result).not.toHaveTextContent("上：");
    expect(result).not.toHaveTextContent("同行：");
    expect(result).not.toHaveTextContent("下：");
    expect(result).not.toHaveTextContent("A2");
  });

  it("restores and reports the results scroll position", () => {
    const props = renderOverlay({ resultsScrollTop: 80 });
    const results = screen.getByRole("list", { name: "全表搜索结果" });

    expect(results.scrollTop).toBe(80);

    fireEvent.scroll(results, { target: { scrollTop: 120 } });

    expect(props.onResultsScroll).toHaveBeenCalledWith("history-1", 120);
  });

  it("closes on Escape and outside click", () => {
    const props = renderOverlay();
    const input = screen.getByRole("textbox", { name: "全表搜索内容" });

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "全表搜索" }).parentElement!);

    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
