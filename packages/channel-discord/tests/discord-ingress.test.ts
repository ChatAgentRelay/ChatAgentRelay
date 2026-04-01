import { beforeAll, describe, expect, it } from "bun:test";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DiscordIngress } from "../src/discord-ingress";
import type { DiscordMessageEvent } from "../src/types";

function sampleGuildMessage(): DiscordMessageEvent {
  return {
    id: "1234567890123456789",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888990",
    author: { id: "111122223333444455", username: "testuser", bot: false },
    content: "Hello from Discord!",
    timestamp: "2024-03-18T12:00:00.000000+00:00",
  };
}

function sampleDMMessage(): DiscordMessageEvent {
  return {
    id: "2345678901234567890",
    channel_id: "8765432109876543210",
    author: { id: "222233334444555566", username: "dmuser" },
    content: "Hello via DM!",
    timestamp: "2024-03-18T13:00:00.000000+00:00",
  };
}

function sampleThreadMessage(): DiscordMessageEvent {
  return {
    id: "3456789012345678901",
    channel_id: "7654321098765432109",
    guild_id: "5555666677778888990",
    author: { id: "111122223333444455", username: "testuser" },
    content: "Reply in thread",
    timestamp: "2024-03-18T14:00:00.000000+00:00",
    message_reference: {
      message_id: "1234567890123456789",
      channel_id: "7654321098765432109",
      guild_id: "5555666677778888990",
    },
  };
}

describe("Discord ingress", () => {
  let ingress: DiscordIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DiscordIngress.create("test-discord-token", "tenant_acme", "ws_gaming");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a guild message into a contract-valid message.received", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("discord");
    expect(result.event.payload["text"]).toBe("Hello from Discord!");
    expect(result.event.actor_type).toBe("end_user");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("canonicalizes a DM message with correct conversation_id", () => {
    const result = ingress.canonicalize(sampleDMMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("discord:dm:8765432109876543210");
    expect(result.event.channel_instance_id).toBe("discord_dm_8765432109876543210");
    expect(result.event.payload["text"]).toBe("Hello via DM!");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("maps guild messages to discord:channel: conversation_id", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("discord:channel:9876543210987654321");
  });

  it("maps thread messages to discord:thread: conversation_id", () => {
    const result = ingress.canonicalize(sampleThreadMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("discord:thread:7654321098765432109");
  });

  it("rejects bot messages", () => {
    const botMsg: DiscordMessageEvent = {
      ...sampleGuildMessage(),
      author: { id: "999900001111222233", username: "mybot", bot: true },
    };
    const result = ingress.canonicalize(botMsg);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("bot_message");
  });

  it("rejects empty content", () => {
    const empty = { ...sampleGuildMessage(), content: "   " };
    const result = ingress.canonicalize(empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_content");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalize(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_discord_event");
  });

  it("rejects undefined input", () => {
    const result = ingress.canonicalize(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_discord_event");
  });

  it("rejects non-object input", () => {
    const result = ingress.canonicalize("not an object");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_discord_event");
  });

  it("derives a stable idempotency key from tenant + message snowflake", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("discord:tenant_acme:1234567890123456789");

    const result2 = ingress.canonicalize(sampleGuildMessage());
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.idempotencyKey).toBe(result.idempotencyKey);
  });

  it("preserves Discord metadata in provider_extensions", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["discord"]).toBeDefined();
    expect(ext["discord"]!["message_id"]).toBe("1234567890123456789");
    expect(ext["discord"]!["channel_id"]).toBe("9876543210987654321");
    expect(ext["discord"]!["guild_id"]).toBe("5555666677778888990");
  });

  it("preserves message_reference in provider_extensions for thread messages", () => {
    const result = ingress.canonicalize(sampleThreadMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    const ref = ext["discord"]!["message_reference"] as Record<string, unknown>;
    expect(ref["message_id"]).toBe("1234567890123456789");
  });

  it("preserves correct tenant_id and workspace_id from config", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.tenant_id).toBe("tenant_acme");
    expect(result.event.workspace_id).toBe("ws_gaming");
  });

  it("maps author to actor and identity_refs", () => {
    const result = ingress.canonicalize(sampleGuildMessage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.event.actor as Record<string, string>;
    expect(actor["id"]).toBe("111122223333444455");
    expect(actor["display_name"]).toBe("testuser");
    const refs = result.event.identity_refs as Record<string, string>;
    expect(refs["channel_user_id"]).toBe("111122223333444455");
  });

  it("describeCapabilities returns correct metadata", () => {
    const caps = ingress.describeCapabilities();
    expect(caps.channel).toBe("discord");
    expect(caps.messaging).toEqual({
      text: true,
      attachments: false,
      reactions: true,
      threads: true,
    });
    expect(caps.streaming).toEqual({ progressiveUpdate: true, nativeStreaming: false });
    expect(caps.interactive).toEqual({ buttons: false, menus: false, commands: true });
    expect(caps.delivery).toEqual({ retry: true, chunking: true, edit: true });
  });
});
