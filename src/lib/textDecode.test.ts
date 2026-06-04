import { describe, expect, it } from "vitest";
import { decodeTextBuffer } from "./textDecode";

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
});
