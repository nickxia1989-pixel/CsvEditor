export type DecodedText = {
  text: string;
  encoding: string;
  replacementCount: number;
};

const CANDIDATE_ENCODINGS = ["utf-8", "gb18030"];

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
