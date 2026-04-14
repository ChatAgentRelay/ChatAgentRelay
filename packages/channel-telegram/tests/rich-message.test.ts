import { describe, expect, it } from "bun:test";
import type { RichMessage } from "@chat-agent-relay/contract-harness";
import { escapeMarkdownV2, richMessageToMarkdownV2 } from "../src/rich-message";

describe("escapeMarkdownV2", () => {
  it("escapes Telegram MarkdownV2 reserved characters", () => {
    expect(escapeMarkdownV2("a_b*c[d]")).toBe("a\\_b\\*c\\[d\\]");
  });
});

describe("richMessageToMarkdownV2", () => {
  it("maps text blocks to escaped plain text", () => {
    const msg: RichMessage = {
      blocks: [{ type: "text", text: "Hello *world*" }],
      fallbackText: "fb",
    };
    expect(richMessageToMarkdownV2(msg)).toBe("Hello \\*world\\*");
  });

  it("maps code blocks to fenced markdown", () => {
    const msg: RichMessage = {
      blocks: [{ type: "code", text: "const x = 1;", language: "ts" }],
      fallbackText: "fb",
    };
    const out = richMessageToMarkdownV2(msg);
    expect(out).toContain("```ts");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("```");
  });

  it("maps header blocks to bold (MarkdownV2 asterisks)", () => {
    const msg: RichMessage = {
      blocks: [{ type: "header", text: "Title" }],
      fallbackText: "fb",
    };
    expect(richMessageToMarkdownV2(msg)).toBe("*Title*");
  });

  it("maps divider blocks to em dash line", () => {
    const msg: RichMessage = {
      blocks: [{ type: "divider" }],
      fallbackText: "fb",
    };
    expect(richMessageToMarkdownV2(msg)).toBe("———");
  });

  it("joins blocks with blank lines", () => {
    const msg: RichMessage = {
      blocks: [
        { type: "header", text: "H" },
        { type: "text", text: "body" },
        { type: "divider" },
      ],
      fallbackText: "fb",
    };
    expect(richMessageToMarkdownV2(msg)).toBe("*H*\n\nbody\n\n———");
  });
});
