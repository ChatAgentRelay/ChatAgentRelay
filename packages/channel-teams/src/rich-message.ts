import type { RichMessage } from "@chat-agent-relay/contract-harness";

/** Builds an Adaptive Card JSON object for Teams (application/vnd.microsoft.card.adaptive). */
export function richMessageToAdaptiveCard(msg: RichMessage): Record<string, unknown> {
  const body: Record<string, unknown>[] = [];
  for (const block of msg.blocks) {
    switch (block.type) {
      case "text":
        body.push({ type: "TextBlock", text: block.text, wrap: true });
        break;
      case "code":
        body.push({
          type: "TextBlock",
          text: block.text,
          wrap: true,
          fontType: "Monospace",
        });
        break;
      case "header":
        body.push({
          type: "TextBlock",
          text: block.text,
          size: "Large",
          weight: "Bolder",
          wrap: true,
        });
        break;
      case "divider":
        body.push({ type: "Container", separator: true, items: [] });
        break;
      default:
        break;
    }
  }

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
  };
}
