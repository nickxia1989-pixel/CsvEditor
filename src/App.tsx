import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertTriangle,
  Columns2,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  X
} from "lucide-react";
import { DirectoryPane } from "./components/DirectoryPane";
import { GlobalSearchOverlay } from "./components/GlobalSearchOverlay";
import { COMMIT_ACTIVE_EDIT_EVENT, GridEditor } from "./components/GridEditor";
import { QuickOpenOverlay } from "./components/QuickOpenOverlay";
import { TabStrip, type TabDropPlacement } from "./components/TabStrip";
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
import {
  addGlobalSearchHistory,
  GLOBAL_SEARCH_HISTORY_STORAGE_KEY,
  sanitizeGlobalSearchHistory,
  searchCsvFiles,
  type SearchableCsvFile
} from "./lib/globalSearch";
import { clearHistory, pushUndo, redoTab, undoTab } from "./lib/history";
import { buildQuickOpenCandidates, type QuickOpenCandidate } from "./lib/quickOpen";
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
  GlobalSearchProgress,
  GlobalSearchResult,
  GlobalSearchSnapshot,
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
const SPLIT_MIN_RATIO = 28;
const SPLIT_MAX_RATIO = 72;
const SPLIT_DEFAULT_RATIO = 50;
const SPLIT_KEYBOARD_STEP = 4;
const SPLIT_KEYBOARD_LARGE_STEP = 10;
const DEFAULT_GRID_SCROLL_POSITION: GridScrollPosition = { scrollTop: 0, scrollLeft: 0 };
const DEFAULT_DESKTOP_WINDOW_STATE: DesktopWindowState = { maximized: false, fullscreen: false };

type WorkspacePaneId = "left" | "right";
type PaneTabIds = Record<WorkspacePaneId, string | null>;

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
  targetCell?: FindResultCell;
  status?: string;
  clearFilters?: boolean;
};
type QuickOpenState = {
  query: string;
  selectedId: string | null;
  loading: boolean;
};
type PathContextMenuState = {
  name: string;
  path: string;
  x: number;
  y: number;
} | null;

