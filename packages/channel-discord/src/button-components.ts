import type { ButtonAction } from "@chat-agent-relay/contract-harness";

/** Discord API: 1 = Primary, 2 = Secondary, 4 = Danger */
function mapDiscordButtonStyle(style?: ButtonAction["style"]): number {
  if (style === "danger") return 4;
  if (style === "secondary") return 2;
  return 1;
}

const DISCORD_ACTION_ROW_MAX = 5;

/**
 * Builds Discord message `components`: action rows (type 1) each with up to 5 buttons (type 2).
 */
export function buttonsToDiscordComponents(buttons: ButtonAction[]): unknown[] {
  const rows: unknown[] = [];
  for (let i = 0; i < buttons.length; i += DISCORD_ACTION_ROW_MAX) {
    const slice = buttons.slice(i, i + DISCORD_ACTION_ROW_MAX);
    rows.push({
      type: 1,
      components: slice.map((b) => {
        const c: Record<string, unknown> = {
          type: 2,
          label: b.label,
          style: mapDiscordButtonStyle(b.style),
          custom_id: b.id,
        };
        return c;
      }),
    });
  }
  return rows;
}
