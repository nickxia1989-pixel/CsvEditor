import Papa from "papaparse";
import type { CsvMatrix } from "../types";

export type ParsedCsv = {
  data: CsvMatrix;
  delimiter: string;
  newline: string;
  hasBom: boolean;
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

  return {
    data,
    delimiter: parsed.meta.delimiter || ",",
    newline: detectNewline(normalizedText),
    hasBom
  };
}

export function unparseCsvData(data: CsvMatrix, delimiter: string, newline: string, hasBom = false): string {
  const text = Papa.unparse(data, {
    delimiter: delimiter || ",",
    newline: newline || "\n"
  });
  return hasBom ? `\uFEFF${text}` : text;
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
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => line.split("\t"));
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
