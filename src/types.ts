import type { CsvSourceRow } from "./lib/csv";
import type { CsvFileRef, CsvVersion } from "./lib/fileRefs";

export type CsvMatrix = string[][];

export type CsvSelection = {
  anchorRow: number;
  anchorCol: number;
  focusRow: number;
  focusCol: number;
};

export type GridScrollPosition = {
  scrollTop: number;
  scrollLeft: number;
};

export type CsvCellStyle = {
  textColor?: string;
  backgroundColor?: string;
};

export type CsvCellStyleMap = Record<string, CsvCellStyle>;

export type FindResultCell = {
  row: number;
  col: number;
};

export type CsvFindResult = FindResultCell & {
  value: string;
  locked: boolean;
};

export type CsvFindScope = {
  mode: "table" | "selection";
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  visibleOnly: boolean;
};

export type CsvFindSnapshot = {
  query: string;
  scope: CsvFindScope;
  results: CsvFindResult[];
};

export type CsvCellUpdate = FindResultCell & {
  value: string;
};

export type CsvColumnFilters = Record<number, string[]>;

export type CsvFavoriteFile = {
  name: string;
  path: string;
  source: CsvFileRef["source"];
};

export type CsvWorkspaceDirectory = {
  name: string;
  path: string;
  source: "local";
};

export type CsvWorkspaceFile = {
  name: string;
  path: string;
  source: "local";
};

export type CsvWorkspaceState = {
  directory: CsvWorkspaceDirectory;
  openFiles: CsvWorkspaceFile[];
  activeFilePath: string | null;
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
  sourceRows: Array<CsvSourceRow | undefined>;
  trailingNewline: boolean;
  encoding: string;
  version: CsvVersion;
  latestDiskVersion?: CsvVersion;
  dirty: boolean;
  externalChanged: boolean;
  autoRefresh: boolean;
  findQuery: string;
  replaceValue: string;
  findSnapshot: CsvFindSnapshot | null;
  lockedCells: string[];
  cellStyles: CsvCellStyleMap;
  selection: CsvSelection;
  zoom: number;
  freezeRows: number;
  freezeCols: number;
  colWidths: Record<number, number>;
  columnFilters: CsvColumnFilters;
  undoStack: CsvTabHistorySnapshot[];
  redoStack: CsvTabHistorySnapshot[];
  status?: string;
};

export type CsvTabHistorySnapshot = {
  data: CsvMatrix;
  sourceRows: Array<CsvSourceRow | undefined>;
  lockedCells: string[];
  cellStyles: CsvCellStyleMap;
  selection: CsvSelection;
  colWidths: Record<number, number>;
  dirty: boolean;
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
  directoryHandle?: import("./lib/fileRefs").DirectoryHandle;
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
