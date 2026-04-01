import { beforeAll, describe, expect, it } from "bun:test";
import { testChannelAdapter } from "@chat-agent-relay/adapter-conformance";
import { TelegramIngress } from "../src/telegram-ingress";
import { createTelegramSender } from "../src/telegram-sender";

const VALID_UPDATE = {
  update_id: 100200300,
  message: {
    message_id: 42,
    from: { id: 12345, is_bot: false, first_name: "Alice", last_name: "Wang", username: "alicew" },
    chat: { id: -100999, type: "group" as const, title: "Dev Chat" },
    date: 1711670400,
    text: "Hello from Telegram",
  },
};

describe("TelegramIngress", () => {
  let ingress: TelegramIngress;

  beforeAll(async () => {
    ingress = await TelegramIngress.create("TEST_BOT_TOKEN", "tenant-tg", "workspace-tg");
  });

  testChannelAdapter({
    name: "telegram",
    get adapter() {
      return ingress;
    },
    validInput: VALID_UPDATE,
    invalidInputs: [
      { label: "null body", input: null, expectedCode: "invalid_payload" },
      { label: "missing update_id", input: { message: {} }, expectedCode: "missing_field" },
      { label: "missing message", input: { update_id: 1 }, expectedCode: "missing_field" },
      { label: "empty text", input: { ...VALID_UPDATE, message: { ...VALID_UPDATE.message, text: "" } }, expectedCode: "missing_field" },
    ],
    expectedChannel: "telegram",
  });

  it("maps fields correctly", () => {
    const result = ingress.canonicalize(VALID_UPDATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.channel).toBe("telegram");
    expect(result.event.channel_instance_id).toBe("telegram--100999");
    expect(result.event.conversation_id).toBe("tg-chat--100999");
    expect(result.event.event_type).toBe("message.received");
    expect(result.event.actor_type).toBe("end_user");
    expect((result.event.actor as Record<string, unknown>)["id"]).toBe("12345");
    expect((result.event.actor as Record<string, unknown>)["display_name"]).toBe("Alice Wang");
    expect(result.event.payload["text"]).toBe("Hello from Telegram");

    const tg = result.event.provider_extensions!["telegram"] as Record<string, unknown>;
    expect(tg["update_id"]).toBe(100200300);
    expect(tg["message_id"]).toBe(42);
    expect(tg["chat_id"]).toBe(-100999);
    expect(tg["chat_type"]).toBe("group");
  });

  it("returns stable idempotency key", () => {
    const r1 = ingress.canonicalize(VALID_UPDATE);
    const r2 = ingress.canonicalize(VALID_UPDATE);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.idempotencyKey).toBe("tg-100200300");
    expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
  });

  it("rejects bot messages", () => {
    const botUpdate = {
      ...VALID_UPDATE,
      message: { ...VALID_UPDATE.message, from: { id: 999, is_bot: true, first_name: "Bot" } },
    };
    const result = ingress.canonicalize(botUpdate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("bot_message");
  });

  it("handles private chat", () => {
    const privateUpdate = {
      ...VALID_UPDATE,
      message: { ...VALID_UPDATE.message, chat: { id: 12345, type: "private" as const } },
    };
    const result = ingress.canonicalize(privateUpdate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tg = result.event.provider_extensions!["telegram"] as Record<string, unknown>;
    expect(tg["chat_type"]).toBe("private");
  });

  it("detects bot commands", () => {
    const cmdUpdate = {
      ...VALID_UPDATE,
      message: {
        ...VALID_UPDATE.message,
        text: "/start hello",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    const result = ingress.canonicalize(cmdUpdate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.event_type).toBe("command.received");
    expect(result.event.payload["command_name"]).toBe("start");
    expect(result.event.payload["text"]).toBe("hello");
  });

  it("describes capabilities", () => {
    const caps = ingress.describeCapabilities();
    expect(caps.channel).toBe("telegram");
    expect(caps.messaging.text).toBe(true);
    expect(caps.streaming.progressiveUpdate).toBe(true);
    expect(caps.interactive.commands).toBe(true);
    expect(caps.delivery.edit).toBe(true);
  });
});

describe("TelegramSender", () => {
  it("sends message via Bot API", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(init?.body as string) };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200 });
    }) as typeof fetch;

    try {
      const sender = createTelegramSender("BOT_TOKEN_123");
      const result = await sender.sendMessage(-100999, "Hello!");
      expect(result.messageId).toBe(99);
      expect(captured!.url).toBe("https://api.telegram.org/botBOT_TOKEN_123/sendMessage");
      expect((captured!.body as Record<string, unknown>)["chat_id"]).toBe(-100999);
      expect((captured!.body as Record<string, unknown>)["text"]).toBe("Hello!");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
