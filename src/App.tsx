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
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  RotateCcw,
  Star,
  X
} from "lucide-react";
import { DirectoryPane } from "./components/DirectoryPane";
import { COMMIT_ACTIVE_EDIT_EVENT, GridEditor } from "./components/GridEditor";
import { TabStrip } from "./components/TabStrip";
import { TabSwitcherOverlay } from "./components/TabSwitcherOverlay";
import {
  maxColumnCount,
  parseCsvText,
  replaceCellText,
  readCell,
  unparseCsvData,
  writeCell,
  type CsvSourceRow
} from "./lib/csv";
import {
  canOpenSvnCommit,
  canOpenSvnUpdate,
  canControlDesktopWindow,
  closeDesktopWindow,
  getDesktopWindowState,
  loadWorkspaceState,
  loadFavoriteFiles,
  makeDesktopFileRef,
  canPickDirectory,
  isDesktopDirectoryHandle,
  minimizeDesktopWindow,
  openSvnCommit,
  openSvnUpdate,
  pickDirectory,
  saveFavoriteFiles,
  saveWorkspaceState,
  subscribeDesktopWindowState,
  toggleMaximizeDesktopWindow,
  versionEquals,
  type DesktopWindowState,
  type DirectoryHandle,
  type CsvFileRef
} from "./lib/fileRefs";
import {
  deleteColumns,
  deleteRows,
  deleteRowsByIndexes,
  hasLockedCellInColumns,
  hasLockedCellInRowIndexes,
  hasLockedCellInRows,
  insertColumns,
  insertRows,
  shiftLockedCellsForDeletedColumns,
  shiftLockedCellsForDeletedRowIndexes,
  shiftLockedCellsForDeletedRows,
  shiftLockedCellsForInsertedColumns,
  shiftLockedCellsForInsertedRows
} from "./lib/gridOps";
import { clearHistory, pushUndo, redoTab, undoTab } from "./lib/history";
import { applyDiskVersionChange, createTabFromFileRef, getSaveConflictVersion, reloadTabFromFileRef } from "./lib/tabModel";
import {
  advanceTabSwitcherSession,
  startTabSwitcherSession,
  updateRecentTabIds,
  type TabSwitchDirection,
  type TabSwitcherModifierKey,
  type TabSwitcherSession
} from "./lib/tabSwitcher";
import { encodeTextBuffer } from "./lib/textDecode";
import {
  createLocalRoot,
  hasUnloadedLocalDirectory,
  loadLocalChildren,
  loadLocalDescendants,
  mergeLoadedNodeState,
  reloadLoadedLocalTree,
  updateNode
} from "./lib/tree";
import type {
  CsvCellStyle,
  CsvCellStyleMap,
  CsvCellUpdate,
  CsvColumnFilters,
  CsvFavoriteFile,
  CsvFindSnapshot,
  CsvWorkspaceFile,
  CsvWorkspaceState,
  CsvTab,
  FindResultCell,
  GridScrollPosition,
  TreeNode
} from "./types";
import { cellKey, normalizeSelection, singleCellSelection } from "./types";

const HOT_REFRESH_INTERVAL_MS = 5000;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_DEFAULT_WIDTH = 310;
const SIDEBAR_KEYBOARD_STEP = 20;
const SIDEBAR_KEYBOARD_LARGE_STEP = 60;
const DEFAULT_GRID_SCROLL_POSITION: GridScrollPosition = { scrollTop: 0, scrollLeft: 0 };
const DEFAULT_DESKTOP_WINDOW_STATE: DesktopWindowState = { maximized: false, fullscreen: false };

type Notice = {
  tone: "info" | "success" | "warning" | "error";
  message: string;
} | null;

type NoticeTone = NonNullable<Notice>["tone"];
type SaveResult = "saved" | "skipped" | "blocked";
type SaveOptions = {
  quiet?: boolean;
};
type OpenFileOptions = {
  activate?: boolean;
  quiet?: boolean;
};

