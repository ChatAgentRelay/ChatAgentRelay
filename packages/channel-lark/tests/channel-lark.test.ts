import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { testChannelAdapter } from "@chat-agent-relay/adapter-conformance";
import type { Server } from "bun";
import { createHmac } from "node:crypto";
import { LarkIngress } from "../src/lark-ingress";
import { createLarkSender } from "../src/lark-sender";
import { LarkWebhookVerifier } from "../src/lark-verifier";

type BunServer = Server<unknown>;

function sampleLarkEvent(overrides?: Record<string, unknown>) {
  return {
    schema: "2.0",
    header: {
      event_id: "evt_lark_001",
      event_type: "im.message.receive_v1",
      create_time: "1710756000000",
      token: "verification_token",
      app_id: "cli_test_app",
      tenant_key: "tenant_test",
    },
    event: {
      sender: {
        sender_id: { open_id: "ou_user123" },
        sender_type: "user",
      },
      message: {
        message_id: "om_msg001",
        chat_id: "oc_chat001",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "Hello from Lark" }),
      },
      ...overrides,
    },
  };
}

function patchFetch(port: number): () => void {
  const originalFetch = globalThis.fetch;
  const patched = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input).replace(
      "https://open.feishu.cn/open-apis",
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

describe("Lark ingress", () => {
  let ingress: LarkIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await LarkIngress.create("app_id", "app_secret", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a Lark text message into a contract-valid message.received", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("lark");
    expect(result.event.payload["text"]).toBe("Hello from Lark");
    expect(result.event.actor_type).toBe("end_user");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("includes Lark metadata in provider_extensions", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["lark"]).toBeDefined();
    expect(ext["lark"]!["event_id"]).toBe("evt_lark_001");
    expect(ext["lark"]!["message_id"]).toBe("om_msg001");
    expect(ext["lark"]!["chat_id"]).toBe("oc_chat001");
    expect(ext["lark"]!["chat_type"]).toBe("p2p");
    expect(ext["lark"]!["tenant_key"]).toBe("tenant_test");
    expect(ext["lark"]!["app_id"]).toBe("cli_test_app");
  });

  it("derives a stable idempotency key from header.event_id", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("lark-evt_lark_001");

    const r2 = ingress.canonicalize(sampleLarkEvent());
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.idempotencyKey).toBe(result.idempotencyKey);
  });

  it("maps chat_id to channel_instance_id and conversation_id", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.channel_instance_id).toBe("lark-oc_chat001");
    expect(result.event.conversation_id).toBe("lark-chat-oc_chat001");
  });

  it("preserves correct tenant_id and workspace_id from config", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.tenant_id).toBe("tenant_acme");
    expect(result.event.workspace_id).toBe("ws_support");
  });

  it("maps sender open_id to actor.id and identity_refs", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.event.actor as Record<string, string>;
    expect(actor["id"]).toBe("ou_user123");
    const refs = result.event.identity_refs as Record<string, string>;
    expect(refs["channel_user_id"]).toBe("ou_user123");
  });

  it("rejects non-Lark events (missing schema/header)", () => {
    const result = ingress.canonicalize({ type: "something_else" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_lark_event");
  });

  it("rejects unsupported event types", () => {
    const event = sampleLarkEvent();
    event.header.event_type = "im.chat.member.user.added_v1";
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_event_type");
  });

  it("rejects bot messages", () => {
    const event = sampleLarkEvent({
      sender: { sender_id: { open_id: "ou_bot1" }, sender_type: "bot" },
      message: {
        message_id: "om_msg002",
        chat_id: "oc_chat001",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "bot says hi" }),
      },
    });
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("bot_message");
  });

  it("rejects app messages", () => {
    const event = sampleLarkEvent({
      sender: { sender_id: { open_id: "ou_app1" }, sender_type: "app" },
      message: {
        message_id: "om_msg003",
        chat_id: "oc_chat001",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "app says hi" }),
      },
    });
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("bot_message");
  });

  it("rejects non-text message types", () => {
    const event = sampleLarkEvent();
    (event.event as Record<string, unknown>)["message"] = {
      message_id: "om_msg004",
      chat_id: "oc_chat001",
      chat_type: "group",
      message_type: "image",
      content: "{}",
    };
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_message_type");
  });

  it("rejects messages with empty text", () => {
    const event = sampleLarkEvent();
    (event.event as Record<string, unknown>)["message"] = {
      message_id: "om_msg005",
      chat_id: "oc_chat001",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "" }),
    };
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_text");
  });

  it("rejects messages with invalid content JSON", () => {
    const event = sampleLarkEvent();
    (event.event as Record<string, unknown>)["message"] = {
      message_id: "om_msg006",
      chat_id: "oc_chat001",
      chat_type: "p2p",
      message_type: "text",
      content: "not-json",
    };
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_content");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalize(null);
    expect(result.ok).toBe(false);
  });

  it("rejects undefined input", () => {
    const result = ingress.canonicalize(undefined);
    expect(result.ok).toBe(false);
  });

  it("preserves mentions in provider_extensions when present", () => {
    const event = sampleLarkEvent();
    (event.event as Record<string, unknown>)["message"] = {
      message_id: "om_msg007",
      chat_id: "oc_chat001",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "@Bob hello" }),
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bob" }, name: "Bob" }],
    };
    const result = ingress.canonicalize(event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    const mentions = ext["lark"]!["mentions"] as Array<Record<string, unknown>>;
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!["name"]).toBe("Bob");
  });

  it("uses create_time from header for occurred_at", () => {
    const result = ingress.canonicalize(sampleLarkEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = new Date(1710756000000).toISOString();
    expect(result.event.occurred_at).toBe(expected);
  });

  it("returns describeCapabilities with correct shape", () => {
    const caps = ingress.describeCapabilities();
    expect(caps.channel).toBe("lark");
    expect(caps.messaging.text).toBe(true);
    expect(caps.delivery.edit).toBe(true);
    expect(caps.streaming.progressiveUpdate).toBe(true);
  });
});

