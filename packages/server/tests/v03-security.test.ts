import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { SlackWebhookVerifier } from "@chat-agent-relay/channel-slack";
import { TeamsWebhookVerifier } from "@chat-agent-relay/channel-teams";
import { TelegramWebhookVerifier } from "@chat-agent-relay/channel-telegram";
import { RouteEngine, SqliteConfigStore } from "@chat-agent-relay/config-store";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { AgentRegistry } from "../src/agent-registry";
import { startApiServer } from "../src/api";
import { ChannelRegistry } from "../src/channel-registry";

function makeBlockedEvent(conversationId: string, correlationId: string, blockStage: string) {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "event.blocked",
    tenant_id: "tenant_test",
    workspace_id: "ws_test",
    channel: "webchat",
    channel_instance_id: "webchat",
    conversation_id: conversationId,
    session_id: "sess_test",
    correlation_id: correlationId,
    causation_id: `evt_${crypto.randomUUID()}`,
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload: { reason: `${blockStage}_reason`, block_stage: blockStage, retryable: false },
  };
}

type BunServer = Server<unknown>;

// ── REQ-1: Management API Authentication ────────────────────────────────

describe("REQ-1: API Authentication — no key set (backward compat)", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addAgent("test-agent", "a2a", { endpoint: "http://localhost:9999" });

    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    // No apiKey set — should be fully open
    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("GET /api/agents is accessible without auth", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
  });

  it("GET /api/health is accessible", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });
});

describe("REQ-1: API Authentication — key set", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  const API_KEY = "test-secret-key-123";

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addAgent("test-agent", "a2a", { endpoint: "http://localhost:9999" });

    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({
      port: 0,
      ledgerStore: store,
      configDb,
      agentRegistry,
      channelRegistry,
      apiKey: API_KEY,
      chatPublic: true,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("GET /api/agents without header returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("GET /api/agents with correct Bearer returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/agents with wrong Bearer returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/health without header returns 200 (always public)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("POST /api/chat without header returns OK when chatPublic is true", async () => {
    // WebChat not configured, so we'll get 501 (not 401)
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    // Should not be 401 — it's public
    expect(res.status).not.toBe(401);
  });

  it("OPTIONS /api/chat is always public (CORS preflight)", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, { method: "OPTIONS" });
    expect(res.status).not.toBe(401);
  });
});

describe("REQ-1: API Authentication — chatPublic=false", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  const API_KEY = "another-secret";

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");

    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({
      port: 0,
      ledgerStore: store,
      configDb,
      agentRegistry,
      channelRegistry,
      apiKey: API_KEY,
      chatPublic: false,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("POST /api/chat without header returns 401 when chatPublic is false", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(401);
  });

  it("OPTIONS /api/chat is still public even when chatPublic is false", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, { method: "OPTIONS" });
    expect(res.status).not.toBe(401);
  });
});

describe("REQ-1b: Slack webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("slack-main", "slack", {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "signing-secret",
    });

    callCount = 0;
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {
      callCount++;
    });
    channelRegistry.registerFactory("slack", async () => {
      return {
        adapter: {
          channelType: "slack",
          describeCapabilities: () => ({
            channel: "slack",
            messaging: { text: true, attachments: false, reactions: true, threads: true },
            streaming: { progressiveUpdate: true, nativeStreaming: false },
            interactive: { buttons: false, menus: false, commands: true },
            delivery: { retry: true, chunking: true, edit: true },
          }),
          canonicalize: () => ({ ok: false as const, error: { code: "noop", message: "noop" } }),
          createSender: () => ({ send: async () => ({ providerMessageId: "noop" }) }),
        },
        connection: null,
      };
    });
    const slackChannel = await configDb.getChannel("slack-main");
    expect(slackChannel).toBeDefined();
    await channelRegistry.register(slackChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    configDb.close();
  });

  it("accepts a valid Slack-signed webhook request", async () => {
    const verifier = new SlackWebhookVerifier("signing-secret");
    const body = JSON.stringify({ type: "event_callback", event: { type: "message", text: "hi" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = verifier.sign(timestamp, body);

    const res = await fetch(`${baseUrl}/api/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("rejects an invalid Slack-signed webhook request", async () => {
    const before = callCount;
    const res = await fetch(`${baseUrl}/api/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": "1710756000",
        "x-slack-signature": "v0=deadbeef",
      },
      body: JSON.stringify({ type: "event_callback", event: { type: "message", text: "hi" } }),
    });

    expect(res.status).toBe(401);
    expect(callCount).toBe(before);
  });
});

