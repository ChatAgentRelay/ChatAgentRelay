import type { RichMessage } from "@chat-agent-relay/contract-harness";

const HEADER_TITLE_MAX = 100;

function truncateTitle(s: string): string {
  if (s.length <= HEADER_TITLE_MAX) return s;
  return `${s.slice(0, HEADER_TITLE_MAX - 1)}…`;
}

/** Escape minimal set for Lark markdown (lark_md) when embedding plain text. */
function escapeLarkMdPlain(text: string): string {
  return text.replace(/([\\`*_[\]()#+\-.!|>])/g, "\\$1");
}

/**
 * Lark interactive card payload (msg_type: "interactive"), serialized to JSON string in API `content`.
 * First `header` block becomes the card header title; later headers use bold markdown in the body.
 */
export function richMessageToLarkCard(msg: RichMessage): Record<string, unknown> {
  const firstHeaderIdx = msg.blocks.findIndex((b) => b.type === "header");
  let headerTitle = truncateTitle(msg.fallbackText);
  if (firstHeaderIdx >= 0) {
    const h = msg.blocks[firstHeaderIdx]!;
    if (h.type === "header") {
      headerTitle = truncateTitle(h.text);
    }
  }

  const elements: Record<string, unknown>[] = [];
  for (let i = 0; i < msg.blocks.length; i++) {
    const block = msg.blocks[i]!;
    if (block.type === "header" && i === firstHeaderIdx) {
      continue;
    }

    switch (block.type) {
      case "text":
        elements.push({
          tag: "div",
          text: { tag: "lark_md", content: escapeLarkMdPlain(block.text) },
        });
        break;
      case "code": {
        const lang = block.language !== undefined && block.language.length > 0 ? `${block.language}\n` : "";
        elements.push({
          tag: "div",
          text: { tag: "lark_md", content: `\`\`\`${lang}${block.text}\`\`\`` },
        });
        break;
      }
      case "header":
        elements.push({
          tag: "div",
          text: { tag: "lark_md", content: `**${escapeLarkMdPlain(block.text)}**` },
        });
        break;
      case "divider":
        elements.push({ tag: "hr" });
        break;
      default:
        break;
    }
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: headerTitle },
    },
    elements,
  };
}
