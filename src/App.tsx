import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert
} from "lucide-react";
import { DirectoryPane } from "./components/DirectoryPane";
import { COMMIT_ACTIVE_EDIT_EVENT, GridEditor } from "./components/GridEditor";
import { TabStrip } from "./components/TabStrip";
import {
  maxColumnCount,
  parseCsvText,
  replaceAllCellText,
  replaceCellText,
  readCell,
  unparseCsvData,
  writeCell,
  type CsvSourceRow
} from "./lib/csv";
import { canPickDirectory, pickDirectory, versionEquals, type CsvFileRef } from "./lib/fileRefs";
import {
  deleteColumns,
  deleteRows,
  hasLockedCellInColumns,
  hasLockedCellInRows,
  insertColumns,
  insertRows,
  shiftLockedCellsForDeletedColumns,
  shiftLockedCellsForDeletedRows,
  shiftLockedCellsForInsertedColumns,
  shiftLockedCellsForInsertedRows
} from "./lib/gridOps";
import { clearHistory, pushUndo, redoTab, undoTab } from "./lib/history";
import { applyDiskVersionChange, createTabFromFileRef, getSaveConflictVersion, reloadTabFromFileRef } from "./lib/tabModel";
import { encodeTextBuffer } from "./lib/textDecode";
import {
  createLocalRoot,
  hasUnloadedLocalDirectory,
  loadLocalChildren,
  loadLocalDescendants,
  loadSampleTree,
  mergeLoadedNodeState,
  updateNode
} from "./lib/tree";
import type { CsvCellStyle, CsvCellStyleMap, CsvTab, FindResultCell, GridScrollPosition, TreeNode } from "./types";
import { cellKey, normalizeSelection, singleCellSelection } from "./types";

const HOT_REFRESH_INTERVAL_MS = 5000;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_DEFAULT_WIDTH = 310;
const SIDEBAR_KEYBOARD_STEP = 20;
const SIDEBAR_KEYBOARD_LARGE_STEP = 60;
const DEFAULT_GRID_SCROLL_POSITION: GridScrollPosition = { scrollTop: 0, scrollLeft: 0 };

type Notice = {
  tone: "info" | "success" | "warning" | "error";
  message: string;
} | null;

type NoticeTone = NonNullable<Notice>["tone"];
type SaveResult = "saved" | "skipped" | "blocked";
type SaveOptions = {
  quiet?: boolean;
};

