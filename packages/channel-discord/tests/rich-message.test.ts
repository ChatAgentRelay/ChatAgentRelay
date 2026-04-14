import { describe, expect, it } from "bun:test";
import type { RichMessage } from "@chat-agent-relay/contract-harness";
import { richMessageToDiscordEmbed } from "../src/rich-message";

describe("richMessageToDiscordEmbed", () => {
  it("converts text blocks", () => {
    const msg: RichMessage = {
      blocks: [{ type: "text", text: "Hello world" }],
      fallbackText: "Hello",
    };
    const embed = richMessageToDiscordEmbed(msg);
    expect(embed["type"]).toBe("rich");
    expect(embed["description"]).toBe("Hello world");
  });

  it("converts code blocks with language", () => {
    const msg: RichMessage = {
      blocks: [{ type: "code", text: "const x = 1;", language: "typescript" }],
      fallbackText: "code",
    };
    const embed = richMessageToDiscordEmbed(msg);
    const desc = embed["description"] as string;
    expect(desc).toContain("```typescript");
    expect(desc).toContain("const x = 1;");
    expect(desc).toContain("```");
  });

  it("converts code blocks without language", () => {
    const msg: RichMessage = {
      blocks: [{ type: "code", text: "raw code" }],
      fallbackText: "code",
    };
    const embed = richMessageToDiscordEmbed(msg);
    const desc = embed["description"] as string;
    expect(desc).toContain("```\n");
    expect(desc).toContain("raw code");
  });

  it("converts header blocks to bold text", () => {
    const msg: RichMessage = {
      blocks: [{ type: "header", text: "Title" }],
      fallbackText: "Title",
    };
    const embed = richMessageToDiscordEmbed(msg);
    expect(embed["description"]).toBe("**Title**");
  });

  it("converts divider blocks to horizontal rule", () => {
    const msg: RichMessage = {
      blocks: [{ type: "divider" }],
      fallbackText: "---",
    };
    const embed = richMessageToDiscordEmbed(msg);
    expect(embed["description"]).toBe("---");
  });

  it("joins multiple blocks with double newlines", () => {
    const msg: RichMessage = {
      blocks: [{ type: "header", text: "Title" }, { type: "text", text: "Body" }, { type: "divider" }],
      fallbackText: "Title",
    };
    const embed = richMessageToDiscordEmbed(msg);
    const desc = embed["description"] as string;
    expect(desc).toBe("**Title**\n\nBody\n\n---");
  });

  it("truncates description at 4096 characters", () => {
    const longText = "A".repeat(5000);
    const msg: RichMessage = {
      blocks: [{ type: "text", text: longText }],
      fallbackText: "long text",
    };
    const embed = richMessageToDiscordEmbed(msg);
    const desc = embed["description"] as string;
    expect(desc.length).toBe(4096);
  });
});
