import { describe, expect, it } from "bun:test";
import { TelegramWebhookVerifier } from "../src/telegram-verifier";

describe("TelegramWebhookVerifier", () => {
  it("accepts a matching secret token header", async () => {
    const verifier = new TelegramWebhookVerifier("telegram-secret");
    const request = new Request("https://example.test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "telegram-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects a missing secret token header", async () => {
    const verifier = new TelegramWebhookVerifier("telegram-secret");
    const request = new Request("https://example.test/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });

  it("rejects a mismatched secret token header", async () => {
    const verifier = new TelegramWebhookVerifier("telegram-secret");
    const request = new Request("https://example.test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});
