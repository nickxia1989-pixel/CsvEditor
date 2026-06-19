const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const allowedRoots = new Set();

let mainWindow = null;

if (process.env.CSV_EDITOR_SMOKE_TEST === "1" && process.env.CSV_EDITOR_SMOKE_DIR) {
  const smokeUserDataPath = path.join(path.resolve(process.env.CSV_EDITOR_SMOKE_DIR), ".smoke-user-data");
  fsSync.mkdirSync(smokeUserDataPath, { recursive: true });
  app.setPath("userData", smokeUserDataPath);
}

function addAllowedRoot(directoryPath) {
  allowedRoots.add(path.resolve(directoryPath));
}

function isPathInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertAllowedPath(targetPath) {
  const resolved = path.resolve(targetPath);
  for (const root of allowedRoots) {
    if (isPathInsideRoot(resolved, root)) {
      return resolved;
    }
  }
  throw new Error("该路径不在已授权目录内。请先通过“选择目录”授权。");
}

async function getVersion(filePath) {
  const stat = await fs.stat(filePath);
  return {
    lastModified: Math.trunc(stat.mtimeMs),
    size: stat.size
  };
}

function getFavoritesPath() {
  return path.join(app.getPath("userData"), "favorites.json");
}

function getWorkspacePath() {
  return path.join(app.getPath("userData"), "workspace.json");
}

function sanitizeFavorites(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const favorites = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const favoritePath = typeof item.path === "string" ? item.path.trim() : "";
    const source = item.source === "sample" ? "sample" : "local";
    if (!name || !favoritePath || seen.has(favoritePath)) {
      continue;
    }
    seen.add(favoritePath);
    favorites.push({ name, path: favoritePath, source });
  }
  return favorites.slice(0, 60);
}

function authorizeFavoriteRoots(favorites) {
  for (const favorite of favorites) {
    if (favorite.source !== "local" || !path.isAbsolute(favorite.path)) {
      continue;
    }
    addAllowedRoot(path.dirname(favorite.path));
  }
}

