import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectoryPane } from "./DirectoryPane";
import type { TreeNode } from "../types";

function createLargeRoot(count: number): TreeNode {
  return {
    id: "Tables",
    name: "Tables",
    path: "Tables",
    kind: "directory",
    expanded: true,
    loaded: true,
    children: Array.from({ length: count }, (_, index) => {
      const padded = String(index).padStart(3, "0");
      return {
        id: `Tables/file-${padded}.csv`,
        name: `file-${padded}.csv`,
        path: `Tables/file-${padded}.csv`,
        kind: "file" as const
      };
    })
  };
}

function renderDirectory(root = createLargeRoot(200)) {
  const props = {
    root,
    filter: "",
    directoryPickerAvailable: true,
    svnCommitAvailable: true,
    svnUpdateAvailable: true,
    onFilterChange: vi.fn(),
    onPickDirectory: vi.fn(),
    onSvnCommit: vi.fn(),
    onSvnUpdate: vi.fn(),
    onToggleDirectory: vi.fn(),
    onOpenFile: vi.fn()
  };
  const result = render(<DirectoryPane {...props} />);
  return { ...result, props };
}

describe("DirectoryPane", () => {
  it("virtualizes large directory trees and keeps a real scroll range", () => {
    const { container } = renderDirectory();

    expect(screen.getByRole("button", { name: "file-000.csv" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "file-199.csv" })).not.toBeInTheDocument();

    const canvas = container.querySelector('[data-testid="tree-canvas"]');
    expect(canvas).toHaveStyle({ height: `${201 * 28}px` });
  });

  it("renders deep rows after scrolling the virtual tree", async () => {
    renderDirectory();
    const scroll = screen.getByTestId("tree-scroll");

    fireEvent.scroll(scroll, { target: { scrollTop: 5200 } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "file-199.csv" })).toBeInTheDocument();
    });
  });

  it("forwards filter text changes to the app", () => {
    const { props } = renderDirectory();

    fireEvent.change(screen.getByPlaceholderText("搜索全部 CSV"), { target: { value: "monster" } });

    expect(props.onFilterChange).toHaveBeenCalledWith("monster");
  });

  it("does not render the sample loader button", () => {
    renderDirectory();

    expect(screen.queryByRole("button", { name: "样例" })).not.toBeInTheDocument();
  });

  it("forwards SVN update clicks to the app", () => {
    const { props } = renderDirectory();

    fireEvent.click(screen.getByRole("button", { name: "SVN更新" }));

    expect(props.onSvnUpdate).toHaveBeenCalledTimes(1);
  });

  it("forwards SVN commit clicks to the app", () => {
    const { props } = renderDirectory();

    fireEvent.click(screen.getByRole("button", { name: "SVN提交" }));

    expect(props.onSvnCommit).toHaveBeenCalledTimes(1);
  });
});
