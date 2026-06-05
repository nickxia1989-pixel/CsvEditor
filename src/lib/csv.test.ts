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

  it("does not create an extra row for a trailing TSV newline", () => {
    expect(parseTsv("A\tB\nC\tD\n")).toEqual([
      ["A", "B"],
      ["C", "D"]
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
