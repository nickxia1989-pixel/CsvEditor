import { maxColumnCount, readCell } from "./csv";
import type { CsvMatrix, GlobalSearchSnapshot } from "../types";

export const GLOBAL_SEARCH_HISTORY_LIMIT = 50;
export const GLOBAL_SEARCH_HISTORY_STORAGE_KEY = "csv-workspace-editor:global-search-history:v1";
const PRIMARY_KEY_COLUMN_INDEX = 0;
const FIELD_NAME_ROW_INDEX = 1;

export type SearchableCsvFile = {
  name: string;
  path: string;
  relativePath: string;
  readData(): Promise<CsvMatrix>;
};

export type GlobalSearchProgressUpdate = {
  scannedFiles: number;
  totalFiles: number;
};

type SearchCsvFilesOptions = {
  query: string;
  rootName: string;
  rootPath: string;
  files: SearchableCsvFile[];
  now?: number;
  createId?: () => string;
  onProgress?(progress: GlobalSearchProgressUpdate): void;
  onSnapshot?(snapshot: GlobalSearchSnapshot): void;
};

export async function searchCsvFiles({
  query,
  rootName,
  rootPath,
  files,
  now = Date.now(),
  createId = createGlobalSearchId,
  onProgress,
  onSnapshot
}: SearchCsvFilesOptions): Promise<GlobalSearchSnapshot> {
  const normalizedQuery = query.trim();
  const lowerQuery = normalizedQuery.toLowerCase();
  const results: GlobalSearchSnapshot["results"] = [];
  const errors: GlobalSearchSnapshot["errors"] = [];
  let scannedFiles = 0;
  const matchedFiles = new Set<string>();
  const id = createId();

  for (const file of files) {
    try {
      const data = await file.readData();
      const beforeCount = results.length;
      collectFileMatches(data, file, lowerQuery, results);
      if (results.length > beforeCount) {
        matchedFiles.add(file.path);
      }
    } catch (error) {
      errors.push({
        fileName: file.name,
        filePath: file.path,
        relativePath: file.relativePath,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      scannedFiles += 1;
      onProgress?.({ scannedFiles, totalFiles: files.length });
      onSnapshot?.(
        buildSnapshot({
          id,
          query: normalizedQuery,
          rootName,
          rootPath,
          createdAt: now,
          searchedFileCount: scannedFiles,
          matchedFileCount: matchedFiles.size,
          results,
          errors
        })
      );
    }
  }

  return buildSnapshot({
    id,
    query: normalizedQuery,
    createdAt: now,
    rootName,
    rootPath,
    searchedFileCount: scannedFiles,
    matchedFileCount: matchedFiles.size,
    results,
    errors
  });
}

export function addGlobalSearchHistory(
  history: GlobalSearchSnapshot[],
  snapshot: GlobalSearchSnapshot
): GlobalSearchSnapshot[] {
  return [snapshot, ...history.filter((entry) => entry.id !== snapshot.id)].slice(0, GLOBAL_SEARCH_HISTORY_LIMIT);
}

export function sanitizeGlobalSearchHistory(value: unknown): GlobalSearchSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: GlobalSearchSnapshot[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<GlobalSearchSnapshot>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.query !== "string" ||
      typeof candidate.createdAt !== "number" ||
      typeof candidate.rootName !== "string" ||
      typeof candidate.rootPath !== "string" ||
      seen.has(candidate.id)
    ) {
      continue;
    }
    seen.add(candidate.id);
    entries.push({
      id: candidate.id,
      query: candidate.query,
      createdAt: candidate.createdAt,
      rootName: candidate.rootName,
      rootPath: candidate.rootPath,
      searchedFileCount: sanitizeCount(candidate.searchedFileCount),
      matchedFileCount: sanitizeCount(candidate.matchedFileCount),
      results: sanitizeResults(candidate.results),
      errors: sanitizeErrors(candidate.errors)
    });
    if (entries.length >= GLOBAL_SEARCH_HISTORY_LIMIT) {
      break;
    }
  }
  return entries;
}

