import { describe, expect, it } from "vitest";
import { pushUndo, redoTab, undoTab } from "./history";
import type { CsvTab } from "../types";
import { singleCellSelection } from "../types";

function makeTab(): CsvTab {
  return {
    id: "tab-1",
    name: "test.csv",
    path: "test.csv",
    fileRef: {
      source: "sample",
      name: "test.csv",
      path: "test.csv",
      writable: false,
      read: async () => ({ text: "", version: { lastModified: 1, size: 1 } })
    },
    data: [["A"]],
    delimiter: ",",
    newline: "\n",
    hasBom: false,
    version: { lastModified: 1, size: 1 },
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    findQuery: "",
    lockedCells: [],
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
    undoStack: [],
    redoStack: []
  };
}

describe("history", () => {
  it("undoes and redoes data plus dirty state", () => {
    const original = makeTab();
    const edited = {
      ...pushUndo(original),
      data: [["B"]],
      dirty: true
    };

    const undone = undoTab(edited);
    expect(undone.data).toEqual([["A"]]);
    expect(undone.dirty).toBe(false);
    expect(undone.redoStack).toHaveLength(1);

    const redone = redoTab(undone);
    expect(redone.data).toEqual([["B"]]);
    expect(redone.dirty).toBe(true);
    expect(redone.undoStack).toHaveLength(1);
  });

  it("keeps snapshot data immutable", () => {
    const original = makeTab();
    const withHistory = pushUndo(original);
    withHistory.data[0][0] = "mutated";

    expect(undoTab(withHistory).data).toEqual([["A"]]);
  });
});