export function App() {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [tabs, setTabs] = useState<CsvTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [activeEditDraftDirty, setActiveEditDraftDirty] = useState(false);
  const tabsRef = useRef(tabs);
  const activeEditDraftDirtyRef = useRef(activeEditDraftDirty);
  const activeTabIdRef = useRef(activeTabId);
  const tabScrollPositionsRef = useRef<Record<string, GridScrollPosition>>({});
  const pollBusyRef = useRef(false);
  const openingPathsRef = useRef(new Set<string>());
  const pendingActivatePathRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const directoryPickerAvailable = canPickDirectory();

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeEditDraftDirtyRef.current = activeEditDraftDirty;
  }, [activeEditDraftDirty]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs]);
  const activeScrollPosition = activeTabId
    ? tabScrollPositionsRef.current[activeTabId] ?? DEFAULT_GRID_SCROLL_POSITION
    : DEFAULT_GRID_SCROLL_POSITION;
  const visibleTabs = useMemo(
    () =>
      activeEditDraftDirty && activeTabId
        ? tabs.map((tab) => (tab.id === activeTabId ? { ...tab, dirty: true } : tab))
        : tabs,
    [activeEditDraftDirty, activeTabId, tabs]
  );
  const dirtyCount = tabs.filter((tab) => tab.dirty).length + (activeEditDraftDirty && activeTab && !activeTab.dirty ? 1 : 0);

  useEffect(() => {
    setActiveEditDraftDirty(false);
  }, [activeTabId]);

  const notify = useCallback((tone: NoticeTone, message: string) => {
    setNotice({ tone, message });
    window.setTimeout(() => {
      setNotice((current) => (current?.message === message ? null : current));
    }, 4200);
  }, []);

  const runAfterActiveEditCommit = useCallback((action: () => void) => {
    window.dispatchEvent(new Event(COMMIT_ACTIVE_EDIT_EVENT));
    window.setTimeout(action, 0);
  }, []);

  const rememberTabScrollPosition = useCallback((tabId: string, position: GridScrollPosition) => {
    tabScrollPositionsRef.current[tabId] = position;
  }, []);

  const patchTab = useCallback((id: string, updater: (tab: CsvTab) => CsvTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? updater(tab) : tab)));
  }, []);

  const openFileRef = useCallback(
    async (fileRef: CsvFileRef) => {
      pendingActivatePathRef.current = fileRef.path;
      const existing = tabsRef.current.find((tab) => tab.path === fileRef.path);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      if (openingPathsRef.current.has(fileRef.path)) {
        window.setTimeout(() => {
          const opened = tabsRef.current.find((tab) => tab.path === fileRef.path);
          if (opened && pendingActivatePathRef.current === fileRef.path) {
            setActiveTabId(opened.id);
          }
        }, 0);
        return;
      }

      try {
        openingPathsRef.current.add(fileRef.path);
        const id = createTabId();
        const tab = await createTabFromFileRef(fileRef, id);
        setTabs((current) => [...current, tab]);
        if (pendingActivatePathRef.current === fileRef.path) {
          setActiveTabId(id);
        }
        notify("success", `已打开 ${fileRef.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      } finally {
        window.setTimeout(() => openingPathsRef.current.delete(fileRef.path), 0);
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

  useEffect(() => {
    const query = treeFilter.trim();
    if (!query || !root || !hasUnloadedLocalDirectory(root)) {
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      try {
        const loadedRoot = await loadLocalDescendants(root);
        if (!cancelled) {
          setRoot((current) => (current === root ? mergeLoadedNodeState(current, loadedRoot) : current));
        }
      } catch (error) {
        if (!cancelled) {
          notify("error", error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notify, root, treeFilter]);

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
        const { fileRef } = node;
        runAfterActiveEditCommit(() => void openFileRef(fileRef));
      }
    },
    [openFileRef, runAfterActiveEditCommit]
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
        patchTab(id, (current) => ({
          ...reloaded,
          id: current.id,
          selection: clampSelectionToData(current.selection, reloaded.data),
          lockedCells: current.lockedCells,
          zoom: current.zoom,
          freezeRows: current.freezeRows,
          freezeCols: current.freezeCols,
          colWidths: current.colWidths,
          cellStyles: current.cellStyles,
          autoRefresh: current.autoRefresh,
          findQuery: current.findQuery,
          replaceValue: current.replaceValue
        }));
        notify("success", `已刷新 ${tab.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify, patchTab]
  );

  const saveTab = useCallback(
    async (id: string, options: SaveOptions = {}): Promise<SaveResult> => {
      const tab = tabsRef.current.find((current) => current.id === id);
      if (!tab) {
        return "skipped";
      }
      if (!tab.fileRef.write || !tab.fileRef.writable) {
        if (!options.quiet) {
          notify("warning", "当前文件是只读来源，不能保存。");
        }
        return "skipped";
      }
      try {
        const conflictVersion = await getSaveConflictVersion(tab);
        if (conflictVersion) {
          patchTab(id, (current) => ({
            ...current,
            latestDiskVersion: conflictVersion,
            externalChanged: true,
            status: "保存前发现磁盘新版本"
          }));
          const confirmed = window.confirm(`${tab.name} 在磁盘上已变化。保存会覆盖磁盘版本，是否继续？`);
          if (!confirmed) {
            return "blocked";
          }
        }
        const text = unparseCsvData(
          tab.data,
          tab.delimiter,
          tab.newline,
          tab.hasBom,
          tab.sourceRows,
          tab.trailingNewline
        );
        const version = await tab.fileRef.write(encodeTextBuffer(text, tab.encoding));
        const saved = parseCsvText(text);
        patchTab(id, (current) =>
          clearHistory({
            ...current,
            version,
            encoding: tab.encoding,
            sourceRows: saved.sourceRows,
            trailingNewline: saved.trailingNewline,
            latestDiskVersion: undefined,
            dirty: false,
            externalChanged: false,
            status: "已保存"
          })
        );
        if (!options.quiet) {
          notify("success", `已保存 ${tab.name}`);
        }
        return "saved";
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
        return "blocked";
      }
    },
    [notify, patchTab]
  );

  const saveAllDirtyTabs = useCallback(async () => {
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty);
    if (dirtyTabs.length === 0) {
      notify("info", "没有需要保存的 CSV。");
      return;
    }

    let saved = 0;
    let skipped = 0;
    let blocked = 0;
    for (const tab of dirtyTabs) {
      const result = await saveTab(tab.id, { quiet: true });
      if (result === "saved") {
        saved += 1;
      } else if (result === "skipped") {
        skipped += 1;
      } else {
        blocked += 1;
      }
    }

    const parts = [`已保存 ${saved} 个`];
    if (skipped > 0) {
      parts.push(`跳过只读 ${skipped} 个`);
    }
    if (blocked > 0) {
      parts.push(`未完成 ${blocked} 个`);
    }
    notify(blocked > 0 || skipped > 0 ? "warning" : "success", parts.join("，"));
  }, [notify, saveTab]);

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((current) => current.id === id);
      if (tab?.dirty) {
        const confirmed = window.confirm(`${tab.name} 有未保存修改，确认关闭？`);
        if (!confirmed) {
          return;
        }
      }
      delete tabScrollPositionsRef.current[id];
      const remaining = tabsRef.current.filter((item) => item.id !== id);
      tabsRef.current = remaining;
      setTabs(remaining);
      setActiveTabId((current) => {
        if (current !== id) {
          return current;
        }
        return remaining[remaining.length - 1]?.id ?? null;
      });
    },
    []
  );

  const activateTabAfterEditCommit = useCallback(
    (id: string) => runAfterActiveEditCommit(() => setActiveTabId(id)),
    [runAfterActiveEditCommit]
  );

  const closeTabAfterEditCommit = useCallback(
    (id: string) => runAfterActiveEditCommit(() => closeTab(id)),
    [closeTab, runAfterActiveEditCommit]
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (tabsRef.current.some((tab) => tab.dirty) || activeEditDraftDirtyRef.current) {
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
        runAfterActiveEditCommit(() => void saveTab(activeTabId));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, runAfterActiveEditCommit, saveTab]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (pollBusyRef.current) {
        return;
      }
      pollBusyRef.current = true;
      try {
        const snapshot = tabsRef.current;
        for (const tab of snapshot) {
          if (!tab.fileRef.getVersion) {
            continue;
          }
          const diskVersion = await tab.fileRef.getVersion();
          if (!versionEquals(tab.version, diskVersion)) {
            const activeDraftDirtyForSnapshot = activeEditDraftDirtyRef.current && activeTabIdRef.current === tab.id;
            const shouldApplyDiskVersion = tab.autoRefresh && !tab.dirty && !activeDraftDirtyForSnapshot;
            const nextTab = shouldApplyDiskVersion ? await applyDiskVersionChange(tab, diskVersion) : null;
            patchTab(tab.id, (current) => {
              const activeDraftDirtyForCurrent = activeEditDraftDirtyRef.current && activeTabIdRef.current === current.id;
              if (current.dirty || activeDraftDirtyForCurrent || !current.autoRefresh) {
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
              if (!nextTab) {
                return current;
              }
              return {
                ...nextTab,
                id: current.id,
                selection: clampSelectionToData(current.selection, nextTab.data),
                lockedCells: current.lockedCells,
                zoom: current.zoom,
                freezeRows: current.freezeRows,
                freezeCols: current.freezeCols,
                colWidths: current.colWidths,
                cellStyles: current.cellStyles,
                autoRefresh: current.autoRefresh,
                findQuery: current.findQuery,
                replaceValue: current.replaceValue
              };
            });
          }
        }
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      } finally {
        pollBusyRef.current = false;
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
    ? `${activeTab.data.length} 行 / ${maxColumnCount(activeTab.data)} 列 / ${activeTab.encoding.toUpperCase()}`
    : "未打开文件";

  const moveSidebarResize = useCallback((event: PointerEvent) => {
    const start = sidebarResizeRef.current;
    if (!start) {
      return;
    }
    setSidebarWidth(clamp(start.startWidth + event.clientX - start.startX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
  }, []);

  const stopSidebarResize = useCallback(() => {
    sidebarResizeRef.current = null;
    setSidebarResizing(false);
    window.removeEventListener("pointermove", moveSidebarResize);
    window.removeEventListener("pointerup", stopSidebarResize);
    window.removeEventListener("blur", stopSidebarResize);
  }, [moveSidebarResize]);

  const beginSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      sidebarResizeRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidth
      };
      setSidebarResizing(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", moveSidebarResize);
      window.addEventListener("pointerup", stopSidebarResize, { once: true });
      window.addEventListener("blur", stopSidebarResize, { once: true });
    },
    [moveSidebarResize, sidebarWidth, stopSidebarResize]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", moveSidebarResize);
      window.removeEventListener("pointerup", stopSidebarResize);
      window.removeEventListener("blur", stopSidebarResize);
    };
  }, [moveSidebarResize, stopSidebarResize]);

  const handleSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? SIDEBAR_KEYBOARD_LARGE_STEP : SIDEBAR_KEYBOARD_STEP;
      let nextWidth = sidebarWidth;
      if (event.key === "ArrowLeft") {
        nextWidth -= step;
      } else if (event.key === "ArrowRight") {
        nextWidth += step;
      } else if (event.key === "Home") {
        nextWidth = SIDEBAR_MIN_WIDTH;
      } else if (event.key === "End") {
        nextWidth = SIDEBAR_MAX_WIDTH;
      } else {
        return;
      }

      event.preventDefault();
      setSidebarWidth(clamp(nextWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
    },
    [sidebarWidth]
  );

  return (
    <div
      className={`app-frame ${sidebarResizing ? "resizing-sidebar" : ""}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}
    >
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

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        title="拖拽调整左侧宽度，双击还原"
        onPointerDown={beginSidebarResize}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={handleSidebarResizeKeyDown}
      />

      <main className="workspace">
        <header className="topbar">
          <TabStrip
            tabs={visibleTabs}
            activeTabId={activeTabId}
            onActivate={activateTabAfterEditCommit}
            onClose={closeTabAfterEditCommit}
          />
          <div className="topbar-actions">
            <button
              className="toolbar-button"
              disabled={!activeTab}
              onClick={() => activeTabId && runAfterActiveEditCommit(() => void reloadTabFromDisk(activeTabId))}
              title="从磁盘重新读取当前 CSV"
            >
              <RefreshCw size={15} />
              刷新
            </button>
            <button
              className="toolbar-button save"
              disabled={!activeTab || (!activeTab.dirty && !activeEditDraftDirty) || !activeTab.fileRef.writable}
              onClick={() => activeTabId && runAfterActiveEditCommit(() => void saveTab(activeTabId))}
              title="保存当前 CSV"
            >
              <Save size={15} />
              保存
            </button>
            <button
              className="toolbar-button"
              disabled={dirtyCount === 0}
              onClick={() => runAfterActiveEditCommit(() => void saveAllDirtyTabs())}
              title="保存所有未保存且可写的 CSV"
            >
              <Save size={15} />
              全部保存
            </button>
          </div>
        </header>

        <div className="workspace-status">
          <span>
            {dirtyCount > 0 ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}
            未保存 {dirtyCount}
          </span>
          <span>{selectedStats}</span>
          {notice ? <span className={`notice ${notice.tone}`}>{notice.message}</span> : null}
        </div>

        <div className={`conflict-banner ${activeTab?.externalChanged ? "" : "empty"}`} aria-hidden={!activeTab?.externalChanged}>
          {activeTab?.externalChanged ? (
            <>
            <AlertTriangle size={17} />
            <span>磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。</span>
            <button onClick={() => activeTabId && void reloadTabFromDisk(activeTabId, true)}>
              <RotateCcw size={15} />
              丢弃并刷新
            </button>
            </>
          ) : null}
        </div>

        {activeTab ? (
          <GridEditor
            tab={activeTab}
            scrollPosition={activeScrollPosition}
            onScrollPositionChange={rememberTabScrollPosition}
            onSelectionChange={(selection) => updateActiveTab((tab) => ({ ...tab, selection }))}
            onSetCell={(row, col, value) =>
              updateActiveTab((tab) => {
                if (tab.lockedCells.includes(cellKey(row, col))) {
                  return tab;
                }
                if (readCell(tab.data, row, col) === value) {
                  return tab;
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data: writeCell(base.data, row, col, value),
                  dirty: true,
                  status: "已修改"
                };
              })
            }
            onPaste={(startRow, startCol, values) =>
              updateActiveTab((tab) => {
                const locked = new Set(tab.lockedCells);
                let data = tab.data;
                let changed = false;
                let skippedLocked = 0;
                values.forEach((line, rowOffset) => {
                  line.forEach((value, colOffset) => {
                    const row = startRow + rowOffset;
                    const col = startCol + colOffset;
                    if (locked.has(cellKey(row, col))) {
                      skippedLocked += 1;
                    } else if (readCell(data, row, col) !== value) {
                      data = writeCell(data, row, col, value);
                      changed = true;
                    }
                  });
                });
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 个` : "";
                if (!changed) {
                  return { ...tab, status: `粘贴内容没有改变${lockStatus}` };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data,
                  dirty: true,
                  status: `已粘贴${lockStatus}`
                };
              })
            }
            onClearRange={(startRow, startCol, endRow, endCol) =>
              updateActiveTab((tab) => {
                const range = normalizeSelection({ anchorRow: startRow, anchorCol: startCol, focusRow: endRow, focusCol: endCol });
                const locked = new Set(tab.lockedCells);
                let data = tab.data;
                let changed = false;
                let skippedLocked = 0;
                for (let row = range.startRow; row <= range.endRow; row += 1) {
                  if (row >= tab.data.length) {
                    continue;
                  }
                  const rowWidth = tab.data[row]?.length ?? 0;
                  for (let col = range.startCol; col <= range.endCol; col += 1) {
                    if (col >= rowWidth) {
                      continue;
                    }
                    if (locked.has(cellKey(row, col))) {
                      skippedLocked += 1;
                    } else if (readCell(data, row, col) !== "") {
                      data = writeCell(data, row, col, "");
                      changed = true;
                    }
                  }
                }
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 个` : "";
                if (!changed) {
                  return { ...tab, status: `没有可清空的内容${lockStatus}` };
                }
                const base = pushUndo(tab);
                return { ...base, data, dirty: true, status: `已清空选区${lockStatus}` };
              })
            }
            onToggleLock={(startRow, startCol, endRow, endCol, locked) =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                const next = new Set(base.lockedCells);
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
                return { ...base, lockedCells: [...next], status: locked ? "已锁定选区" : "已解锁选区" };
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
            onSetAutoRefresh={(enabled) =>
              updateActiveTab((tab) => ({
                ...tab,
                autoRefresh: enabled,
                externalChanged: enabled && !tab.dirty ? false : tab.externalChanged,
                status: enabled ? "已开启自动热刷" : "已暂停自动热刷"
              }))
            }
            onSetFindQuery={(findQuery) => updateActiveTab((tab) => ({ ...tab, findQuery }))}
            onSetReplaceValue={(replaceValue) => updateActiveTab((tab) => ({ ...tab, replaceValue }))}
            onSetStatus={(status) => updateActiveTab((tab) => ({ ...tab, status }))}
            onEditDraftDirtyChange={setActiveEditDraftDirty}
            onReplaceCurrent={() =>
              updateActiveTab((tab) => {
                const query = tab.findQuery.trim();
                const { focusRow, focusCol } = tab.selection;
                if (!query || tab.lockedCells.includes(cellKey(focusRow, focusCol))) {
                  return tab;
                }
                if (!readCell(tab.data, focusRow, focusCol).toLowerCase().includes(query.toLowerCase())) {
                  return { ...tab, status: "当前格没有匹配内容" };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data: replaceCellText(base.data, focusRow, focusCol, query, base.replaceValue),
                  dirty: true,
                  status: "已替换当前匹配"
                };
              })
            }
            onReplaceAll={() =>
              updateActiveTab((tab) => {
                const result = replaceAllCellText(
                  tab.data,
                  tab.findQuery,
                  tab.replaceValue,
                  new Set(tab.lockedCells)
                );
                if (result.count === 0) {
                  return { ...tab, status: "没有可替换的匹配内容" };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data: result.data,
                  dirty: true,
                  status: `已替换 ${result.count} 处`
                };
              })
            }
            onReplaceFindResults={(results) =>
              updateActiveTab((tab) => {
                const query = tab.findQuery.trim();
                if (!query || results.length === 0) {
                  return tab;
                }
                const locked = new Set(tab.lockedCells);
                const seen = new Set<string>();
                let data = tab.data;
                let count = 0;
                let skippedLocked = 0;
                for (const result of results) {
                  const key = cellKey(result.row, result.col);
                  if (seen.has(key)) {
                    continue;
                  }
                  seen.add(key);
                  if (locked.has(key)) {
                    skippedLocked += 1;
                    continue;
                  }
                  const replacement = replaceAllMatchesInCell(data, result.row, result.col, query, tab.replaceValue);
                  data = replacement.data;
                  count += replacement.count;
                }
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 格` : "";
                if (count === 0) {
                  return { ...tab, status: `没有可替换的结果${lockStatus}` };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data,
                  dirty: true,
                  status: `已替换结果 ${count} 处${lockStatus}`
                };
              })
            }
            onApplyCellStyle={(startRow, startCol, endRow, endCol, stylePatch) =>
              updateActiveTab((tab) => {
                const range = normalizeSelection({ anchorRow: startRow, anchorCol: startCol, focusRow: endRow, focusCol: endCol });
                const result = applyCellStylePatchToRange(
                  tab.cellStyles,
                  range.startRow,
                  range.startCol,
                  range.endRow,
                  range.endCol,
                  stylePatch
                );
                if (result.changedCount === 0) {
                  return { ...tab, status: "颜色没有变化" };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  cellStyles: result.styles,
                  status: `已设置颜色 ${result.changedCount} 格`
                };
              })
            }
            canUndo={activeTab.undoStack.length > 0}
            canRedo={activeTab.redoStack.length > 0}
            onUndo={() => updateActiveTab(undoTab)}
            onRedo={() => updateActiveTab(redoTab)}
            onSaveRequest={() => activeTabId && void saveTab(activeTabId)}
            onInsertRows={(startRow, endRow) =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                const count = endRow - startRow + 1;
                return {
                  ...base,
                  data: insertRows(base.data, startRow, count),
                  sourceRows: insertSourceRows(base.sourceRows, startRow, count),
                  lockedCells: shiftLockedCellsForInsertedRows(base.lockedCells, startRow, count),
                  cellStyles: shiftCellStylesForInsertedRows(base.cellStyles, startRow, count),
                  selection: singleCellSelection(startRow, base.selection.focusCol),
                  dirty: true,
                  status: `已插入 ${count} 行`
                };
              })
            }
            onDeleteRows={(startRow, endRow) =>
              updateActiveTab((tab) => {
                if (startRow >= tab.data.length) {
                  return { ...tab, status: "选中行没有已有数据" };
                }
                const clampedEndRow = Math.min(endRow, tab.data.length - 1);
                if (hasLockedCellInRows(tab.lockedCells, startRow, clampedEndRow)) {
                  return { ...tab, status: "选中行包含锁定格，不能删除" };
                }
                const base = pushUndo(tab);
                const nextData = deleteRows(base.data, startRow, clampedEndRow);
                const nextRow = Math.min(startRow, Math.max(0, nextData.length - 1));
                return {
                  ...base,
                  data: nextData,
                  sourceRows: deleteSourceRows(base.sourceRows, startRow, clampedEndRow),
                  lockedCells: shiftLockedCellsForDeletedRows(base.lockedCells, startRow, clampedEndRow),
                  cellStyles: shiftCellStylesForDeletedRows(base.cellStyles, startRow, clampedEndRow),
                  selection: singleCellSelection(nextRow, base.selection.focusCol),
                  dirty: true,
                  status: `已删除 ${clampedEndRow - startRow + 1} 行`
                };
              })
            }
            onInsertColumns={(startCol, endCol) =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                const count = endCol - startCol + 1;
                const nextData = insertColumns(base.data, startCol, count);
                return {
                  ...base,
                  data: nextData,
                  sourceRows: insertSourceColumns(
                    base.sourceRows,
                    base.data,
                    startCol,
                    count,
                    base.delimiter,
                    nextData
                  ),
                  lockedCells: shiftLockedCellsForInsertedColumns(base.lockedCells, startCol, count),
                  cellStyles: shiftCellStylesForInsertedColumns(base.cellStyles, startCol, count),
                  selection: singleCellSelection(base.selection.focusRow, startCol),
                  dirty: true,
                  status: `已插入 ${count} 列`
                };
              })
            }
            onDeleteColumns={(startCol, endCol) =>
              updateActiveTab((tab) => {
                const width = maxColumnCount(tab.data);
                if (startCol >= width) {
                  return { ...tab, status: "选中列没有已有数据" };
                }
                const clampedEndCol = Math.min(endCol, width - 1);
                if (hasLockedCellInColumns(tab.lockedCells, startCol, clampedEndCol)) {
                  return { ...tab, status: "选中列包含锁定格，不能删除" };
                }
                const base = pushUndo(tab);
                const nextData = deleteColumns(base.data, startCol, clampedEndCol);
                const nextCol = Math.min(startCol, Math.max(0, maxColumnCount(nextData) - 1));
                return {
                  ...base,
                  data: nextData,
                  sourceRows: deleteSourceColumns(
                    base.sourceRows,
                    base.data,
                    startCol,
                    clampedEndCol,
                    base.delimiter,
                    nextData
                  ),
                  lockedCells: shiftLockedCellsForDeletedColumns(base.lockedCells, startCol, clampedEndCol),
                  cellStyles: shiftCellStylesForDeletedColumns(base.cellStyles, startCol, clampedEndCol),
                  selection: singleCellSelection(base.selection.focusRow, nextCol),
                  dirty: true,
                  status: `已删除 ${clampedEndCol - startCol + 1} 列`
                };
              })
            }
            onAddRow={() =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                return {
                  ...base,
                  data: [...base.data, Array.from({ length: Math.max(1, maxColumnCount(base.data)) }, () => "")],
                  sourceRows: [...base.sourceRows, undefined],
                  dirty: true,
                  status: "已新增行"
                };
              })
            }
            onAddColumn={() =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                const width = maxColumnCount(base.data);
                const nextData = base.data.length
                  ? base.data.map((row) => {
                      const normalized = [...row];
                      while (normalized.length < width) {
                        normalized.push("");
                      }
                      return [...normalized, ""];
                    })
                  : [[""]];
                return {
                  ...base,
                  data: nextData,
                  sourceRows: insertSourceColumns(
                    base.sourceRows,
                    base.data,
                    width,
                    1,
                    base.delimiter,
                    nextData
                  ),
                  dirty: true,
                  status: "已新增列"
                };
              })
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

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampSelectionToData(selection: CsvTab["selection"], data: CsvTab["data"]): CsvTab["selection"] {
  const maxRow = Math.max(0, data.length - 1);
  const maxCol = Math.max(0, maxColumnCount(data) - 1);
  return {
    anchorRow: clamp(selection.anchorRow, 0, maxRow),
    anchorCol: clamp(selection.anchorCol, 0, maxCol),
    focusRow: clamp(selection.focusRow, 0, maxRow),
    focusCol: clamp(selection.focusCol, 0, maxCol)
  };
}

