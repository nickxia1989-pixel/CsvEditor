import { decodeTextBuffer } from "./textDecode";
import type { CsvFavoriteFile } from "../types";

export type CsvWritableData = Uint8Array;

export type CsvVersion = {
  lastModified: number;
  size: number;
};

export type OpenedFile = {
  text: string;
  version: CsvVersion;
  encoding?: string;
};

export interface BrowserFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  createWritable?: () => Promise<{
    write(data: CsvWritableData): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface BrowserDirectoryHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, BrowserFileHandle | BrowserDirectoryHandle]>;
}

export type DesktopFileSystemEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
};

export type DesktopDirectoryHandle = {
  source: "desktop";
  kind: "directory";
  name: string;
  path: string;
};

export type DesktopWindowState = {
  maximized: boolean;
  fullscreen: boolean;
};

export type DirectoryHandle = BrowserDirectoryHandle | DesktopDirectoryHandle;

export type CsvDesktopApi = {
  pickDirectory(): Promise<DesktopDirectoryHandle>;
  listDirectory(path: string): Promise<DesktopFileSystemEntry[]>;
  readFile(path: string): Promise<{
    data: Uint8Array | ArrayBuffer;
    version: CsvVersion;
  }>;
  writeFile(path: string, data: CsvWritableData): Promise<CsvVersion>;
  getVersion(path: string): Promise<CsvVersion>;
  openSvnCommit?(path: string): Promise<void>;
  openSvnUpdate?(path: string): Promise<void>;
  getWindowState?(): Promise<DesktopWindowState>;
  minimizeWindow?(): Promise<void>;
  toggleMaximizeWindow?(): Promise<DesktopWindowState>;
  closeWindow?(): Promise<void>;
  getFavorites?(): Promise<CsvFavoriteFile[]>;
  setFavorites?(favorites: CsvFavoriteFile[]): Promise<CsvFavoriteFile[]>;
  onWindowStateChange?(callback: (state: DesktopWindowState) => void): () => void;
};

export interface CsvFileRef {
  source: "local" | "sample";
  name: string;
  path: string;
  writable: boolean;
  read(): Promise<OpenedFile>;
  write?(data: CsvWritableData): Promise<CsvVersion>;
  getVersion?(): Promise<CsvVersion>;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
  csvDesktop?: CsvDesktopApi;
};

export function canPickDirectory(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(getDesktopApi() || typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function");
}

export async function pickDirectory(): Promise<DirectoryHandle> {
  const desktop = getDesktopApi();
  if (desktop) {
    return desktop.pickDirectory();
  }

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前环境不支持目录选择，请使用桌面版，或用 Chrome/Edge 打开 localhost 页面。");
  }
  return picker({ mode: "read" });
}

export function canOpenSvnCommit(): boolean {
  return Boolean(getDesktopApi()?.openSvnCommit);
}

export function canOpenSvnUpdate(): boolean {
  return Boolean(getDesktopApi()?.openSvnUpdate);
}

export async function openSvnCommit(path: string): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop?.openSvnCommit) {
    throw new Error("SVN GUI 提交只支持桌面版。");
  }
  await desktop.openSvnCommit(path);
}

export async function openSvnUpdate(path: string): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop?.openSvnUpdate) {
    throw new Error("SVN GUI 更新只支持桌面版。");
  }
  await desktop.openSvnUpdate(path);
}

export function canControlDesktopWindow(): boolean {
  const desktop = getDesktopApi();
  return Boolean(desktop?.getWindowState && desktop.minimizeWindow && desktop.toggleMaximizeWindow && desktop.closeWindow);
}

export async function getDesktopWindowState(): Promise<DesktopWindowState> {
  const desktop = getDesktopApi();
  if (!desktop?.getWindowState) {
    return { maximized: false, fullscreen: false };
  }
  return desktop.getWindowState();
}

export async function minimizeDesktopWindow(): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop?.minimizeWindow) {
    return;
  }
  await desktop.minimizeWindow();
}

export async function toggleMaximizeDesktopWindow(): Promise<DesktopWindowState> {
  const desktop = getDesktopApi();
  if (!desktop?.toggleMaximizeWindow) {
    return { maximized: false, fullscreen: false };
  }
  return desktop.toggleMaximizeWindow();
}

export async function closeDesktopWindow(): Promise<void> {
  const desktop = getDesktopApi();
  if (!desktop?.closeWindow) {
    return;
  }
  await desktop.closeWindow();
}

const FAVORITES_STORAGE_KEY = "csv-workspace-editor:favorites:v1";

