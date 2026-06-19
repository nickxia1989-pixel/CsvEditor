import { describe, expect, it, vi } from "vitest";
import {
  addGlobalSearchHistory,
  formatCellAddress,
  sanitizeGlobalSearchHistory,
  searchCsvFiles,
  type SearchableCsvFile
} from "./globalSearch";

function file(name: string, relativePath: string, data: string[][]): SearchableCsvFile {
  return {
    name,
    path: `Tables/${relativePath}`,
    relativePath,
    readData: vi.fn(async () => data)
  };
}

describe("globalSearch", () => {
  it("searches every CSV file and records cell locations", async () => {
    const files = [
      file("skill.csv", "skill/skill.csv", [
        ["说明", "说明"],
        ["id", "name"],
        ["1001", "Fire Arrow"],
        ["1002", "Ice Shield"]
      ]),
      file("monster.csv", "monster/monster.csv", [
        ["说明", "说明"],
        ["id", "name"],
        ["2001", "Fire Bat"]
      ])
    ];
    const onProgress = vi.fn();
    const onSnapshot = vi.fn();

    const snapshot = await searchCsvFiles({
      query: "fire",
      rootName: "Tables",
      rootPath: "Tables",
      files,
      now: 1000,
      createId: () => "search-1",
      onProgress,
      onSnapshot
    });

    expect(snapshot).toMatchObject({
      id: "search-1",
      query: "fire",
      rootName: "Tables",
      searchedFileCount: 2,
      matchedFileCount: 2
    });
    expect(snapshot.results).toEqual([
      expect.objectContaining({
        fileName: "skill.csv",
        relativePath: "skill/skill.csv",
        row: 2,
        col: 1,
        cell: "B3",
        preview: "Fire Arrow",
        primaryKey: "1001",
        fieldName: "name",
        contextBefore: "name",
        contextAfter: "Ice Shield",
        rowContext: "1001 / Fire Arrow"
      }),
      expect.objectContaining({
        fileName: "monster.csv",
        relativePath: "monster/monster.csv",
        row: 2,
        col: 1,
        cell: "B3",
        preview: "Fire Bat",
        primaryKey: "2001",
        fieldName: "name"
      })
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ scannedFiles: 2, totalFiles: 2 });
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "search-1",
        results: [expect.objectContaining({ fileName: "skill.csv" })]
      })
    );
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ results: snapshot.results }));
  });

  it("keeps file read failures as searchable snapshot errors", async () => {
    const broken: SearchableCsvFile = {
      name: "broken.csv",
      path: "Tables/broken.csv",
      relativePath: "broken.csv",
      readData: vi.fn(async () => {
        throw new Error("cannot read");
      })
    };

    const snapshot = await searchCsvFiles({
      query: "alpha",
      rootName: "Tables",
      rootPath: "Tables",
      files: [broken],
      createId: () => "search-error"
    });

    expect(snapshot.results).toHaveLength(0);
    expect(snapshot.errors).toEqual([
      {
        fileName: "broken.csv",
        filePath: "Tables/broken.csv",
        relativePath: "broken.csv",
        message: "cannot read"
      }
    ]);
  });

  it("formats spreadsheet-style cell addresses", () => {
    expect(formatCellAddress(0, 0)).toBe("A1");
    expect(formatCellAddress(4, 26)).toBe("AA5");
  });

  it("stores newest search snapshots first and caps history at 50", () => {
    const history = Array.from({ length: 55 }, (_, index) => ({
      id: `old-${index}`,
      query: `query-${index}`,
      createdAt: index,
      rootName: "Tables",
      rootPath: "Tables",
      searchedFileCount: 1,
      matchedFileCount: 0,
      results: [],
      errors: []
    }));
    const next = addGlobalSearchHistory(history, {
      id: "new",
      query: "alpha",
      createdAt: 100,
      rootName: "Tables",
      rootPath: "Tables",
      searchedFileCount: 1,
      matchedFileCount: 1,
      results: [],
      errors: []
    });

    expect(next).toHaveLength(50);
    expect(next[0].id).toBe("new");
    expect(next.at(-1)?.id).toBe("old-48");
  });

  it("sanitizes persisted history records", () => {
    const history = sanitizeGlobalSearchHistory([
      {
        id: "valid",
        query: "alpha",
        createdAt: 100,
        rootName: "Tables",
        rootPath: "Tables",
        searchedFileCount: 2,
        matchedFileCount: 1,
        results: [
          {
            id: "match",
            fileName: "skill.csv",
            filePath: "Tables/skill.csv",
            relativePath: "skill.csv",
            row: 1,
            col: 2,
            cell: "C2",
            value: "alpha",
            preview: "alpha"
          }
        ],
        errors: []
      },
      { id: "invalid" }
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].results[0]).toMatchObject({ fileName: "skill.csv", cell: "C2" });
  });
});