function insertSourceRows(sourceRows: CsvTab["sourceRows"], atRow: number, count: number): CsvTab["sourceRows"] {
  const rowCount = Math.max(1, count);
  const target = clamp(atRow, 0, sourceRows.length);
  const inserted: CsvTab["sourceRows"] = Array.from({ length: rowCount }, () => undefined);
  return [...sourceRows.slice(0, target), ...inserted, ...sourceRows.slice(target)];
}

function deleteSourceRows(sourceRows: CsvTab["sourceRows"], startRow: number, endRow: number): CsvTab["sourceRows"] {
  if (sourceRows.length === 0) {
    return [];
  }
  const normalizedStart = Math.min(startRow, endRow);
  const normalizedEnd = Math.max(startRow, endRow);
  if (normalizedEnd < 0 || normalizedStart >= sourceRows.length) {
    return [...sourceRows];
  }
  const start = clamp(normalizedStart, 0, sourceRows.length - 1);
  const end = clamp(normalizedEnd, 0, sourceRows.length - 1);
  return [...sourceRows.slice(0, start), ...sourceRows.slice(end + 1)];
}

function insertSourceColumns(
  sourceRows: CsvTab["sourceRows"],
  currentData: CsvTab["data"],
  atCol: number,
  count: number,
  delimiter: string,
  nextData: CsvTab["data"]
): CsvTab["sourceRows"] {
  const columnCount = Math.max(1, count);
  const target = Math.max(0, atCol);
  return nextData.map((row, index) => {
    const sourceRow = sourceRows[index];
    const currentRow = currentData[index] ?? [];
    if (!canTransformSourceColumns(sourceRow, currentRow)) {
      return undefined;
    }
    const fields = [...sourceRow.fields!];
    const data = [...sourceRow.data];
    while (fields.length < target) {
      fields.push("");
      data.push("");
    }
    const nextFields = [
      ...fields.slice(0, target),
      ...Array.from({ length: columnCount }, () => ""),
      ...fields.slice(target)
    ];
    const nextSourceData = [
      ...data.slice(0, target),
      ...Array.from({ length: columnCount }, () => ""),
      ...data.slice(target)
    ];
    if (!rowsEqual(row, nextSourceData)) {
      return undefined;
    }
    return makeSourceRowFromFields(nextSourceData, nextFields, delimiter);
  });
}

