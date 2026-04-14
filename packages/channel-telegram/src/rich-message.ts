import type { RichMessage } from "@chat-agent-relay/contract-harness";

/** Characters that MUST be escaped in Telegram MarkdownV2 (outside pre blocks). */
const MARKDOWN_V2_ESCAPE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_ESCAPE, "\\$1");
}

function codeFenceLine(language?: string): string {
  if (language === undefined || language.trim().length === 0) {
    return "```";
  }
  const safeLang = language.replace(/[^\w-]/g, "");
  return safeLang.length > 0 ? `\`\`\`${safeLang}` : "```";
}

/**
 * Converts a RichMessage to Telegram MarkdownV2 for sendMessage(parse_mode: "MarkdownV2").
 * - text: escaped plain text
 * - code: fenced code block (content passed through; closing fence in code is escaped)
 * - header: bold via *…*
 * - divider: em dash line (escaped)
 */
export function richMessageToMarkdownV2(msg: RichMessage): string {
  const parts: string[] = [];
  for (const block of msg.blocks) {
    switch (block.type) {
      case "text":
        parts.push(escapeMarkdownV2(block.text));
        break;
      case "code": {
        const open = codeFenceLine(block.language);
        let body = block.text;
        if (body.includes("```")) {
          body = body.replace(/```/g, "\\`\\`\\`");
        }
        parts.push(`${open}\n${body}\n\`\`\``);
        break;
      }
      case "header":
        parts.push(`*${escapeMarkdownV2(block.text)}*`);
        break;
      case "divider":
        parts.push(escapeMarkdownV2("———"));
        break;
      default:
        break;
    }
  }
  return parts.join("\n\n");
}
