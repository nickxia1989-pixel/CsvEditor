export type DecodedText = {
  text: string;
  encoding: string;
  replacementCount: number;
};

const CANDIDATE_ENCODINGS = ["utf-8", "gb18030"];
let gb18030EncodeMap: Map<string, number[]> | null = null;

export function decodeTextBuffer(buffer: ArrayBuffer | Uint8Array): DecodedText {
  const results = CANDIDATE_ENCODINGS.flatMap((encoding) => {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false, ignoreBOM: true });
      const text = decoder.decode(buffer);
      return [{ text, encoding, replacementCount: countReplacementCharacters(text) }];
    } catch {
      return [];
    }
  });

  if (results.length === 0) {
    throw new Error("当前运行环境没有可用的文本解码器。");
  }

  return results.sort((left, right) => {
    if (left.replacementCount !== right.replacementCount) {
      return left.replacementCount - right.replacementCount;
    }
    return left.encoding === "utf-8" ? -1 : 1;
  })[0];
}

export function countReplacementCharacters(text: string): number {
  return text.match(/\uFFFD/g)?.length ?? 0;
}

export function encodeTextBuffer(text: string, encoding: string): string | Uint8Array {
  const normalized = encoding.toLowerCase();
  if (normalized === "utf-8" || normalized === "utf8") {
    return text;
  }
  if (normalized === "gb18030") {
    return encodeGb18030(text);
  }
  throw new Error(`暂不支持保存 ${encoding.toUpperCase()} 编码的文件。`);
}

function encodeGb18030(text: string): Uint8Array {
  const map = getGb18030EncodeMap();
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }
    const encoded = map.get(char);
    if (!encoded) {
      throw new Error(`字符 U+${codePoint.toString(16).toUpperCase()} 无法用 GB18030 保存。`);
    }
    bytes.push(...encoded);
  }
  return new Uint8Array(bytes);
}

function getGb18030EncodeMap(): Map<string, number[]> {
  if (gb18030EncodeMap) {
    return gb18030EncodeMap;
  }

  const decoder = new TextDecoder("gb18030", { fatal: false, ignoreBOM: true });
  const next = new Map<string, number[]>();
  const addDecoded = (bytes: number[]) => {
    const decoded = decoder.decode(new Uint8Array(bytes));
    if (!decoded || decoded.includes("\uFFFD")) {
      return;
    }
    if (!next.has(decoded)) {
      next.set(decoded, bytes);
    }
  };

  for (let byte = 0x80; byte <= 0xff; byte += 1) {
    addDecoded([byte]);
  }

  for (let first = 0x81; first <= 0xfe; first += 1) {
    for (let second = 0x40; second <= 0xfe; second += 1) {
      if (second === 0x7f) {
        continue;
      }
      addDecoded([first, second]);
    }
  }

  gb18030EncodeMap = next;
  return next;
}
