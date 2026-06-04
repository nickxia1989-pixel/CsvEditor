import { decodeTextBuffer } from "./textDecode";

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
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface BrowserDirectoryHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, BrowserFileHandle | BrowserDirectoryHandle]>;
}

export interface CsvFileRef {
  source: "local" | "sample";
  name: string;
  path: string;
  writable: boolean;
  read(): Promise<OpenedFile>;
  write?(text: string): Promise<CsvVersion>;
  getVersion?(): Promise<CsvVersion>;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
};

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function pickDirectory(): Promise<BrowserDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error("当前浏览器不支持目录选择，请使用 Chrome 或 Edge 打开 localhost 页面。");
  }
  return picker({ mode: "read" });
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
    async write(text: string) {
      await ensureWritePermission(handle);
      const writable = await handle.createWritable!();
      await writable.write(text);
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
