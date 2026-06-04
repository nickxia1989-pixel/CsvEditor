import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert
} from "lucide-react";
import { DirectoryPane } from "./components/DirectoryPane";
import { GridEditor } from "./components/GridEditor";
import { TabStrip } from "./components/TabStrip";
import {
  maxColumnCount,
  unparseCsvData,
  writeCell
} from "./lib/csv";
import { canPickDirectory, pickDirectory, versionEquals, type CsvFileRef } from "./lib/fileRefs";
import { applyDiskVersionChange, createTabFromFileRef, reloadTabFromFileRef } from "./lib/tabModel";
import { createLocalRoot, loadLocalChildren, loadSampleTree, updateNode } from "./lib/tree";
import type { CsvTab, TreeNode } from "./types";
import { cellKey, normalizeSelection } from "./types";

const HOT_REFRESH_INTERVAL_MS = 2000;

type Notice = {
  tone: "info" | "success" | "warning" | "error";
  message: string;
} | null;

type NoticeTone = NonNullable<Notice>["tone"];

export function App() {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [tabs, setTabs] = useState<CsvTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [polling, setPolling] = useState(false);
  const tabsRef = useRef(tabs);
  const pollBusyRef = useRef(false);
  const directoryPickerAvailable = canPickDirectory();

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs]);
  const dirtyCount = tabs.filter((tab) => tab.dirty).length;

  const notify = useCallback((tone: NoticeTone, message: string) => {
    setNotice({ tone, message });
    window.setTimeout(() => {
      setNotice((current) => (current?.message === message ? null : current));
    }, 4200);
  }, []);

  const patchTab = useCallback((id: string, updater: (tab: CsvTab) => CsvTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? updater(tab) : tab)));
  }, []);

  const openFileRef = useCallback(
    async (fileRef: CsvFileRef) => {
      const existing = tabsRef.current.find((tab) => tab.path === fileRef.path);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      try {
        const id = crypto.randomUUID();
        const tab = await createTabFromFileRef(fileRef, id);
        setTabs((current) => [...current, tab]);
        setActiveTabId(id);
        notify("success", `已打开 ${fileRef.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify]
  );

  const handlePickDirectory = useCallback(async () => {
    try {
      const handle = await pickDirectory();
      const nextRoot = createLocalRoot(handle);
      setRoot({ ...nextRoot, loading: true });
      const children = await loadLocalChildren(nextRoot);
      setRoot({
        ...nextRoot,
        children,
        loaded: true,
        loading: false
      });
      notify("success", `已载入目录 ${handle.name}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [notify]);

  const handleLoadSample = useCallback(async () => {
    try {
      setRoot(await loadSampleTree());
      notify("info", "已载入只读样例目录");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [notify]);

  const handleToggleDirectory = useCallback(
    async (node: TreeNode) => {
      if (!root || node.kind !== "directory") {
        return;
      }
      if (node.loaded) {
        setRoot(updateNode(root, node.id, (current) => ({ ...current, expanded: !current.expanded })));
        return;
      }

      setRoot(updateNode(root, node.id, (current) => ({ ...current, loading: true, expanded: true, error: undefined })));
      try {
        const children = await loadLocalChildren(node);
        setRoot((current) =>
          current
            ? updateNode(current, node.id, (target) => ({
                ...target,
                children,
                loaded: true,
                loading: false,
                expanded: true
              }))
            : current
        );
      } catch (error) {
        setRoot((current) =>
          current
            ? updateNode(current, node.id, (target) => ({
                ...target,
                loading: false,
                error: error instanceof Error ? error.message : String(error)
              }))
            : current
        );
      }
    },
    [root]
  );

  const handleOpenTreeFile = useCallback(
    (node: TreeNode) => {
      if (node.kind === "file" && node.fileRef) {
        void openFileRef(node.fileRef);
      }
    },
    [openFileRef]
  );

  const reloadTabFromDisk = useCallback(
    async (id: string, force = false) => {
      const tab = tabsRef.current.find((current) => current.id === id);
      if (!tab) {
        return;
      }
      if (tab.dirty && !force) {
        const confirmed = window.confirm(`${tab.name} 有未保存修改。刷新会丢弃这些修改，是否继续？`);
        if (!confirmed) {
          return;
        }
      }
      try {
        const reloaded = await reloadTabFromFileRef(tab);
        patchTab(id, (current) => ({ ...reloaded, id: current.id, selection: current.selection }));
        notify("success", `已刷新 ${tab.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify, patchTab]
  );

  const saveTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((current) => current.id === id);
      if (!tab) {
        return;
      }
      if (!tab.fileRef.write || !tab.fileRef.writable) {
        notify("warning", "当前文件是只读来源，不能保存。");
        return;
      }
      if (tab.externalChanged) {
        const confirmed = window.confirm(`${tab.name} 在磁盘上已变化。保存会覆盖磁盘版本，是否继续？`);
        if (!confirmed) {
          return;
        }
      }
      try {
        const text = unparseCsvData(tab.data, tab.delimiter, tab.newline, tab.hasBom);
        const version = await tab.fileRef.write(text);
        patchTab(id, (current) => ({
          ...current,
          version,
          latestDiskVersion: undefined,
          dirty: false,
          externalChanged: false,
          status: "已保存"
        }));
        notify("success", `已保存 ${tab.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify, patchTab]
  );

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((current) => current.id === id);
      if (tab?.dirty) {
        const confirmed = window.confirm(`${tab.name} 有未保存修改，确认关闭？`);
        if (!confirmed) {
          return;
        }
      }
      setTabs((current) => current.filter((item) => item.id !== id));
      setActiveTabId((current) => {
        if (current !== id) {
          return current;
        }
        const remaining = tabsRef.current.filter((item) => item.id !== id);
        return remaining[remaining.length - 1]?.id ?? null;
      });
    },
    []
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (tabsRef.current.some((tab) => tab.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && activeTabId) {
        event.preventDefault();
        void saveTab(activeTabId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, saveTab]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (pollBusyRef.current) {
        return;
      }
      pollBusyRef.current = true;
      setPolling(true);
      try {
        const snapshot = tabsRef.current;
        for (const tab of snapshot) {
          if (!tab.fileRef.getVersion) {
            continue;
          }
          const diskVersion = await tab.fileRef.getVersion();
          if (!versionEquals(tab.version, diskVersion)) {
            const nextTab = await applyDiskVersionChange(tab, diskVersion);
            patchTab(tab.id, (current) => {
              if (current.dirty) {
                return {
                  ...current,
                  latestDiskVersion: diskVersion,
                  externalChanged: true,
                  status: "磁盘有新版本"
                };
              }
              if (!versionEquals(current.version, tab.version)) {
                return current;
              }
              return {
                ...nextTab,
                id: current.id,
                selection: current.selection,
                lockedCells: current.lockedCells,
                zoom: current.zoom,
                freezeRows: current.freezeRows,
                freezeCols: current.freezeCols,
                colWidths: current.colWidths
              };
            });
          }
        }
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      } finally {
        pollBusyRef.current = false;
        setPolling(false);
      }
    }, HOT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [notify, patchTab]);

  const updateActiveTab = useCallback(
    (updater: (tab: CsvTab) => CsvTab) => {
      if (!activeTabId) {
        return;
      }
      patchTab(activeTabId, updater);
    },
    [activeTabId, patchTab]
  );

  const selectedStats = activeTab
    ? `${activeTab.data.length} 行 / ${maxColumnCount(activeTab.data)} 列`
    : "未打开文件";

  return (
    <div className="app-frame">
      <DirectoryPane
        root={root}
        filter={treeFilter}
        directoryPickerAvailable={directoryPickerAvailable}
        onFilterChange={setTreeFilter}
        onPickDirectory={handlePickDirectory}
        onLoadSample={handleLoadSample}
        onToggleDirectory={handleToggleDirectory}
        onOpenFile={handleOpenTreeFile}
      />

      <main className="workspace">
        <header className="topbar">
          <TabStrip tabs={tabs} activeTabId={activeTabId} onActivate={setActiveTabId} onClose={closeTab} />
          <div className="topbar-actions">
            <button
              className="toolbar-button"
              disabled={!activeTab}
              onClick={() => activeTabId && void reloadTabFromDisk(activeTabId)}
              title="从磁盘重新读取当前 CSV"
            >
              <RefreshCw size={15} />
              刷新
            </button>
            <button
              className="toolbar-button save"
              disabled={!activeTab || !activeTab.dirty || !activeTab.fileRef.writable}
              onClick={() => activeTabId && void saveTab(activeTabId)}
              title="保存当前 CSV"
            >
              <Save size={15} />
              保存
            </button>
          </div>
        </header>

        <div className="workspace-status">
          <span>
            <Clock3 size={14} />
            热刷新 {polling ? "检查中" : "2s"}
          </span>
          <span>
            {dirtyCount > 0 ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}
            未保存 {dirtyCount}
          </span>
          <span>{selectedStats}</span>
          {notice ? <span className={`notice ${notice.tone}`}>{notice.message}</span> : null}
        </div>

        {activeTab?.externalChanged ? (
          <div className="conflict-banner">
            <AlertTriangle size={17} />
            <span>磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。</span>
            <button onClick={() => activeTabId && void reloadTabFromDisk(activeTabId, true)}>
              <RotateCcw size={15} />
              丢弃并刷新
            </button>
          </div>
        ) : null}

        {activeTab ? (
          <GridEditor
            tab={activeTab}
            onSelectionChange={(selection) => updateActiveTab((tab) => ({ ...tab, selection }))}
            onSetCell={(row, col, value) =>
              updateActiveTab((tab) => {
                if (tab.lockedCells.includes(cellKey(row, col))) {
                  return tab;
                }
                return {
                  ...tab,
                  data: writeCell(tab.data, row, col, value),
                  dirty: true,
                  status: "已修改"
                };
              })
            }
            onPaste={(startRow, startCol, values) =>
              updateActiveTab((tab) => {
                const locked = new Set(tab.lockedCells);
                let data = tab.data;
                values.forEach((line, rowOffset) => {
                  line.forEach((value, colOffset) => {
                    const row = startRow + rowOffset;
                    const col = startCol + colOffset;
                    if (!locked.has(cellKey(row, col))) {
                      data = writeCell(data, row, col, value);
                    }
                  });
                });
                return {
                  ...tab,
                  data,
                  dirty: true,
                  status: "已粘贴"
                };
              })
            }
            onClearRange={(startRow, startCol, endRow, endCol) =>
              updateActiveTab((tab) => {
                const range = normalizeSelection({ anchorRow: startRow, anchorCol: startCol, focusRow: endRow, focusCol: endCol });
                const locked = new Set(tab.lockedCells);
                let data = tab.data;
                for (let row = range.startRow; row <= range.endRow; row += 1) {
                  for (let col = range.startCol; col <= range.endCol; col += 1) {
                    if (!locked.has(cellKey(row, col))) {
                      data = writeCell(data, row, col, "");
                    }
                  }
                }
                return { ...tab, data, dirty: true, status: "已清空选区" };
              })
            }
            onToggleLock={(startRow, startCol, endRow, endCol, locked) =>
              updateActiveTab((tab) => {
                const next = new Set(tab.lockedCells);
                for (let row = startRow; row <= endRow; row += 1) {
                  for (let col = startCol; col <= endCol; col += 1) {
                    const key = cellKey(row, col);
                    if (locked) {
                      next.add(key);
                    } else {
                      next.delete(key);
                    }
                  }
                }
                return { ...tab, lockedCells: [...next], status: locked ? "已锁定选区" : "已解锁选区" };
              })
            }
            onSetZoom={(zoom) => updateActiveTab((tab) => ({ ...tab, zoom }))}
            onSetFreeze={(rows, cols) =>
              updateActiveTab((tab) => ({
                ...tab,
                freezeRows: Math.max(0, rows),
                freezeCols: Math.max(0, cols),
                status: rows || cols ? "已设置冻结" : "已取消冻结"
              }))
            }
            onSetColWidth={(col, width) =>
              updateActiveTab((tab) => ({ ...tab, colWidths: { ...tab.colWidths, [col]: width } }))
            }
            onAddRow={() =>
              updateActiveTab((tab) => ({
                ...tab,
                data: [...tab.data, Array.from({ length: Math.max(1, maxColumnCount(tab.data)) }, () => "")],
                dirty: true,
                status: "已新增行"
              }))
            }
            onAddColumn={() =>
              updateActiveTab((tab) => ({
                ...tab,
                data: tab.data.length ? tab.data.map((row) => [...row, ""]) : [[""]],
                dirty: true,
                status: "已新增列"
              }))
            }
          />
        ) : (
          <div className="empty-workspace">
            <FilePrompt />
          </div>
        )}
      </main>
    </div>
  );
}

function FilePrompt() {
  return (
    <div className="file-prompt">
      <RefreshCw size={34} />
      <h2>打开一个 CSV 开始编辑</h2>
      <p>左侧选择本地目录后，点击 CSV 文件即可加入上方页签。干净页签会自动热刷新，未保存页签会保留编辑并标记磁盘冲突。</p>
    </div>
  );
}
