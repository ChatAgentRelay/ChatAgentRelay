import { describe, expect, it } from "bun:test";
import { chunkText } from "../src/chunk-text";

describe("chunkText", () => {
  it("returns single chunk when text is under limit", () => {
    const result = chunkText("Hello, world!", 100);
    expect(result).toEqual(["Hello, world!"]);
  });

  it("returns single chunk when text is exactly at limit", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, 100);
    expect(result).toEqual([text]);
  });

  it("splits at paragraph boundaries first", () => {
    const para1 = "a".repeat(50);
    const para2 = "b".repeat(50);
    const text = `${para1}\n\n${para2}`;
    const result = chunkText(text, 60);
    expect(result).toEqual([para1, para2]);
  });

  it("splits at newline boundaries when no paragraph break fits", () => {
    const line1 = "a".repeat(50);
    const line2 = "b".repeat(50);
    const text = `${line1}\n${line2}`;
    const result = chunkText(text, 60);
    expect(result).toEqual([line1, line2]);
  });

  it("splits at sentence boundaries when no newline fits", () => {
    const sentence1 = "a".repeat(40);
    const sentence2 = "b".repeat(40);
    const text = `${sentence1}. ${sentence2}`;
    const result = chunkText(text, 50);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(`${sentence1}.`);
    expect(result[1]).toBe(sentence2);
  });

  it("hard splits when no natural break point exists", () => {
    const text = "a".repeat(200);
    const result = chunkText(text, 100);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("a".repeat(100));
    expect(result[1]).toBe("a".repeat(100));
  });

  it("returns [''] for empty string input", () => {
    const result = chunkText("");
    expect(result).toEqual([""]);
  });

  it("uses default maxLen of 3900", () => {
    const shortText = "a".repeat(3900);
    expect(chunkText(shortText)).toEqual([shortText]);

    const longText = "a".repeat(3901);
    expect(chunkText(longText).length).toBe(2);
  });

  it("handles multiple paragraph splits", () => {
    const paras = Array.from({ length: 5 }, (_, i) => String.fromCharCode(97 + i).repeat(30));
    const text = paras.join("\n\n");
    const result = chunkText(text, 70);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(70);
    }
  });
});
