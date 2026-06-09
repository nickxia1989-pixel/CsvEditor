import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalRoot, loadLocalChildren } from "./tree";
import type { CsvDesktopApi, DesktopDirectoryHandle } from "./fileRefs";

function setDesktopApi(api: CsvDesktopApi): void {
  Object.defineProperty(window, "csvDesktop", {
    configurable: true,
    value: api
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "csvDesktop");
});

describe("desktop directory tree", () => {
  it("loads desktop directories and CSV files from the Electron API", async () => {
    const handle: DesktopDirectoryHandle = {
      source: "desktop",
      kind: "directory",
      name: "Tables",
      path: "D:\\Tables"
    };
    setDesktopApi({
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(async () => [
        { kind: "file" as const, name: "readme.txt", path: "D:\\Tables\\readme.txt" },
        { kind: "file" as const, name: "skill.csv", path: "D:\\Tables\\skill.csv" },
        { kind: "directory" as const, name: "monster", path: "D:\\Tables\\monster" }
      ]),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn()
    });

    const root = createLocalRoot(handle);
    const children = await loadLocalChildren(root);

    expect(root).toMatchObject({
      id: "D:\\Tables",
      name: "Tables",
      path: "D:\\Tables"
    });
    expect(children.map((child) => [child.kind, child.name, child.path])).toEqual([
      ["directory", "monster", "D:\\Tables\\monster"],
      ["file", "skill.csv", "D:\\Tables\\skill.csv"]
    ]);
    expect(children[0].directoryHandle).toMatchObject({
      source: "desktop",
      path: "D:\\Tables\\monster"
    });
    expect(children[1].fileRef).toMatchObject({
      source: "local",
      writable: true,
      path: "D:\\Tables\\skill.csv"
    });
  });
});