function deleteSourceColumns(
  sourceRows: CsvTab["sourceRows"],
  currentData: CsvTab["data"],
  startCol: number,
  endCol: number,
  delimiter: string,
  nextData: CsvTab["data"]
): CsvTab["sourceRows"] {
  const width = maxColumnCount(currentData);
  if (width === 0) {
    return nextData.map(() => undefined);
  }
  const start = clamp(Math.min(startCol, endCol), 0, width - 1);
  const end = clamp(Math.max(startCol, endCol), 0, width - 1);
  return nextData.map((row, index) => {
    const sourceRow = sourceRows[index];
    const currentRow = currentData[index] ?? [];
    if (!canTransformSourceColumns(sourceRow, currentRow)) {
      return undefined;
    }
    const nextFields = [...sourceRow.fields!.slice(0, start), ...sourceRow.fields!.slice(end + 1)];
    const nextSourceData = [...sourceRow.data.slice(0, start), ...sourceRow.data.slice(end + 1)];
    const normalizedFields = nextFields.length > 0 ? nextFields : [""];
    const normalizedData = nextSourceData.length > 0 ? nextSourceData : [""];
    if (!rowsEqual(row, normalizedData)) {
      return undefined;
    }
    return makeSourceRowFromFields(normalizedData, normalizedFields, delimiter);
  });
}

