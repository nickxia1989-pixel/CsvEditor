import type { CsvFileRef, CsvVersion } from "./lib/fileRefs";

export type CsvMatrix = string[][];

export type CsvSelection = {
  anchorRow: number;
  anchorCol: number;
  focusRow: number;
  focusCol: number;
};

export type CsvTab = {
  id: string;
  name: string;
  path: string;
  fileRef: CsvFileRef;
  data: CsvMatrix;
  delimiter: string;
  newline: string;
  hasBom: boolean;
  version: CsvVersion;
  latestDiskVersion?: CsvVersion;
  dirty: boolean;
  externalChanged: boolean;
  autoRefresh: boolean;
  findQuery: string;
  lockedCells: string[];
  selection: CsvSelection;
  zoom: number;
  freezeRows: number;
  freezeCols: number;
  colWidths: Record<number, number>;
  status?: string;
};

export type TreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
  expanded?: boolean;
  error?: string;
  directoryHandle?: import("./lib/fileRefs").BrowserDirectoryHandle;
  fileRef?: CsvFileRef;
};

export const cellKey = (row: number, col: number) => `${row}:${col}`;

export const normalizeSelection = (selection: CsvSelection) => ({
  startRow: Math.min(selection.anchorRow, selection.focusRow),
  endRow: Math.max(selection.anchorRow, selection.focusRow),
  startCol: Math.min(selection.anchorCol, selection.focusCol),
  endCol: Math.max(selection.anchorCol, selection.focusCol)
});

export const singleCellSelection = (row: number, col: number): CsvSelection => ({
  anchorRow: row,
  anchorCol: col,
  focusRow: row,
  focusCol: col
});
