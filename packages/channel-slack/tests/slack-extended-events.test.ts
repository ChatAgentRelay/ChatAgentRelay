import { beforeAll, describe, expect, it } from "bun:test";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SlackIngress } from "../src/slack-ingress";
import type {
  SlackAppMentionEvent,
  SlackMessageChangedEvent,
  SlackMessageDeletedEvent,
  SlackReactionEvent,
} from "../src/types";

function sampleAppMentionEvent(): SlackAppMentionEvent {
  return {
    type: "app_mention",
    channel: "C1234567890",
    user: "U9876543210",
    text: "<@U_BOT> hello there",
    ts: "1710756000.000100",
    team: "T0001",
    channel_type: "channel",
  };
}

function sampleMessageChangedEvent(): SlackMessageChangedEvent {
  return {
    type: "message",
    subtype: "message_changed",
    channel: "C1234567890",
    ts: "1710756001.000200",
    message: {
      user: "U9876543210",
      text: "edited message text",
      ts: "1710756000.000100",
      edited: { user: "U9876543210", ts: "1710756001.000200" },
    },
    previous_message: {
      text: "original message text",
      ts: "1710756000.000100",
    },
  };
}

function sampleMessageDeletedEvent(): SlackMessageDeletedEvent {
  return {
    type: "message",
    subtype: "message_deleted",
    channel: "C1234567890",
    ts: "1710756002.000300",
    deleted_ts: "1710756000.000100",
    previous_message: {
      text: "this was deleted",
      user: "U9876543210",
    },
  };
}

function sampleReactionAddedEvent(): SlackReactionEvent {
  return {
    type: "reaction_added",
    user: "U9876543210",
    reaction: "thumbsup",
    item: {
      type: "message",
      channel: "C1234567890",
      ts: "1710756000.000100",
    },
    item_user: "U1111111111",
    event_ts: "1710756003.000400",
  };
}

function sampleReactionRemovedEvent(): SlackReactionEvent {
  return {
    type: "reaction_removed",
    user: "U9876543210",
    reaction: "thumbsup",
    item: {
      type: "message",
      channel: "C1234567890",
      ts: "1710756000.000100",
    },
    event_ts: "1710756004.000500",
  };
}

describe("Slack app_mention canonicalization", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes an app_mention into a contract-valid message.received", () => {
    const result = ingress.canonicalize(sampleAppMentionEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("slack");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["text"]).toBe("<@U_BOT> hello there");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("sets event_type in provider_extensions for app_mention", () => {
    const result = ingress.canonicalize(sampleAppMentionEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["slack"]!["event_type"]).toBe("app_mention");
  });

  it("handles app_mention with thread_ts", () => {
    const event = { ...sampleAppMentionEvent(), thread_ts: "1710756000.000001" };
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.conversation_id).toBe("slack_thread_1710756000.000001");
  });
});

describe("Slack message update canonicalization", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a message_changed into a contract-valid message.updated", () => {
    const result = ingress.canonicalizeMessageUpdate(sampleMessageChangedEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.updated");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["original_message_id"]).toBe("1710756000.000100");
    expect(result.event.payload["new_text"]).toBe("edited message text");
    expect(result.event.payload["previous_text"]).toBe("original message text");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects invalid message_changed event", () => {
    const result = ingress.canonicalizeMessageUpdate({ type: "message", subtype: "something_else" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_message_changed");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeMessageUpdate(null);
    expect(result.ok).toBe(false);
  });
});

describe("Slack message delete canonicalization", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a message_deleted into a contract-valid message.deleted", () => {
    const result = ingress.canonicalizeMessageDelete(sampleMessageDeletedEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.deleted");
    expect(result.event.actor_type).toBe("system");
    expect(result.event.payload["deleted_message_id"]).toBe("1710756000.000100");
    expect(result.event.payload["deleted_text"]).toBe("this was deleted");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects invalid message_deleted event", () => {
    const result = ingress.canonicalizeMessageDelete({ type: "message" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_message_deleted");
  });
});

describe("Slack reaction canonicalization", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes reaction_added into a contract-valid reaction.received", () => {
    const result = ingress.canonicalizeReaction(sampleReactionAddedEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("reaction.received");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["emoji"]).toBe("thumbsup");
    expect(result.event.payload["target_message_id"]).toBe("1710756000.000100");
    expect(result.event.payload["action"]).toBe("added");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("canonicalizes reaction_removed with action=removed", () => {
    const result = ingress.canonicalizeReaction(sampleReactionRemovedEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload["action"]).toBe("removed");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects invalid reaction event", () => {
    const result = ingress.canonicalizeReaction({ type: "something_else" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_reaction");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeReaction(null);
    expect(result.ok).toBe(false);
  });
});
