import Papa from "papaparse";
import type { CsvMatrix } from "../types";

export type ParsedCsv = {
  data: CsvMatrix;
  delimiter: string;
  newline: string;
};

export function detectNewline(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf >= lf ? "\r\n" : "\n";
}

export function parseCsvText(text: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(text, {
    delimiter: "",
    skipEmptyLines: false,
    dynamicTyping: false
  });

  const seriousError = parsed.errors.find((error) => error.type !== "Delimiter");
  if (seriousError) {
    throw new Error(`CSV parse failed at row ${seriousError.row ?? "?"}: ${seriousError.message}`);
  }

  const data = parsed.data.map((row) => row.map((value) => value ?? ""));
  if (text.length > 0 && /(\r\n|\n|\r)$/.test(text)) {
    const last = data[data.length - 1];
    if (last && last.length === 1 && last[0] === "") {
      data.pop();
    }
  }

  return {
    data,
    delimiter: parsed.meta.delimiter || ",",
    newline: detectNewline(text)
  };
}

export function unparseCsvData(data: CsvMatrix, delimiter: string, newline: string): string {
  return Papa.unparse(data, {
    delimiter: delimiter || ",",
    newline: newline || "\n"
  });
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
