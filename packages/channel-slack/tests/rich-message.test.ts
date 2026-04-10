import { describe, expect, it } from "bun:test";
import type { RichMessage } from "../src/rich-message";
import { richMessageToSlackBlocks } from "../src/rich-message";

describe("richMessageToSlackBlocks", () => {
  it("converts a text block to a section with mrkdwn", () => {
    const msg: RichMessage = {
      blocks: [{ type: "text", text: "Hello world" }],
      fallbackText: "Hello world",
    };
    const blocks = richMessageToSlackBlocks(msg);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Record<string, unknown>;
    expect(block["type"]).toBe("section");
    const text = block["text"] as Record<string, string>;
    expect(text["type"]).toBe("mrkdwn");
    expect(text["text"]).toBe("Hello world");
  });

  it("converts a code block with language", () => {
    const msg: RichMessage = {
      blocks: [{ type: "code", text: "const x = 1;", language: "typescript" }],
      fallbackText: "code",
    };
    const blocks = richMessageToSlackBlocks(msg);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Record<string, unknown>;
    expect(block["type"]).toBe("section");
    const text = block["text"] as Record<string, string>;
    expect(text["type"]).toBe("mrkdwn");
    expect(text["text"]).toContain("```typescript");
    expect(text["text"]).toContain("const x = 1;");
  });

  it("converts a code block without language", () => {
    const msg: RichMessage = {
      blocks: [{ type: "code", text: "plain code" }],
      fallbackText: "code",
    };
    const blocks = richMessageToSlackBlocks(msg);
    const block = blocks[0] as Record<string, unknown>;
    const text = block["text"] as Record<string, string>;
    expect(text["text"]).toContain("```\n");
    expect(text["text"]).toContain("plain code");
  });

  it("converts a header block", () => {
    const msg: RichMessage = {
      blocks: [{ type: "header", text: "Important Title" }],
      fallbackText: "title",
    };
    const blocks = richMessageToSlackBlocks(msg);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Record<string, unknown>;
    expect(block["type"]).toBe("header");
    const text = block["text"] as Record<string, string>;
    expect(text["type"]).toBe("plain_text");
    expect(text["text"]).toBe("Important Title");
  });

  it("converts a divider block", () => {
    const msg: RichMessage = {
      blocks: [{ type: "divider" }],
      fallbackText: "---",
    };
    const blocks = richMessageToSlackBlocks(msg);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Record<string, unknown>;
    expect(block["type"]).toBe("divider");
  });

  it("handles mixed block types", () => {
    const msg: RichMessage = {
      blocks: [
        { type: "header", text: "Status Report" },
        { type: "text", text: "Everything is running smoothly." },
        { type: "divider" },
        { type: "code", text: "npm test", language: "bash" },
      ],
      fallbackText: "Status Report",
    };
    const blocks = richMessageToSlackBlocks(msg);
    expect(blocks).toHaveLength(4);
    expect((blocks[0] as Record<string, unknown>)["type"]).toBe("header");
    expect((blocks[1] as Record<string, unknown>)["type"]).toBe("section");
    expect((blocks[2] as Record<string, unknown>)["type"]).toBe("divider");
    expect((blocks[3] as Record<string, unknown>)["type"]).toBe("section");
  });
});
