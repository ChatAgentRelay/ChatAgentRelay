import type { ButtonAction } from "@chat-agent-relay/contract-harness";

/**
 * Builds Slack Block Kit blocks: a section with the message text and an actions row of buttons.
 */
export function buttonsToSlackBlocks(text: string, buttons: ButtonAction[]): unknown[] {
  const elements = buttons.map((b) => {
    const el: Record<string, unknown> = {
      type: "button",
      text: { type: "plain_text", text: b.label, emoji: true },
      action_id: b.id,
      style: b.style === "danger" ? "danger" : "primary",
    };
    if (b.value !== undefined && b.value.length > 0) {
      el.value = b.value;
    }
    return el;
  });

  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "actions", elements },
  ];
}
