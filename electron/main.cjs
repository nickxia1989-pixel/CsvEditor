const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const allowedRoots = new Set();

let mainWindow = null;

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
            if (predicate()) {
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(label);
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
        const setTextAreaValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          setter.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
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
        await api.writeFile(target.path, new TextEncoder().encode("\\uFEFFA,B\\r\\n3,4\\r\\n"));
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
        pointerDownElement(cellA1);
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 1 x 1"), "single selection not reflected");
        pointerDownElement(cellB2, { shiftKey: true });
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 2"), "shift selection not reflected");
        const filterButton = document.querySelector("button[aria-label='筛选 B 列']");
        if (!filterButton) {
          throw new Error("column filter button missing");
        }
        clickElement(filterButton);
        await waitFor(() => document.querySelector(".column-filter-popover"), "filter popover missing");
        const selectAllFilterInput = document.querySelector("input[aria-label='全选当前筛选值']");
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
            !document.querySelector(".grid-cell[aria-label='A2']") &&
            document.querySelector(".grid-status")?.textContent?.includes("筛选显示 0 行"),
          "filter did not hide data row"
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
        await waitFor(() => document.querySelector(".grid-cell[aria-label='A2']"), "filter did not restore data row");
        const restoredCellA1 = document.querySelector(".grid-cell[aria-label='A1']");
        const restoredCellB2 = document.querySelector(".grid-cell[aria-label='B2']");
        pointerDownElement(restoredCellA1);
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 1 x 1"), "single selection not restored");
        pointerDownElement(restoredCellB2, { shiftKey: true });
        await waitFor(() => document.querySelector(".grid-status")?.textContent?.includes("选区 2 x 2"), "shift selection not restored");
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
      !buttonTexts.includes("全部保存")
    ) {
      throw new Error("桌面左侧操作按钮烟测不正确。");
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
      result.layout.tabStripScrollWidth <= result.layout.tabStripClientWidth ||
      result.layout.tabStripWheelLeftAfter <= 0 ||
      result.layout.tabStripScrollLeftAfter <= 0 ||
      result.layout.tabFlexShrink !== "0" ||
      result.layout.tabMaxWidth !== "none" ||
      result.layout.tabNameOverflow !== "visible" ||
      result.layout.tabNameTextOverflow !== "clip"
    ) {
      throw new Error("桌面多页签滚动布局烟测不正确。");
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