describe("REQ-1c: Teams webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("teams-main", "teams", {
      appId: "teams-app-id",
      appSecret: "teams-secret",
      tenantId: "common",
    });

    callCount = 0;
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {
      callCount++;
    });
    channelRegistry.registerFactory("teams", async () => {
      return {
        adapter: {
          channelType: "teams",
          describeCapabilities: () => ({
            channel: "teams",
            messaging: { text: true, attachments: false, reactions: false, threads: true },
            streaming: { progressiveUpdate: true, nativeStreaming: false },
            interactive: { buttons: false, menus: false, commands: false },
            delivery: { retry: true, chunking: false, edit: true },
          }),
          canonicalize: () => ({ ok: false as const, error: { code: "noop", message: "noop" } }),
          createSender: () => ({ send: async () => ({ providerMessageId: "noop" }) }),
        },
        connection: null,
      };
    });
    const teamsChannel = await configDb.getChannel("teams-main");
    expect(teamsChannel).toBeDefined();
    await channelRegistry.register(teamsChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    configDb.close();
  });

  it("accepts a valid Teams JWT webhook request", async () => {
    const originalVerify = TeamsWebhookVerifier.prototype.verify;
    TeamsWebhookVerifier.prototype.verify = async () => true;

    try {
      const res = await fetch(`${baseUrl}/api/teams/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer valid-token",
        },
        body: JSON.stringify({ type: "message", text: "hi" }),
      });

      expect(res.status).toBe(200);
      expect(callCount).toBe(1);
    } finally {
      TeamsWebhookVerifier.prototype.verify = originalVerify;
    }
  });

  it("rejects an invalid Teams JWT webhook request", async () => {
    const originalVerify = TeamsWebhookVerifier.prototype.verify;
    TeamsWebhookVerifier.prototype.verify = async () => false;

    try {
      const before = callCount;
      const res = await fetch(`${baseUrl}/api/teams/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ type: "message", text: "hi" }),
      });

      expect(res.status).toBe(401);
      expect(callCount).toBe(before);
    } finally {
      TeamsWebhookVerifier.prototype.verify = originalVerify;
    }
  });
});

describe("REQ-1d: Telegram webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("telegram-main", "telegram", {
      botToken: "telegram-bot-token",
      secretToken: "telegram-secret",
    });

    callCount = 0;
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {
      callCount++;
    });
    channelRegistry.registerFactory("telegram", async () => {
      return {
        adapter: {
          channelType: "telegram",
          describeCapabilities: () => ({
            channel: "telegram",
            messaging: { text: true, attachments: false, reactions: false, threads: false },
            streaming: { progressiveUpdate: true, nativeStreaming: false },
            interactive: { buttons: false, menus: false, commands: true },
            delivery: { retry: true, chunking: false, edit: true },
          }),
          canonicalize: () => ({ ok: false as const, error: { code: "noop", message: "noop" } }),
          createSender: () => ({ send: async () => ({ providerMessageId: "noop" }) }),
        },
        connection: null,
      };
    });
    const telegramChannel = await configDb.getChannel("telegram-main");
    expect(telegramChannel).toBeDefined();
    await channelRegistry.register(telegramChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    configDb.close();
  });

  it("accepts a valid Telegram secret-token webhook request", async () => {
    const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "telegram-secret",
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          date: 1710756000,
          text: "hi",
          from: { id: 123, is_bot: false, first_name: "Ada" },
          chat: { id: 456, type: "private" },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("rejects an invalid Telegram secret-token webhook request", async () => {
    const before = callCount;
    const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
      },
      body: JSON.stringify({
        update_id: 2,
        message: {
          message_id: 11,
          date: 1710756001,
          text: "hi",
          from: { id: 123, is_bot: false, first_name: "Ada" },
          chat: { id: 456, type: "private" },
        },
      }),
    });

    expect(res.status).toBe(401);
    expect(callCount).toBe(before);
  });
});

