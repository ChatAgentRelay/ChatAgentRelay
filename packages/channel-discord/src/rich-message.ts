export type RichTextBlock = { type: "text"; text: string };
export type RichCodeBlock = { type: "code"; text: string; language?: string };
export type RichHeaderBlock = { type: "header"; text: string };
export type RichDividerBlock = { type: "divider" };
export type RichBlock = RichTextBlock | RichCodeBlock | RichHeaderBlock | RichDividerBlock;
export type RichMessage = { blocks: RichBlock[]; fallbackText: string };

export function richMessageToDiscordEmbed(msg: RichMessage): Record<string, unknown> {
  const description = msg.blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "code":
          return "```" + (block.language ?? "") + "\n" + block.text + "\n```";
        case "header":
          return `**${block.text}**`;
        case "divider":
          return "---";
      }
    })
    .join("\n\n");

  return {
    type: "rich",
    description: description.slice(0, 4096),
  };
}
