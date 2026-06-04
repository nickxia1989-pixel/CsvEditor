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
    version: opened.version,
    dirty: false,
    externalChanged: false,
    autoRefresh: true,
    lockedCells: [],
    selection: singleCellSelection(0, 0),
    zoom: 1,
    freezeRows: 0,
    freezeCols: 0,
    colWidths: {},
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
    version: opened.version,
    latestDiskVersion: undefined,
    dirty: false,
    externalChanged: false,
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