function canTransformSourceColumns(
  sourceRow: CsvSourceRow | undefined,
  currentRow: string[]
): sourceRow is CsvSourceRow & { fields: string[] } {
  return Boolean(
    sourceRow?.fields &&
      sourceRow.fields.length === sourceRow.data.length &&
      rowsEqual(currentRow, sourceRow.data)
  );
}

function makeSourceRowFromFields(data: string[], fields: string[], delimiter: string): CsvSourceRow {
  const separator = delimiter || ",";
  return {
    raw: fields.join(separator),
    data: [...data],
    fields: [...fields]
  };
}

function replaceAllMatchesInCell(
  data: CsvTab["data"],
  row: number,
  col: number,
  query: string,
  replacement: string
): { data: CsvTab["data"]; count: number } {
  const current = readCell(data, row, col);
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { data, count: 0 };
  }
  const lowerCurrent = current.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  if (!lowerCurrent.includes(lowerQuery)) {
    return { data, count: 0 };
  }

  let count = 0;
  let cursor = 0;
  let nextValue = "";
  let matchIndex = lowerCurrent.indexOf(lowerQuery, cursor);
  while (matchIndex >= 0) {
    nextValue += `${current.slice(cursor, matchIndex)}${replacement}`;
    cursor = matchIndex + normalizedQuery.length;
    count += 1;
    matchIndex = lowerCurrent.indexOf(lowerQuery, cursor);
  }
  nextValue += current.slice(cursor);
  return { data: writeCell(data, row, col, nextValue), count };
}

