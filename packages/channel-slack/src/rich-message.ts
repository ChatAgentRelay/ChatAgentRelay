import type { RichMessage } from "@chat-agent-relay/contract-harness";

export function richMessageToSlackBlocks(msg: RichMessage): unknown[] {
  return msg.blocks.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "section", text: { type: "mrkdwn", text: block.text } };
      case "code": {
        const languagePrefix = block.language ? `${block.language}\n` : "\n";
        return {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${languagePrefix}${block.text}\n\`\`\``,
          },
        };
      }
      case "header":
        return { type: "header", text: { type: "plain_text", text: block.text } };
      case "divider":
        return { type: "divider" };
      default:
        return { type: "divider" };
    }
  });
}
