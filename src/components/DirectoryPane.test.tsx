import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
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

function renderDirectory(root = createLargeRoot(200), overrides: Partial<ComponentProps<typeof DirectoryPane>> = {}) {
  const props = {
    root,
    favorites: [],
    activeFavoritePath: null,
    filter: "",
    directoryPickerAvailable: true,
    svnCommitAvailable: true,
    svnUpdateAvailable: true,
    canReloadActive: true,
    canSaveActive: true,
    canSaveAll: true,
    canGlobalSearch: true,
    onFilterChange: vi.fn(),
    onPickDirectory: vi.fn(),
    onSvnCommit: vi.fn(),
    onSvnUpdate: vi.fn(),
    onReloadActive: vi.fn(),
    onSaveActive: vi.fn(),
    onSaveAll: vi.fn(),
    onOpenGlobalSearch: vi.fn(),
    onToggleDirectory: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFavorite: vi.fn(),
    onRemoveFavorite: vi.fn(),
    ...overrides
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

  it("renders current file actions in the directory pane", () => {
    const { props } = renderDirectory();

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));
    fireEvent.click(screen.getByRole("button", { name: "全表搜索" }));

    expect(props.onReloadActive).toHaveBeenCalledTimes(1);
    expect(props.onSaveActive).toHaveBeenCalledTimes(1);
    expect(props.onSaveAll).toHaveBeenCalledTimes(1);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it("opens a file context menu target from a right click", () => {
    const onFileContextMenu = vi.fn();
    renderDirectory(createLargeRoot(3), { onFileContextMenu });

    fireEvent.contextMenu(screen.getByRole("button", { name: "file-000.csv" }), { clientX: 18, clientY: 42 });

    expect(onFileContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "file-000.csv",
        path: "Tables/file-000.csv",
        kind: "file"
      }),
      { x: 18, y: 42 }
    );
  });

  it("renders favorite files and forwards open and remove actions", () => {
    const { props } = renderDirectory(createLargeRoot(3), {
      favorites: [
        {
          name: "monster.csv",
          path: "Tables/monster/monster.csv",
          source: "local"
        }
      ],
      activeFavoritePath: "Tables/monster/monster.csv"
    });

    fireEvent.click(screen.getByRole("button", { name: "monster.csv" }));
    fireEvent.click(screen.getByRole("button", { name: "移除收藏 monster.csv" }));

    expect(screen.getByRole("button", { name: "monster.csv" })).toHaveClass("active");
    expect(props.onOpenFavorite).toHaveBeenCalledWith({
      name: "monster.csv",
      path: "Tables/monster/monster.csv",
      source: "local"
    });
    expect(props.onRemoveFavorite).toHaveBeenCalledWith({
      name: "monster.csv",
      path: "Tables/monster/monster.csv",
      source: "local"
    });
  });

  it("sorts favorite files alphabetically by name", () => {
    renderDirectory(createLargeRoot(3), {
      favorites: [
        { name: "zeta.csv", path: "Tables/zeta.csv", source: "local" },
        { name: "beta-10.csv", path: "Tables/beta-10.csv", source: "local" },
        { name: "Alpha.csv", path: "Tables/Alpha.csv", source: "local" },
        { name: "beta-2.csv", path: "Tables/beta-2.csv", source: "local" }
      ]
    });

    const favoriteSection = screen.getByLabelText("收藏表格");
    const favoriteNames = within(favoriteSection)
      .getAllByRole("button")
      .filter((button) => button.classList.contains("favorite-row"))
      .map((button) => button.textContent);

    expect(favoriteNames).toEqual(["Alpha.csv", "beta-2.csv", "beta-10.csv", "zeta.csv"]);
  });

  it("shows an empty favorite state when there are no favorites", () => {
    renderDirectory(createLargeRoot(3));

    expect(screen.getByLabelText("收藏表格")).toHaveTextContent("暂无收藏");
  });

  it("disables current file actions when the app has no matching operation", () => {
    renderDirectory(createLargeRoot(3), {
      canReloadActive: false,
      canSaveActive: false,
      canSaveAll: false,
      canGlobalSearch: false
    });

    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全部保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全表搜索" })).toBeDisabled();
  });
});
