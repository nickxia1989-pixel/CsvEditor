import { describe, expect, it } from "vitest";
import {
  findCell,
  matrixToTsv,
  parseCsvText,
  parseTsv,
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
});
