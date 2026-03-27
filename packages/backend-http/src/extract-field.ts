/**
 * Extract a value from a nested object using a dot-separated path.
 *
 * Supports numeric segments for array indexing:
 *   "answer"                    -> obj.answer
 *   "result.text"               -> obj.result.text
 *   "choices.0.message.content" -> obj.choices[0].message.content
 */
export function extractField(obj: unknown, dotPath: string): string | undefined {
  let current: unknown = obj;
  for (const segment of dotPath.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}
