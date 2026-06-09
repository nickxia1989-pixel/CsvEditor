import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canControlDesktopWindow,
  canPickDirectory,
  canOpenSvnCommit,
  canOpenSvnUpdate,
  closeDesktopWindow,
  getDesktopWindowState,
  makeDesktopFileRef,
  makeLocalFileRef,
  minimizeDesktopWindow,
  openSvnCommit,
  openSvnUpdate,
  pickDirectory,
  subscribeDesktopWindowState,
  toggleMaximizeDesktopWindow,
  versionEquals,
  type BrowserFileHandle,
  type CsvDesktopApi
} from "./fileRefs";
import { applyDiskVersionChange, createTabFromFileRef, getSaveConflictVersion } from "./tabModel";

class MockFileHandle implements BrowserFileHandle {
  kind = "file" as const;
  name = "mock.csv";
  private bytes: Uint8Array;
  private modified = 1;

  constructor(data: string | Uint8Array) {
    this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  }

  async getFile(): Promise<File> {
    const bytes = new Uint8Array(this.bytes);
    return {
      name: this.name,
      lastModified: this.modified,
      size: bytes.byteLength,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer
    } as File;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async createWritable() {
    return {
      write: async (data: string | Uint8Array) => {
        this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        this.modified += 1;
      },
      close: async () => undefined
    };
  }

  externalWrite(data: string | Uint8Array) {
    this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    this.modified += 1;
  }
}

function setDesktopApi(api: CsvDesktopApi): void {
  Object.defineProperty(window, "csvDesktop", {
    configurable: true,
    value: api
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "csvDesktop");
});

describe("file refs and hot refresh model", () => {
  it("reads and writes a local file ref without holding state locks", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const before = await ref.read();
    expect(before.text).toBe("A,B\n1,2");

    const savedVersion = await ref.write!("A,B\n3,4");
    const after = await ref.read();
    expect(after.text).toBe("A,B\n3,4");
    expect(versionEquals(savedVersion, after.version)).toBe(true);
  });

  it("auto-refreshes clean tabs when disk version changes", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const tab = await createTabFromFileRef(ref, "tab-1");

    handle.externalWrite("A,B\n9,9");
    const diskVersion = await ref.getVersion!();
    const refreshed = await applyDiskVersionChange(tab, diskVersion);
    expect(refreshed.data[1]).toEqual(["9", "9"]);
    expect(refreshed.externalChanged).toBe(false);
    expect(refreshed.dirty).toBe(false);
  });

