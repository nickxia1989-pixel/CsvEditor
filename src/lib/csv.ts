import Papa from "papaparse";
import type { CsvMatrix } from "../types";

export type ParsedCsv = {
  data: CsvMatrix;
  delimiter: string;
  newline: string;
  hasBom: boolean;
  sourceRows: CsvSourceRow[];
  trailingNewline: boolean;
};

export type CsvSourceRow = {
  raw: string;
  data: string[];
};

export function detectNewline(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf >= lf ? "\r\n" : "\n";
}

export function parseCsvText(text: string): ParsedCsv {
  const hasBom = text.startsWith("\uFEFF");
  const normalizedText = hasBom ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(normalizedText, {
    delimiter: "",
    skipEmptyLines: false,
    dynamicTyping: false
  });

  const seriousError = parsed.errors.find((error) => error.type !== "Delimiter");
  if (seriousError) {
    throw new Error(`CSV parse failed at row ${seriousError.row ?? "?"}: ${seriousError.message}`);
  }

  const data = parsed.data.map((row) => row.map((value) => value ?? ""));
  if (normalizedText.length > 0 && /(\r\n|\n|\r)$/.test(normalizedText)) {
    const last = data[data.length - 1];
    if (last && last.length === 1 && last[0] === "") {
      data.pop();
    }
  }

  const rawRows = splitCsvRecords(normalizedText);
  return {
    data,
    delimiter: parsed.meta.delimiter || ",",
    newline: detectNewline(normalizedText),
    hasBom,
    sourceRows: data.map((row, index) => ({
      raw: rawRows[index] ?? unparseCsvData([row], parsed.meta.delimiter || ",", "\n", false),
      data: [...row]
    })),
    trailingNewline: normalizedText.length > 0 && /(\r\n|\n|\r)$/.test(normalizedText)
  };
}

export function unparseCsvData(
  data: CsvMatrix,
  delimiter: string,
  newline: string,
  hasBom = false,
  sourceRows: CsvSourceRow[] = [],
  trailingNewline = false
): string {
  const separator = newline || "\n";
  const text = data
    .map((row, index) => {
      const sourceRow = sourceRows[index];
      if (sourceRow && rowsEqual(row, sourceRow.data)) {
        return sourceRow.raw;
      }
      return Papa.unparse([row], {
        delimiter: delimiter || ",",
        newline: separator
      });
    })
    .join(separator);
  const withFinalNewline = trailingNewline && text.length > 0 ? `${text}${separator}` : text;
  return hasBom ? `\uFEFF${withFinalNewline}` : withFinalNewline;
}

export function readCell(data: CsvMatrix, row: number, col: number): string {
  return data[row]?.[col] ?? "";
}

export function writeCell(data: CsvMatrix, row: number, col: number, value: string): CsvMatrix {
  const next = data.map((line) => [...line]);
  while (next.length <= row) {
    next.push([]);
  }
  while (next[row].length <= col) {
    next[row].push("");
  }
  next[row][col] = value;
  return next;
}

export function writeRange(data: CsvMatrix, startRow: number, startCol: number, values: string[][]): CsvMatrix {
  let next = data.map((line) => [...line]);
  values.forEach((line, rowOffset) => {
    line.forEach((value, colOffset) => {
      next = writeCell(next, startRow + rowOffset, startCol + colOffset, value);
    });
  });
  return next;
}

export function clearRange(
  data: CsvMatrix,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): CsvMatrix {
  let next = data.map((line) => [...line]);
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      next = writeCell(next, row, col, "");
    }
  }
  return next;
}

export function matrixToTsv(
  data: CsvMatrix,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): string {
  const rows: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const values: string[] = [];
    for (let col = startCol; col <= endCol; col += 1) {
      values.push(readCell(data, row, col));
    }
    rows.push(values.join("\t"));
  }
  return rows.join("\n");
}

export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.map((line) => line.split("\t"));
}

export function maxColumnCount(data: CsvMatrix): number {
  return data.reduce((max, row) => Math.max(max, row.length), 0);
}

export function findCell(
  data: CsvMatrix,
  query: string,
  fromRow: number,
  fromCol: number,
  direction: "next" | "previous"
): { row: number; col: number } | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  const rowCount = data.length;
  const colCount = maxColumnCount(data);
  const totalCells = rowCount * colCount;
  if (totalCells === 0 || colCount === 0) {
    return null;
  }

  const clampedRow = Math.max(0, Math.min(rowCount - 1, fromRow));
  const clampedCol = Math.max(0, Math.min(colCount - 1, fromCol));
  const startIndex = clampedRow * colCount + clampedCol;
  const step = direction === "next" ? 1 : -1;

  for (let offset = 1; offset <= totalCells; offset += 1) {
    const index = (startIndex + step * offset + totalCells) % totalCells;
    const row = Math.floor(index / colCount);
    const col = index % colCount;
    if (readCell(data, row, col).toLowerCase().includes(normalizedQuery)) {
      return { row, col };
    }
  }

  return null;
}

function splitCsvRecords(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const rows: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) {
      continue;
    }
    if (char === "\r" || char === "\n") {
      rows.push(text.slice(start, index));
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      start = index + 1;
    }
  }

  if (start < text.length) {
    rows.push(text.slice(start));
  }
  return rows;
}

function rowsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function replaceCellText(data: CsvMatrix, row: number, col: number, query: string, replacement: string): CsvMatrix {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return data;
  }
  const current = readCell(data, row, col);
  const index = current.toLowerCase().indexOf(normalizedQuery.toLowerCase());
  if (index < 0) {
    return data;
  }
  return writeCell(
    data,
    row,
    col,
    `${current.slice(0, index)}${replacement}${current.slice(index + normalizedQuery.length)}`
  );
}

export function replaceAllCellText(
  data: CsvMatrix,
  query: string,
  replacement: string,
  lockedCells: Set<string>
): { data: CsvMatrix; count: number } {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { data, count: 0 };
  }

  let next = data;
  let count = 0;
  const lowerQuery = normalizedQuery.toLowerCase();
  for (let row = 0; row < data.length; row += 1) {
    for (let col = 0; col < data[row].length; col += 1) {
      if (lockedCells.has(`${row}:${col}`)) {
        continue;
      }
      const current = readCell(next, row, col);
      const lowerCurrent = current.toLowerCase();
      if (!lowerCurrent.includes(lowerQuery)) {
        continue;
      }
      let cursor = 0;
      let replaced = "";
      let matchIndex = lowerCurrent.indexOf(lowerQuery, cursor);
      while (matchIndex >= 0) {
        replaced += `${current.slice(cursor, matchIndex)}${replacement}`;
        cursor = matchIndex + normalizedQuery.length;
        count += 1;
        matchIndex = lowerCurrent.indexOf(lowerQuery, cursor);
      }
      replaced += current.slice(cursor);
      next = writeCell(next, row, col, replaced);
    }
  }

  return { data: next, count };
}