let conformanceIngress: LarkIngress;

beforeAll(async () => {
  conformanceIngress = await LarkIngress.create("app_id", "app_secret", "tenant_conformance", "ws_conformance");
});

testChannelAdapter({
  name: "lark",
  get adapter() {
    return conformanceIngress;
  },
  get validInput() {
    return sampleLarkEvent();
  },
  invalidInputs: [
    { label: "non-object", input: "not an object", expectedCode: "invalid_lark_event" },
    {
      label: "wrong event type",
      input: {
        schema: "2.0",
        header: {
          event_id: "evt_x",
          event_type: "im.chat.created_v1",
          create_time: "1710756000000",
          token: "t",
          app_id: "a",
          tenant_key: "tk",
        },
        event: {},
      },
      expectedCode: "unsupported_event_type",
    },
    {
      label: "bot sender",
      input: sampleLarkEvent({
        sender: { sender_id: { open_id: "ou_bot" }, sender_type: "bot" },
        message: {
          message_id: "m1",
          chat_id: "c1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hi" }),
        },
      }),
      expectedCode: "bot_message",
    },
  ],
  expectedChannel: "lark",
});

describe("LarkWebhookVerifier", () => {
  const encryptKey = "lark-encrypt-key";

  function sign(timestamp: string, nonce: string, body: string): string {
    return createHmac("sha256", encryptKey)
      .update(`${timestamp}${nonce}${body}`)
      .digest("base64");
  }

  it("accepts a matching Lark signature", async () => {
    const verifier = new LarkWebhookVerifier(encryptKey);
    const body = JSON.stringify({ schema: "2.0", event: { type: "message" } });
    const timestamp = "1710756000";
    const nonce = "nonce-123";
    const request = new Request("https://example.test/api/lark/webhook", {
      method: "POST",
      headers: {
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": sign(timestamp, nonce, body),
      },
      body,
    });

    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects a missing Lark signature header", async () => {
    const verifier = new LarkWebhookVerifier(encryptKey);
    const request = new Request("https://example.test/api/lark/webhook", {
      method: "POST",
      headers: {
        "x-lark-request-timestamp": "1710756000",
        "x-lark-request-nonce": "nonce-123",
      },
      body: JSON.stringify({ schema: "2.0" }),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });

  it("rejects a mismatched Lark signature", async () => {
    const verifier = new LarkWebhookVerifier(encryptKey);
    const request = new Request("https://example.test/api/lark/webhook", {
      method: "POST",
      headers: {
        "x-lark-request-timestamp": "1710756000",
        "x-lark-request-nonce": "nonce-123",
        "x-lark-signature": "invalid-signature",
      },
      body: JSON.stringify({ schema: "2.0" }),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});

describe("Lark sender", () => {
  let mockServer: BunServer;

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  it("sends a message and returns messageId", async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/auth/")) {
          return Response.json({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-test-token",
            expire: 7200,
          });
        }
        expect(req.headers.get("Authorization")).toBe("Bearer t-test-token");
        const body = (await req.json()) as Record<string, string>;
        expect(body["receive_id"]).toBe("oc_chat001");
        return Response.json({ code: 0, msg: "ok", data: { message_id: "om_reply001" } });
      },
    });

    const sender = createLarkSender("app_id", "app_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      const result = await sender.sendMessage("oc_chat001", "Hello back");
      expect(result.messageId).toBe("om_reply001");
    } finally {
      restore();
    }
  });

  it("edits a message via PATCH", async () => {
    let patchCalled = false;
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/auth/")) {
          return Response.json({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-edit-token",
            expire: 7200,
          });
        }
        expect(req.method).toBe("PATCH");
        expect(url.pathname).toContain("/om_msg_to_edit");
        patchCalled = true;
        return Response.json({ code: 0, msg: "ok" });
      },
    });

    const sender = createLarkSender("app_id", "app_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      await sender.editMessage("om_msg_to_edit", "Updated text");
      expect(patchCalled).toBe(true);
    } finally {
      restore();
    }
  });

  it("throws on token fetch failure", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ code: 10003, msg: "invalid app_id" });
      },
    });

    const sender = createLarkSender("bad_id", "bad_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      await expect(sender.sendMessage("oc_chat001", "test")).rejects.toThrow("invalid app_id");
    } finally {
      restore();
    }
  });

  it("throws on send failure", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/auth/")) {
          return Response.json({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-ok",
            expire: 7200,
          });
        }
        return Response.json({ code: 230001, msg: "chat not found" });
      },
    });

    const sender = createLarkSender("app_id", "app_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      await expect(sender.sendMessage("oc_invalid", "test")).rejects.toThrow("chat not found");
    } finally {
      restore();
    }
  });

  it("caches the token across calls", async () => {
    let tokenRequestCount = 0;
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/auth/")) {
          tokenRequestCount++;
          return Response.json({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-cached",
            expire: 7200,
          });
        }
        return Response.json({ code: 0, msg: "ok", data: { message_id: "om_x" } });
      },
    });

    const sender = createLarkSender("app_id", "app_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      await sender.sendMessage("oc_chat001", "first");
      await sender.sendMessage("oc_chat001", "second");
      expect(tokenRequestCount).toBe(1);
    } finally {
      restore();
    }
  });

  it("sendFn extracts chat_id from provider_extensions and sends", async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/auth/")) {
          return Response.json({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-sendfn",
            expire: 7200,
          });
        }
        const body = (await req.json()) as Record<string, string>;
        expect(body["receive_id"]).toBe("oc_chat_sendfn");
        return Response.json({ code: 0, msg: "ok", data: { message_id: "om_sf" } });
      },
    });

    const sender = createLarkSender("app_id", "app_secret");
    const restore = patchFetch(mockServer.port!);
    try {
      const event = {
        event_id: "evt_1",
        schema_version: "v1alpha1",
        event_type: "message.send.requested",
        tenant_id: "t",
        workspace_id: "w",
        channel: "lark",
        conversation_id: "c",
        session_id: "s",
        correlation_id: "corr",
        occurred_at: new Date().toISOString(),
        actor_type: "system",
        payload: { text: "reply text" },
        provider_extensions: { lark: { chat_id: "oc_chat_sendfn" } },
      };
      await sender.sendFn(event);
    } finally {
      restore();
    }
  });
});
