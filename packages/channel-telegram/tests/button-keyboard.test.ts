import { describe, expect, it } from "bun:test";
import type { ButtonAction } from "@chat-agent-relay/contract-harness";
import { buttonsToInlineKeyboard } from "../src/button-keyboard";

describe("buttonsToInlineKeyboard", () => {
  it("converts ButtonAction[] to Telegram inline_keyboard with one row", () => {
    const buttons: ButtonAction[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta", style: "primary", value: "ignored-by-telegram" },
    ];
    const markup = buttonsToInlineKeyboard(buttons);

    expect(markup).toEqual({
      inline_keyboard: [
        [
          { text: "Alpha", callback_data: "a" },
          { text: "Beta", callback_data: "b" },
        ],
      ],
    });
  });

  it("uses callback_data from button id", () => {
    const markup = buttonsToInlineKeyboard([{ id: "callback_payload_123", label: "Tap" }]);
    expect(markup.inline_keyboard[0]![0]).toEqual({
      text: "Tap",
      callback_data: "callback_payload_123",
    });
  });

  it("returns empty row array when given no buttons", () => {
    const markup = buttonsToInlineKeyboard([]);
    expect(markup).toEqual({ inline_keyboard: [[]] });
  });
});
