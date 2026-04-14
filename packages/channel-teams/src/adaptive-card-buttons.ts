import type { ButtonAction } from "@chat-agent-relay/contract-harness";

function adaptiveSubmitStyle(style?: ButtonAction["style"]): "positive" | "destructive" | "default" {
  if (style === "danger") return "destructive";
  if (style === "primary") return "positive";
  return "default";
}

/**
 * Adaptive Card JSON for Bot Framework (Teams) with Action.Submit per button.
 */
export function buttonsToAdaptiveCard(text: string, buttons: ButtonAction[]): Record<string, unknown> {
  const actions = buttons.map((b) => {
    const data: Record<string, unknown> = { buttonId: b.id };
    if (b.value !== undefined && b.value.length > 0) {
      data.buttonValue = b.value;
    }
    return {
      type: "Action.Submit",
      title: b.label,
      style: adaptiveSubmitStyle(b.style),
      data,
    };
  });

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [{ type: "TextBlock", text, wrap: true }],
    actions,
  };
}
