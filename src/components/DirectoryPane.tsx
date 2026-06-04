import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Search
} from "lucide-react";
import type { TreeNode } from "../types";

const TREE_ROW_HEIGHT = 28;
const TREE_OVERSCAN = 12;

type DirectoryPaneProps = {
  root: TreeNode | null;
  filter: string;
  directoryPickerAvailable: boolean;
  onFilterChange(value: string): void;
  onPickDirectory(): void;
  onLoadSample(): void;
  onToggleDirectory(node: TreeNode): void;
  onOpenFile(node: TreeNode): void;
};

export function DirectoryPane({
  root,
  filter,
  directoryPickerAvailable,
  onFilterChange,
  onPickDirectory,
  onLoadSample,
  onToggleDirectory,
  onOpenFile
}: DirectoryPaneProps) {
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [treeViewport, setTreeViewport] = useState({
    height: 520,
    scrollTop: 0
  });
  const normalizedFilter = filter.trim().toLowerCase();
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
        <button className="ghost-button" onClick={onLoadSample}>
          <Database size={16} />
          样例
        </button>
      </div>

      {!directoryPickerAvailable ? (
        <div className="compat-note">当前浏览器不支持目录选择。请用 Chrome 或 Edge 打开本地 dev URL。</div>
      ) : null}

      <label className="search-box">
        <Search size={15} />
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="筛选已加载文件"
          aria-label="筛选已加载文件"
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
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
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
  onToggleDirectory(node: TreeNode): void;
  onOpenFile(node: TreeNode): void;
};

function TreeRow({ node, depth, onToggleDirectory, onOpenFile }: TreeRowProps) {
  const isDirectory = node.kind === "directory";
  const icon = isDirectory ? (
    node.loading ? (
      <Loader2 size={15} className="spin" />
    ) : node.expanded ? (
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
        title={node.path}
      >
        {icon}
        {isDirectory ? node.expanded ? <FolderOpen size={15} /> : <Folder size={15} /> : <FileText size={15} />}
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
  if (node.kind !== "directory" || !node.expanded || !node.children) {
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

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
