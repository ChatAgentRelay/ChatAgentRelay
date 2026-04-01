import { beforeAll, describe, expect, it } from "bun:test";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DiscordIngress } from "../src/discord-ingress";
import type {
  DiscordMessageDeleteEvent,
  DiscordMessageUpdateEvent,
  DiscordReactionEvent,
} from "../src/types";

function sampleMessageUpdate(): DiscordMessageUpdateEvent {
  return {
    id: "1234567890123456789",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888990",
    author: { id: "111122223333444455", username: "testuser", bot: false },
    content: "edited content here",
    timestamp: "2024-03-18T12:00:00.000000+00:00",
    edited_timestamp: "2024-03-18T12:05:00.000000+00:00",
  };
}

function sampleMessageDelete(): DiscordMessageDeleteEvent {
  return {
    id: "1234567890123456789",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888990",
  };
}

function sampleReaction(): DiscordReactionEvent {
  return {
    user_id: "111122223333444455",
    channel_id: "9876543210987654321",
    message_id: "1234567890123456789",
    guild_id: "5555666677778888990",
    emoji: { name: "👍" },
  };
}

describe("Discord message update canonicalization", () => {
  let ingress: DiscordIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DiscordIngress.create("test-discord-token", "tenant_acme", "ws_gaming");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes MESSAGE_UPDATE into a contract-valid message.updated", () => {
    const result = ingress.canonicalizeMessageUpdate(sampleMessageUpdate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.updated");
    expect(result.event.channel).toBe("discord");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["original_message_id"]).toBe("1234567890123456789");
    expect(result.event.payload["new_text"]).toBe("edited content here");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("handles update without author", () => {
    const event: DiscordMessageUpdateEvent = {
      id: "1234567890123456789",
      channel_id: "9876543210987654321",
      content: "updated",
    };
    const result = ingress.canonicalizeMessageUpdate(event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.updated");
    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeMessageUpdate(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_message_update");
  });

  it("rejects non-object input", () => {
    const result = ingress.canonicalizeMessageUpdate("not an object");
    expect(result.ok).toBe(false);
  });
});

describe("Discord message delete canonicalization", () => {
  let ingress: DiscordIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DiscordIngress.create("test-discord-token", "tenant_acme", "ws_gaming");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes MESSAGE_DELETE into a contract-valid message.deleted", () => {
    const result = ingress.canonicalizeMessageDelete(sampleMessageDelete());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.deleted");
    expect(result.event.channel).toBe("discord");
    expect(result.event.actor_type).toBe("system");
    expect(result.event.payload["deleted_message_id"]).toBe("1234567890123456789");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("handles DM delete (no guild_id)", () => {
    const event: DiscordMessageDeleteEvent = {
      id: "2345678901234567890",
      channel_id: "8765432109876543210",
    };
    const result = ingress.canonicalizeMessageDelete(event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("discord:dm:8765432109876543210");
    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeMessageDelete(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_message_delete");
  });
});

describe("Discord reaction canonicalization", () => {
  let ingress: DiscordIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DiscordIngress.create("test-discord-token", "tenant_acme", "ws_gaming");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes MESSAGE_REACTION_ADD into a contract-valid reaction.received", () => {
    const result = ingress.canonicalizeReaction(sampleReaction());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("reaction.received");
    expect(result.event.channel).toBe("discord");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["emoji"]).toBe("👍");
    expect(result.event.payload["target_message_id"]).toBe("1234567890123456789");
    expect(result.event.payload["action"]).toBe("added");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("handles custom emoji with id", () => {
    const event: DiscordReactionEvent = {
      ...sampleReaction(),
      emoji: { id: "123456", name: "custom_emoji" },
    };
    const result = ingress.canonicalizeReaction(event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload["emoji"]).toBe("custom_emoji:123456");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeReaction(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_reaction");
  });

  it("rejects event missing emoji", () => {
    const result = ingress.canonicalizeReaction({
      user_id: "111",
      channel_id: "222",
      message_id: "333",
    });
    expect(result.ok).toBe(false);
  });
});