async function readFavorites() {
  try {
    const text = await fs.readFile(getFavoritesPath(), "utf8");
    const favorites = sanitizeFavorites(JSON.parse(text));
    authorizeFavoriteRoots(favorites);
    return favorites;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeFavorites(favorites) {
  const sanitized = sanitizeFavorites(favorites);
  await fs.mkdir(path.dirname(getFavoritesPath()), { recursive: true });
  await fs.writeFile(getFavoritesPath(), `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  authorizeFavoriteRoots(sanitized);
  return sanitized;
}

function sanitizeWorkspace(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawDirectory = value.directory;
  if (!rawDirectory || typeof rawDirectory !== "object") {
    return null;
  }
  const directoryPath = typeof rawDirectory.path === "string" ? rawDirectory.path.trim() : "";
  if (!directoryPath || !path.isAbsolute(directoryPath)) {
    return null;
  }
  const directory = {
    name: typeof rawDirectory.name === "string" && rawDirectory.name.trim() ? rawDirectory.name.trim() : path.basename(directoryPath),
    path: path.resolve(directoryPath),
    source: "local"
  };

  const seen = new Set();
  const openFiles = [];
  if (Array.isArray(value.openFiles)) {
    for (const item of value.openFiles) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const filePath = typeof item.path === "string" ? item.path.trim() : "";
      if (!filePath || !path.isAbsolute(filePath)) {
        continue;
      }
      const resolvedFilePath = path.resolve(filePath);
      if (
        seen.has(resolvedFilePath) ||
        !isPathInsideRoot(resolvedFilePath, directory.path) ||
        !resolvedFilePath.toLowerCase().endsWith(".csv")
      ) {
        continue;
      }
      seen.add(resolvedFilePath);
      openFiles.push({
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : path.basename(resolvedFilePath),
        path: resolvedFilePath,
        source: "local"
      });
    }
  }

  const activeFilePath =
    typeof value.activeFilePath === "string" && openFiles.some((file) => file.path === path.resolve(value.activeFilePath))
      ? path.resolve(value.activeFilePath)
      : null;

  return {
    directory,
    openFiles,
    activeFilePath
  };
}

async function readWorkspace() {
  try {
    const text = await fs.readFile(getWorkspacePath(), "utf8");
    const workspace = sanitizeWorkspace(JSON.parse(text));
    if (!workspace) {
      return null;
    }

    const directoryStat = await fs.stat(workspace.directory.path);
    if (!directoryStat.isDirectory()) {
      return null;
    }
    addAllowedRoot(workspace.directory.path);

    const openFiles = [];
    for (const file of workspace.openFiles) {
      try {
        const fileStat = await fs.stat(file.path);
        if (fileStat.isFile()) {
          openFiles.push(file);
        }
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    return {
      ...workspace,
      openFiles,
      activeFilePath: openFiles.some((file) => file.path === workspace.activeFilePath) ? workspace.activeFilePath : null
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeWorkspace(workspace) {
  if (!workspace) {
    await fs.rm(getWorkspacePath(), { force: true });
    return null;
  }

  const sanitized = sanitizeWorkspace(workspace);
  if (!sanitized) {
    await fs.rm(getWorkspacePath(), { force: true });
    return null;
  }

  addAllowedRoot(sanitized.directory.path);
  await fs.mkdir(path.dirname(getWorkspacePath()), { recursive: true });
  await fs.writeFile(getWorkspacePath(), `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return sanitized;
}

function toWriteBuffer(data) {
  if (typeof data === "string") {
    return Buffer.from(data, "utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  throw new Error("不支持的写入数据类型。");
}

async function listDirectory(directoryPath) {
  const resolved = assertAllowedPath(directoryPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")))
    .map((entry) => ({
      kind: entry.isDirectory() ? "directory" : "file",
      name: entry.name,
      path: path.join(resolved, entry.name)
    }));
}

async function readFile(filePath) {
  const resolved = assertAllowedPath(filePath);
  const data = await fs.readFile(resolved);
  return {
    data,
    version: await getVersion(resolved)
  };
}

async function writeFile(filePath, data) {
  const resolved = assertAllowedPath(filePath);
  await fs.writeFile(resolved, toWriteBuffer(data));
  return getVersion(resolved);
}

function getTortoiseProcCandidates() {
  return [
    process.env.TORTOISEPROC,
    process.env.TSVN_PROC,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "TortoiseSVN", "bin", "TortoiseProc.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "TortoiseSVN", "bin", "TortoiseProc.exe") : "",
    process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "TortoiseSVN", "bin", "TortoiseProc.exe") : "",
    "TortoiseProc.exe"
  ].filter(Boolean);
}

function resolveTortoiseProc() {
  const candidates = getTortoiseProcCandidates();
  return candidates.find((candidate) => candidate === "TortoiseProc.exe" || fsSync.existsSync(candidate));
}

async function openTortoiseSvnCommand(command, directoryPath) {
  if (process.platform !== "win32") {
    throw new Error("SVN GUI 操作目前只支持 Windows 桌面环境。");
  }

  const resolved = assertAllowedPath(directoryPath);
  const stat = fsSync.statSync(resolved);
  const targetPath = stat.isDirectory() ? resolved : path.dirname(resolved);
  const tortoiseProc = resolveTortoiseProc();
  if (!tortoiseProc) {
    throw new Error("未找到 TortoiseSVN 的 TortoiseProc.exe。");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(tortoiseProc, [`/command:${command}`, `/path:${targetPath}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openSvnCommit(directoryPath) {
  return openTortoiseSvnCommand("commit", directoryPath);
}

async function openSvnUpdate(directoryPath) {
  return openTortoiseSvnCommand("update", directoryPath);
}

function getIndexPath() {
  return path.join(__dirname, "..", "dist", "index.html");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    title: "CSV Workspace Editor",
    backgroundColor: "#eef2f3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.removeMenu();
  for (const eventName of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) {
    mainWindow.on(eventName, () => emitWindowState(mainWindow));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.CSV_EDITOR_SMOKE_TEST === "1") {
    void runSmokeTestWhenLoaded(mainWindow);
  }

  const devUrl = process.env.CSV_EDITOR_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(getIndexPath());
  }
}

function getWindowState(window) {
  return {
    maximized: Boolean(window?.isMaximized()),
    fullscreen: Boolean(window?.isFullScreen())
  };
}

function emitWindowState(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send("csv:window-state", getWindowState(window));
}

function getSenderWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error("窗口不可用。");
  }
  return window;
}

async function runSmokeTestWhenLoaded(window) {
  const smokeDir = process.env.CSV_EDITOR_SMOKE_DIR;
  const resultPath = process.env.CSV_EDITOR_SMOKE_RESULT;
  if (!smokeDir) {
    app.exit(1);
    return;
  }
  addAllowedRoot(smokeDir);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("桌面版页面加载超时。")), 20000);
      window.webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
      window.webContents.once("did-fail-load", (_event, _code, description) => {
        clearTimeout(timeout);
        reject(new Error(description));
      });
    });

    const result = await window.webContents.executeJavaScript(
      `
      (async () => {
        const waitFor = async (predicate, label, timeoutMs = 10000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (await predicate()) {
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(label + ": " + (document.querySelector(".grid-status")?.textContent ?? ""));
        };
        const findButton = (text) =>
          Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
        const clickElement = (element) => {
          element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
        };
        const pointerDownElement = (element, options = {}) => {
          const EventClass = window.PointerEvent || window.MouseEvent;
          element.dispatchEvent(new EventClass("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 1,
            ...options
          }));
        };
        const pointerMoveElement = (element, options = {}) => {
          const EventClass = window.PointerEvent || window.MouseEvent;
          element.dispatchEvent(new EventClass("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            ...options
          }));
        };
        const pointerEnterElement = (element, options = {}) => {
          const EventClass = window.PointerEvent || window.MouseEvent;
          element.dispatchEvent(new EventClass("pointerover", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            ...options
          }));
          element.dispatchEvent(new EventClass("pointerenter", {
            bubbles: false,
            cancelable: false,
            pointerId: 1,
            ...options
          }));
        };
        const elementCenter = (element) => {
          const rect = element.getBoundingClientRect();
          return {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          };
        };
        const pointerUpWindow = async (options = {}) => {
          const EventClass = window.PointerEvent || window.MouseEvent;
          const dispatch = () => {
            window.dispatchEvent(new EventClass("pointerup", {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              ...options
            }));
          };
          dispatch();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          dispatch();
        };
        const setTextAreaValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          setter.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const setInputValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const toggleFindPanel = () => {
          window.dispatchEvent(new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "f",
            ctrlKey: true
          }));
        };
        const openQuickFilePicker = () => {
          window.dispatchEvent(new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "p",
            ctrlKey: true
          }));
        };
        const api = window.csvDesktop;
        if (!api) {
          throw new Error("csvDesktop preload API missing");
        }
        const directoryPath = ${JSON.stringify(path.resolve(smokeDir))};
        const entries = await api.listDirectory(directoryPath);
        const target = entries.find((entry) => entry.name === "smoke.csv");
        if (!target) {
          throw new Error("smoke.csv not listed");
        }
        const opened = await api.readFile(target.path);
        const initialText = new TextDecoder("utf-8", { ignoreBOM: false }).decode(opened.data);
        await api.writeFile(target.path, new TextEncoder().encode("\\uFEFFA,B\\r\\n3,4\\r\\n5,other\\r\\n6,4\\r\\n"));
        const saved = await api.readFile(target.path);
        const savedText = new TextDecoder("utf-8", { ignoreBOM: false }).decode(saved.data);
        const pickButton = findButton("选择目录");
        if (!pickButton) {
          throw new Error("选择目录按钮不存在");
        }
        clickElement(pickButton);
        await waitFor(
          () => Array.from(document.querySelectorAll(".tree-row.file")).some((row) => row.textContent?.includes("smoke.csv")),
          "smoke.csv UI row missing"
        );
        const fileRow = Array.from(document.querySelectorAll(".tree-row.file")).find((row) => row.textContent?.includes("smoke.csv"));
        clickElement(fileRow);
        await waitFor(() => document.querySelector(".grid-cell[aria-label='A1']") && document.querySelector(".formula-bar textarea"), "grid UI missing");
        const favoritesBefore = api.getFavorites ? await api.getFavorites() : [];
        let favoriteListed = false;
        let favoritePersisted = false;
        let favoriteButtonDisabledAfterAdd = false;
        try {
          const addFavoriteButton = findButton("加入收藏");
          if (!addFavoriteButton || addFavoriteButton.disabled) {
            throw new Error("add favorite button missing or disabled");
          }
          addFavoriteButton.click();
          await waitFor(
            () => Array.from(document.querySelectorAll(".favorite-row")).some((row) => row.textContent?.includes("smoke.csv")),
            "favorite row missing"
          );
          favoriteListed = Array.from(document.querySelectorAll(".favorite-row")).some((row) => row.textContent?.includes("smoke.csv"));
          let lastSavedFavorites = [];
          try {
            await waitFor(
              async () => {
                lastSavedFavorites = api.getFavorites ? await api.getFavorites() : [];
                favoritePersisted = lastSavedFavorites.some((favorite) => favorite.path === target.path && favorite.name === "smoke.csv");
                return favoritePersisted;
              },
              "favorite did not persist"
            );
          } catch (error) {
            throw new Error((error instanceof Error ? error.message : String(error)) + "; saved=" + JSON.stringify(lastSavedFavorites));
          }
          await waitFor(() => findButton("加入收藏")?.disabled, "add favorite button did not become disabled");
          favoriteButtonDisabledAfterAdd = Boolean(findButton("加入收藏")?.disabled);
          const favoriteRow = Array.from(document.querySelectorAll(".favorite-row")).find((row) => row.textContent?.includes("smoke.csv"));
          clickElement(favoriteRow);
          await waitFor(
            () => Array.from(document.querySelectorAll("[role='tab']")).some((tab) => tab.textContent?.includes("smoke.csv")),
            "favorite did not open the smoke tab"
          );
        } finally {
          if (api.setFavorites) {
            await api.setFavorites(favoritesBefore);
          }
        }
        const workspaceStatusRemoved = !document.querySelector(".workspace-status");
        const tools = document.querySelector(".grid-tools");
        const formulaBar = document.querySelector(".formula-bar");
        const detailEditor = document.querySelector(".formula-bar textarea");
        const toolsRect = tools?.getBoundingClientRect();
        const formulaRect = formulaBar?.getBoundingClientRect();
        const detailStyle = detailEditor ? getComputedStyle(detailEditor) : null;
        const detailHeightBefore = detailEditor ? Math.round(detailEditor.getBoundingClientRect().height) : 0;
        if (detailEditor) {
          detailEditor.style.height = "118px";
        }
        const detailHeightAfter = detailEditor ? Math.round(detailEditor.getBoundingClientRect().height) : 0;
        const cellA1 = document.querySelector(".grid-cell[aria-label='A1']");
        const cellB2 = document.querySelector(".grid-cell[aria-label='B2']");
        pointerDownElement(cellA1, elementCenter(cellA1));
        await waitFor(
          () =>
            document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "A1" &&
            document.querySelector(".grid-status")?.textContent?.includes("选区 1 x 1"),
          "single selection not reflected"
        );
        await pointerUpWindow(elementCenter(cellA1));
        pointerDownElement(cellB2, { ...elementCenter(cellB2), shiftKey: true });
        await waitFor(
          () =>
            document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "B2" &&
            document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 2"),
          "shift selection not reflected"
        );
        await pointerUpWindow(elementCenter(cellB2));
        const filterButton = document.querySelector("button[aria-label='筛选 B 列']");
        if (!filterButton) {
          throw new Error("column filter button missing");
        }
        clickElement(filterButton);
        await waitFor(() => document.querySelector(".column-filter-popover"), "filter popover missing");
        const selectAllFilterInput = document.querySelector("input[aria-label='全选']");
        if (!selectAllFilterInput) {
          throw new Error("filter select-all input missing");
        }
        clickElement(selectAllFilterInput);
        const applyFilterButton = Array.from(document.querySelectorAll(".column-filter-actions button")).find(
          (button) => button.textContent?.trim() === "确定"
        );
        if (!applyFilterButton) {
          throw new Error("filter apply button missing");
        }
        clickElement(applyFilterButton);
        await waitFor(
          () =>
            document.querySelector(".grid-cell[aria-label='A2']") &&
            !document.querySelector(".grid-cell[aria-label='A3']") &&
            !document.querySelector(".grid-cell[aria-label='A4']") &&
            document.querySelector(".grid-status")?.textContent?.includes("筛选显示 1 行"),
          "filter did not keep only ignored data row"
        );
        clickElement(filterButton);
        await waitFor(() => document.querySelector(".column-filter-popover"), "filter popover missing after active filter");
        const clearFilterButton = Array.from(document.querySelectorAll(".column-filter-actions button")).find(
          (button) => button.textContent?.trim() === "清除筛选"
        );
        if (!clearFilterButton || clearFilterButton.disabled) {
          throw new Error("clear filter button missing or disabled");
        }
        clickElement(clearFilterButton);
        await waitFor(
          () => document.querySelector(".grid-cell[aria-label='A2']") && !document.querySelector(".column-filter-popover"),
          "filter did not restore data row"
        );
        clickElement(filterButton);
        await waitFor(() => document.querySelector(".column-filter-popover"), "filter popover missing before search filter");
        const filterSearchInput = document.querySelector("input[aria-label='搜索筛选值']");
        if (!filterSearchInput) {
          throw new Error("filter search input missing");
        }
        setInputValue(filterSearchInput, "4");
        await waitFor(
          () => document.querySelector("input[aria-label='全选搜索结果']"),
          "filter search select-all label missing"
        );
        const searchApplyFilterButton = Array.from(document.querySelectorAll(".column-filter-actions button")).find(
          (button) => button.textContent?.trim() === "确定"
        );
        if (!searchApplyFilterButton || searchApplyFilterButton.disabled) {
          throw new Error("filter search apply button missing or disabled");
        }
        clickElement(searchApplyFilterButton);
        await waitFor(
          () =>
            document.querySelector(".grid-cell[aria-label='A2']") &&
            !document.querySelector(".grid-cell[aria-label='A3']") &&
            document.querySelector(".grid-cell[aria-label='A4']") &&
            document.querySelector(".grid-status")?.textContent?.includes("筛选显示 2 行"),
          "filter search did not keep only matching rows"
        );
        const filterSearchStatus = document.querySelector(".grid-status")?.textContent ?? "";
        const filterSearchMatchedOnly = Boolean(
          document.querySelector(".grid-cell[aria-label='A2']") &&
            !document.querySelector(".grid-cell[aria-label='A3']") &&
            document.querySelector(".grid-cell[aria-label='A4']")
        );
        clickElement(filterButton);
        await waitFor(() => document.querySelector(".column-filter-popover"), "filter popover missing after search filter");
        const clearSearchFilterButton = Array.from(document.querySelectorAll(".column-filter-actions button")).find(
          (button) => button.textContent?.trim() === "清除筛选"
        );
        if (!clearSearchFilterButton || clearSearchFilterButton.disabled) {
          throw new Error("search clear filter button missing or disabled");
        }
        clickElement(clearSearchFilterButton);
        await waitFor(
          () =>
            document.querySelector(".grid-cell[aria-label='A2']") &&
            document.querySelector(".grid-cell[aria-label='A3']") &&
            document.querySelector(".grid-cell[aria-label='A4']") &&
            !document.querySelector(".column-filter-popover"),
          "search filter did not restore all data rows"
        );
        const restoredCellA1 = document.querySelector(".grid-cell[aria-label='A1']");
        const restoredCellB2 = document.querySelector(".grid-cell[aria-label='B2']");
        pointerDownElement(restoredCellA1, elementCenter(restoredCellA1));
        await waitFor(
          () =>
            document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "A1" &&
            document.querySelector(".grid-status")?.textContent?.includes("选区 1 x 1"),
          "single selection not restored"
        );
        await pointerUpWindow(elementCenter(restoredCellA1));
        pointerDownElement(restoredCellB2, { ...elementCenter(restoredCellB2), shiftKey: true });
        await waitFor(
          () =>
            document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "B2" &&
            document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 2"),
          "shift selection not restored"
        );
        await pointerUpWindow(elementCenter(restoredCellB2));
        toggleFindPanel();
        await waitFor(() => document.querySelector(".find-side-panel"), "find side panel did not open");
        const findPanel = document.querySelector(".find-side-panel");
        const findInput = document.querySelector("input[aria-label='查找内容']");
        const runFindButton = Array.from(document.querySelectorAll(".find-side-panel button")).find(
          (button) => button.textContent?.trim() === "查找"
        );
        if (!findPanel || !findInput || !runFindButton) {
          throw new Error("find side panel controls missing");
        }
        setInputValue(findInput, "3");
        clickElement(runFindButton);
        await waitFor(
          () =>
            document.querySelector(".find-results-summary")?.textContent?.includes("1 项") &&
            document.querySelector(".find-results-summary")?.textContent?.includes("选区 A1:B2") &&
            Array.from(document.querySelectorAll(".find-result")).some((button) => button.textContent?.includes("A2")),
          "find side panel did not show selected-range result"
        );
        const findPanelRect = findPanel.getBoundingClientRect();
        const gridViewportRect = document.querySelector(".grid-viewport")?.getBoundingClientRect();
        const resultA2 = Array.from(document.querySelectorAll(".find-result")).find((button) => button.textContent?.includes("A2"));
        if (!gridViewportRect || !resultA2 || findPanelRect.left <= gridViewportRect.left) {
          throw new Error("find side panel layout invalid");
        }
        clickElement(resultA2);
        await waitFor(
          () => document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "A2",
          "find result click did not jump to cell"
        );
        const findResultJumped = document.querySelector(".grid-cell.focus")?.getAttribute("aria-label") === "A2";
        const findSummaryText = document.querySelector(".find-results-summary")?.textContent ?? "";
        toggleFindPanel();
        await waitFor(() => !document.querySelector(".find-side-panel"), "find side panel did not close");
        openQuickFilePicker();
        await waitFor(() => document.querySelector(".quick-open-panel"), "quick file picker did not open");
        const quickOpenInput = document.querySelector("input[aria-label='快速打开文件']");
        if (!quickOpenInput) {
          throw new Error("quick file picker input missing");
        }
        setInputValue(quickOpenInput, "smoke-tab");
        await waitFor(
          () => Array.from(document.querySelectorAll(".quick-open-option")).some((option) => option.textContent?.includes("smoke-tab-07.csv")),
          "quick file picker result missing"
        );
        const quickHoverTarget = Array.from(document.querySelectorAll(".quick-open-option")).find((option) =>
          option.textContent?.includes("smoke-tab-07.csv")
        );
        if (!quickHoverTarget) {
          throw new Error("quick file picker hover target missing");
        }
        const quickHoverInitiallySelected = quickHoverTarget.classList.contains("selected");
        quickHoverTarget.dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: quickHoverTarget.getBoundingClientRect().left + 10,
          clientY: quickHoverTarget.getBoundingClientRect().top + 10
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const quickOpenHoverDidNotSelect = !quickHoverInitiallySelected && !quickHoverTarget.classList.contains("selected");
        quickHoverTarget.click();
        await waitFor(
          () => Array.from(document.querySelectorAll("[role='tab']")).some((tab) => tab.getAttribute("aria-selected") === "true" && tab.textContent?.includes("smoke-tab-07.csv")),
          "quick file picker did not open clicked file"
        );
        const quickOpenOpened = Array.from(document.querySelectorAll("[role='tab']")).some(
          (tab) => tab.getAttribute("aria-selected") === "true" && tab.textContent?.includes("smoke-tab-07.csv")
        );
        const quickOpenClosed = !document.querySelector(".quick-open-panel");
        const columnHeaderB = document.querySelector("[role='columnheader'][aria-label='Column B']");
        const columnHeaderD = document.querySelector("[role='columnheader'][aria-label='Column D']");
        if (!columnHeaderB || !columnHeaderD) {
          throw new Error("column drag headers missing");
        }
        pointerDownElement(columnHeaderB, elementCenter(columnHeaderB));
        pointerMoveElement(columnHeaderD, elementCenter(columnHeaderD));
        pointerEnterElement(columnHeaderD, elementCenter(columnHeaderD));
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 3"), "column header drag selection not reflected");
        const columnHeaderDragStatus = document.querySelector(".grid-status")?.textContent ?? "";
        await pointerUpWindow();
        const rowHeader1 = document.querySelector("[role='rowheader'][aria-label='Row 1']");
        const rowHeader2 = document.querySelector("[role='rowheader'][aria-label='Row 2']");
        if (!rowHeader1 || !rowHeader2) {
          throw new Error("row drag headers missing");
        }
        pointerDownElement(rowHeader1, elementCenter(rowHeader1));
        pointerMoveElement(rowHeader2, elementCenter(rowHeader2));
        pointerEnterElement(rowHeader2, elementCenter(rowHeader2));
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 2"), "row header drag selection not reflected");
        const rowHeaderDragStatus = document.querySelector(".grid-status")?.textContent ?? "";
        await pointerUpWindow();
        setTextAreaValue(detailEditor, "多行\\n详情\\n编辑");
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("未保存 1"), "detail textarea edit not reflected");
        const gridStatusText = document.querySelector(".grid-status")?.textContent ?? "";
        const extraEntries = entries.filter((entry) => entry.name.startsWith("smoke-tab-"));
        for (const entry of extraEntries) {
          const row = Array.from(document.querySelectorAll(".tree-row.file")).find((item) => item.textContent?.includes(entry.name));
          if (!row) {
            throw new Error("extra smoke tab row missing: " + entry.name);
          }
          clickElement(row);
          await waitFor(
            () => Array.from(document.querySelectorAll("[role='tab']")).some((tab) => tab.textContent?.includes(entry.name)),
            "extra smoke tab not opened: " + entry.name
          );
        }
        const buttons = Array.from(document.querySelectorAll("button")).map((button) => ({
          text: button.textContent?.trim() ?? "",
          disabled: button.disabled
        }));
        const windowControls = Array.from(document.querySelectorAll(".window-control")).map((button) => ({
          label: button.getAttribute("aria-label"),
          title: button.getAttribute("title")
        }));
        const topbar = document.querySelector(".topbar");
        const paneTitle = document.querySelector(".pane-title");
        const topbarActions = document.querySelector(".topbar-actions");
        const fileActions = document.querySelector(".file-actions");
        const tabStrip = document.querySelector(".tab-strip");
        const firstTab = document.querySelector(".tab");
        const firstTabName = document.querySelector(".tab-name");
        const firstTabStyle = firstTab ? getComputedStyle(firstTab) : null;
        const firstTabNameStyle = firstTabName ? getComputedStyle(firstTabName) : null;
        let tabStripWheelLeftAfter = 0;
        if (tabStrip) {
          tabStrip.scrollLeft = 0;
          tabStrip.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 180 }));
          tabStripWheelLeftAfter = Math.round(tabStrip.scrollLeft);
          tabStrip.scrollLeft = tabStrip.scrollWidth;
        }
        const windowControlsRect = document.querySelector(".window-controls")?.getBoundingClientRect();
        const topbarRect = topbar?.getBoundingClientRect();
        const windowState = await api.getWindowState?.();
        return {
          title: document.title,
          entries: entries.length,
          initialText,
          savedText,
          favorites: {
            listed: favoriteListed,
            persisted: favoritePersisted,
            addButtonDisabled: favoriteButtonDisabledAfterAdd
          },
          buttons,
          windowControls,
          windowState,
          regions: {
            topbar: topbar ? getComputedStyle(topbar).webkitAppRegion : "",
            paneTitle: paneTitle ? getComputedStyle(paneTitle).webkitAppRegion : "",
            topbarActions: topbarActions ? getComputedStyle(topbarActions).webkitAppRegion : "",
            fileActions: fileActions ? getComputedStyle(fileActions).webkitAppRegion : "",
            tabStrip: tabStrip ? getComputedStyle(tabStrip).webkitAppRegion : ""
          },
          layout: {
            topbarHeight: topbarRect ? Math.round(topbarRect.height) : 0,
            windowControlsWidth: windowControlsRect ? Math.round(windowControlsRect.width) : 0,
            hasTopbarActions: Boolean(topbarActions),
            tabCount: document.querySelectorAll("[role='tab']").length,
            tabStripClientWidth: tabStrip ? Math.round(tabStrip.clientWidth) : 0,
            tabStripScrollWidth: tabStrip ? Math.round(tabStrip.scrollWidth) : 0,
            tabStripClientHeight: tabStrip ? Math.round(tabStrip.clientHeight) : 0,
            tabStripScrollHeight: tabStrip ? Math.round(tabStrip.scrollHeight) : 0,
            tabStripWheelLeftAfter,
            tabStripScrollLeftAfter: tabStrip ? Math.round(tabStrip.scrollLeft) : 0,
            tabFlexShrink: firstTabStyle?.flexShrink ?? "",
            tabMaxWidth: firstTabStyle?.maxWidth ?? "",
            tabNameOverflow: firstTabNameStyle?.overflow ?? "",
            tabNameTextOverflow: firstTabNameStyle?.textOverflow ?? "",
            toolsAboveFormula: Boolean(toolsRect && formulaRect && toolsRect.top < formulaRect.top),
            detailEditorTag: detailEditor?.tagName ?? "",
            detailEditorResize: detailStyle?.resize ?? "",
            detailHeightBefore,
            detailHeightAfter,
            workspaceStatusRemoved,
            gridStatusText
          },
          headerDrag: {
            column: columnHeaderDragStatus,
            row: rowHeaderDragStatus
          },
          search: {
            summary: findSummaryText,
            resultJumped: findResultJumped,
            panelClosed: !document.querySelector(".find-side-panel")
          },
          filter: {
            searchStatus: filterSearchStatus,
            searchMatchedOnly: filterSearchMatchedOnly
          },
          quickOpen: {
            hoverDidNotSelect: quickOpenHoverDidNotSelect,
            opened: quickOpenOpened,
            closed: quickOpenClosed
          },
          savedVersion: saved.version
        };
      })();
      `,
      true
    );

    if (!result.title.includes("CSV Workspace Editor")) {
      throw new Error(`页面标题异常: ${result.title}`);
    }
    if (!result.initialText.includes("A,B") || !result.savedText.includes("3,4")) {
      throw new Error("桌面读写烟测内容不正确。");
    }
    const buttonTexts = result.buttons.map((button) => button.text);
    if (
      buttonTexts.includes("样例") ||
      !buttonTexts.includes("SVN更新") ||
      !buttonTexts.includes("SVN提交") ||
      !buttonTexts.includes("刷新") ||
      !buttonTexts.includes("保存") ||
      !buttonTexts.includes("全部保存") ||
      !buttonTexts.includes("加入收藏")
    ) {
      throw new Error("桌面左侧操作按钮烟测不正确。");
    }
    if (!result.favorites?.listed || !result.favorites.persisted || !result.favorites.addButtonDisabled) {
      throw new Error("桌面收藏功能烟测不正确。");
    }
    const windowControlLabels = result.windowControls.map((control) => control.label);
    if (!windowControlLabels.includes("最小化") || !windowControlLabels.includes("最大化") || !windowControlLabels.includes("关闭")) {
      throw new Error("桌面沉浸式窗口控制按钮烟测不正确。");
    }
    if (
      !result.windowState ||
      result.regions.topbar !== "drag" ||
      result.regions.paneTitle !== "drag" ||
      result.regions.fileActions !== "no-drag" ||
      result.regions.tabStrip !== "no-drag" ||
      result.regions.topbarActions !== ""
    ) {
      throw new Error("桌面沉浸式拖拽区域烟测不正确。");
    }
    if (result.layout.topbarHeight <= 0 || result.layout.windowControlsWidth < 120) {
      throw new Error("桌面沉浸式布局烟测不正确。");
    }
    if (
      result.layout.hasTopbarActions ||
      result.layout.tabCount < 8 ||
      result.layout.tabStripScrollWidth > result.layout.tabStripClientWidth ||
      result.layout.tabStripScrollHeight < 60 ||
      result.layout.tabStripClientHeight < result.layout.tabStripScrollHeight ||
      result.layout.tabStripWheelLeftAfter !== 0 ||
      result.layout.tabStripScrollLeftAfter !== 0 ||
      result.layout.tabFlexShrink !== "0" ||
      result.layout.tabMaxWidth === "none" ||
      result.layout.tabNameOverflow !== "hidden" ||
      result.layout.tabNameTextOverflow !== "ellipsis"
    ) {
      throw new Error("桌面多页签换行布局烟测不正确。");
    }
    if (
      !result.layout.workspaceStatusRemoved ||
      !result.layout.toolsAboveFormula ||
      result.layout.detailEditorTag !== "TEXTAREA" ||
      result.layout.detailEditorResize !== "vertical" ||
      result.layout.detailHeightAfter <= result.layout.detailHeightBefore ||
      !result.layout.gridStatusText.includes("未保存 1") ||
      !result.layout.gridStatusText.includes("选区 2 x 2") ||
      !result.layout.gridStatusText.includes("UTF-8")
    ) {
      throw new Error("桌面编辑区布局或 Shift 选区烟测不正确。");
    }
    if (!result.headerDrag?.column.includes("选区 2 x 3") || !result.headerDrag?.row.includes("选区 2 x 2")) {
      throw new Error("桌面行列头拖选烟测不正确。");
    }
    if (
      !result.search?.summary.includes("1 项") ||
      !result.search.summary.includes("选区 A1:B2") ||
      !result.search.resultJumped ||
      !result.search.panelClosed
    ) {
      throw new Error(`桌面查找侧栏烟测不正确: ${JSON.stringify(result.search)}`);
    }
    if (!result.filter?.searchMatchedOnly || !result.filter.searchStatus.includes("筛选显示 2 行")) {
      throw new Error(`桌面搜索筛选烟测不正确: ${JSON.stringify(result.filter)}`);
    }
    if (!result.quickOpen?.hoverDidNotSelect || !result.quickOpen.opened || !result.quickOpen.closed) {
      throw new Error(`桌面快速打开烟测不正确: ${JSON.stringify(result.quickOpen)}`);
    }
    if (resultPath) {
      fsSync.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    }
    app.exit(0);
  } catch (error) {
    if (resultPath) {
      fsSync.writeFileSync(
        resultPath,
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
        "utf8"
      );
    }
    app.exit(1);
  }
}

ipcMain.handle("csv:pick-directory", async () => {
  if (process.env.CSV_EDITOR_SMOKE_TEST === "1" && process.env.CSV_EDITOR_SMOKE_DIR) {
    const directoryPath = path.resolve(process.env.CSV_EDITOR_SMOKE_DIR);
    addAllowedRoot(directoryPath);
    return {
      source: "desktop",
      kind: "directory",
      name: path.basename(directoryPath),
      path: directoryPath
    };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 CSV 表格目录",
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    throw new Error("已取消选择目录。");
  }

  const directoryPath = path.resolve(result.filePaths[0]);
  addAllowedRoot(directoryPath);
  return {
    source: "desktop",
    kind: "directory",
    name: path.basename(directoryPath),
    path: directoryPath
  };
});

ipcMain.handle("csv:list-directory", (_event, directoryPath) => listDirectory(directoryPath));
ipcMain.handle("csv:read-file", (_event, filePath) => readFile(filePath));
ipcMain.handle("csv:write-file", (_event, filePath, data) => writeFile(filePath, data));
ipcMain.handle("csv:get-version", (_event, filePath) => getVersion(assertAllowedPath(filePath)));
ipcMain.handle("csv:open-svn-commit", (_event, directoryPath) => openSvnCommit(directoryPath));
ipcMain.handle("csv:open-svn-update", (_event, directoryPath) => openSvnUpdate(directoryPath));
ipcMain.handle("csv:window-get-state", (event) => getWindowState(getSenderWindow(event)));
ipcMain.handle("csv:window-minimize", (event) => {
  getSenderWindow(event).minimize();
});
ipcMain.handle("csv:window-toggle-maximize", (event) => {
  const window = getSenderWindow(event);
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
  return getWindowState(window);
});
ipcMain.handle("csv:window-close", (event) => {
  getSenderWindow(event).close();
});
ipcMain.handle("csv:favorites-get", () => readFavorites());
ipcMain.handle("csv:favorites-set", (_event, favorites) => writeFavorites(favorites));
ipcMain.handle("csv:workspace-get", () => readWorkspace());
ipcMain.handle("csv:workspace-set", (_event, workspace) => writeWorkspace(workspace));

if (process.env.CSV_EDITOR_ALLOWED_ROOTS) {
  for (const root of process.env.CSV_EDITOR_ALLOWED_ROOTS.split(path.delimiter)) {
    if (root.trim()) {
      addAllowedRoot(root.trim());
    }
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
