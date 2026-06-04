import { describe, expect, it } from "vitest";
import { makeLocalFileRef, versionEquals, type BrowserFileHandle } from "./fileRefs";
import { applyDiskVersionChange, createTabFromFileRef, getSaveConflictVersion } from "./tabModel";

class MockFileHandle implements BrowserFileHandle {
  kind = "file" as const;
  name = "mock.csv";
  private text: string;
  private modified = 1;

  constructor(text: string) {
    this.text = text;
  }

  async getFile(): Promise<File> {
    return {
      name: this.name,
      lastModified: this.modified,
      size: new Blob([this.text]).size,
      text: async () => this.text
    } as File;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async createWritable() {
    return {
      write: async (text: string) => {
        this.text = text;
        this.modified += 1;
      },
      close: async () => undefined
    };
  }

  externalWrite(text: string) {
    this.text = text;
    this.modified += 1;
  }
}

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

  it("checks the disk version again before save", async () => {
    const handle = new MockFileHandle("A,B\n1,2");
    const ref = makeLocalFileRef(handle, "mock.csv");
    const tab = await createTabFromFileRef(ref, "tab-1");

    expect(await getSaveConflictVersion(tab)).toBeNull();

    handle.externalWrite("A,B\n9,9");
    const conflictVersion = await getSaveConflictVersion(tab);
    expect(conflictVersion).toEqual(await ref.getVersion!());
  });
});
