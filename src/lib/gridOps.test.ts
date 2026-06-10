import { describe, expect, it } from "vitest";
import {
  deleteColumns,
  deleteRows,
  deleteRowsByIndexes,
  hasLockedCellInColumns,
  hasLockedCellInRowIndexes,
  hasLockedCellInRows,
  insertColumns,
  insertRows,
  shiftLockedCellsForDeletedColumns,
  shiftLockedCellsForDeletedRowIndexes,
  shiftLockedCellsForDeletedRows,
  shiftLockedCellsForInsertedColumns,
  shiftLockedCellsForInsertedRows
} from "./gridOps";

describe("grid operations", () => {
  it("inserts and deletes rows around the selected range", () => {
    const data = [
      ["A", "B"],
      ["1", "2"]
    ];
    expect(insertRows(data, 1, 1)).toEqual([
      ["A", "B"],
      ["", ""],
      ["1", "2"]
    ]);
    expect(deleteRows(data, 0, 0)).toEqual([["1", "2"]]);
  });

  it("inserts and deletes columns around the selected range", () => {
    const data = [
      ["A", "B"],
      ["1", "2"]
    ];
    expect(insertColumns(data, 1, 1)).toEqual([
      ["A", "", "B"],
      ["1", "", "2"]
    ]);
    expect(deleteColumns(data, 0, 0)).toEqual([["B"], ["2"]]);
  });

  it("does not delete real data when the selected virtual range is outside the matrix", () => {
    const data = [
      ["A", "B"],
      ["1", "2"]
    ];
    expect(deleteRows(data, 20, 20)).toEqual(data);
    expect(deleteColumns(data, 20, 20)).toEqual(data);
  });

  it("deletes only explicitly visible row indexes", () => {
    const data = [
      ["Header"],
      ["visible-1"],
      ["hidden"],
      ["visible-2"]
    ];
    expect(deleteRowsByIndexes(data, [3, 1, 1, 99])).toEqual([["Header"], ["hidden"]]);
  });

  it("keeps one blank column when deleting the last real column", () => {
    expect(deleteColumns([["A"], ["1"]], 0, 0)).toEqual([[""], [""]]);
  });

  it("shifts locked cells when rows and columns are inserted", () => {
    expect(shiftLockedCellsForInsertedRows(["0:0", "2:1"], 1, 2)).toEqual(["0:0", "4:1"]);
    expect(shiftLockedCellsForInsertedColumns(["0:0", "2:1"], 1, 2)).toEqual(["0:0", "2:3"]);
  });

  it("removes or shifts locked cells when rows and columns are deleted", () => {
    expect(shiftLockedCellsForDeletedRows(["0:0", "2:1", "4:2"], 1, 2)).toEqual(["0:0", "2:2"]);
    expect(shiftLockedCellsForDeletedRowIndexes(["0:0", "2:1", "4:2", "5:3"], [2, 4])).toEqual([
      "0:0",
      "3:3"
    ]);
    expect(shiftLockedCellsForDeletedColumns(["0:0", "2:1", "4:3"], 1, 2)).toEqual(["0:0", "4:1"]);
  });

  it("detects locked cells inside row or column delete ranges", () => {
    expect(hasLockedCellInRows(["0:0", "2:1"], 2, 3)).toBe(true);
    expect(hasLockedCellInRowIndexes(["0:0", "2:1"], [1, 3])).toBe(false);
    expect(hasLockedCellInRowIndexes(["0:0", "2:1"], [2, 3])).toBe(true);
    expect(hasLockedCellInRows(["0:0", "2:1"], 3, 4)).toBe(false);
    expect(hasLockedCellInColumns(["0:0", "2:1"], 1, 2)).toBe(true);
    expect(hasLockedCellInColumns(["0:0", "2:1"], 3, 4)).toBe(false);
  });
});
