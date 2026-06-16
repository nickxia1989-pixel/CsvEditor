import { describe, expect, it } from "vitest";
import {
  findCell,
  matrixToTsv,
  parseCsvText,
  parseTsv,
  replaceAllCellText,
  replaceCellText,
  readCell,
  unparseCsvData,
  writeCell
} from "./csv";

describe("csv helpers", () => {
  it("keeps quoted commas and CRLF newline metadata", () => {
    const parsed = parseCsvText('ID,Name,Desc\r\n1,Slime,"slow, green"\r\n');
    expect(parsed.newline).toBe("\r\n");
    expect(parsed.delimiter).toBe(",");
    expect(parsed.data).toEqual([
      ["ID", "Name", "Desc"],
      ["1", "Slime", "slow, green"]
    ]);
  });

  it("detects row separators outside quoted multiline fields", () => {
    const parsed = parseCsvText('"Line 1\r\nLine 2\r\nLine 3",Desc\n1,Original\n');
    const next = parsed.data.map((row) => [...row]);
    next[1][1] = "Changed";

    expect(parsed.newline).toBe("\n");
    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('"Line 1\r\nLine 2\r\nLine 3",Desc\n1,Changed\n');
  });

  it("keeps CRLF row separators when quoted fields contain more LF newlines", () => {
    const parsed = parseCsvText('ID,Notes\r\n1,"a\nb\nc\nd"\r\n');
    const next = parsed.data.map((row) => [...row]);
    next[0][0] = "Key";

    expect(parsed.newline).toBe("\r\n");
    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('Key,Notes\r\n1,"a\nb\nc\nd"\r\n');
  });

  it("expands sparse writes without mutating the original matrix", () => {
    const original = [["A"]];
    const next = writeCell(original, 2, 2, "Z");
    expect(original).toEqual([["A"]]);
    expect(readCell(next, 2, 2)).toBe("Z");
    expect(readCell(next, 1, 1)).toBe("");
  });

  it("round-trips tsv clipboard payloads", () => {
    const tsv = matrixToTsv(
      [
        ["A", "B"],
        ["C", "D"]
      ],
      0,
      0,
      1,
      1
    );
    expect(tsv).toBe("A\tB\nC\tD");
    expect(parseTsv(tsv)).toEqual([
      ["A", "B"],
      ["C", "D"]
    ]);
  });

  it("quotes TSV clipboard values that contain tabs, newlines, or quotes", () => {
    const tsv = matrixToTsv(
      [["A\tinside", "Line 1\nLine 2", 'He said "Hi"']],
      0,
      0,
      0,
      2
    );

    expect(tsv).toBe('"A\tinside"\t"Line 1\nLine 2"\t"He said ""Hi"""');
    expect(parseTsv(tsv)).toEqual([["A\tinside", "Line 1\nLine 2", 'He said "Hi"']]);
  });

  it("does not create an extra row for a trailing TSV newline", () => {
    expect(parseTsv("A\tB\nC\tD\n")).toEqual([
      ["A", "B"],
      ["C", "D"]
    ]);
  });

  it("parses Excel-style quoted TSV clipboard values", () => {
    expect(parseTsv('"A\tinside"\t"Line 1\nLine 2"\t"He said ""Hi"""')).toEqual([
      ["A\tinside", "Line 1\nLine 2", 'He said "Hi"']
    ]);
  });

  it("serializes using the detected delimiter", () => {
    const text = unparseCsvData(
      [
        ["A", "B"],
        ["1", "2"]
      ],
      ";",
      "\n"
    );
    expect(text).toBe("A;B\n1;2");
  });

  it("preserves untouched source rows exactly when saving", () => {
    const original = '34,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n';
    const parsed = parseCsvText(original);

    expect(unparseCsvData(
      parsed.data,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe(original);
  });

  it("only reserializes changed rows and keeps untouched CSV formatting", () => {
    const original = '34,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n';
    const parsed = parseCsvText(original);
    const next = parsed.data.map((row) => [...row]);
    next[2][1] = "伊莉亚改";

    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('34,测试lilifute ,测试\r\n""\r\n35,伊莉亚改,测试\r\n');
  });

  it("preserves unchanged raw fields inside a changed source row", () => {
    const original = '34,测试lilifute ,测试\r\n';
    const parsed = parseCsvText(original);
    const next = parsed.data.map((row) => [...row]);
    next[0][0] = "340";

    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('340,测试lilifute ,测试\r\n');
  });

  it("serializes changed fields while preserving unchanged raw neighbors", () => {
    const original = '34,测试lilifute ,测试\r\n';
    const parsed = parseCsvText(original);
    const next = parsed.data.map((row) => [...row]);
    next[0][2] = "new,value";

    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('34,测试lilifute ,"new,value"\r\n');
  });

  it("preserves raw source fields when a row is widened", () => {
    const original = '34,"keep,comma",测试lilifute \r\n';
    const parsed = parseCsvText(original);
    const next = parsed.data.map((row) => [...row, "added"]);

    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe('34,"keep,comma",测试lilifute ,added\r\n');
  });

  it("pads changed ragged rows to the current table width", () => {
    const original = "A,B,C\r\n1\r\n";
    const parsed = parseCsvText(original);
    const next = parsed.data.map((row) => [...row]);
    next[1][0] = "2";

    expect(unparseCsvData(
      next,
      parsed.delimiter,
      parsed.newline,
      parsed.hasBom,
      parsed.sourceRows,
      parsed.trailingNewline
    )).toBe("A,B,C\r\n2,,\r\n");
  });

  it("pads virtual blank rows when saving sparse edits", () => {
    const data = writeCell(
      [
        ["A", "B", "C"],
        ["1", "2", "3"]
      ],
      3,
      0,
      "new"
    );

    expect(unparseCsvData(data, ",", "\n")).toBe("A,B,C\n1,2,3\n,,\nnew,,");
  });

  it("strips BOM while parsing and restores it when serializing", () => {
    const parsed = parseCsvText("\uFEFFA,B\n1,2");
    expect(parsed.hasBom).toBe(true);
    expect(parsed.data[0][0]).toBe("A");
    expect(unparseCsvData(parsed.data, parsed.delimiter, parsed.newline, parsed.hasBom).startsWith("\uFEFF")).toBe(true);
  });

  it("finds cells forward, backward, and with wrapping", () => {
    const data = [
      ["ID", "Name"],
      ["1001", "Training Slime"],
      ["1002", "Forest Wolf"]
    ];
    expect(findCell(data, "forest", 0, 0, "next")).toEqual({ row: 2, col: 1 });
    expect(findCell(data, "name", 0, 0, "previous")).toEqual({ row: 0, col: 1 });
    expect(findCell(data, "missing", 0, 0, "next")).toBeNull();
  });

  it("replaces a single matching cell", () => {
    expect(replaceCellText([["Forest Wolf"]], 0, 0, "wolf", "Cat")).toEqual([["Forest Cat"]]);
    expect(replaceCellText([["Forest Wolf"]], 0, 0, "missing", "Cat")).toEqual([["Forest Wolf"]]);
  });

  it("replaces all matches while skipping locked cells", () => {
    const result = replaceAllCellText(
      [
        ["Wolf", "Wolf Wolf"],
        ["Locked Wolf", "Cat"]
      ],
      "wolf",
      "Fox",
      new Set(["1:0"])
    );
    expect(result.count).toBe(3);
    expect(result.data).toEqual([
      ["Fox", "Fox Fox"],
      ["Locked Wolf", "Cat"]
    ]);
  });
});
