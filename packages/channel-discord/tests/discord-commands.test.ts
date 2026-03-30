import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DiscordIngress } from "../src/discord-ingress";
import { DiscordSender } from "../src/discord-sender";
import type { DiscordInteraction } from "../src/types";

type BunServer = Server<unknown>;

const DISCORD_API_BASE = "https://discord.com/api/v10";

function patchFetch(port: number): () => void {
  const originalFetch = globalThis.fetch;
  const patched = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input).replace(
      DISCORD_API_BASE,
      `http://localhost:${port}`,
    );
    return originalFetch(url, init);
  };
  patched.preconnect = originalFetch.preconnect;
  globalThis.fetch = patched as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function sampleGuildInteraction(): DiscordInteraction {
  return {
    id: "interaction_001",
    type: 2,
    data: {
      id: "cmd_001",
      name: "ask",
      type: 1,
      options: [
        { name: "question", type: 3, value: "what is the weather" },
      ],
    },
    guild_id: "guild_001",
    channel_id: "channel_001",
    member: { user: { id: "user_001", username: "testuser" } },
    token: "interaction_token_abc",
    application_id: "app_001",
  };
}

function sampleDMInteraction(): DiscordInteraction {
  return {
    id: "interaction_002",
    type: 2,
    data: {
      id: "cmd_002",
      name: "help",
      type: 1,
    },
    channel_id: "dm_channel_001",
    user: { id: "user_002", username: "dmuser" },
    token: "interaction_token_def",
    application_id: "app_001",
  };
}

describe("Discord slash command canonicalization", () => {
  let ingress: DiscordIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DiscordIngress.create("tenant_acme", "ws_gaming");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a valid APPLICATION_COMMAND interaction", () => {
    const result = ingress.canonicalizeCommand(sampleGuildInteraction());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("command.received");
    expect(result.event.channel).toBe("discord");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["command_name"]).toBe("ask");
    expect(result.event.payload["text"]).toBe("what is the weather");
    const args = result.event.payload["arguments"] as Record<string, unknown>;
    expect(args["question"]).toBe("what is the weather");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("canonicalizes a DM interaction using user field", () => {
    const result = ingress.canonicalizeCommand(sampleDMInteraction());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("command.received");
    expect(result.event.payload["command_name"]).toBe("help");

    const actor = result.event.actor as Record<string, string>;
    expect(actor["id"]).toBe("user_002");
    expect(actor["display_name"]).toBe("dmuser");

    expect(result.event.channel_instance_id).toBe("discord_dm_dm_channel_001");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("rejects non-APPLICATION_COMMAND interactions", () => {
    const ping: DiscordInteraction = { ...sampleGuildInteraction(), type: 1 };
    const result = ingress.canonicalizeCommand(ping);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_interaction_type");
  });

  it("rejects interactions without data", () => {
    const noData: DiscordInteraction = { ...sampleGuildInteraction(), data: undefined };
    const result = ingress.canonicalizeCommand(noData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_interaction_data");
  });

  it("rejects invalid input", () => {
    const result = ingress.canonicalizeCommand(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_interaction");
  });

  it("derives idempotency key from interaction id", () => {
    const result = ingress.canonicalizeCommand(sampleGuildInteraction());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("discord:tenant_acme:interaction:interaction_001");
  });

  it("includes Discord metadata in provider_extensions", () => {
    const result = ingress.canonicalizeCommand(sampleGuildInteraction());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["discord"]).toBeDefined();
    expect(ext["discord"]!["interaction_id"]).toBe("interaction_001");
    expect(ext["discord"]!["interaction_token"]).toBe("interaction_token_abc");
    expect(ext["discord"]!["application_id"]).toBe("app_001");
    expect(ext["discord"]!["guild_id"]).toBe("guild_001");
  });
});

describe("Discord interaction responses", () => {
  let mockServer: BunServer;
  let mockPort: number;

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  it("deferInteraction sends correct payload", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedPath = "";

    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedMethod = req.method;
        capturedPath = new URL(req.url).pathname;
        capturedBody = (await req.json()) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await sender.deferInteraction("int_123", "tok_abc");
      expect(capturedMethod).toBe("POST");
      expect(capturedPath).toBe("/interactions/int_123/tok_abc/callback");
      expect(capturedBody["type"]).toBe(5);
    } finally {
      restore();
    }
  });

  it("editInteractionResponse sends correct payload", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedPath = "";

    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedMethod = req.method;
        capturedPath = new URL(req.url).pathname;
        capturedBody = (await req.json()) as Record<string, unknown>;
        return new Response(null, { status: 200 });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await sender.editInteractionResponse("app_001", "tok_abc", "Updated response");
      expect(capturedMethod).toBe("PATCH");
      expect(capturedPath).toBe("/webhooks/app_001/tok_abc/messages/@original");
      expect(capturedBody["content"]).toBe("Updated response");
    } finally {
      restore();
    }
  });
});