function applyCellStylePatchToRange(
  styles: CsvCellStyleMap,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  stylePatch: Partial<CsvCellStyle>
): { styles: CsvCellStyleMap; changedCount: number } {
  const next: CsvCellStyleMap = { ...styles };
  const hasTextColor = Object.prototype.hasOwnProperty.call(stylePatch, "textColor");
  const hasBackgroundColor = Object.prototype.hasOwnProperty.call(stylePatch, "backgroundColor");
  let changedCount = 0;

  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      const key = cellKey(row, col);
      const current = next[key] ?? {};
      const updated: CsvCellStyle = { ...current };
      if (hasTextColor) {
        if (stylePatch.textColor) {
          updated.textColor = stylePatch.textColor;
        } else {
          delete updated.textColor;
        }
      }
      if (hasBackgroundColor) {
        if (stylePatch.backgroundColor) {
          updated.backgroundColor = stylePatch.backgroundColor;
        } else {
          delete updated.backgroundColor;
        }
      }
      if (cellStylesEqual(current, updated)) {
        continue;
      }
      changedCount += 1;
      if (hasCellStyle(updated)) {
        next[key] = updated;
      } else {
        delete next[key];
      }
    }
  }

  return { styles: next, changedCount };
}

function shiftCellStylesForInsertedRows(styles: CsvCellStyleMap, startRow: number, count: number): CsvCellStyleMap {
  return mapCellStyles(styles, (row, col) => ({ row: row >= startRow ? row + count : row, col }));
}

