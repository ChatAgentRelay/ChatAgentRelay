import { describe, expect, it } from "bun:test";
import type { RichMessage } from "@chat-agent-relay/contract-harness";
import { richMessageToLarkCard } from "../src/rich-message";

describe("richMessageToLarkCard", () => {
  it("uses first header as card header and hr for dividers", () => {
    const msg: RichMessage = {
      blocks: [
        { type: "header", text: "Report" },
        { type: "text", text: "Line one" },
        { type: "code", text: "echo hi", language: "bash" },
        { type: "divider" },
        { type: "header", text: "Sub" },
      ],
      fallbackText: "fallback",
    };
    const card = richMessageToLarkCard(msg);
    const header = card["header"] as Record<string, unknown>;
    const title = header["title"] as Record<string, unknown>;
    expect(title["content"]).toBe("Report");

    const elements = card["elements"] as Record<string, unknown>[];
    expect(elements[0]).toMatchObject({
      tag: "div",
      text: { tag: "lark_md", content: "Line one" },
    });
    expect((elements[1] as Record<string, unknown>)["text"]).toEqual({
      tag: "lark_md",
      content: "```bash\necho hi```",
    });
    expect(elements[2]).toEqual({ tag: "hr" });
    expect(elements[3]).toMatchObject({
      tag: "div",
      text: { tag: "lark_md", content: "**Sub**" },
    });
  });

  it("falls back to fallbackText for header when no header block", () => {
    const msg: RichMessage = {
      blocks: [{ type: "text", text: "only body" }],
      fallbackText: "My fallback title",
    };
    const card = richMessageToLarkCard(msg);
    const header = card["header"] as Record<string, unknown>;
    const title = header["title"] as Record<string, unknown>;
    expect(title["content"]).toBe("My fallback title");
  });
});
