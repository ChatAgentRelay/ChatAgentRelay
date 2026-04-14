import { describe, expect, it } from "bun:test";
import type { RichMessage } from "@chat-agent-relay/contract-harness";
import { richMessageToAdaptiveCard } from "../src/rich-message";

describe("richMessageToAdaptiveCard", () => {
  it("builds Adaptive Card body for each block type", () => {
    const msg: RichMessage = {
      blocks: [
        { type: "header", text: "Status" },
        { type: "text", text: "All good." },
        { type: "code", text: "npm test", language: "bash" },
        { type: "divider" },
      ],
      fallbackText: "Status",
    };
    const card = richMessageToAdaptiveCard(msg);
    expect(card["type"]).toBe("AdaptiveCard");
    expect(card["version"]).toBe("1.4");
    const body = card["body"] as Record<string, unknown>[];
    expect(body).toHaveLength(4);
    expect(body[0]).toMatchObject({ type: "TextBlock", text: "Status", size: "Large", weight: "Bolder" });
    expect(body[1]).toMatchObject({ type: "TextBlock", text: "All good." });
    expect(body[2]).toMatchObject({ type: "TextBlock", text: "npm test", fontType: "Monospace" });
    expect(body[3]).toMatchObject({ type: "Container", separator: true, items: [] });
  });
});
