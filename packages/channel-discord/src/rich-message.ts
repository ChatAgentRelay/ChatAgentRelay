import type { RichMessage } from "@chat-agent-relay/contract-harness";

export function richMessageToDiscordEmbed(msg: RichMessage): Record<string, unknown> {
  const description = msg.blocks
    .map((block): string => {
      switch (block.type) {
        case "text":
          return block.text;
        case "code":
          return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
        case "header":
          return `**${block.text}**`;
        case "divider":
          return "---";
        default:
          return "";
      }
    })
    .join("\n\n");

  return {
    type: "rich",
    description: description.slice(0, 4096),
  };
}