export async function loadFavoriteFiles(): Promise<CsvFavoriteFile[]> {
  const desktop = getDesktopApi();
  if (desktop?.getFavorites) {
    return sanitizeFavorites(await desktop.getFavorites());
  }
  if (typeof window === "undefined") {
    return [];
  }
  try {
    return sanitizeFavorites(JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export async function saveFavoriteFiles(favorites: CsvFavoriteFile[]): Promise<CsvFavoriteFile[]> {
  const sanitized = sanitizeFavorites(favorites);
  const desktop = getDesktopApi();
  if (desktop?.setFavorites) {
    return sanitizeFavorites(await desktop.setFavorites(sanitized));
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(sanitized));
  }
  return sanitized;
}

export function subscribeDesktopWindowState(callback: (state: DesktopWindowState) => void): () => void {
  return getDesktopApi()?.onWindowStateChange?.(callback) ?? (() => undefined);
}

export function isDesktopDirectoryHandle(handle: DirectoryHandle): handle is DesktopDirectoryHandle {
  return "source" in handle && handle.source === "desktop";
}

export async function listDesktopDirectory(handle: DesktopDirectoryHandle): Promise<DesktopFileSystemEntry[]> {
  return requireDesktopApi().listDirectory(handle.path);
}

async function ensureWritePermission(handle: BrowserFileHandle): Promise<void> {
  if (!handle.createWritable) {
    throw new Error("当前浏览器没有提供写入接口。");
  }
  if (handle.queryPermission) {
    const current = await handle.queryPermission({ mode: "readwrite" });
    if (current === "granted") {
      return;
    }
  }
  if (handle.requestPermission) {
    const requested = await handle.requestPermission({ mode: "readwrite" });
    if (requested === "granted") {
      return;
    }
  }
  throw new Error("没有获得该 CSV 文件的写入权限。");
}

export function versionEquals(left?: CsvVersion, right?: CsvVersion): boolean {
  return Boolean(left && right && left.lastModified === right.lastModified && left.size === right.size);
}

export function makeLocalFileRef(handle: BrowserFileHandle, path: string): CsvFileRef {
  return {
    source: "local",
    name: handle.name,
    path,
    writable: true,
    async read() {
      const file = await handle.getFile();
      const decoded = decodeTextBuffer(await file.arrayBuffer());
      return {
        text: decoded.text,
        encoding: decoded.encoding,
        version: {
          lastModified: file.lastModified,
          size: file.size
        }
      };
    },
    async write(data: CsvWritableData) {
      await ensureWritePermission(handle);
      const writable = await handle.createWritable!();
      await writable.write(data);
      await writable.close();
      const file = await handle.getFile();
      return {
        lastModified: file.lastModified,
        size: file.size
      };
    },
    async getVersion() {
      const file = await handle.getFile();
      return {
        lastModified: file.lastModified,
        size: file.size
      };
    }
  };
}

export function makeDesktopFileRef(entry: DesktopFileSystemEntry): CsvFileRef {
  return {
    source: "local",
    name: entry.name,
    path: entry.path,
    writable: true,
    async read() {
      const opened = await requireDesktopApi().readFile(entry.path);
      const decoded = decodeTextBuffer(toUint8Array(opened.data));
      return {
        text: decoded.text,
        encoding: decoded.encoding,
        version: opened.version
      };
    },
    async write(data: CsvWritableData) {
      return requireDesktopApi().writeFile(entry.path, data);
    },
    async getVersion() {
      return requireDesktopApi().getVersion(entry.path);
    }
  };
}

export function makeSampleFileRef(name: string, path: string, url: string): CsvFileRef {
  let loadedVersion: CsvVersion | undefined;
  return {
    source: "sample",
    name,
    path,
    writable: false,
    async read() {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`样例文件读取失败: ${response.status}`);
      }
      const decoded = decodeTextBuffer(await response.arrayBuffer());
      const text = decoded.text;
      loadedVersion = {
        lastModified: Date.now(),
        size: new Blob([text]).size
      };
      return {
        text,
        encoding: decoded.encoding,
        version: loadedVersion
      };
    },
    async getVersion() {
      return loadedVersion ?? {
        lastModified: 0,
        size: 0
      };
    }
  };
}

function getDesktopApi(): CsvDesktopApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as DirectoryPickerWindow).csvDesktop;
}

function requireDesktopApi(): CsvDesktopApi {
  const desktop = getDesktopApi();
  if (!desktop) {
    throw new Error("桌面文件接口不可用。");
  }
  return desktop;
}

function sanitizeFavorites(value: unknown): CsvFavoriteFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const favorites: CsvFavoriteFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<CsvFavoriteFile>;
    if (typeof candidate.name !== "string" || typeof candidate.path !== "string") {
      continue;
    }
    const source = candidate.source === "sample" ? "sample" : "local";
    const name = candidate.name.trim();
    const favoritePath = candidate.path.trim();
    if (!name || !favoritePath || seen.has(favoritePath)) {
      continue;
    }
    seen.add(favoritePath);
    favorites.push({ name, path: favoritePath, source });
  }
  return favorites.slice(0, 60);
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