describe("REQ-1e: Lark webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;

  function sign(timestamp: string, nonce: string, body: string): string {
    return createHmac("sha256", "lark-encrypt-key").update(`${timestamp}${nonce}${body}`).digest("base64");
  }

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("lark-main", "lark", {
      appId: "lark-app-id",
      appSecret: "lark-app-secret",
      encryptKey: "lark-encrypt-key",
    });

    callCount = 0;
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {
      callCount++;
    });
    channelRegistry.registerFactory("lark", async () => {
      return {
        adapter: {
          channelType: "lark",
          describeCapabilities: () => ({
            channel: "lark",
            messaging: { text: true, attachments: false, reactions: false, threads: false },
            streaming: { progressiveUpdate: true, nativeStreaming: false },
            interactive: { buttons: false, menus: false, commands: false },
            delivery: { retry: true, chunking: false, edit: true },
          }),
          canonicalize: () => ({ ok: false as const, error: { code: "noop", message: "noop" } }),
          createSender: () => ({ send: async () => ({ providerMessageId: "noop" }) }),
        },
        connection: null,
      };
    });
    const larkChannel = await configDb.getChannel("lark-main");
    expect(larkChannel).toBeDefined();
    await channelRegistry.register(larkChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("accepts a valid Lark-signed webhook request", async () => {
    const body = JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "evt_lark_valid",
        event_type: "im.message.receive_v1",
        create_time: "1710756000000",
        token: "verification_token",
        app_id: "lark-app-id",
        tenant_key: "tenant_test",
      },
      event: {
        sender: { sender_id: { open_id: "ou_user123" }, sender_type: "user" },
        message: {
          message_id: "om_msg001",
          chat_id: "oc_chat001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hi" }),
        },
      },
    });
    const timestamp = "1710756000";
    const nonce = "nonce-123";

    const res = await fetch(`${baseUrl}/api/lark/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": sign(timestamp, nonce, body),
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("rejects an invalid Lark-signed webhook request", async () => {
    const before = callCount;
    const res = await fetch(`${baseUrl}/api/lark/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": "1710756000",
        "x-lark-request-nonce": "nonce-123",
        "x-lark-signature": "invalid-signature",
      },
      body: JSON.stringify({ schema: "2.0", event: {} }),
    });

    expect(res.status).toBe(401);
    expect(callCount).toBe(before);
  });
});

describe("REQ-1f: DingTalk webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;

  function sign(timestamp: string): string {
    return createHmac("sha256", "dingtalk-secret").update(`${timestamp}\n${"dingtalk-secret"}`).digest("base64");
  }

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("dingtalk-main", "dingtalk", {
      secret: "dingtalk-secret",
    });

    callCount = 0;
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {
      callCount++;
    });
    channelRegistry.registerFactory("dingtalk", async () => {
      return {
        adapter: {
          channelType: "dingtalk",
          describeCapabilities: () => ({
            channel: "dingtalk",
            messaging: { text: true, attachments: false, reactions: false, threads: false },
            streaming: { progressiveUpdate: false, nativeStreaming: false },
            interactive: { buttons: false, menus: false, commands: false },
            delivery: { retry: true, chunking: false, edit: false },
          }),
          canonicalize: () => ({ ok: false as const, error: { code: "noop", message: "noop" } }),
          createSender: () => ({ send: async () => ({ providerMessageId: "noop" }) }),
        },
        connection: null,
      };
    });
    const dingtalkChannel = await configDb.getChannel("dingtalk-main");
    expect(dingtalkChannel).toBeDefined();
    await channelRegistry.register(dingtalkChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("accepts a valid DingTalk-signed webhook request", async () => {
    const timestamp = "1710756000000";
    const res = await fetch(
      `${baseUrl}/api/dingtalk/webhook?timestamp=${timestamp}&sign=${encodeURIComponent(sign(timestamp))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: "hi" },
          msgId: "msg_abc123",
          createAt: 1700000000000,
          conversationType: "2",
          conversationId: "cidXYZ",
          senderId: "user_001",
          senderNick: "Alice",
          chatbotUserId: "bot_001",
          sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
          sessionWebhookExpiredTime: 1700003600000,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("rejects an invalid DingTalk-signed webhook request", async () => {
    const before = callCount;
    const res = await fetch(`${baseUrl}/api/dingtalk/webhook?timestamp=1710756000000&sign=invalid-signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: "hi" } }),
    });

    expect(res.status).toBe(401);
    expect(callCount).toBe(before);
  });
});

