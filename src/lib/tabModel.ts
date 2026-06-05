import { parseCsvText } from "./csv";
import { versionEquals, type CsvFileRef, type CsvVersion } from "./fileRefs";
import type { CsvTab } from "../types";
import { singleCellSelection } from "../types";

export async function createTabFromFileRef(fileRef: CsvFileRef, id: string): Promise<CsvTab> {
  const opened = await fileRef.read();
  const parsed = parseCsvText(opened.text);
  return {
    id,
    name: fileRef.name,
    path: fileRef.path,
    fileRef,
    data: parsed.data,
    delimiter: parsed.delimiter,
    newline: parsed.newline,
    hasBom: parsed.hasBom,
    sourceRows: parsed.sourceRows,
    trailingNewline: parsed.trailingNewline,
    encoding: opened.encoding ?? "utf-8",
    version: opened.version,
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    findQuery: "",
    replaceValue: "",
    lockedCells: [],
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 2,
    freezeCols: 2,
    colWidths: {},
    undoStack: [],
    redoStack: [],
    status: "已打开"
  };
}

export async function reloadTabFromFileRef(tab: CsvTab, status = "已从磁盘刷新"): Promise<CsvTab> {
  const opened = await tab.fileRef.read();
  const parsed = parseCsvText(opened.text);
  return {
    ...tab,
    data: parsed.data,
    delimiter: parsed.delimiter,
    newline: parsed.newline,
    hasBom: parsed.hasBom,
    sourceRows: parsed.sourceRows,
    trailingNewline: parsed.trailingNewline,
    encoding: opened.encoding ?? tab.encoding,
    version: opened.version,
    latestDiskVersion: undefined,
    dirty: false,
    externalChanged: false,
    undoStack: [],
    redoStack: [],
    status
  };
}

export async function applyDiskVersionChange(tab: CsvTab, diskVersion: CsvVersion): Promise<CsvTab> {
  if (versionEquals(tab.version, diskVersion)) {
    return tab;
  }

  if (!tab.dirty && tab.autoRefresh) {
    return reloadTabFromFileRef(tab, "磁盘变化，已自动刷新");
  }

  return {
    ...tab,
    latestDiskVersion: diskVersion,
    externalChanged: true,
    status: "磁盘有新版本"
  };
}

export async function getSaveConflictVersion(tab: CsvTab): Promise<CsvVersion | null> {
  if (!tab.fileRef.getVersion) {
    return tab.externalChanged ? tab.latestDiskVersion ?? tab.version : null;
  }

  const diskVersion = await tab.fileRef.getVersion();
  return versionEquals(tab.version, diskVersion) ? null : diskVersion;
}
