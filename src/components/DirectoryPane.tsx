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
        <input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="筛选已加载文件" />
      </label>

      <div className="tree-scroll">
        {root ? (
          <TreeRow
            node={root}
            depth={0}
            filter={filter.trim().toLowerCase()}
            onToggleDirectory={onToggleDirectory}
            onOpenFile={onOpenFile}
          />
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
  filter: string;
  onToggleDirectory(node: TreeNode): void;
  onOpenFile(node: TreeNode): void;
};

function TreeRow({ node, depth, filter, onToggleDirectory, onOpenFile }: TreeRowProps) {
  if (!nodeMatchesFilter(node, filter)) {
    return null;
  }

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
      {node.error ? <div className="tree-error" style={{ paddingLeft: 30 + depth * 14 }}>{node.error}</div> : null}
      {isDirectory && node.expanded && node.children
        ? node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </>
  );
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