export function formatCellAddress(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function formatSearchPreview(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function collectFileMatches(
  data: CsvMatrix,
  file: SearchableCsvFile,
  lowerQuery: string,
  results: GlobalSearchSnapshot["results"]
): void {
  if (!lowerQuery) {
    return;
  }
  const maxCols = maxColumnCount(data);
  for (let row = 0; row < data.length; row += 1) {
    for (let col = 0; col < maxCols; col += 1) {
      const value = readCell(data, row, col);
      if (!value.toLowerCase().includes(lowerQuery)) {
        continue;
      }
      const cell = formatCellAddress(row, col);
      results.push({
        id: `${file.path}:${row}:${col}`,
        fileName: file.name,
        filePath: file.path,
        relativePath: file.relativePath,
        row,
        col,
        cell,
        value,
        preview: formatMatchedPreview(value, lowerQuery),
        primaryKey: buildPrimaryKey(data, row),
        fieldName: buildFieldName(data, col),
        contextBefore: buildVerticalContext(data, row - 1, col),
        contextAfter: buildVerticalContext(data, row + 1, col),
        rowContext: buildRowContext(data, row, col)
      });
    }
  }
}

function buildSnapshot(snapshot: GlobalSearchSnapshot): GlobalSearchSnapshot {
  return {
    ...snapshot,
    results: [...snapshot.results],
    errors: [...snapshot.errors]
  };
}

function buildVerticalContext(data: CsvMatrix, row: number, col: number): string {
  if (row < 0 || row >= data.length) {
    return "";
  }
  return formatSearchPreview(readCell(data, row, col), 84);
}

function buildPrimaryKey(data: CsvMatrix, row: number): string {
  return formatSearchPreview(readCell(data, row, PRIMARY_KEY_COLUMN_INDEX), 72);
}

function buildFieldName(data: CsvMatrix, col: number): string {
  return formatSearchPreview(readCell(data, FIELD_NAME_ROW_INDEX, col), 84);
}

function buildRowContext(data: CsvMatrix, row: number, col: number): string {
  const values: string[] = [];
  const startCol = Math.max(0, col - 2);
  const endCol = Math.min(maxColumnCount(data) - 1, col + 2);
  for (let currentCol = startCol; currentCol <= endCol; currentCol += 1) {
    const value = formatSearchPreview(readCell(data, row, currentCol), 52);
    if (!value) {
      continue;
    }
    values.push(value);
  }
  return values.join(" / ");
}

function formatMatchedPreview(value: string, lowerQuery: string, maxLength = 150): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const matchIndex = normalized.toLowerCase().indexOf(lowerQuery);
  if (matchIndex < 0) {
    return formatSearchPreview(normalized, maxLength);
  }
  const contextBefore = Math.floor((maxLength - lowerQuery.length) * 0.42);
  const start = Math.max(0, matchIndex - Math.max(24, contextBefore));
  const end = Math.min(normalized.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function createGlobalSearchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `global-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function columnName(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label || "A";
}

function sanitizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function sanitizeResults(value: unknown): GlobalSearchSnapshot["results"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): GlobalSearchSnapshot["results"] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<GlobalSearchSnapshot["results"][number]>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.fileName !== "string" ||
      typeof candidate.filePath !== "string" ||
      typeof candidate.relativePath !== "string" ||
      typeof candidate.row !== "number" ||
      typeof candidate.col !== "number" ||
      typeof candidate.cell !== "string" ||
      typeof candidate.value !== "string" ||
      typeof candidate.preview !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        fileName: candidate.fileName,
        filePath: candidate.filePath,
        relativePath: candidate.relativePath,
        row: Math.max(0, Math.floor(candidate.row)),
        col: Math.max(0, Math.floor(candidate.col)),
        cell: candidate.cell,
        value: candidate.value,
        preview: candidate.preview,
        primaryKey: typeof candidate.primaryKey === "string" ? candidate.primaryKey : "",
        fieldName: typeof candidate.fieldName === "string" ? candidate.fieldName : "",
        contextBefore: typeof candidate.contextBefore === "string" ? candidate.contextBefore : "",
        contextAfter: typeof candidate.contextAfter === "string" ? candidate.contextAfter : "",
        rowContext: typeof candidate.rowContext === "string" ? candidate.rowContext : ""
      }
    ];
  });
}

function sanitizeErrors(value: unknown): GlobalSearchSnapshot["errors"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): GlobalSearchSnapshot["errors"] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<GlobalSearchSnapshot["errors"][number]>;
    if (
      typeof candidate.fileName !== "string" ||
      typeof candidate.filePath !== "string" ||
      typeof candidate.relativePath !== "string" ||
      typeof candidate.message !== "string"
    ) {
      return [];
    }
    return [
      {
        fileName: candidate.fileName,
        filePath: candidate.filePath,
        relativePath: candidate.relativePath,
        message: candidate.message
      }
    ];
  });
}
