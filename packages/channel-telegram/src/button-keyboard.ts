import type { ButtonAction } from "@chat-agent-relay/contract-harness";

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

/**
 * Builds Telegram `reply_markup.inline_keyboard` with one row of inline buttons.
 */
export function buttonsToInlineKeyboard(buttons: ButtonAction[]): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [buttons.map((b) => ({ text: b.label, callback_data: b.id }))],
  };
}
