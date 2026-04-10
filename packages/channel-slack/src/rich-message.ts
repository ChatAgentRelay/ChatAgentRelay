export type RichTextBlock = {
  type: "text";
  text: string;
};

export type RichCodeBlock = {
  type: "code";
  text: string;
  language?: string;
};

export type RichHeaderBlock = {
  type: "header";
  text: string;
};

export type RichDividerBlock = {
  type: "divider";
};

export type RichBlock = RichTextBlock | RichCodeBlock | RichHeaderBlock | RichDividerBlock;

export type RichMessage = {
  blocks: RichBlock[];
  fallbackText: string;
};

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
