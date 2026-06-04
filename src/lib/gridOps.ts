import { maxColumnCount } from "./csv";
import type { CsvMatrix } from "../types";

type CellPosition = {
  row: number;
  col: number;
};

export function insertRows(data: CsvMatrix, atRow: number, count: number): CsvMatrix {
  const rowCount = Math.max(1, count);
  const width = Math.max(1, maxColumnCount(data));
  const target = clamp(atRow, 0, data.length);
  const inserted = Array.from({ length: rowCount }, () => Array.from({ length: width }, () => ""));
  return [...data.slice(0, target), ...inserted, ...data.slice(target)];
}

export function deleteRows(data: CsvMatrix, startRow: number, endRow: number): CsvMatrix {
  const range = normalizeRange(startRow, endRow, 0, Math.max(0, data.length - 1));
  const width = Math.max(1, maxColumnCount(data));
  const next = data.filter((_, row) => row < range.start || row > range.end);
  return next.length > 0 ? next : [Array.from({ length: width }, () => "")];
}

export function insertColumns(data: CsvMatrix, atCol: number, count: number): CsvMatrix {
  const colCount = Math.max(1, count);
  const width = maxColumnCount(data);
  const target = clamp(atCol, 0, width);
  const rows = data.length > 0 ? data : [[]];
  return rows.map((row) => {
    const normalized = [...row];
    while (normalized.length < target) {
      normalized.push("");
    }
    return [
      ...normalized.slice(0, target),
      ...Array.from({ length: colCount }, () => ""),
      ...normalized.slice(target)
    ];
  });
}

export function deleteColumns(data: CsvMatrix, startCol: number, endCol: number): CsvMatrix {
  const width = Math.max(1, maxColumnCount(data));
  const range = normalizeRange(startCol, endCol, 0, width - 1);
  const rows = data.length > 0 ? data : [[]];
  return rows.map((row) => [...row.slice(0, range.start), ...row.slice(range.end + 1)]);
}

export function shiftLockedCellsForInsertedRows(lockedCells: string[], atRow: number, count: number): string[] {
  return mapLockedCells(lockedCells, ({ row, col }) => ({
    row: row >= atRow ? row + count : row,
    col
  }));
}

export function shiftLockedCellsForDeletedRows(lockedCells: string[], startRow: number, endRow: number): string[] {
  const range = normalizeRange(startRow, endRow, 0, Number.MAX_SAFE_INTEGER);
  const deletedCount = range.end - range.start + 1;
  return mapLockedCells(lockedCells, ({ row, col }) => {
    if (row >= range.start && row <= range.end) {
      return null;
    }
    return {
      row: row > range.end ? row - deletedCount : row,
      col
    };
  });
}

export function shiftLockedCellsForInsertedColumns(lockedCells: string[], atCol: number, count: number): string[] {
  return mapLockedCells(lockedCells, ({ row, col }) => ({
    row,
    col: col >= atCol ? col + count : col
  }));
}

export function shiftLockedCellsForDeletedColumns(lockedCells: string[], startCol: number, endCol: number): string[] {
  const range = normalizeRange(startCol, endCol, 0, Number.MAX_SAFE_INTEGER);
  const deletedCount = range.end - range.start + 1;
  return mapLockedCells(lockedCells, ({ row, col }) => {
    if (col >= range.start && col <= range.end) {
      return null;
    }
    return {
      row,
      col: col > range.end ? col - deletedCount : col
    };
  });
}

export function hasLockedCellInRows(lockedCells: string[], startRow: number, endRow: number): boolean {
  const range = normalizeRange(startRow, endRow, 0, Number.MAX_SAFE_INTEGER);
  return lockedCells.some((key) => {
    const position = parseCellKey(key);
    return Boolean(position && position.row >= range.start && position.row <= range.end);
  });
}

export function hasLockedCellInColumns(lockedCells: string[], startCol: number, endCol: number): boolean {
  const range = normalizeRange(startCol, endCol, 0, Number.MAX_SAFE_INTEGER);
  return lockedCells.some((key) => {
    const position = parseCellKey(key);
    return Boolean(position && position.col >= range.start && position.col <= range.end);
  });
}

function mapLockedCells(
  lockedCells: string[],
  mapper: (position: CellPosition) => CellPosition | null
): string[] {
  const next = new Set<string>();
  for (const key of lockedCells) {
    const position = parseCellKey(key);
    if (!position) {
      continue;
    }
    const mapped = mapper(position);
    if (mapped && mapped.row >= 0 && mapped.col >= 0) {
      next.add(`${mapped.row}:${mapped.col}`);
    }
  }
  return [...next];
}

function parseCellKey(key: string): CellPosition | null {
  const [rowText, colText] = key.split(":");
  const row = Number(rowText);
  const col = Number(colText);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return null;
  }
  return { row, col };
}

function normalizeRange(start: number, end: number, min: number, max: number): { start: number; end: number } {
  return {
    start: clamp(Math.min(start, end), min, max),
    end: clamp(Math.max(start, end), min, max)
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
