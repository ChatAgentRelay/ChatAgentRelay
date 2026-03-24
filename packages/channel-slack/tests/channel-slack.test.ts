import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { ContractHarnessValidators } from "@cap/contract-harness";
import { SlackIngress } from "../src/slack-ingress";
import { SlackSender } from "../src/slack-sender";
import type { SlackMessageEvent } from "../src/types";

type BunServer = Server<unknown>;

function patchFetch(port: number): () => void {
  const originalFetch = globalThis.fetch;
  const patched = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
      .replace("https://slack.com/api", `http://localhost:${port}`);
    return originalFetch(url, init);
  };
  patched.preconnect = originalFetch.preconnect;
  globalThis.fetch = patched as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function sampleSlackEvent(): SlackMessageEvent {
  return {
    type: "message",
    channel: "C1234567890",
    user: "U9876543210",
    text: "Where is my order?",
    ts: "1710756000.000100",
    team: "T0001",
    channel_type: "channel",
  };
}

describe("Slack ingress", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a Slack message into a contract-valid message.received", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("slack");
    expect(result.event.payload["text"]).toBe("Where is my order?");
    expect(result.event.actor_type).toBe("end_user");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("includes Slack metadata in provider_extensions", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["slack"]).toBeDefined();
    expect(ext["slack"]!["channel_id"]).toBe("C1234567890");
    expect(ext["slack"]!["ts"]).toBe("1710756000.000100");
    expect(ext["slack"]!["team_id"]).toBe("T0001");
  });

  it("derives a stable idempotency key from tenant + channel + ts", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("slack:tenant_acme:slack_C1234567890:1710756000.000100");
  });

  it("uses thread_ts for conversation_id when in a thread", () => {
    const threaded = { ...sampleSlackEvent(), thread_ts: "1710756000.000001" };
    const result = ingress.canonicalize(threaded);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("slack_thread_1710756000.000001");
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["slack"]!["thread_ts"]).toBe("1710756000.000001");
  });

  it("uses channel + ts for conversation_id when not in a thread", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("slack_C1234567890_1710756000.000100");
  });

  it("preserves correct tenant_id and workspace_id from config", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.tenant_id).toBe("tenant_acme");
    expect(result.event.workspace_id).toBe("ws_support");
  });

  it("maps user to actor.id and identity_refs", () => {
    const result = ingress.canonicalize(sampleSlackEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.event.actor as Record<string, string>;
    expect(actor["id"]).toBe("U9876543210");
    const refs = result.event.identity_refs as Record<string, string>;
    expect(refs["channel_user_id"]).toBe("U9876543210");
  });

  it("rejects non-message events", () => {
    const result = ingress.canonicalize({ type: "reaction_added" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_slack_event");
  });

  it("rejects messages with subtypes (bot messages, etc)", () => {
    const botMsg = { ...sampleSlackEvent(), subtype: "bot_message" };
    const result = ingress.canonicalize(botMsg);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_subtype");
  });

  it("rejects messages with empty text", () => {
    const empty = { ...sampleSlackEvent(), text: "  " };
    const result = ingress.canonicalize(empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_text");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalize(null);
    expect(result.ok).toBe(false);
  });
});

describe("Slack sender", () => {
  let mockServer: BunServer;
  let mockPort: number;

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  it("sends a message via chat.postMessage and returns ts", async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("Authorization")).toBe("Bearer xoxb-test-token");
        const body = (await req.json()) as Record<string, string>;
        expect(body["channel"]).toBe("C1234567890");
        expect(body["text"]).toBe("Your order shipped.");
        return Response.json({ ok: true, channel: "C1234567890", ts: "1710756001.000200" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new SlackSender({ botToken: "xoxb-test-token" });
    const restore = patchFetch(mockPort);
    try {
      const result = await sender.send("C1234567890", "Your order shipped.");
      expect(result.providerMessageId).toBe("1710756001.000200");
    } finally {
      restore();
    }
  });

  it("throws on Slack API error", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: false, error: "channel_not_found" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new SlackSender({ botToken: "xoxb-test-token" });
    const restore = patchFetch(mockPort);
    try {
      await expect(sender.send("C_INVALID", "Hello")).rejects.toThrow("channel_not_found");
    } finally {
      restore();
    }
  });

  it("creates a sendFn bound to a channel", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: true, channel: "C123", ts: "1710756002.000300" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new SlackSender({ botToken: "xoxb-test-token" });
    const restore = patchFetch(mockPort);
    try {
      const sendFn = sender.createSendFn("C123");
      const result = await sendFn("Hello");
      expect(result.providerMessageId).toBe("1710756002.000300");
    } finally {
      restore();
    }
  });
});
