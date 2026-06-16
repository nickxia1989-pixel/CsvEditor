import { describe, expect, it } from "vitest";
import { decodeTextBuffer, encodeTextBuffer } from "./textDecode";

describe("text decoding", () => {
  it("keeps UTF-8 as the default when it decodes cleanly", () => {
    const result = decodeTextBuffer(new TextEncoder().encode("\uFEFFID,Name\n1,测试"));
    expect(result.encoding).toBe("utf-8");
    expect(result.text.startsWith("\uFEFF")).toBe(true);
    expect(result.replacementCount).toBe(0);
  });

  it("falls back to GB18030 when UTF-8 would produce replacement characters", () => {
    const result = decodeTextBuffer(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]));
    expect(result.encoding).toBe("gb18030");
    expect(result.text).toBe("中文");
    expect(result.replacementCount).toBe(0);
  });

  it("encodes UTF-8 text to bytes instead of delegating string writes", () => {
    const encoded = encodeTextBuffer("\uFEFFID,测试\r\n", "utf-8");

    expect(ArrayBuffer.isView(encoded)).toBe(true);
    expect([...encoded.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoded)).toBe("\uFEFFID,测试\r\n");
  });

  it("encodes GB18030 text back to bytes for safe legacy CSV saves", () => {
    const encoded = encodeTextBuffer("ID,中文\r\n", "gb18030");

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect([...(encoded as Uint8Array)]).toEqual([0x49, 0x44, 0x2c, 0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a]);
    expect(new TextDecoder("gb18030").decode(encoded as Uint8Array)).toBe("ID,中文\r\n");
  });

  it("blocks GB18030 saves when a character cannot be represented safely", () => {
    expect(() => encodeTextBuffer("emoji 😀", "gb18030")).toThrow("无法用 GB18030 保存");
  });
});
