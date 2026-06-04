import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Papa from "papaparse";

const defaultTablesDir = "D:\\2D_AI_WORKING\\Tables";
const rootDir = process.argv[2] ?? process.env.CSV_TABLES_DIR ?? defaultTablesDir;

const start = performance.now();
const files = await collectCsvFiles(rootDir);
const failures = [];
const warnings = [];
const largest = [];
let totalRows = 0;
let totalBytes = 0;
let maxColumns = 0;
const encodingCounts = new Map();

for (const filePath of files) {
  const stat = await fs.stat(filePath);
  const buffer = await fs.readFile(filePath);
  const decoded = decodeTextBuffer(buffer);
  const text = decoded.text;
  encodingCounts.set(decoded.encoding, (encodingCounts.get(decoded.encoding) ?? 0) + 1);
  const parsed = Papa.parse(text.startsWith("\uFEFF") ? text.slice(1) : text, {
    delimiter: "",
    skipEmptyLines: false,
    dynamicTyping: false
  });
  const seriousErrors = parsed.errors.filter((error) => error.type !== "Delimiter");
  if (seriousErrors.length > 0) {
    failures.push({
      file: path.relative(rootDir, filePath),
      errors: seriousErrors.slice(0, 3).map((error) => ({
        row: error.row ?? "?",
        code: error.code,
        message: error.message
      }))
    });
  }
  if (decoded.replacementCount > 0) {
    warnings.push(path.relative(rootDir, filePath));
  }

  const rows = Array.isArray(parsed.data) ? parsed.data.length : 0;
  const columns = Array.isArray(parsed.data)
    ? parsed.data.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    : 0;
  totalRows += rows;
  totalBytes += stat.size;
  maxColumns = Math.max(maxColumns, columns);
  largest.push({
    file: path.relative(rootDir, filePath),
    bytes: stat.size,
    rows,
    columns
  });
}

largest.sort((left, right) => right.bytes - left.bytes);
const elapsed = Math.round(performance.now() - start);

console.log(`CSV tables root: ${rootDir}`);
console.log(`CSV files parsed: ${files.length}`);
console.log(`Total rows: ${totalRows}`);
console.log(`Total bytes: ${totalBytes}`);
console.log(`Max columns: ${maxColumns}`);
console.log(`Elapsed: ${elapsed}ms`);
console.log(`Encodings: ${[...encodingCounts.entries()].map(([encoding, count]) => `${encoding}=${count}`).join(", ")}`);
console.log("Largest files:");
for (const item of largest.slice(0, 8)) {
  console.log(`- ${item.file} | ${item.bytes} bytes | ${item.rows} rows | ${item.columns} columns`);
}

if (warnings.length > 0) {
  console.warn(`Files containing U+FFFD replacement characters: ${warnings.length}`);
  for (const file of warnings.slice(0, 10)) {
    console.warn(`- ${file}`);
  }
}

if (failures.length > 0) {
  console.error(`CSV parse failures: ${failures.length}`);
  for (const failure of failures.slice(0, 10)) {
    console.error(`- ${failure.file}`);
    for (const error of failure.errors) {
      console.error(`  row ${error.row}: ${error.code} ${error.message}`);
    }
  }
  process.exitCode = 1;
}

async function collectCsvFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectCsvFiles(fullPath);
      }
      return entry.isFile() && entry.name.toLowerCase().endsWith(".csv") ? [fullPath] : [];
    })
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function decodeTextBuffer(buffer) {
  const results = ["utf-8", "gb18030"].flatMap((encoding) => {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false, ignoreBOM: true });
      const text = decoder.decode(buffer);
      return [{ text, encoding, replacementCount: countReplacementCharacters(text) }];
    } catch {
      return [];
    }
  });

  if (results.length === 0) {
    throw new Error("No text decoder is available.");
  }

  return results.sort((left, right) => {
    if (left.replacementCount !== right.replacementCount) {
      return left.replacementCount - right.replacementCount;
    }
    return left.encoding === "utf-8" ? -1 : 1;
  })[0];
}

function countReplacementCharacters(text) {
  return text.match(/\uFFFD/g)?.length ?? 0;
}