export function App() {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [favoriteFiles, setFavoriteFiles] = useState<CsvFavoriteFile[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [tabs, setTabs] = useState<CsvTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [activeEditDraftDirty, setActiveEditDraftDirty] = useState(false);
  const [desktopWindowState, setDesktopWindowState] = useState<DesktopWindowState>(DEFAULT_DESKTOP_WINDOW_STATE);
  const [tabSwitcher, setTabSwitcher] = useState<TabSwitcherSession | null>(null);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const rootRef = useRef(root);
  const tabsRef = useRef(tabs);
  const activeEditDraftDirtyRef = useRef(activeEditDraftDirty);
  const activeTabIdRef = useRef(activeTabId);
  const recentTabIdsRef = useRef<string[]>([]);
  const tabSwitcherRef = useRef<TabSwitcherSession | null>(null);
  const restoringWorkspaceRef = useRef(false);
  const workspacePersistSnapshotRef = useRef("");
  const tabScrollPositionsRef = useRef<Record<string, GridScrollPosition>>({});
  const pollBusyRef = useRef(false);
  const openingPathsRef = useRef(new Set<string>());
  const pendingActivatePathRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const directoryPickerAvailable = canPickDirectory();
  const svnCommitAvailable = Boolean(root?.directoryHandle && isDesktopDirectoryHandle(root.directoryHandle) && canOpenSvnCommit());
  const svnUpdateAvailable = Boolean(root?.directoryHandle && isDesktopDirectoryHandle(root.directoryHandle) && canOpenSvnUpdate());
  const desktopWindowControlsAvailable = canControlDesktopWindow();

  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  useEffect(() => {
    tabsRef.current = tabs;
    recentTabIdsRef.current = updateRecentTabIds(recentTabIdsRef.current, tabs, activeTabId);
  }, [activeTabId, tabs]);

  useEffect(() => {
    activeEditDraftDirtyRef.current = activeEditDraftDirty;
  }, [activeEditDraftDirty]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs]);
  const activeFavorite = useMemo(
    () => Boolean(activeTab && favoriteFiles.some((favorite) => favorite.path === activeTab.path)),
    [activeTab, favoriteFiles]
  );
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
  const tabSwitcherTabs = useMemo(() => {
    if (!tabSwitcher) {
      return [];
    }
    const tabsById = new Map(visibleTabs.map((tab) => [tab.id, tab]));
    return tabSwitcher.order.flatMap((id) => {
      const tab = tabsById.get(id);
      return tab ? [tab] : [];
    });
  }, [tabSwitcher, visibleTabs]);

  useEffect(() => {
    setActiveEditDraftDirty(false);
  }, [activeTabId]);

  useEffect(() => {
    if (!desktopWindowControlsAvailable) {
      return undefined;
    }
    let cancelled = false;
    void getDesktopWindowState().then((state) => {
      if (!cancelled) {
        setDesktopWindowState(state);
      }
    });
    const unsubscribe = subscribeDesktopWindowState((state) => {
      setDesktopWindowState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktopWindowControlsAvailable]);

  const notify = useCallback((tone: NoticeTone, message: string) => {
    setNotice({ tone, message });
    window.setTimeout(() => {
      setNotice((current) => (current?.message === message ? null : current));
    }, 4200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadFavoriteFiles()
      .then((favorites) => {
        if (!cancelled) {
          setFavoriteFiles(favorites);
          setFavoritesLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFavoritesLoaded(true);
          notify("error", error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    if (!favoritesLoaded) {
      return;
    }
    void saveFavoriteFiles(favoriteFiles)
      .then((savedFavorites) => {
        if (!favoritesEqual(favoriteFiles, savedFavorites)) {
          setFavoriteFiles(savedFavorites);
        }
      })
      .catch((error) => notify("error", error instanceof Error ? error.message : String(error)));
  }, [favoriteFiles, favoritesLoaded, notify]);

  const runAfterActiveEditCommit = useCallback((action: () => void) => {
    window.dispatchEvent(new Event(COMMIT_ACTIVE_EDIT_EVENT));
    window.setTimeout(action, 0);
  }, []);

  const replaceTabSwitcher = useCallback((next: TabSwitcherSession | null) => {
    tabSwitcherRef.current = next;
    setTabSwitcher(next);
  }, []);

  const cycleTabSwitcher = useCallback(
    (direction: TabSwitchDirection, modifierKey: TabSwitcherModifierKey) => {
      const current = tabSwitcherRef.current;
      const next = current
        ? advanceTabSwitcherSession(current, direction)
        : startTabSwitcherSession(
            tabsRef.current,
            activeTabIdRef.current,
            recentTabIdsRef.current,
            direction,
            modifierKey
          );
      replaceTabSwitcher(next);
    },
    [replaceTabSwitcher]
  );

  const highlightTabSwitcherTab = useCallback(
    (id: string) => {
      const current = tabSwitcherRef.current;
      if (!current || current.selectedTabId === id || !current.order.includes(id)) {
        return;
      }
      replaceTabSwitcher({ ...current, selectedTabId: id });
    },
    [replaceTabSwitcher]
  );

  const selectTabSwitcherEdge = useCallback(
    (edge: "first" | "last") => {
      const current = tabSwitcherRef.current;
      if (!current || current.order.length === 0) {
        return;
      }
      replaceTabSwitcher({
        ...current,
        selectedTabId: edge === "first" ? current.order[0] : current.order[current.order.length - 1]
      });
    },
    [replaceTabSwitcher]
  );

  const cancelTabSwitcher = useCallback(() => {
    replaceTabSwitcher(null);
  }, [replaceTabSwitcher]);

  const commitTabSwitcher = useCallback(
    (explicitTabId?: string) => {
      const current = tabSwitcherRef.current;
      if (!current) {
        return;
      }
      const targetTabId = explicitTabId ?? current.selectedTabId;
      replaceTabSwitcher(null);
      if (!targetTabId || targetTabId === activeTabIdRef.current) {
        return;
      }
      if (!tabsRef.current.some((tab) => tab.id === targetTabId)) {
        return;
      }
      runAfterActiveEditCommit(() => setActiveTabId(targetTabId));
    },
    [replaceTabSwitcher, runAfterActiveEditCommit]
  );

  const rememberTabScrollPosition = useCallback((tabId: string, position: GridScrollPosition) => {
    tabScrollPositionsRef.current[tabId] = position;
  }, []);

  const loadDirectoryHandle = useCallback(async (handle: DirectoryHandle): Promise<TreeNode> => {
    const nextRoot = createLocalRoot(handle);
    setRoot({ ...nextRoot, loading: true });
    const children = await loadLocalChildren(nextRoot);
    const loadedRoot: TreeNode = {
      ...nextRoot,
      children,
      loaded: true,
      loading: false
    };
    setRoot(loadedRoot);
    return loadedRoot;
  }, []);

  const patchTab = useCallback((id: string, updater: (tab: CsvTab) => CsvTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? updater(tab) : tab)));
  }, []);

  useEffect(() => {
    const current = tabSwitcherRef.current;
    if (!current) {
      return;
    }
    const openIds = new Set(tabs.map((tab) => tab.id));
    const order = current.order.filter((id) => openIds.has(id));
    if (order.length < 2 || !openIds.has(current.originTabId)) {
      replaceTabSwitcher(null);
      return;
    }
    const selectedTabId = order.includes(current.selectedTabId) ? current.selectedTabId : order[0];
    if (selectedTabId !== current.selectedTabId || order.length !== current.order.length) {
      replaceTabSwitcher({ ...current, order, selectedTabId });
    }
  }, [replaceTabSwitcher, tabs]);

  const openFileRef = useCallback(
    async (fileRef: CsvFileRef, options: OpenFileOptions = {}) => {
      const shouldActivate = options.activate ?? true;
      if (shouldActivate) {
        pendingActivatePathRef.current = fileRef.path;
      }
      const existing = tabsRef.current.find((tab) => tab.path === fileRef.path);
      if (existing) {
        if (shouldActivate) {
          setActiveTabId(existing.id);
        }
        return;
      }
      if (openingPathsRef.current.has(fileRef.path)) {
        window.setTimeout(() => {
          const opened = tabsRef.current.find((tab) => tab.path === fileRef.path);
          if (shouldActivate && opened && pendingActivatePathRef.current === fileRef.path) {
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
        if (shouldActivate && pendingActivatePathRef.current === fileRef.path) {
          setActiveTabId(id);
        }
        if (!options.quiet) {
          notify("success", `已打开 ${fileRef.name}`);
        }
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
      await loadDirectoryHandle(handle);
      setWorkspaceStateLoaded(true);
      notify("success", `已载入目录 ${handle.name}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [loadDirectoryHandle, notify]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const workspace = await loadWorkspaceState();
        if (cancelled) {
          return;
        }
        if (!workspace) {
          setWorkspaceStateLoaded(true);
          return;
        }

        restoringWorkspaceRef.current = true;
        const handle: DirectoryHandle = {
          source: "desktop",
          kind: "directory",
          name: workspace.directory.name,
          path: workspace.directory.path
        };
        await loadDirectoryHandle(handle);
        if (cancelled) {
          return;
        }

        const activePath = workspace.activeFilePath ?? workspace.openFiles[0]?.path ?? null;
        for (const file of workspace.openFiles) {
          if (cancelled) {
            return;
          }
          await openFileRef(
            makeDesktopFileRef({
              kind: "file",
              name: file.name,
              path: file.path
            }),
            {
              activate: file.path === activePath,
              quiet: true
            }
          );
        }

        if (workspace.openFiles.length > 0) {
          notify("success", `已恢复目录 ${workspace.directory.name}，打开 ${workspace.openFiles.length} 个表格`);
        } else {
          notify("success", `已恢复目录 ${workspace.directory.name}`);
        }
      } catch (error) {
        if (!cancelled) {
          notify("warning", `恢复上次工作区失败：${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        if (!cancelled) {
          restoringWorkspaceRef.current = false;
          setWorkspaceStateLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDirectoryHandle, notify, openFileRef]);

  useEffect(() => {
    if (!workspaceStateLoaded || restoringWorkspaceRef.current) {
      return;
    }

    const workspace = buildWorkspaceState(root, tabs, activeTabId);
    if (!workspace) {
      return;
    }

    const serialized = JSON.stringify(workspace);
    if (serialized === workspacePersistSnapshotRef.current) {
      return;
    }
    workspacePersistSnapshotRef.current = serialized;

    void saveWorkspaceState(workspace).catch((error) => {
      notify("error", error instanceof Error ? error.message : String(error));
    });
  }, [activeTabId, notify, root, tabs, workspaceStateLoaded]);

  const handleSvnCommit = useCallback(async () => {
    if (!root?.directoryHandle || !isDesktopDirectoryHandle(root.directoryHandle)) {
      notify("warning", "请先在桌面版中选择一个本地目录。");
      return;
    }
    try {
      await openSvnCommit(root.path);
      notify("info", `已打开 SVN 提交窗口：${root.path}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [notify, root]);

  const handleSvnUpdate = useCallback(async () => {
    if (!root?.directoryHandle || !isDesktopDirectoryHandle(root.directoryHandle)) {
      notify("warning", "请先在桌面版中选择一个本地目录。");
      return;
    }
    try {
      await openSvnUpdate(root.path);
      notify("info", `已打开 SVN 更新窗口：${root.path}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [notify, root]);

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

  const handleAddActiveFavorite = useCallback(() => {
    if (!activeTab) {
      notify("warning", "没有可收藏的当前文档。");
      return;
    }
    if (favoriteFiles.some((favorite) => favorite.path === activeTab.path)) {
      notify("info", "当前文档已在收藏中。");
      return;
    }
    const nextFavorite: CsvFavoriteFile = {
      name: activeTab.name,
      path: activeTab.path,
      source: activeTab.fileRef.source
    };
    setFavoriteFiles((current) => [nextFavorite, ...current].slice(0, 60));
    notify("success", `已加入收藏 ${activeTab.name}`);
  }, [activeTab, favoriteFiles, notify]);

  const handleOpenFavorite = useCallback(
    (favorite: CsvFavoriteFile) => {
      runAfterActiveEditCommit(() => {
        const treeNode = root ? findFileNodeByPath(root, favorite.path) : null;
        const fileRef =
          treeNode?.fileRef ??
          (favorite.source === "local"
            ? makeDesktopFileRef({ kind: "file", name: favorite.name, path: favorite.path })
            : null);
        if (!fileRef) {
          notify("warning", "请先载入包含该收藏文件的目录。");
          return;
        }
        void openFileRef(fileRef);
      });
    },
    [notify, openFileRef, root, runAfterActiveEditCommit]
  );

  const handleRemoveFavorite = useCallback((favorite: CsvFavoriteFile) => {
    setFavoriteFiles((current) => current.filter((item) => item.path !== favorite.path));
  }, []);

  const refreshDirectoryTree = useCallback(async () => {
    const currentRoot = rootRef.current;
    if (!currentRoot) {
      return;
    }
    const reloadedRoot = await reloadLoadedLocalTree(currentRoot);
    setRoot((current) => (current?.id === reloadedRoot.id ? reloadedRoot : current));
  }, []);

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
          columnFilters: sanitizeColumnFilters(current.columnFilters, reloaded.data),
          cellStyles: current.cellStyles,
          autoRefresh: current.autoRefresh,
          findQuery: current.findQuery,
          replaceValue: current.replaceValue,
          findSnapshot: current.findSnapshot
        }));
        notify("success", `已刷新 ${tab.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify, patchTab]
  );

  const reloadActiveTabAndDirectoryTree = useCallback(
    async (id: string) => {
      await reloadTabFromDisk(id);
      await refreshDirectoryTree();
    },
    [refreshDirectoryTree, reloadTabFromDisk]
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
      if (event.key === "Tab" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        cycleTabSwitcher(event.shiftKey ? "previous" : "next", event.metaKey && !event.ctrlKey ? "meta" : "control");
        return;
      }

      if (tabSwitcherRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelTabSwitcher();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commitTabSwitcher();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          cycleTabSwitcher("next", tabSwitcherRef.current.modifierKey);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          cycleTabSwitcher("previous", tabSwitcherRef.current.modifierKey);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          selectTabSwitcherEdge("first");
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          selectTabSwitcherEdge("last");
          return;
        }
      }

      const activeId = activeTabIdRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && activeId) {
        event.preventDefault();
        runAfterActiveEditCommit(() => void saveTab(activeId));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const current = tabSwitcherRef.current;
      if (!current || !isTabSwitcherModifierRelease(event, current.modifierKey)) {
        return;
      }
      event.preventDefault();
      commitTabSwitcher();
    };
    const onBlur = () => {
      if (tabSwitcherRef.current) {
        commitTabSwitcher();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    cancelTabSwitcher,
    commitTabSwitcher,
    cycleTabSwitcher,
    runAfterActiveEditCommit,
    saveTab,
    selectTabSwitcherEdge
  ]);

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
                columnFilters: sanitizeColumnFilters(current.columnFilters, nextTab.data),
                cellStyles: current.cellStyles,
                autoRefresh: current.autoRefresh,
                findQuery: current.findQuery,
                replaceValue: current.replaceValue,
                findSnapshot: current.findSnapshot
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

  const handleToggleMaximize = useCallback(async () => {
    setDesktopWindowState(await toggleMaximizeDesktopWindow());
  }, []);

  return (
    <div
      className={`app-frame ${sidebarResizing ? "resizing-sidebar" : ""}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}
    >
      <DirectoryPane
        root={root}
        favorites={favoriteFiles}
        activeFavoritePath={activeTab?.path ?? null}
        filter={treeFilter}
        directoryPickerAvailable={directoryPickerAvailable}
        svnCommitAvailable={svnCommitAvailable}
        svnUpdateAvailable={svnUpdateAvailable}
        canReloadActive={Boolean(activeTab)}
        canSaveActive={Boolean(activeTab && (activeTab.dirty || activeEditDraftDirty) && activeTab.fileRef.writable)}
        canSaveAll={dirtyCount > 0}
        onFilterChange={setTreeFilter}
        onPickDirectory={handlePickDirectory}
        onSvnCommit={handleSvnCommit}
        onSvnUpdate={handleSvnUpdate}
        onReloadActive={() => activeTabId && runAfterActiveEditCommit(() => void reloadActiveTabAndDirectoryTree(activeTabId))}
        onSaveActive={() => activeTabId && runAfterActiveEditCommit(() => void saveTab(activeTabId))}
        onSaveAll={() => runAfterActiveEditCommit(() => void saveAllDirtyTabs())}
        onToggleDirectory={handleToggleDirectory}
        onOpenFile={handleOpenTreeFile}
        onOpenFavorite={handleOpenFavorite}
        onRemoveFavorite={handleRemoveFavorite}
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
          <button
            className={`favorite-active-button ${activeFavorite ? "active" : ""}`}
            onClick={handleAddActiveFavorite}
            disabled={!activeTab || activeFavorite}
            title={activeFavorite ? "当前文档已在收藏中" : "将当前文档加入收藏"}
          >
            <Star size={15} fill={activeFavorite ? "currentColor" : "none"} />
            加入收藏
          </button>
          {desktopWindowControlsAvailable ? (
            <div className="window-controls" aria-label="窗口控制">
              <button className="window-control" onClick={() => void minimizeDesktopWindow()} title="最小化" aria-label="最小化">
                <Minus size={15} />
              </button>
              <button
                className="window-control"
                onClick={() => void handleToggleMaximize()}
                title={desktopWindowState.maximized ? "还原" : "最大化"}
                aria-label={desktopWindowState.maximized ? "还原" : "最大化"}
              >
                {desktopWindowState.maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button className="window-control close" onClick={() => void closeDesktopWindow()} title="关闭" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
          ) : null}
        </header>

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
            dirtyCount={dirtyCount}
            selectedStats={selectedStats}
            notice={notice}
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
            onPasteCells={(updates) =>
              updateActiveTab((tab) => {
                const locked = new Set(tab.lockedCells);
                const seen = new Set<string>();
                let data = tab.data;
                let changed = false;
                let changedCount = 0;
                let skippedLocked = 0;
                for (const update of updates) {
                  const key = cellKey(update.row, update.col);
                  if (seen.has(key)) {
                    continue;
                  }
                  seen.add(key);
                  if (locked.has(key)) {
                    skippedLocked += 1;
                    continue;
                  }
                  if (readCell(data, update.row, update.col) !== update.value) {
                    data = writeCell(data, update.row, update.col, update.value);
                    changed = true;
                    changedCount += 1;
                  }
                }
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 个` : "";
                if (!changed) {
                  return { ...tab, status: `粘贴内容没有改变${lockStatus}` };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data,
                  dirty: true,
                  status: `已粘贴 ${changedCount} 格${lockStatus}`
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
            onClearCells={(cells) =>
              updateActiveTab((tab) => {
                const locked = new Set(tab.lockedCells);
                const seen = new Set<string>();
                let data = tab.data;
                let changed = false;
                let changedCount = 0;
                let skippedLocked = 0;
                for (const cell of cells) {
                  const key = cellKey(cell.row, cell.col);
                  if (seen.has(key)) {
                    continue;
                  }
                  seen.add(key);
                  if (cell.row >= tab.data.length || cell.col >= (tab.data[cell.row]?.length ?? 0)) {
                    continue;
                  }
                  if (locked.has(key)) {
                    skippedLocked += 1;
                  } else if (readCell(data, cell.row, cell.col) !== "") {
                    data = writeCell(data, cell.row, cell.col, "");
                    changed = true;
                    changedCount += 1;
                  }
                }
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 个` : "";
                if (!changed) {
                  return { ...tab, status: `没有可清空的内容${lockStatus}` };
                }
                const base = pushUndo(tab);
                return { ...base, data, dirty: true, status: `已清空 ${changedCount} 个可见单元格${lockStatus}` };
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
            onToggleLockCells={(cells, locked) =>
              updateActiveTab((tab) => {
                const base = pushUndo(tab);
                const next = new Set(base.lockedCells);
                const seen = new Set<string>();
                for (const cell of cells) {
                  const key = cellKey(cell.row, cell.col);
                  if (seen.has(key)) {
                    continue;
                  }
                  seen.add(key);
                  if (locked) {
                    next.add(key);
                  } else {
                    next.delete(key);
                  }
                }
                return { ...base, lockedCells: [...next], status: locked ? "已锁定可见选区" : "已解锁可见选区" };
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
            onSetColumnFilter={(col, selectedValues) =>
              updateActiveTab((tab) => {
                const nextFilters = { ...tab.columnFilters };
                if (selectedValues === null) {
                  delete nextFilters[col];
                } else {
                  nextFilters[col] = [...new Set(selectedValues)];
                }
                const activeCount = Object.keys(nextFilters).length;
                return {
                  ...tab,
                  columnFilters: nextFilters,
                  status: selectedValues === null ? "已清除列筛选" : `已筛选 ${activeCount} 列`
                };
              })
            }
            onClearAllFilters={() =>
              updateActiveTab((tab) => ({
                ...tab,
                columnFilters: {},
                status: "已清除全部筛选"
              }))
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
            onSetFindSnapshot={(findSnapshot: CsvFindSnapshot | null) => updateActiveTab((tab) => ({ ...tab, findSnapshot }))}
            onSetStatus={(status) => updateActiveTab((tab) => ({ ...tab, status }))}
            onEditDraftDirtyChange={setActiveEditDraftDirty}
            onReplaceCurrent={(query) =>
              updateActiveTab((tab) => {
                const normalizedQuery = query.trim();
                const { focusRow, focusCol } = tab.selection;
                if (!normalizedQuery) {
                  return tab;
                }
                if (tab.lockedCells.includes(cellKey(focusRow, focusCol))) {
                  return { ...tab, status: "当前格已锁定，不能替换" };
                }
                if (!readCell(tab.data, focusRow, focusCol).toLowerCase().includes(normalizedQuery.toLowerCase())) {
                  return { ...tab, status: "当前格没有匹配内容" };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data: replaceCellText(base.data, focusRow, focusCol, normalizedQuery, base.replaceValue),
                  dirty: true,
                  status: "已替换当前匹配"
                };
              })
            }
            onReplaceFindResults={(results, query) =>
              updateActiveTab((tab) => {
                const normalizedQuery = query.trim();
                if (!normalizedQuery || results.length === 0) {
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
                  const replacement = replaceAllMatchesInCell(data, result.row, result.col, normalizedQuery, tab.replaceValue);
                  data = replacement.data;
                  count += replacement.count;
                }
                const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 格` : "";
                if (count === 0) {
                  return { ...tab, status: `没有可替换的匹配内容${lockStatus}` };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  data,
                  dirty: true,
                  status: `已替换 ${count} 处${lockStatus}`
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
            onApplyCellStyleToCells={(cells, stylePatch) =>
              updateActiveTab((tab) => {
                const result = applyCellStylePatchToCells(tab.cellStyles, cells, stylePatch);
                if (result.changedCount === 0) {
                  return { ...tab, status: "颜色没有变化" };
                }
                const base = pushUndo(tab);
                return {
                  ...base,
                  cellStyles: result.styles,
                  status: `已设置可见颜色 ${result.changedCount} 格`
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
            onDeleteRowsByIndexes={(rows) =>
              updateActiveTab((tab) => {
                const targetRows = [...new Set(rows)]
                  .filter((row) => Number.isInteger(row) && row >= 0 && row < tab.data.length)
                  .sort((left, right) => left - right);
                if (targetRows.length === 0) {
                  return { ...tab, status: "选中行没有已有数据" };
                }
                if (hasLockedCellInRowIndexes(tab.lockedCells, targetRows)) {
                  return { ...tab, status: "可见选中行包含锁定格，不能删除" };
                }
                const base = pushUndo(tab);
                const nextData = deleteRowsByIndexes(base.data, targetRows);
                const nextRow = Math.min(targetRows[0], Math.max(0, nextData.length - 1));
                return {
                  ...base,
                  data: nextData,
                  sourceRows: deleteSourceRowsByIndexes(base.sourceRows, targetRows),
                  lockedCells: shiftLockedCellsForDeletedRowIndexes(base.lockedCells, targetRows),
                  cellStyles: shiftCellStylesForDeletedRowIndexes(base.cellStyles, targetRows),
                  selection: singleCellSelection(nextRow, base.selection.focusCol),
                  dirty: true,
                  status: `已删除 ${targetRows.length} 个可见行`
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
                  columnFilters: shiftColumnFiltersForInsertedColumns(base.columnFilters, startCol, count),
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
                  columnFilters: shiftColumnFiltersForDeletedColumns(base.columnFilters, startCol, clampedEndCol),
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
      {tabSwitcher ? (
        <TabSwitcherOverlay
          tabs={tabSwitcherTabs}
          selectedTabId={tabSwitcher.selectedTabId}
          originTabId={tabSwitcher.originTabId}
          onHighlight={highlightTabSwitcherTab}
          onSelect={commitTabSwitcher}
        />
      ) : null}
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

function isTabSwitcherModifierRelease(event: KeyboardEvent, modifierKey: TabSwitcherModifierKey): boolean {
  return modifierKey === "meta" ? event.key === "Meta" : event.key === "Control";
}

function buildWorkspaceState(root: TreeNode | null, tabs: CsvTab[], activeTabId: string | null): CsvWorkspaceState | null {
  if (!root?.directoryHandle || !isDesktopDirectoryHandle(root.directoryHandle)) {
    return null;
  }

  const directory = {
    name: root.name,
    path: root.path,
    source: "local" as const
  };
  const openFiles = tabs.flatMap((tab): CsvWorkspaceFile[] => {
    if (tab.fileRef.source !== "local" || !isPathInsideDirectory(tab.path, root.path)) {
      return [];
    }
    return [
      {
        name: tab.name,
        path: tab.path,
        source: "local"
      }
    ];
  });
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeFilePath =
    activeTab && openFiles.some((file) => file.path === activeTab.path) ? activeTab.path : openFiles[0]?.path ?? null;
  return {
    directory,
    openFiles,
    activeFilePath
  };
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFile = normalizePathForComparison(filePath);
  const normalizedDirectory = normalizePathForComparison(directoryPath);
  return normalizedFile === normalizedDirectory || normalizedFile.startsWith(`${normalizedDirectory}/`);
}

function normalizePathForComparison(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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

function deleteSourceRowsByIndexes(sourceRows: CsvTab["sourceRows"], rowIndexes: number[]): CsvTab["sourceRows"] {
  if (sourceRows.length === 0) {
    return [];
  }
  const rowSet = new Set(
    rowIndexes.filter((row) => Number.isInteger(row) && row >= 0 && row < sourceRows.length)
  );
  if (rowSet.size === 0) {
    return [...sourceRows];
  }
  return sourceRows.filter((_, row) => !rowSet.has(row));
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

function applyCellStylePatchToCells(
  styles: CsvCellStyleMap,
  cells: FindResultCell[],
  stylePatch: Partial<CsvCellStyle>
): { styles: CsvCellStyleMap; changedCount: number } {
  const next: CsvCellStyleMap = { ...styles };
  const seen = new Set<string>();
  const hasTextColor = Object.prototype.hasOwnProperty.call(stylePatch, "textColor");
  const hasBackgroundColor = Object.prototype.hasOwnProperty.call(stylePatch, "backgroundColor");
  let changedCount = 0;

  for (const cell of cells) {
    const key = cellKey(cell.row, cell.col);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
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

function shiftCellStylesForDeletedRowIndexes(styles: CsvCellStyleMap, rowIndexes: number[]): CsvCellStyleMap {
  const rowsToDelete = [...new Set(rowIndexes)]
    .filter((row) => Number.isInteger(row) && row >= 0)
    .sort((left, right) => left - right);
  const rowSet = new Set(rowsToDelete);
  return mapCellStyles(styles, (row, col) => {
    if (rowSet.has(row)) {
      return null;
    }
    return { row: row - countSortedValuesBelow(rowsToDelete, row), col };
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

function shiftColumnFiltersForInsertedColumns(filters: CsvColumnFilters, startCol: number, count: number): CsvColumnFilters {
  const next: CsvColumnFilters = {};
  Object.entries(filters).forEach(([colText, values]) => {
    const col = Number(colText);
    if (!Number.isInteger(col) || col < 0) {
      return;
    }
    next[col >= startCol ? col + count : col] = [...values];
  });
  return next;
}

function shiftColumnFiltersForDeletedColumns(filters: CsvColumnFilters, startCol: number, endCol: number): CsvColumnFilters {
  const start = Math.min(startCol, endCol);
  const end = Math.max(startCol, endCol);
  const deletedCount = end - start + 1;
  const next: CsvColumnFilters = {};
  Object.entries(filters).forEach(([colText, values]) => {
    const col = Number(colText);
    if (!Number.isInteger(col) || col < 0 || (col >= start && col <= end)) {
      return;
    }
    next[col > end ? col - deletedCount : col] = [...values];
  });
  return next;
}

function sanitizeColumnFilters(filters: CsvColumnFilters, data: CsvTab["data"]): CsvColumnFilters {
  const maxCol = Math.max(0, maxColumnCount(data) - 1);
  const next: CsvColumnFilters = {};
  Object.entries(filters).forEach(([colText, values]) => {
    const col = Number(colText);
    if (!Number.isInteger(col) || col < 0 || col > maxCol) {
      return;
    }
    next[col] = [...new Set(values)];
  });
  return next;
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

function countSortedValuesBelow(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findFileNodeByPath(node: TreeNode, targetPath: string): TreeNode | null {
  if (node.kind === "file" && node.path === targetPath) {
    return node;
  }
  for (const child of node.children ?? []) {
    const matched = findFileNodeByPath(child, targetPath);
    if (matched) {
      return matched;
    }
  }
  return null;
}

function favoritesEqual(left: CsvFavoriteFile[], right: CsvFavoriteFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (favorite, index) =>
      favorite.name === right[index]?.name &&
      favorite.path === right[index]?.path &&
      favorite.source === right[index]?.source
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
