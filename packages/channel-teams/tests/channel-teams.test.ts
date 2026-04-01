import { beforeAll, describe, expect, it } from "bun:test";
import { testChannelAdapter } from "@chat-agent-relay/adapter-conformance";
import { createTeamsSender } from "../src/teams-sender";
import { createTeamsTokenManager } from "../src/token-manager";
import { TeamsIngress } from "../src/teams-ingress";
import { TeamsWebhookVerifier } from "../src/verify-jwt";

const VALID_ACTIVITY = {
  id: "activity-123",
  type: "message",
  text: "<at>Relay Bot</at> hello from teams",
  timestamp: "2026-04-01T12:00:00.000Z",
  serviceUrl: "https://smba.trafficmanager.net/amer/",
  channelId: "msteams",
  conversation: { id: "conv-123", tenantId: "tenant-abc" },
  from: { id: "user-123", name: "Ada Lovelace" },
  recipient: { id: "bot-123", name: "Relay Bot" },
  channelData: { tenant: { id: "tenant-abc" } },
};

describe("TeamsIngress", () => {
  let ingress: TeamsIngress;

  beforeAll(async () => {
    ingress = await TeamsIngress.create("app-id", "app-secret", "teams-tenant", "tenant_car", "workspace_ops");
  });

  testChannelAdapter({
    name: "teams",
    get adapter() {
      return ingress;
    },
    validInput: VALID_ACTIVITY,
    invalidInputs: [
      { label: "null body", input: null, expectedCode: "invalid_payload" },
      { label: "missing serviceUrl", input: { ...VALID_ACTIVITY, serviceUrl: undefined }, expectedCode: "missing_field" },
      { label: "wrong activity type", input: { ...VALID_ACTIVITY, type: "conversationUpdate" }, expectedCode: "unsupported_activity" },
    ],
    expectedChannel: "teams",
  });

  it("canonicalizes a Teams message activity", async () => {
    const ingress = await TeamsIngress.create("app-id", "app-secret", "teams-tenant", "tenant_car", "workspace_ops");
    const result = ingress.canonicalize({
      ...VALID_ACTIVITY,
      channelData: {
        tenant: { id: "tenant-abc" },
        teamsChannelId: "teams-channel-789",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.channel).toBe("teams");
    expect(result.event.channel_instance_id).toBe("teams-teams-channel-789");
    expect(result.event.conversation_id).toBe("conv-123");
    expect(result.event.payload["text"]).toBe("hello from teams");
    expect((result.event.actor as Record<string, unknown>)["display_name"]).toBe("Ada Lovelace");
    expect(result.idempotencyKey).toBe("teams:conv-123:activity-123");

    const teams = result.event.provider_extensions!["teams"] as Record<string, unknown>;
    expect(teams["service_url"]).toBe("https://smba.trafficmanager.net/amer/");
    expect(teams["activity_id"]).toBe("activity-123");
    expect(teams["tenant_id"]).toBe("tenant-abc");
    expect(teams["teams_channel_id"]).toBe("teams-channel-789");
  });

  it("rejects non-message activities", async () => {
    const ingress = await TeamsIngress.create("app-id", "app-secret", "teams-tenant", "tenant_car", "workspace_ops");
    const result = ingress.canonicalize({ ...VALID_ACTIVITY, type: "conversationUpdate" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_activity");
  });
});

describe("Teams token manager", () => {
  it("caches tokens until refresh window", async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    let now = 0;
    let calls = 0;

    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    Date.now = () => now;

    try {
      const manager = createTeamsTokenManager("app-id", "app-secret", "tenant-123", { loginBase: "https://login.example.test" });
      await expect(manager.getToken()).resolves.toBe("token-1");
      now = 1_000;
      await expect(manager.getToken()).resolves.toBe("token-1");
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
    }
  });
});

describe("Teams webhook verifier", () => {
  it("accepts a valid bearer token when jose verification succeeds", async () => {
    const verifier = new TeamsWebhookVerifier("app-id", {
      openIdConfigUrl: "https://login.example.test/openid",
      fetchImpl: (async () => new Response(JSON.stringify({ issuer: "https://issuer.example.test", jwks_uri: "https://issuer.example.test/keys" }), { status: 200 })) as typeof fetch,
      jwtVerifyFn: (async () => ({ payload: {}, protectedHeader: {} })) as typeof import("jose").jwtVerify,
    });

    const request = new Request("https://example.test/api/teams/messages", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    });
    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects missing or invalid bearer tokens", async () => {
    const verifier = new TeamsWebhookVerifier("app-id", {
      openIdConfigUrl: "https://login.example.test/openid",
      fetchImpl: (async () => new Response(JSON.stringify({ issuer: "https://issuer.example.test", jwks_uri: "https://issuer.example.test/keys" }), { status: 200 })) as typeof fetch,
    });

    const request = new Request("https://example.test/api/teams/messages", {
      method: "POST",
    });
    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});

describe("Teams sender", () => {
  it("sends and edits activities via Bot Framework endpoints", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; authorization: string | null; body: Record<string, unknown> }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "teams-token", expires_in: 3600 }), { status: 200 });
      }

      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });

      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ id: "reply-456" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "reply-456" }), { status: 200 });
    }) as typeof fetch;

    try {
      const sender = createTeamsSender("app-id", "app-secret", "tenant-123");
      const reference = { serviceUrl: "https://smba.trafficmanager.net/amer/", conversationId: "conv-123", tenantId: "tenant-abc" };

      const sent = await sender.sendMessage(reference, "Hello Teams");
      expect(sent.messageId).toBe("reply-456");
      await sender.editMessage(reference, "reply-456", "Updated Teams");

      expect(calls).toHaveLength(2);
      expect(calls[0]!.url).toBe("https://smba.trafficmanager.net/amer/v3/conversations/conv-123/activities");
      expect(calls[0]!.method).toBe("POST");
      expect(calls[0]!.authorization).toBe("Bearer teams-token");
      expect(calls[0]!.body["text"]).toBe("Hello Teams");

      expect(calls[1]!.url).toBe("https://smba.trafficmanager.net/amer/v3/conversations/conv-123/activities/reply-456");
      expect(calls[1]!.method).toBe("PUT");
      expect(calls[1]!.body["text"]).toBe("Updated Teams");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