function shiftCellStylesForDeletedRows(styles: CsvCellStyleMap, startRow: number, endRow: number): CsvCellStyleMap {
  const deletedCount = endRow - startRow + 1;
  return mapCellStyles(styles, (row, col) => {
    if (row >= startRow && row <= endRow) {
      return null;
    }
    return { row: row > endRow ? row - deletedCount : row, col };
  });
}

function shiftCellStylesForInsertedColumns(styles: CsvCellStyleMap, startCol: number, count: number): CsvCellStyleMap {
  return mapCellStyles(styles, (row, col) => ({ row, col: col >= startCol ? col + count : col }));
}

function shiftCellStylesForDeletedColumns(styles: CsvCellStyleMap, startCol: number, endCol: number): CsvCellStyleMap {
  const deletedCount = endCol - startCol + 1;
  return mapCellStyles(styles, (row, col) => {
    if (col >= startCol && col <= endCol) {
      return null;
    }
    return { row, col: col > endCol ? col - deletedCount : col };
  });
}

function mapCellStyles(
  styles: CsvCellStyleMap,
  mapper: (row: number, col: number) => FindResultCell | null
): CsvCellStyleMap {
  const next: CsvCellStyleMap = {};
  Object.entries(styles).forEach(([key, style]) => {
    const parsed = parseCellKey(key);
    if (!parsed) {
      next[key] = { ...style };
      return;
    }
    const mapped = mapper(parsed.row, parsed.col);
    if (mapped) {
      next[cellKey(mapped.row, mapped.col)] = { ...style };
    }
  });
  return next;
}

function parseCellKey(key: string): FindResultCell | null {
  const [rowText, colText] = key.split(":");
  const row = Number(rowText);
  const col = Number(colText);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    return null;
  }
  return { row, col };
}

function cellStylesEqual(left: CsvCellStyle, right: CsvCellStyle): boolean {
  return (left.textColor ?? "") === (right.textColor ?? "") && (left.backgroundColor ?? "") === (right.backgroundColor ?? "");
}

function hasCellStyle(style: CsvCellStyle): boolean {
  return Boolean(style.textColor || style.backgroundColor);
}

function rowsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