export function App() {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [favoriteFiles, setFavoriteFiles] = useState<CsvFavoriteFile[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [tabs, setTabs] = useState<CsvTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [paneTabIds, setPaneTabIds] = useState<PaneTabIds>({ left: null, right: null });
  const [activePane, setActivePane] = useState<WorkspacePaneId>("left");
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(SPLIT_DEFAULT_RATIO);
  const [splitResizing, setSplitResizing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [activeEditDraftDirty, setActiveEditDraftDirty] = useState(false);
  const [desktopWindowState, setDesktopWindowState] = useState<DesktopWindowState>(DEFAULT_DESKTOP_WINDOW_STATE);
  const [tabSwitcher, setTabSwitcher] = useState<TabSwitcherSession | null>(null);
  const [quickOpen, setQuickOpen] = useState<QuickOpenState | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchSnapshot, setGlobalSearchSnapshot] = useState<GlobalSearchSnapshot | null>(null);
  const [globalSearchHistory, setGlobalSearchHistory] = useState<GlobalSearchSnapshot[]>(() => loadStoredGlobalSearchHistory());
  const [selectedGlobalSearchHistoryId, setSelectedGlobalSearchHistoryId] = useState<string | null>(null);
  const [selectedGlobalSearchResultId, setSelectedGlobalSearchResultId] = useState<string | null>(null);
  const [globalSearchSearching, setGlobalSearchSearching] = useState(false);
  const [globalSearchProgress, setGlobalSearchProgress] = useState<GlobalSearchProgress>({
    phase: "idle",
    scannedFiles: 0,
    totalFiles: 0
  });
  const [pathContextMenu, setPathContextMenu] = useState<PathContextMenuState>(null);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const rootRef = useRef(root);
  const tabsRef = useRef(tabs);
  const activeEditDraftDirtyRef = useRef(activeEditDraftDirty);
  const activeTabIdRef = useRef(activeTabId);
  const paneTabIdsRef = useRef(paneTabIds);
  const activePaneRef = useRef(activePane);
  const recentTabIdsRef = useRef<string[]>([]);
  const tabSwitcherRef = useRef<TabSwitcherSession | null>(null);
  const quickOpenLoadSerialRef = useRef(0);
  const quickOpenCandidatesRef = useRef<QuickOpenCandidate[]>([]);
  const globalSearchSerialRef = useRef(0);
  const globalSearchHistoryRef = useRef(globalSearchHistory);
  const globalSearchResultScrollTopsRef = useRef<Record<string, number>>({});
  const restoringWorkspaceRef = useRef(false);
  const workspacePersistSnapshotRef = useRef("");
  const favoritePersistSnapshotRef = useRef("");
  const tabScrollPositionsRef = useRef<Record<string, GridScrollPosition>>({});
  const paneScrollPositionsRef = useRef<Record<string, GridScrollPosition>>({});
  const pollBusyRef = useRef(false);
  const openingPathsRef = useRef(new Set<string>());
  const pendingActivatePathRef = useRef<string | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const splitResizeRef = useRef<{ rectLeft: number; rectWidth: number } | null>(null);
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

  useEffect(() => {
    paneTabIdsRef.current = paneTabIds;
  }, [paneTabIds]);

  useEffect(() => {
    activePaneRef.current = activePane;
  }, [activePane]);

  useEffect(() => {
    if (!pathContextMenu) {
      return undefined;
    }
    const closeMenu = () => setPathContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [pathContextMenu]);

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
  const quickOpenCandidates = useMemo(
    () =>
      quickOpen
        ? buildQuickOpenCandidates(visibleTabs, root, quickOpen.query, recentTabIdsRef.current, activeTabId)
        : [],
    [activeTabId, quickOpen, root, visibleTabs]
  );

  useEffect(() => {
    setActiveEditDraftDirty(false);
  }, [activeTabId]);

  useEffect(() => {
    quickOpenCandidatesRef.current = quickOpenCandidates;
  }, [quickOpenCandidates]);

  useEffect(() => {
    globalSearchHistoryRef.current = globalSearchHistory;
  }, [globalSearchHistory]);

  useEffect(() => {
    if (!quickOpen) {
      return;
    }
    const selectedStillVisible = quickOpenCandidates.some((candidate) => candidate.id === quickOpen.selectedId);
    const nextSelectedId = selectedStillVisible ? quickOpen.selectedId : quickOpenCandidates[0]?.id ?? null;
    if (nextSelectedId !== quickOpen.selectedId) {
      setQuickOpen((current) => (current ? { ...current, selectedId: nextSelectedId } : current));
    }
  }, [quickOpen, quickOpenCandidates]);

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

  const openPathContextMenu = useCallback((target: { name: string; path: string }, point: { x: number; y: number }) => {
    setPathContextMenu({
      ...target,
      x: clamp(point.x, 8, Math.max(8, window.innerWidth - 196)),
      y: clamp(point.y, 8, Math.max(8, window.innerHeight - 72))
    });
  }, []);

  const copyPathToClipboard = useCallback(
    async (target: { name: string; path: string }) => {
      try {
        await writeClipboardText(target.path);
        notify("success", `已复制路径 ${target.name}`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      }
    },
    [notify]
  );

  const copyActiveTabPath = useCallback(() => {
    if (!activeTab) {
      notify("warning", "没有可复制路径的当前文档。");
      return;
    }
    void copyPathToClipboard(activeTab);
  }, [activeTab, copyPathToClipboard, notify]);

  const handleTreeFileContextMenu = useCallback(
    (node: TreeNode, point: { x: number; y: number }) => {
      const path = node.fileRef?.path ?? node.path;
      openPathContextMenu({ name: node.name, path }, point);
    },
    [openPathContextMenu]
  );

  const handleTabContextMenu = useCallback(
    (tab: CsvTab, point: { x: number; y: number }) => {
      openPathContextMenu({ name: tab.name, path: tab.path }, point);
    },
    [openPathContextMenu]
  );

  const handleReorderTabs = useCallback((draggedId: string, targetId: string, placement: TabDropPlacement) => {
    setTabs((current) => {
      const next = reorderTabsByDrop(current, draggedId, targetId, placement);
      if (next === current) {
        return current;
      }
      tabsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadFavoriteFiles()
      .then((favorites) => {
        if (!cancelled) {
          setFavoriteFiles((current) => {
            const next = current.length === 0 ? favorites : mergeFavoriteFiles(current, favorites);
            favoritePersistSnapshotRef.current = current.length === 0 ? serializeFavorites(next) : "";
            return next;
          });
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
    const snapshot = serializeFavorites(favoriteFiles);
    if (snapshot === favoritePersistSnapshotRef.current) {
      return;
    }
    favoritePersistSnapshotRef.current = snapshot;
    void saveFavoriteFiles(favoriteFiles)
      .then((savedFavorites) => {
        favoritePersistSnapshotRef.current = serializeFavorites(savedFavorites);
        if (!favoritesEqual(favoriteFiles, savedFavorites)) {
          setFavoriteFiles(savedFavorites);
        }
      })
      .catch((error) => {
        favoritePersistSnapshotRef.current = "";
        notify("error", error instanceof Error ? error.message : String(error));
      });
  }, [favoriteFiles, favoritesLoaded, notify]);

  const runAfterActiveEditCommit = useCallback((action: () => void) => {
    window.dispatchEvent(new Event(COMMIT_ACTIVE_EDIT_EVENT));
    window.setTimeout(action, 0);
  }, []);

  const activateTabInPane = useCallback((id: string, pane: WorkspacePaneId = activePaneRef.current) => {
    activePaneRef.current = pane;
    activeTabIdRef.current = id;
    setActivePane(pane);
    setActiveTabId(id);
    setPaneTabIds((current) => ({ ...current, [pane]: id }));
  }, []);

  const focusPane = useCallback((pane: WorkspacePaneId) => {
    activePaneRef.current = pane;
    setActivePane(pane);
    const paneTabId = paneTabIdsRef.current[pane];
    if (paneTabId) {
      activeTabIdRef.current = paneTabId;
      setActiveTabId(paneTabId);
    }
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
      runAfterActiveEditCommit(() => activateTabInPane(targetTabId));
    },
    [activateTabInPane, replaceTabSwitcher, runAfterActiveEditCommit]
  );

  const closeQuickOpen = useCallback(() => {
    quickOpenLoadSerialRef.current += 1;
    setQuickOpen(null);
  }, []);

  const openQuickOpen = useCallback(() => {
    replaceTabSwitcher(null);
    const currentRoot = rootRef.current;
    const shouldLoadTree = Boolean(currentRoot && hasUnloadedLocalDirectory(currentRoot));
    const loadSerial = quickOpenLoadSerialRef.current + 1;
    quickOpenLoadSerialRef.current = loadSerial;
    setQuickOpen({
      query: "",
      selectedId: null,
      loading: shouldLoadTree
    });

    if (!currentRoot || !shouldLoadTree) {
      return;
    }

    void (async () => {
      try {
        const loadedRoot = await loadLocalDescendants(currentRoot);
        setRoot((current) => {
          if (!current || current.id !== currentRoot.id) {
            return current;
          }
          return mergeLoadedNodeState(current, loadedRoot);
        });
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      } finally {
        setQuickOpen((current) =>
          current && quickOpenLoadSerialRef.current === loadSerial ? { ...current, loading: false } : current
        );
      }
    })();
  }, [notify, replaceTabSwitcher]);

  const updateQuickOpenQuery = useCallback((query: string) => {
    setQuickOpen((current) => (current ? { ...current, query, selectedId: null } : current));
  }, []);

  const moveQuickOpenSelection = useCallback((delta: number) => {
    setQuickOpen((current) => {
      if (!current) {
        return current;
      }
      const candidates = quickOpenCandidatesRef.current;
      if (candidates.length === 0) {
        return { ...current, selectedId: null };
      }
      const currentIndex = Math.max(0, candidates.findIndex((candidate) => candidate.id === current.selectedId));
      const nextIndex = ((currentIndex + delta) % candidates.length + candidates.length) % candidates.length;
      return { ...current, selectedId: candidates[nextIndex].id };
    });
  }, []);

  const selectQuickOpenEdge = useCallback((edge: "first" | "last") => {
    setQuickOpen((current) => {
      if (!current) {
        return current;
      }
      const candidates = quickOpenCandidatesRef.current;
      const candidate = edge === "first" ? candidates[0] : candidates[candidates.length - 1];
      return { ...current, selectedId: candidate?.id ?? null };
    });
  }, []);

  const persistGlobalSearchHistory = useCallback(
    (history: GlobalSearchSnapshot[]) => {
      globalSearchHistoryRef.current = history;
      setGlobalSearchHistory(history);
      if (typeof window === "undefined") {
        return;
      }
      try {
        window.localStorage.setItem(GLOBAL_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
      } catch (error) {
        notify("warning", `全表搜索历史保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [notify]
  );

  const openGlobalSearch = useCallback(() => {
    replaceTabSwitcher(null);
    closeQuickOpen();
    setPathContextMenu(null);
    setGlobalSearchOpen(true);
  }, [closeQuickOpen, replaceTabSwitcher]);

  const closeGlobalSearch = useCallback(() => {
    globalSearchSerialRef.current += 1;
    setGlobalSearchSearching(false);
    setGlobalSearchProgress({ phase: "idle", scannedFiles: 0, totalFiles: 0 });
    setGlobalSearchOpen(false);
  }, []);

  const selectGlobalSearchHistory = useCallback((id: string) => {
    const snapshot = globalSearchHistoryRef.current.find((entry) => entry.id === id);
    if (!snapshot) {
      return;
    }
    setGlobalSearchQuery(snapshot.query);
    setGlobalSearchSnapshot(snapshot);
    setSelectedGlobalSearchHistoryId(snapshot.id);
    setGlobalSearchProgress({ phase: "idle", scannedFiles: 0, totalFiles: 0 });
    setGlobalSearchOpen(true);
  }, []);

  const deleteGlobalSearchHistory = useCallback(
    (id: string) => {
      const currentHistory = globalSearchHistoryRef.current;
      const deletedIndex = currentHistory.findIndex((entry) => entry.id === id);
      if (deletedIndex < 0) {
        return;
      }

      const nextHistory = currentHistory.filter((entry) => entry.id !== id);
      const nextScrollTops = { ...globalSearchResultScrollTopsRef.current };
      delete nextScrollTops[id];
      globalSearchResultScrollTopsRef.current = nextScrollTops;
      persistGlobalSearchHistory(nextHistory);

      if (selectedGlobalSearchHistoryId !== id && globalSearchSnapshot?.id !== id) {
        return;
      }

      const fallbackSnapshot = nextHistory[Math.min(deletedIndex, nextHistory.length - 1)] ?? null;
      setSelectedGlobalSearchResultId(null);
      if (fallbackSnapshot) {
        setGlobalSearchQuery(fallbackSnapshot.query);
        setGlobalSearchSnapshot(fallbackSnapshot);
        setSelectedGlobalSearchHistoryId(fallbackSnapshot.id);
        setGlobalSearchProgress({ phase: "idle", scannedFiles: 0, totalFiles: 0 });
        return;
      }

      setGlobalSearchSnapshot(null);
      setSelectedGlobalSearchHistoryId(null);
      setGlobalSearchProgress({ phase: "idle", scannedFiles: 0, totalFiles: 0 });
    },
    [globalSearchSnapshot?.id, persistGlobalSearchHistory, selectedGlobalSearchHistoryId]
  );

  const rememberGlobalSearchResultsScroll = useCallback((snapshotId: string, scrollTop: number) => {
    globalSearchResultScrollTopsRef.current = {
      ...globalSearchResultScrollTopsRef.current,
      [snapshotId]: scrollTop
    };
  }, []);

  const runGlobalSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) {
        notify("warning", "请输入全表搜索内容。");
        return;
      }
      const currentRoot = rootRef.current;
      if (!currentRoot) {
        notify("warning", "请先选择一个包含 CSV 的目录。");
        return;
      }

      const serial = globalSearchSerialRef.current + 1;
      globalSearchSerialRef.current = serial;
      setGlobalSearchOpen(true);
      setGlobalSearchQuery(rawQuery);
      setGlobalSearchSearching(true);
      setSelectedGlobalSearchHistoryId(null);
      setSelectedGlobalSearchResultId(null);
      setGlobalSearchSnapshot(null);
      setGlobalSearchProgress({ phase: "loading", scannedFiles: 0, totalFiles: 0 });

      try {
        let searchRoot = currentRoot;
        if (hasUnloadedLocalDirectory(currentRoot)) {
          const loadedRoot = await loadLocalDescendants(currentRoot);
          if (globalSearchSerialRef.current !== serial) {
            return;
          }
          searchRoot = loadedRoot;
          setRoot((current) => (current?.id === currentRoot.id ? mergeLoadedNodeState(current, loadedRoot) : current));
        }

        const files = buildSearchableCsvFiles(searchRoot, tabsRef.current);
        if (globalSearchSerialRef.current !== serial) {
          return;
        }
        setGlobalSearchProgress({ phase: "searching", scannedFiles: 0, totalFiles: files.length });

        const snapshot = await searchCsvFiles({
          query,
          rootName: searchRoot.name,
          rootPath: searchRoot.path,
          files,
          onProgress: ({ scannedFiles, totalFiles }) => {
            if (globalSearchSerialRef.current === serial) {
              setGlobalSearchProgress({ phase: "searching", scannedFiles, totalFiles });
            }
          },
          onSnapshot: (nextSnapshot) => {
            if (globalSearchSerialRef.current === serial) {
              setGlobalSearchSnapshot(nextSnapshot);
              setSelectedGlobalSearchHistoryId(nextSnapshot.id);
            }
          }
        });
        if (globalSearchSerialRef.current !== serial) {
          return;
        }

        setGlobalSearchSnapshot(snapshot);
        setSelectedGlobalSearchHistoryId(snapshot.id);
        persistGlobalSearchHistory(addGlobalSearchHistory(globalSearchHistoryRef.current, snapshot));
        notify(
          snapshot.results.length > 0 ? "success" : "info",
          `全表搜索完成：${snapshot.results.length} 项，${snapshot.matchedFileCount} 个表格`
        );
      } catch (error) {
        if (globalSearchSerialRef.current === serial) {
          notify("error", error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (globalSearchSerialRef.current === serial) {
          setGlobalSearchSearching(false);
        }
      }
    },
    [notify, persistGlobalSearchHistory]
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

  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id));
    const fallbackId = (activeTabId && openIds.has(activeTabId) ? activeTabId : null) ?? tabs[0]?.id ?? null;
    let nextPaneTabIds = paneTabIdsRef.current;
    let paneIdsChanged = false;
    for (const pane of ["left", "right"] as const) {
      const currentId = nextPaneTabIds[pane];
      if (currentId && openIds.has(currentId)) {
        continue;
      }
      const replacement =
        pane === "right"
          ? tabs.find((tab) => tab.id !== (nextPaneTabIds.left ?? fallbackId))?.id ?? fallbackId
          : fallbackId;
      nextPaneTabIds = { ...nextPaneTabIds, [pane]: replacement ?? null };
      paneIdsChanged = true;
    }
    if (paneIdsChanged) {
      paneTabIdsRef.current = nextPaneTabIds;
      setPaneTabIds(nextPaneTabIds);
    }
    if (activeTabId && openIds.has(activeTabId)) {
      return;
    }
    activeTabIdRef.current = nextPaneTabIds[activePaneRef.current] ?? fallbackId;
    setActiveTabId(activeTabIdRef.current);
  }, [activeTabId, tabs]);

  const openFileRef = useCallback(
    async (fileRef: CsvFileRef, options: OpenFileOptions = {}): Promise<string | null> => {
      const shouldActivate = options.activate ?? true;
      const targetPane = activePaneRef.current;
      if (shouldActivate) {
        pendingActivatePathRef.current = fileRef.path;
      }
      const existing = tabsRef.current.find((tab) => tab.path === fileRef.path);
      if (existing) {
        if (options.targetCell || options.status || options.clearFilters) {
          patchTab(existing.id, (current) => applyOpenFileOptionsToTab(current, options));
        }
        if (shouldActivate) {
          activateTabInPane(existing.id, targetPane);
        }
        return existing.id;
      }
      if (openingPathsRef.current.has(fileRef.path)) {
        window.setTimeout(() => {
          const opened = tabsRef.current.find((tab) => tab.path === fileRef.path);
          if (opened && (options.targetCell || options.status || options.clearFilters)) {
            patchTab(opened.id, (current) => applyOpenFileOptionsToTab(current, options));
          }
          if (shouldActivate && opened && pendingActivatePathRef.current === fileRef.path) {
            activateTabInPane(opened.id, targetPane);
          }
        }, 0);
        return null;
      }

      try {
        openingPathsRef.current.add(fileRef.path);
        const id = createTabId();
        const tab = applyOpenFileOptionsToTab(await createTabFromFileRef(fileRef, id), options);
        setTabs((current) => {
          const next = [...current, tab];
          tabsRef.current = next;
          return next;
        });
        if (shouldActivate && pendingActivatePathRef.current === fileRef.path) {
          activateTabInPane(id, targetPane);
        }
        if (!options.quiet) {
          notify("success", `已打开 ${fileRef.name}`);
        }
        return id;
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        window.setTimeout(() => openingPathsRef.current.delete(fileRef.path), 0);
      }
    },
    [activateTabInPane, notify, patchTab]
  );

  const openGlobalSearchResult = useCallback(
    (result: GlobalSearchResult) => {
      setSelectedGlobalSearchResultId(result.id);
      runAfterActiveEditCommit(() => {
        void (async () => {
          const fileRef = resolveGlobalSearchResultFileRef(rootRef.current, result);
          if (!fileRef) {
            notify("warning", "请先载入包含该历史结果的目录。");
            return;
          }
          const openedId = await openFileRef(fileRef, {
            targetCell: result,
            status: `已从全表搜索跳转到 ${result.cell}`,
            clearFilters: true
          });
          if (!openedId) {
            return;
          }
          setGlobalSearchOpen(false);
          notify("success", `已跳转到 ${result.fileName} ${result.cell}`);
        })();
      });
    },
    [notify, openFileRef, runAfterActiveEditCommit]
  );

  const commitQuickOpenCandidate = useCallback(
    (explicitId?: string) => {
      const current = quickOpen;
      if (!current) {
        return;
      }
      const targetId = explicitId ?? current.selectedId;
      const candidate = quickOpenCandidatesRef.current.find((item) => item.id === targetId);
      closeQuickOpen();
      if (!candidate) {
        return;
      }
      runAfterActiveEditCommit(() => {
        if (candidate.tabId && tabsRef.current.some((tab) => tab.id === candidate.tabId)) {
          activateTabInPane(candidate.tabId);
          return;
        }
        void openFileRef(candidate.fileRef);
      });
    },
    [activateTabInPane, closeQuickOpen, openFileRef, quickOpen, runAfterActiveEditCommit]
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

  const handleAddFavoriteForTab = useCallback((tab: CsvTab | null) => {
    if (!tab) {
      notify("warning", "没有可收藏的当前文档。");
      return;
    }
    if (favoriteFiles.some((favorite) => favorite.path === tab.path)) {
      notify("info", "当前文档已在收藏中。");
      return;
    }
    const nextFavorite: CsvFavoriteFile = {
      name: tab.name,
      path: tab.path,
      source: tab.fileRef.source
    };
    const nextFavorites = mergeFavoriteFiles([nextFavorite], favoriteFiles);
    favoritePersistSnapshotRef.current = serializeFavorites(nextFavorites);
    setFavoriteFiles(nextFavorites);
    void saveFavoriteFiles(nextFavorites)
      .then((savedFavorites) => {
        favoritePersistSnapshotRef.current = serializeFavorites(savedFavorites);
        if (!favoritesEqual(nextFavorites, savedFavorites)) {
          setFavoriteFiles(savedFavorites);
        }
      })
      .catch((error) => {
        favoritePersistSnapshotRef.current = "";
        notify("error", error instanceof Error ? error.message : String(error));
      });
    notify("success", `已加入收藏 ${tab.name}`);
  }, [favoriteFiles, notify]);

  const handleAddActiveFavorite = useCallback(() => {
    handleAddFavoriteForTab(activeTab);
  }, [activeTab, handleAddFavoriteForTab]);

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
      const fallbackId = remaining[remaining.length - 1]?.id ?? null;
      const nextPaneTabIds: PaneTabIds = {
        left: paneTabIdsRef.current.left === id ? fallbackId : paneTabIdsRef.current.left,
        right: paneTabIdsRef.current.right === id ? fallbackId : paneTabIdsRef.current.right
      };
      paneTabIdsRef.current = nextPaneTabIds;
      setPaneTabIds(nextPaneTabIds);
      const nextActiveId = activeTabIdRef.current === id ? nextPaneTabIds[activePaneRef.current] ?? fallbackId : activeTabIdRef.current;
      activeTabIdRef.current = nextActiveId;
      setActiveTabId(nextActiveId);
    },
    []
  );

  const activateTabAfterEditCommit = useCallback(
    (id: string) => runAfterActiveEditCommit(() => activateTabInPane(id)),
    [activateTabInPane, runAfterActiveEditCommit]
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
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        openQuickOpen();
        return;
      }

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
    openQuickOpen,
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
      const targetTabId = activeTabIdRef.current;
      if (!targetTabId) {
        return;
      }
      patchTab(targetTabId, updater);
    },
    [patchTab]
  );

  const selectedStats = activeTab
    ? formatSelectedStats(activeTab)
    : "未打开文件";

  function formatSelectedStats(tab: CsvTab): string {
    return `${tab.data.length} 行 / ${maxColumnCount(tab.data)} 列 / ${tab.encoding.toUpperCase()}`;
  }

  const isFavoriteTab = (tab: CsvTab) => favoriteFiles.some((favorite) => favorite.path === tab.path);

  const getPaneScrollPosition = (pane: WorkspacePaneId, tabId: string) =>
    paneScrollPositionsRef.current[`${pane}:${tabId}`] ??
    tabScrollPositionsRef.current[tabId] ??
    DEFAULT_GRID_SCROLL_POSITION;

  const rememberPaneScrollPosition = (pane: WorkspacePaneId, tabId: string, position: GridScrollPosition) => {
    paneScrollPositionsRef.current[`${pane}:${tabId}`] = position;
    if (pane === "left") {
      tabScrollPositionsRef.current[tabId] = position;
    }
  };

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

  const moveSplitResize = useCallback((event: PointerEvent) => {
    const resize = splitResizeRef.current;
    if (!resize || resize.rectWidth <= 0) {
      return;
    }
    const nextRatio = ((event.clientX - resize.rectLeft) / resize.rectWidth) * 100;
    setSplitRatio(clamp(nextRatio, SPLIT_MIN_RATIO, SPLIT_MAX_RATIO));
  }, []);

  const stopSplitResize = useCallback(() => {
    splitResizeRef.current = null;
    setSplitResizing(false);
    window.removeEventListener("pointermove", moveSplitResize);
    window.removeEventListener("pointerup", stopSplitResize);
    window.removeEventListener("blur", stopSplitResize);
  }, [moveSplitResize]);

  const beginSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const parent = event.currentTarget.parentElement;
      if (!parent) {
        return;
      }
      event.preventDefault();
      const rect = parent.getBoundingClientRect();
      splitResizeRef.current = {
        rectLeft: rect.left,
        rectWidth: rect.width
      };
      setSplitResizing(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", moveSplitResize);
      window.addEventListener("pointerup", stopSplitResize, { once: true });
      window.addEventListener("blur", stopSplitResize, { once: true });
    },
    [moveSplitResize, stopSplitResize]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", moveSidebarResize);
      window.removeEventListener("pointerup", stopSidebarResize);
      window.removeEventListener("blur", stopSidebarResize);
      window.removeEventListener("pointermove", moveSplitResize);
      window.removeEventListener("pointerup", stopSplitResize);
      window.removeEventListener("blur", stopSplitResize);
    };
  }, [moveSidebarResize, moveSplitResize, stopSidebarResize, stopSplitResize]);

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

  const handleSplitResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? SPLIT_KEYBOARD_LARGE_STEP : SPLIT_KEYBOARD_STEP;
      let nextRatio = splitRatio;
      if (event.key === "ArrowLeft") {
        nextRatio -= step;
      } else if (event.key === "ArrowRight") {
        nextRatio += step;
      } else if (event.key === "Home") {
        nextRatio = SPLIT_MIN_RATIO;
      } else if (event.key === "End") {
        nextRatio = SPLIT_MAX_RATIO;
      } else {
        return;
      }

      event.preventDefault();
      setSplitRatio(clamp(nextRatio, SPLIT_MIN_RATIO, SPLIT_MAX_RATIO));
    },
    [splitRatio]
  );

  const handleToggleMaximize = useCallback(async () => {
    setDesktopWindowState(await toggleMaximizeDesktopWindow());
  }, []);

  const chooseSecondaryTabId = useCallback(
    (primaryId: string | null) => tabs.find((tab) => tab.id !== primaryId)?.id ?? primaryId,
    [tabs]
  );

  const enableSplitView = useCallback(() => {
    const leftId = paneTabIdsRef.current.left ?? activeTabIdRef.current ?? tabs[0]?.id ?? null;
    const rightId = paneTabIdsRef.current.right ?? chooseSecondaryTabId(leftId);
    const nextPaneTabIds = { left: leftId, right: rightId };
    paneTabIdsRef.current = nextPaneTabIds;
    setPaneTabIds(nextPaneTabIds);
    setSplitEnabled(true);
    if (leftId) {
      activePaneRef.current = "left";
      activeTabIdRef.current = leftId;
      setActivePane("left");
      setActiveTabId(leftId);
    }
  }, [chooseSecondaryTabId, tabs]);

  const disableSplitView = useCallback(() => {
    setSplitEnabled(false);
    const leftPaneTabId = paneTabIdsRef.current.left ?? tabs[0]?.id ?? null;
    activePaneRef.current = "left";
    setActivePane("left");
    if (leftPaneTabId) {
      const leftPaneScrollPosition = paneScrollPositionsRef.current[`left:${leftPaneTabId}`];
      if (leftPaneScrollPosition) {
        tabScrollPositionsRef.current[leftPaneTabId] = leftPaneScrollPosition;
      }
      activeTabIdRef.current = leftPaneTabId;
      setActiveTabId(leftPaneTabId);
      setPaneTabIds((current) => ({ ...current, left: leftPaneTabId }));
    }
  }, [tabs]);

  const renderGridEditor = (tab: CsvTab, paneId: WorkspacePaneId) => {
    const paneFavorite = isFavoriteTab(tab);
    const updatePaneTab = (updater: (tab: CsvTab) => CsvTab) => patchTab(tab.id, updater);

    return (
      <GridEditor
        key={`${paneId}:${tab.id}`}
        active={activePane === paneId}
        tab={tab}
        dirtyCount={dirtyCount}
        selectedStats={formatSelectedStats(tab)}
        notice={notice}
        scrollPosition={getPaneScrollPosition(paneId, tab.id)}
        onScrollPositionChange={(_, position) => rememberPaneScrollPosition(paneId, tab.id, position)}
        onSelectionChange={(selection) => updatePaneTab((current) => ({ ...current, selection }))}
        onSetCell={(row, col, value) =>
          updatePaneTab((current) => {
            if (current.lockedCells.includes(cellKey(row, col))) {
              return current;
            }
            if (readCell(current.data, row, col) === value) {
              return current;
            }
            const base = pushUndo(current);
            return {
              ...base,
              data: writeCell(base.data, row, col, value),
              dirty: true,
              status: "已修改"
            };
          })
        }
        onPaste={(startRow, startCol, values) =>
          updatePaneTab((current) => {
            const locked = new Set(current.lockedCells);
            let data = current.data;
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
              return { ...current, status: `粘贴内容没有改变${lockStatus}` };
            }
            const base = pushUndo(current);
            return {
              ...base,
              data,
              dirty: true,
              status: `已粘贴${lockStatus}`
            };
          })
        }
        onPasteCells={(updates) =>
          updatePaneTab((current) => {
            const locked = new Set(current.lockedCells);
            const seen = new Set<string>();
            let data = current.data;
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
              return { ...current, status: `粘贴内容没有改变${lockStatus}` };
            }
            const base = pushUndo(current);
            return {
              ...base,
              data,
              dirty: true,
              status: `已粘贴 ${changedCount} 格${lockStatus}`
            };
          })
        }
        onClearRange={(startRow, startCol, endRow, endCol) =>
          updatePaneTab((current) => {
            const range = normalizeSelection({ anchorRow: startRow, anchorCol: startCol, focusRow: endRow, focusCol: endCol });
            const locked = new Set(current.lockedCells);
            let data = current.data;
            let changed = false;
            let skippedLocked = 0;
            for (let row = range.startRow; row <= range.endRow; row += 1) {
              if (row >= current.data.length) {
                continue;
              }
              const rowWidth = current.data[row]?.length ?? 0;
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
              return { ...current, status: `没有可清空的内容${lockStatus}` };
            }
            const base = pushUndo(current);
            return { ...base, data, dirty: true, status: `已清空选区${lockStatus}` };
          })
        }
        onClearCells={(cells) =>
          updatePaneTab((current) => {
            const locked = new Set(current.lockedCells);
            const seen = new Set<string>();
            let data = current.data;
            let changed = false;
            let changedCount = 0;
            let skippedLocked = 0;
            for (const cell of cells) {
              const key = cellKey(cell.row, cell.col);
              if (seen.has(key)) {
                continue;
              }
              seen.add(key);
              if (cell.row >= current.data.length || cell.col >= (current.data[cell.row]?.length ?? 0)) {
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
              return { ...current, status: `没有可清空的内容${lockStatus}` };
            }
            const base = pushUndo(current);
            return { ...base, data, dirty: true, status: `已清空 ${changedCount} 个可见单元格${lockStatus}` };
          })
        }
        onToggleLock={(startRow, startCol, endRow, endCol, locked) =>
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
        onSetZoom={(zoom) => updatePaneTab((current) => ({ ...current, zoom }))}
        onSetFreeze={(rows, cols) =>
          updatePaneTab((current) => ({
            ...current,
            freezeRows: Math.max(0, rows),
            freezeCols: Math.max(0, cols),
            status: rows || cols ? "已设置冻结" : "已取消冻结"
          }))
        }
        onSetColWidth={(col, width) =>
          updatePaneTab((current) => ({ ...current, colWidths: { ...current.colWidths, [col]: width } }))
        }
        onSetColumnFilter={(col, selectedValues) =>
          updatePaneTab((current) => {
            const nextFilters = { ...current.columnFilters };
            if (selectedValues === null) {
              delete nextFilters[col];
            } else {
              nextFilters[col] = [...new Set(selectedValues)];
            }
            const activeCount = Object.keys(nextFilters).length;
            return {
              ...current,
              columnFilters: nextFilters,
              status: selectedValues === null ? "已清除列筛选" : `已筛选 ${activeCount} 列`
            };
          })
        }
        onClearAllFilters={() =>
          updatePaneTab((current) => ({
            ...current,
            columnFilters: {},
            status: "已清除全部筛选"
          }))
        }
        onSetAutoRefresh={(enabled) =>
          updatePaneTab((current) => ({
            ...current,
            autoRefresh: enabled,
            externalChanged: enabled && !current.dirty ? false : current.externalChanged,
            status: enabled ? "已开启自动热刷" : "已暂停自动热刷"
          }))
        }
        onSetFindQuery={(findQuery) => updatePaneTab((current) => ({ ...current, findQuery }))}
        onSetReplaceValue={(replaceValue) => updatePaneTab((current) => ({ ...current, replaceValue }))}
        onSetFindSnapshot={(findSnapshot: CsvFindSnapshot | null) => updatePaneTab((current) => ({ ...current, findSnapshot }))}
        onSetStatus={(status) => updatePaneTab((current) => ({ ...current, status }))}
        onEditDraftDirtyChange={setActiveEditDraftDirty}
        canAddActiveFavorite={!paneFavorite}
        isActiveFavorite={paneFavorite}
        onAddActiveFavorite={() => handleAddFavoriteForTab(tab)}
        onCopyPath={() => void copyPathToClipboard(tab)}
        onReplaceCurrent={(query) =>
          updatePaneTab((current) => {
            const normalizedQuery = query.trim();
            const { focusRow, focusCol } = current.selection;
            if (!normalizedQuery) {
              return current;
            }
            if (current.lockedCells.includes(cellKey(focusRow, focusCol))) {
              return { ...current, status: "当前格已锁定，不能替换" };
            }
            if (!readCell(current.data, focusRow, focusCol).toLowerCase().includes(normalizedQuery.toLowerCase())) {
              return { ...current, status: "当前格没有匹配内容" };
            }
            const base = pushUndo(current);
            return {
              ...base,
              data: replaceCellText(base.data, focusRow, focusCol, normalizedQuery, base.replaceValue),
              dirty: true,
              status: "已替换当前匹配"
            };
          })
        }
        onReplaceFindResults={(results, query) =>
          updatePaneTab((current) => {
            const normalizedQuery = query.trim();
            if (!normalizedQuery || results.length === 0) {
              return current;
            }
            const locked = new Set(current.lockedCells);
            const seen = new Set<string>();
            let data = current.data;
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
              const replacement = replaceAllMatchesInCell(data, result.row, result.col, normalizedQuery, current.replaceValue);
              data = replacement.data;
              count += replacement.count;
            }
            const lockStatus = skippedLocked > 0 ? `，跳过锁定 ${skippedLocked} 格` : "";
            if (count === 0) {
              return { ...current, status: `没有可替换的匹配内容${lockStatus}` };
            }
            const base = pushUndo(current);
            return {
              ...base,
              data,
              dirty: true,
              status: `已替换 ${count} 处${lockStatus}`
            };
          })
        }
        onApplyCellStyle={(startRow, startCol, endRow, endCol, stylePatch) =>
          updatePaneTab((current) => {
            const range = normalizeSelection({ anchorRow: startRow, anchorCol: startCol, focusRow: endRow, focusCol: endCol });
            const result = applyCellStylePatchToRange(
              current.cellStyles,
              range.startRow,
              range.startCol,
              range.endRow,
              range.endCol,
              stylePatch
            );
            if (result.changedCount === 0) {
              return { ...current, status: "颜色没有变化" };
            }
            const base = pushUndo(current);
            return {
              ...base,
              cellStyles: result.styles,
              status: `已设置颜色 ${result.changedCount} 格`
            };
          })
        }
        onApplyCellStyleToCells={(cells, stylePatch) =>
          updatePaneTab((current) => {
            const result = applyCellStylePatchToCells(current.cellStyles, cells, stylePatch);
            if (result.changedCount === 0) {
              return { ...current, status: "颜色没有变化" };
            }
            const base = pushUndo(current);
            return {
              ...base,
              cellStyles: result.styles,
              status: `已设置可见颜色 ${result.changedCount} 格`
            };
          })
        }
        canUndo={tab.undoStack.length > 0}
        canRedo={tab.redoStack.length > 0}
        onUndo={() => updatePaneTab(undoTab)}
        onRedo={() => updatePaneTab(redoTab)}
        onSaveRequest={() => void saveTab(tab.id)}
        onInsertRows={(startRow, endRow) =>
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            if (startRow >= current.data.length) {
              return { ...current, status: "选中行没有已有数据" };
            }
            const clampedEndRow = Math.min(endRow, current.data.length - 1);
            if (hasLockedCellInRows(current.lockedCells, startRow, clampedEndRow)) {
              return { ...current, status: "选中行包含锁定格，不能删除" };
            }
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const targetRows = [...new Set(rows)]
              .filter((row) => Number.isInteger(row) && row >= 0 && row < current.data.length)
              .sort((left, right) => left - right);
            if (targetRows.length === 0) {
              return { ...current, status: "选中行没有已有数据" };
            }
            if (hasLockedCellInRowIndexes(current.lockedCells, targetRows)) {
              return { ...current, status: "可见选中行包含锁定格，不能删除" };
            }
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const width = maxColumnCount(current.data);
            if (startCol >= width) {
              return { ...current, status: "选中列没有已有数据" };
            }
            const clampedEndCol = Math.min(endCol, width - 1);
            if (hasLockedCellInColumns(current.lockedCells, startCol, clampedEndCol)) {
              return { ...current, status: "选中列包含锁定格，不能删除" };
            }
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
          updatePaneTab((current) => {
            const base = pushUndo(current);
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
    );
  };

  const leftPaneTab = tabs.find((tab) => tab.id === (paneTabIds.left ?? activeTabId)) ?? activeTab;
  const rightPaneTab =
    tabs.find((tab) => tab.id === paneTabIds.right) ??
    tabs.find((tab) => tab.id !== leftPaneTab?.id) ??
    leftPaneTab;
  const splitViewActive = splitEnabled && Boolean(leftPaneTab);
  const workspacePaneStyle = splitViewActive
    ? ({
        "--split-left": `${splitRatio}%`,
        "--split-right": `${100 - splitRatio}%`
      } as CSSProperties)
    : undefined;

  const renderWorkspacePane = (paneId: WorkspacePaneId, tab: CsvTab | null | undefined) => {
    const paneActive = activePane === paneId;
    const paneName = paneId === "left" ? "左侧" : "右侧";
    return (
      <section
        className={`workspace-pane ${paneActive ? "active" : ""}`}
        aria-label={`${paneName}分栏`}
        onPointerDownCapture={() => focusPane(paneId)}
        onFocusCapture={() => focusPane(paneId)}
      >
        {splitViewActive ? (
          <div className="pane-header">
            <button
              type="button"
              className={`pane-activation ${paneActive ? "active" : ""}`}
              onClick={() => focusPane(paneId)}
              aria-pressed={paneActive}
            >
              {paneName}
            </button>
            <select
              className="pane-tab-select"
              aria-label={`${paneName}分栏显示的表格`}
              value={tab?.id ?? ""}
              onChange={(event) => {
                if (event.target.value) {
                  activateTabInPane(event.target.value, paneId);
                }
              }}
            >
              {tabs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.dirty ? " *" : ""}
                </option>
              ))}
            </select>
            {paneId === "right" ? (
              <button className="icon-button" onClick={disableSplitView} title="关闭右侧分栏" aria-label="关闭右侧分栏">
                <PanelRightClose size={15} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="pane-body">
          {tab ? renderGridEditor(tab, paneId) : (
            <div className="empty-workspace">
              <FilePrompt />
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div
      className={`app-frame ${sidebarResizing ? "resizing-sidebar" : ""} ${splitResizing ? "resizing-split" : ""}`}
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
        canGlobalSearch={Boolean(root)}
        onFilterChange={setTreeFilter}
        onPickDirectory={handlePickDirectory}
        onSvnCommit={handleSvnCommit}
        onSvnUpdate={handleSvnUpdate}
        onReloadActive={() => activeTabId && runAfterActiveEditCommit(() => void reloadActiveTabAndDirectoryTree(activeTabId))}
        onSaveActive={() => activeTabId && runAfterActiveEditCommit(() => void saveTab(activeTabId))}
        onSaveAll={() => runAfterActiveEditCommit(() => void saveAllDirtyTabs())}
        onOpenGlobalSearch={openGlobalSearch}
        onToggleDirectory={handleToggleDirectory}
        onOpenFile={handleOpenTreeFile}
        onFileContextMenu={handleTreeFileContextMenu}
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
            onContextMenu={handleTabContextMenu}
            onReorder={handleReorderTabs}
          />
          <div className="topbar-view-controls">
            <button
              className={`icon-button split-toggle ${splitEnabled ? "active" : ""}`}
              onClick={splitEnabled ? disableSplitView : enableSplitView}
              disabled={tabs.length === 0}
              title={splitEnabled ? "关闭左右分栏" : "开启左右分栏"}
              aria-label={splitEnabled ? "关闭左右分栏" : "开启左右分栏"}
              aria-pressed={splitEnabled}
            >
              <Columns2 size={16} />
            </button>
          </div>
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

        {splitViewActive ? (
          <div
            className={`workspace-panes split ${splitResizing ? "resizing" : ""}`}
            style={workspacePaneStyle}
          >
            {renderWorkspacePane("left", leftPaneTab)}
            <div
              className="workspace-splitter"
              role="separator"
              aria-label="调整左右分栏比例"
              aria-orientation="vertical"
              aria-valuemin={SPLIT_MIN_RATIO}
              aria-valuemax={SPLIT_MAX_RATIO}
              aria-valuenow={Math.round(splitRatio)}
              tabIndex={0}
              title="拖拽调整左右分栏比例，双击还原"
              onPointerDown={beginSplitResize}
              onDoubleClick={() => setSplitRatio(SPLIT_DEFAULT_RATIO)}
              onKeyDown={handleSplitResizeKeyDown}
            />
            {renderWorkspacePane("right", rightPaneTab)}
          </div>
        ) : activeTab ? (
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
            canAddActiveFavorite={!activeFavorite}
            isActiveFavorite={activeFavorite}
            onAddActiveFavorite={handleAddActiveFavorite}
            onCopyPath={copyActiveTabPath}
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
          onSelect={commitTabSwitcher}
        />
      ) : null}
      {quickOpen ? (
        <QuickOpenOverlay
          query={quickOpen.query}
          candidates={quickOpenCandidates}
          selectedId={quickOpen.selectedId}
          loading={quickOpen.loading}
          onQueryChange={updateQuickOpenQuery}
          onMoveSelection={moveQuickOpenSelection}
          onSelectEdge={selectQuickOpenEdge}
          onOpen={commitQuickOpenCandidate}
          onClose={closeQuickOpen}
        />
      ) : null}
      {globalSearchOpen ? (
        <GlobalSearchOverlay
          query={globalSearchQuery}
          snapshot={globalSearchSnapshot}
          history={globalSearchHistory}
          selectedHistoryId={selectedGlobalSearchHistoryId}
          selectedResultId={selectedGlobalSearchResultId}
          resultsScrollTop={globalSearchSnapshot ? (globalSearchResultScrollTopsRef.current[globalSearchSnapshot.id] ?? 0) : 0}
          searching={globalSearchSearching}
          progress={globalSearchProgress}
          canSearch={Boolean(root)}
          onQueryChange={setGlobalSearchQuery}
          onRunSearch={(query) => runAfterActiveEditCommit(() => void runGlobalSearch(query))}
          onSelectHistory={selectGlobalSearchHistory}
          onDeleteHistory={deleteGlobalSearchHistory}
          onOpenResult={openGlobalSearchResult}
          onResultsScroll={rememberGlobalSearchResultsScroll}
          onClose={closeGlobalSearch}
        />
      ) : null}
      {pathContextMenu ? (
        <div
          className="path-context-menu"
          role="menu"
          aria-label={`${pathContextMenu.name} 操作`}
          style={{ left: pathContextMenu.x, top: pathContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = pathContextMenu;
              setPathContextMenu(null);
              void copyPathToClipboard(target);
            }}
          >
            复制文件路径
          </button>
        </div>
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

function applyOpenFileOptionsToTab(tab: CsvTab, options: OpenFileOptions): CsvTab {
  const selection = options.targetCell
    ? clampSelectionToData(singleCellSelection(options.targetCell.row, options.targetCell.col), tab.data)
    : tab.selection;
  return {
    ...tab,
    selection,
    columnFilters: options.clearFilters ? {} : tab.columnFilters,
    scrollToSelectionToken: options.targetCell ? createSelectionScrollToken() : tab.scrollToSelectionToken,
    status: options.status ?? tab.status
  };
}

function createSelectionScrollToken(): number {
  return Date.now() + Math.random();
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

function resolveGlobalSearchResultFileRef(root: TreeNode | null, result: GlobalSearchResult): CsvFileRef | null {
  const treeNode = root ? findFileNodeByPath(root, result.filePath) : null;
  if (treeNode?.fileRef) {
    return treeNode.fileRef;
  }
  if (isAbsoluteLocalPath(result.filePath)) {
    return makeDesktopFileRef({ kind: "file", name: result.fileName, path: result.filePath });
  }
  return null;
}

function buildSearchableCsvFiles(root: TreeNode, tabs: CsvTab[]): SearchableCsvFile[] {
  const openTabsByPath = new Map(tabs.map((tab) => [tab.path, tab]));
  return collectFileNodes(root).flatMap((node): SearchableCsvFile[] => {
    const fileRef = node.fileRef;
    const filePath = fileRef?.path ?? node.path;
    return [
      {
        name: node.name,
        path: filePath,
        relativePath: makeRelativeSearchPath(root.path, filePath),
        async readData() {
          const openTab = openTabsByPath.get(filePath);
          if (openTab) {
            return openTab.data;
          }
          if (!fileRef) {
            throw new Error("文件引用不可用");
          }
          const opened = await fileRef.read();
          return parseCsvText(opened.text).data;
        }
      }
    ];
  });
}

function collectFileNodes(node: TreeNode): TreeNode[] {
  if (node.kind === "file") {
    return [node];
  }
  return (node.children ?? []).flatMap(collectFileNodes);
}

function makeRelativeSearchPath(rootPath: string, filePath: string): string {
  const normalizedRoot = trimTrailingSlashes(rootPath.replace(/\\/g, "/"));
  const normalizedFile = filePath.replace(/\\/g, "/");
  if (!normalizedRoot) {
    return normalizedFile;
  }
  const lowerRoot = normalizedRoot.toLowerCase();
  const lowerFile = normalizedFile.toLowerCase();
  if (lowerFile === lowerRoot) {
    return pathBaseName(normalizedFile);
  }
  if (lowerFile.startsWith(`${lowerRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return normalizedFile;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function pathBaseName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function isAbsoluteLocalPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}

function loadStoredGlobalSearchHistory(): GlobalSearchSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    return sanitizeGlobalSearchHistory(JSON.parse(window.localStorage.getItem(GLOBAL_SEARCH_HISTORY_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
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

function serializeFavorites(favorites: CsvFavoriteFile[]): string {
  return JSON.stringify(favorites.map((favorite) => [favorite.name, favorite.path, favorite.source]));
}

function mergeFavoriteFiles(primary: CsvFavoriteFile[], secondary: CsvFavoriteFile[]): CsvFavoriteFile[] {
  const merged: CsvFavoriteFile[] = [];
  const seen = new Set<string>();
  for (const favorite of [...primary, ...secondary]) {
    if (seen.has(favorite.path)) {
      continue;
    }
    seen.add(favorite.path);
    merged.push(favorite);
    if (merged.length >= 60) {
      break;
    }
  }
  return merged;
}

function reorderTabsByDrop(tabs: CsvTab[], draggedId: string, targetId: string, placement: TabDropPlacement): CsvTab[] {
  if (draggedId === targetId) {
    return tabs;
  }
  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedId);
  if (draggedIndex < 0) {
    return tabs;
  }
  const draggedTab = tabs[draggedIndex];
  const remainingTabs = tabs.filter((tab) => tab.id !== draggedId);
  const targetIndex = remainingTabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) {
    return tabs;
  }
  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  const nextTabs = [
    ...remainingTabs.slice(0, insertIndex),
    draggedTab,
    ...remainingTabs.slice(insertIndex)
  ];
  return nextTabs.every((tab, index) => tab.id === tabs[index]?.id) ? tabs : nextTabs;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand?.("copy")) {
      throw new Error("当前环境不允许写入剪贴板。");
    }
  } finally {
    textarea.remove();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