describe("REQ-1g: WhatsApp webhook verification", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let callCount: number;
  let store: InMemoryEventLedgerStore;

  function sign(body: string): string {
    return `sha256=${createHmac("sha256", "wa-app-secret").update(body).digest("hex")}`;
  }

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addChannel("whatsapp-main", "whatsapp", {
      phoneNumberId: "phone_123",
      accessToken: "wa-access-token",
      verifyToken: "wa-verify-token",
      appSecret: "wa-app-secret",
    });

    callCount = 0;
    store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async (_channelName, adapter, rawEvent) => {
      callCount++;
      const result = adapter.canonicalize(rawEvent);
      if (result.ok) {
        store.append(result.event);
      }
    });
    channelRegistry.registerFactory("whatsapp", async () => {
      const { WhatsAppIngress } = await import("@chat-agent-relay/channel-whatsapp");
      return { adapter: await WhatsAppIngress.create("phone_123", "wa-access-token"), connection: null };
    });
    const whatsappChannel = await configDb.getChannel("whatsapp-main");
    expect(whatsappChannel).toBeDefined();
    await channelRegistry.register(whatsappChannel!);

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("accepts webhook challenge with matching verify token", async () => {
    const res = await fetch(
      `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wa-verify-token&hub.challenge=test-challenge`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("test-challenge");
  });

  it("accepts a valid WhatsApp-signed webhook request", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "business_123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "phone_123", display_phone_number: "+15550001111" },
                messages: [
                  { from: "15551234567", id: "wamid.001", timestamp: "1710756000", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("rejects an invalid WhatsApp-signed webhook request", async () => {
    const before = callCount;
    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    });

    expect(res.status).toBe(401);
    expect(callCount).toBe(before);
  });

  it("records WhatsApp status webhooks in the ledger without routing them to the pipeline", async () => {
    const before = callCount;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "business_123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "phone_123", display_phone_number: "+15550001111" },
                statuses: [
                  { id: "wamid.status001", status: "delivered", timestamp: "1710756060", recipient_id: "15551234567" },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(before + 1);

    const events = store.getByConversationId("wa_phone_123_15551234567");
    expect(events.some((event) => event.event_type === "agent.status.changed")).toBe(true);
    expect(events.some((event) => event.event_type === "agent.invocation.requested")).toBe(false);
    expect(events.some((event) => event.event_type === "message.send.requested")).toBe(false);
  });
});

describe("REQ-2/3/4: audit surfaces new blocked stages", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let store: InMemoryEventLedgerStore;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});

    const conversationId = "conv_security_audit";
    const blockedStages = ["access_control", "rate_limit", "outbound_governance"];
    for (const [index, blockStage] of blockedStages.entries()) {
      const correlationId = `corr_${index + 1}`;
      store.append({
        event_id: `evt_msg_${index + 1}`,
        schema_version: "v1alpha1",
        event_type: "message.received",
        tenant_id: "tenant_test",
        workspace_id: "ws_test",
        channel: "webchat",
        channel_instance_id: "webchat",
        conversation_id: conversationId,
        session_id: `sess_${index + 1}`,
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        actor_type: "end_user",
        actor: { id: `user_${index + 1}` },
        payload: { text: `message ${index + 1}`, user_id: `user_${index + 1}` },
      });
      store.append(makeBlockedEvent(conversationId, correlationId, blockStage));
    }

    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("GET /api/conversations/:id/audit includes access_control, rate_limit, and outbound_governance", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_security_audit/audit`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turns: Array<{ block_stage?: string }> };
    expect(body.turns.map((turn) => turn.block_stage)).toEqual(["access_control", "rate_limit", "outbound_governance"]);
  });
});