  it("marks dirty tabs as conflicted instead of overwriting edits", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const tab = await createTabFromFileRef(ref, "tab-1");
    const dirtyTab = {
      ...tab,
      dirty: true,
      data: [
        ["A", "B"],
        ["local", "edit"]
      ]
    };

    handle.externalWrite("A,B\n9,9");
    const diskVersion = await ref.getVersion!();
    const conflicted = await applyDiskVersionChange(dirtyTab, diskVersion);
    expect(conflicted.data[1]).toEqual(["local", "edit"]);
    expect(conflicted.externalChanged).toBe(true);
    expect(conflicted.latestDiskVersion).toEqual(diskVersion);
  });

  it("marks clean tabs as changed when auto refresh is paused", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const tab = {
      ...(await createTabFromFileRef(ref, "tab-1")),
      autoRefresh: false
    };

    handle.externalWrite("A,B\n9,9");
    const diskVersion = await ref.getVersion!();
    const paused = await applyDiskVersionChange(tab, diskVersion);

    expect(paused.data[1]).toEqual(["1", "2"]);
    expect(paused.externalChanged).toBe(true);
    expect(paused.latestDiskVersion).toEqual(diskVersion);
  });

  it("checks the disk version again before save", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const tab = await createTabFromFileRef(ref, "tab-1");

    expect(await getSaveConflictVersion(tab)).toBeNull();

    handle.externalWrite("A,B\n9,9");
    const conflictVersion = await getSaveConflictVersion(tab);
    expect(conflictVersion).toEqual(await ref.getVersion!());
  });

  it("uses the Electron desktop API when it is available", async () => {
    const directory = {
      source: "desktop" as const,
      kind: "directory" as const,
      name: "Tables",
      path: "D:\\Tables"
    };
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(async () => directory),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn()
    };
    setDesktopApi(api);

    expect(canPickDirectory()).toBe(true);
    await expect(pickDirectory()).resolves.toEqual(directory);
    expect(api.pickDirectory).toHaveBeenCalledTimes(1);
  });

  it("opens the SVN commit GUI through the Electron desktop API", async () => {
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn(),
      openSvnCommit: vi.fn(async () => undefined),
      openSvnUpdate: vi.fn(async () => undefined)
    };
    setDesktopApi(api);

    expect(canOpenSvnCommit()).toBe(true);
    await openSvnCommit("D:\\Tables");

    expect(api.openSvnCommit).toHaveBeenCalledWith("D:\\Tables");
  });

  it("opens the SVN update GUI through the Electron desktop API", async () => {
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn(),
      openSvnUpdate: vi.fn(async () => undefined)
    };
    setDesktopApi(api);

    expect(canOpenSvnUpdate()).toBe(true);
    await openSvnUpdate("D:\\Tables");

    expect(api.openSvnUpdate).toHaveBeenCalledWith("D:\\Tables");
  });

  it("controls the frameless Electron window through the desktop API", async () => {
    const unsubscribe = vi.fn();
    const onWindowStateChange = vi.fn(() => unsubscribe);
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn(),
      getWindowState: vi.fn(async () => ({ maximized: false, fullscreen: false })),
      minimizeWindow: vi.fn(async () => undefined),
      toggleMaximizeWindow: vi.fn(async () => ({ maximized: true, fullscreen: false })),
      closeWindow: vi.fn(async () => undefined),
      onWindowStateChange
    };
    setDesktopApi(api);

    expect(canControlDesktopWindow()).toBe(true);
    await expect(getDesktopWindowState()).resolves.toEqual({ maximized: false, fullscreen: false });
    await minimizeDesktopWindow();
    await expect(toggleMaximizeDesktopWindow()).resolves.toEqual({ maximized: true, fullscreen: false });
    await closeDesktopWindow();
    const returnedUnsubscribe = subscribeDesktopWindowState(vi.fn());
    returnedUnsubscribe();

    expect(api.minimizeWindow).toHaveBeenCalledTimes(1);
    expect(api.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
    expect(api.closeWindow).toHaveBeenCalledTimes(1);
    expect(onWindowStateChange).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reads and writes desktop file refs through preload IPC", async () => {
    let bytes = new TextEncoder().encode("\uFEFFA,B\r\n1,2\r\n");
    let modified = 10;
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(async () => ({
        data: bytes,
        version: { lastModified: modified, size: bytes.byteLength }
      })),
      writeFile: vi.fn(async (_path, data) => {
        bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        modified += 1;
        return { lastModified: modified, size: bytes.byteLength };
      }),
      getVersion: vi.fn(async () => ({ lastModified: modified, size: bytes.byteLength }))
    };
    setDesktopApi(api);

    const ref = makeDesktopFileRef({ kind: "file", name: "desktop.csv", path: "D:\\Tables\\desktop.csv" });
    const opened = await ref.read();
    expect(opened.text).toBe("\uFEFFA,B\r\n1,2\r\n");
    expect(opened.encoding).toBe("utf-8");

    const savedVersion = await ref.write!("A,B\r\n3,4\r\n");
    expect(api.writeFile).toHaveBeenCalledWith("D:\\Tables\\desktop.csv", "A,B\r\n3,4\r\n");
    expect(savedVersion).toEqual(await ref.getVersion!());
    await expect(ref.read()).resolves.toMatchObject({ text: "A,B\r\n3,4\r\n" });
  });
});
