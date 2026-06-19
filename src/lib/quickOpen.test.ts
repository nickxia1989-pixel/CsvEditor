import { describe, expect, it } from "vitest";
import { buildQuickOpenCandidates, collectTreeFileNodes } from "./quickOpen";
import type { CsvTab, TreeNode } from "../types";
import { singleCellSelection } from "../types";

function createFileRef(name: string, path: string) {
  return {
    source: "local" as const,
    name,
    path,
    writable: true,
    read: async () => ({
      text: "",
      version: { lastModified: 1, size: 1 }
    })
  };
}

function createTab(id: string, name: string, path: string, overrides: Partial<CsvTab> = {}): CsvTab {
  return {
    id,
    name,
    path,
    fileRef: createFileRef(name, path),
    data: [["A"]],
    delimiter: ",",
    newline: "\n",
    hasBom: false,
    sourceRows: [],
    trailingNewline: false,
    encoding: "utf-8",
    version: { lastModified: 1, size: 1 },
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    findQuery: "",
    replaceValue: "",
    findSnapshot: null,
    lockedCells: [],
    cellStyles: {},
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
    columnFilters: {},
    undoStack: [],
    redoStack: [],
    ...overrides
  };
}

function createRoot(): TreeNode {
  return {
    id: "Tables",
    name: "Tables",
    path: "Tables",
    kind: "directory",
    loaded: true,
    expanded: true,
    children: [
      {
        id: "Tables/ai",
        name: "ai",
        path: "Tables/ai",
        kind: "directory",
        loaded: true,
        children: [
          {
            id: "Tables/ai/monster_spawn.csv",
            name: "monster_spawn.csv",
            path: "Tables/ai/monster_spawn.csv",
            kind: "file",
            fileRef: createFileRef("monster_spawn.csv", "Tables/ai/monster_spawn.csv")
          }
        ]
      },
      {
        id: "Tables/item.csv",
        name: "item.csv",
        path: "Tables/item.csv",
        kind: "file",
        fileRef: createFileRef("item.csv", "Tables/item.csv")
      }
    ]
  };
}

describe("quickOpen", () => {
  it("collects file nodes recursively from the loaded tree", () => {
    expect(collectTreeFileNodes(createRoot()).map((node) => node.path)).toEqual([
      "Tables/ai/monster_spawn.csv",
      "Tables/item.csv"
    ]);
  });

  it("deduplicates tree files that are already open and keeps open metadata", () => {
    const root = createRoot();
    const tabs = [createTab("tab-item", "item.csv", "Tables/item.csv", { dirty: true })];

    const candidates = buildQuickOpenCandidates(tabs, root, "", ["tab-item"], "tab-item");

    expect(candidates.map((candidate) => candidate.path)).toEqual(["Tables/item.csv", "Tables/ai/monster_spawn.csv"]);
    expect(candidates[0]).toMatchObject({
      tabId: "tab-item",
      open: true,
      active: true,
      dirty: true
    });
  });

  it("ranks exact and segment matches before loose fuzzy matches", () => {
    const root = createRoot();
    const tabs = [createTab("tab-spawn", "spawn_rules.csv", "Tables/open/spawn_rules.csv")];

    expect(buildQuickOpenCandidates(tabs, root, "spawn").map((candidate) => candidate.name)).toEqual([
      "spawn_rules.csv",
      "monster_spawn.csv"
    ]);
    expect(buildQuickOpenCandidates(tabs, root, "ai/mon").map((candidate) => candidate.path)).toEqual([
      "Tables/ai/monster_spawn.csv"
    ]);
    expect(buildQuickOpenCandidates(tabs, root, "mspawn").map((candidate) => candidate.path)).toEqual([
      "Tables/ai/monster_spawn.csv"
    ]);
    expect(buildQuickOpenCandidates(tabs, root, "monster spawn").map((candidate) => candidate.path)).toEqual([
      "Tables/ai/monster_spawn.csv"
    ]);
  });
});
