const DEFAULT_MAX_LEN = 3900;

export function chunkText(text: string, maxLen: number = DEFAULT_MAX_LEN): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const splitIndex = findSplitPoint(remaining, maxLen);
    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (chunks.length === 0) {
    return [""];
  }

  return chunks;
}

function findSplitPoint(text: string, maxLen: number): number {
  const paragraphBreak = text.lastIndexOf("\n\n", maxLen);
  if (paragraphBreak > 0) return paragraphBreak;

  const newlineBreak = text.lastIndexOf("\n", maxLen);
  if (newlineBreak > 0) return newlineBreak;

  for (const sep of [". ", "? ", "! "]) {
    const sentenceBreak = text.lastIndexOf(sep, maxLen);
    if (sentenceBreak > 0) return sentenceBreak + sep.length;
  }

  return maxLen;
}
