import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  Star,
  X,
  Upload
} from "lucide-react";
import type { CsvFavoriteFile, TreeNode } from "../types";

const TREE_ROW_HEIGHT = 28;
const TREE_OVERSCAN = 12;

type DirectoryPaneProps = {
  root: TreeNode | null;
  favorites: CsvFavoriteFile[];
  activeFavoritePath: string | null;
  filter: string;
  directoryPickerAvailable: boolean;
  svnCommitAvailable: boolean;
  svnUpdateAvailable: boolean;
  canReloadActive: boolean;
  canSaveActive: boolean;
  canSaveAll: boolean;
  canGlobalSearch: boolean;
  onFilterChange(value: string): void;
  onPickDirectory(): void;
  onSvnCommit(): void;
  onSvnUpdate(): void;
  onReloadActive(): void;
  onSaveActive(): void;
  onSaveAll(): void;
  onOpenGlobalSearch(): void;
  onToggleDirectory(node: TreeNode): void;
  onOpenFile(node: TreeNode): void;
  onFileContextMenu?(node: TreeNode, point: { x: number; y: number }): void;
  onOpenFavorite(favorite: CsvFavoriteFile): void;
  onRemoveFavorite(favorite: CsvFavoriteFile): void;
};

export function DirectoryPane({
  root,
  favorites,
  activeFavoritePath,
  filter,
  directoryPickerAvailable,
  svnCommitAvailable,
  svnUpdateAvailable,
  canReloadActive,
  canSaveActive,
  canSaveAll,
  canGlobalSearch,
  onFilterChange,
  onPickDirectory,
  onSvnCommit,
  onSvnUpdate,
  onReloadActive,
  onSaveActive,
  onSaveAll,
  onOpenGlobalSearch,
  onToggleDirectory,
  onOpenFile,
  onFileContextMenu,
  onOpenFavorite,
  onRemoveFavorite
}: DirectoryPaneProps) {
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [treeViewport, setTreeViewport] = useState({
    height: 520,
    scrollTop: 0
  });
  const normalizedFilter = filter.trim().toLowerCase();
  const sortedFavorites = useMemo(() => sortFavoritesByName(favorites), [favorites]);
  const rows = useMemo(() => (root ? flattenTreeRows(root, normalizedFilter) : []), [normalizedFilter, root]);
  const totalHeight = Math.max(rows.length * TREE_ROW_HEIGHT, treeViewport.height);
  const visibleStart = clamp(
    Math.floor(treeViewport.scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN,
    0,
    Math.max(0, rows.length - 1)
  );
  const visibleEnd = clamp(
    Math.ceil((treeViewport.scrollTop + treeViewport.height) / TREE_ROW_HEIGHT) + TREE_OVERSCAN,
    0,
    rows.length
  );
  const visibleRows = rows.slice(visibleStart, visibleEnd);

  useEffect(() => {
    const element = treeRef.current;
    if (!element) {
      return undefined;
    }
    const updateViewport = () => {
      setTreeViewport({
        height: element.clientHeight || 520,
        scrollTop: element.scrollTop
      });
    };
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    updateViewport();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = treeRef.current;
    if (element) {
      element.scrollTop = 0;
    }
    setTreeViewport((current) => ({ ...current, scrollTop: 0 }));
  }, [normalizedFilter]);

  return (
    <aside className="directory-pane">
      <div className="pane-title">
        <div>
          <h1>CSV Workspace</h1>
          <span>本地目录 / 热刷新</span>
        </div>
      </div>

      <div className="directory-actions">
        <button className="primary-button" onClick={onPickDirectory} disabled={!directoryPickerAvailable}>
          <FolderOpen size={16} />
          选择目录
        </button>
        <button
          className="ghost-button"
          onClick={onSvnUpdate}
          disabled={!svnUpdateAvailable}
          title={svnUpdateAvailable ? "打开 TortoiseSVN 更新窗口" : "SVN 更新只支持已选择本地目录的桌面版"}
        >
          <RefreshCw size={16} />
          SVN更新
        </button>
        <button
          className="ghost-button"
          onClick={onSvnCommit}
          disabled={!svnCommitAvailable}
          title={svnCommitAvailable ? "打开 TortoiseSVN 提交确认窗口" : "SVN 提交只支持已选择本地目录的桌面版"}
        >
          <Upload size={16} />
          SVN提交
        </button>
      </div>

      <div className="file-actions">
        <button
          className="file-action-button"
          onClick={onReloadActive}
          disabled={!canReloadActive}
          title="从磁盘重新读取当前 CSV"
          aria-label="刷新"
        >
          <RefreshCw size={15} />
          <span>刷新</span>
        </button>
        <button
          className="file-action-button save"
          onClick={onSaveActive}
          disabled={!canSaveActive}
          title="保存当前 CSV"
          aria-label="保存"
        >
          <Save size={15} />
          <span>保存</span>
        </button>
        <button
          className="file-action-button"
          onClick={onSaveAll}
          disabled={!canSaveAll}
          title="保存所有未保存且可写的 CSV"
          aria-label="全部保存"
        >
          <SaveAll size={15} />
          <span>全部保存</span>
        </button>
        <button
          className="file-action-button"
          onClick={onOpenGlobalSearch}
          disabled={!canGlobalSearch}
          title={canGlobalSearch ? "搜索当前目录下所有 CSV" : "请先选择目录"}
          aria-label="全表搜索"
        >
          <Search size={15} />
          <span>全表搜索</span>
        </button>
      </div>

      {!directoryPickerAvailable ? (
        <div className="compat-note">当前浏览器不支持目录选择。请用 Chrome 或 Edge 打开本地 dev URL。</div>
      ) : null}

      <section className="favorites-section" aria-label="收藏表格">
        <div className="favorites-title">
          <Star size={15} />
          <span>收藏</span>
        </div>
        {sortedFavorites.length > 0 ? (
          <div className="favorites-list">
            {sortedFavorites.map((favorite) => (
              <div className="favorite-slot" key={favorite.path}>
                <button
                  className={`favorite-row ${favorite.path === activeFavoritePath ? "active" : ""}`}
                  onClick={() => onOpenFavorite(favorite)}
                  title={favorite.path}
                >
                  <FileText size={14} />
                  <span>{favorite.name}</span>
                </button>
                <button
                  type="button"
                  className="favorite-remove"
                  onClick={() => onRemoveFavorite(favorite)}
                  title={`移除 ${favorite.name}`}
                  aria-label={`移除收藏 ${favorite.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="favorite-empty">暂无收藏</div>
        )}
      </section>

      <label className="search-box">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="搜索全部 CSV"
          aria-label="搜索全部 CSV"
        />
      </label>

      <div
        className="tree-scroll"
        ref={treeRef}
        data-testid="tree-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          setTreeViewport((current) => ({
            ...current,
            scrollTop: element.scrollTop
          }));
        }}
      >
        {root ? (
          <div className="tree-canvas" data-testid="tree-canvas" style={{ height: totalHeight }}>
            {visibleRows.map((row, index) => (
              <div
                key={row.node.id}
                className="tree-row-slot"
                style={{ top: (visibleStart + index) * TREE_ROW_HEIGHT, height: TREE_ROW_HEIGHT }}
              >
                <TreeRow
                  node={row.node}
                  depth={row.depth}
                  searchActive={Boolean(normalizedFilter)}
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
                  onFileContextMenu={onFileContextMenu}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-tree">
            <Folder size={28} />
            <p>先选择一个包含 CSV 的目录。</p>
          </div>
        )}
      </div>
    </aside>
  );
}

type TreeRowProps = {
  node: TreeNode;
  depth: number;
  searchActive: boolean;
  onToggleDirectory(node: TreeNode): void;
  onOpenFile(node: TreeNode): void;
  onFileContextMenu?(node: TreeNode, point: { x: number; y: number }): void;
};

function TreeRow({ node, depth, searchActive, onToggleDirectory, onOpenFile, onFileContextMenu }: TreeRowProps) {
  const isDirectory = node.kind === "directory";
  const visuallyExpanded = isDirectory && (node.expanded || (searchActive && Boolean(node.children?.length)));
  const icon = isDirectory ? (
    node.loading ? (
      <Loader2 size={15} className="spin" />
    ) : visuallyExpanded ? (
      <ChevronDown size={15} />
    ) : (
      <ChevronRight size={15} />
    )
  ) : (
    <span className="tree-spacer" />
  );

  return (
    <>
      <button
        className={`tree-row ${isDirectory ? "directory" : "file"}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (isDirectory ? onToggleDirectory(node) : onOpenFile(node))}
        onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
          if (isDirectory || !onFileContextMenu) {
            return;
          }
          event.preventDefault();
          onFileContextMenu(node, { x: event.clientX, y: event.clientY });
        }}
        title={node.path}
      >
        {icon}
        {isDirectory ? visuallyExpanded ? <FolderOpen size={15} /> : <Folder size={15} /> : <FileText size={15} />}
        <span>{node.name}</span>
      </button>
      {node.error ? <span className="tree-error">{node.error}</span> : null}
    </>
  );
}

type FlatTreeRow = {
  node: TreeNode;
  depth: number;
};

function flattenTreeRows(root: TreeNode, filter: string): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  collectTreeRows(root, 0, filter, rows);
  return rows;
}

function collectTreeRows(node: TreeNode, depth: number, filter: string, rows: FlatTreeRow[]): void {
  if (!nodeMatchesFilter(node, filter)) {
    return;
  }

  rows.push({ node, depth });
  if (node.kind !== "directory" || !node.children || (!node.expanded && !filter)) {
    return;
  }

  node.children.forEach((child) => collectTreeRows(child, depth + 1, filter, rows));
}

function nodeMatchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter) {
    return true;
  }
  if (node.name.toLowerCase().includes(filter) || node.path.toLowerCase().includes(filter)) {
    return true;
  }
  return Boolean(node.children?.some((child) => nodeMatchesFilter(child, filter)));
}

function sortFavoritesByName(favorites: CsvFavoriteFile[]): CsvFavoriteFile[] {
  return [...favorites].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }) ||
      left.path.localeCompare(right.path, "zh-CN", { numeric: true, sensitivity: "base" })
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
