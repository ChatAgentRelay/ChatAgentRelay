import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { testChannelAdapter } from "@chat-agent-relay/adapter-conformance";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { createWhatsAppSessionTracker } from "../src/session-tracker";
import { WhatsAppIngress } from "../src/whatsapp-ingress";
import { createWhatsAppSender } from "../src/whatsapp-sender";
import { WhatsAppWebhookVerifier } from "../src/whatsapp-verifier";

type BunServer = Server<unknown>;

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
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
                {
                  from: "15551234567",
                  id: "wamid.001",
                  timestamp: "1710756000",
                  type: "text",
                  text: { body: "Hello from WhatsApp" },
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("WhatsApp ingress", () => {
  let ingress: WhatsAppIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await WhatsAppIngress.create("phone_123", "token_123");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a WhatsApp text message into message.received", () => {
    const result = ingress.canonicalize(samplePayload());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("whatsapp");
    expect(result.event.payload["text"]).toBe("Hello from WhatsApp");
    expect(result.event.conversation_id).toBe("wa_phone_123_15551234567");
    expect(result.idempotencyKey).toBe("wa-wamid.001");
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["whatsapp"]!["session_window_expires_at"]).toBe("2024-03-19T10:00:00.000Z");
    expect(validators.validateEvent(result.event).ok).toBe(true);
  });

  it("canonicalizes statuses into agent.status.changed", () => {
    const result = ingress.canonicalize({
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
                  { id: "wamid.001", status: "delivered", timestamp: "1710756060", recipient_id: "15551234567" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.event_type).toBe("agent.status.changed");
    expect(result.event.payload["status"]).toBe("working");
    expect(result.event.payload["session_handle"]).toBe("wamid.001");
    expect(result.event.payload["provider_status"]).toBe("delivered");
    expect(validators.validateEvent(result.event).ok).toBe(true);
  });

  it("rejects unsupported payloads", () => {
    const result = ingress.canonicalize({
      object: "whatsapp_business_account",
      entry: [{ id: "business_123", changes: [{ field: "messages", value: { messaging_product: "whatsapp" } }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_payload");
  });
});

let conformanceIngress: WhatsAppIngress;

beforeAll(async () => {
  conformanceIngress = await WhatsAppIngress.create("phone_123", "token_123");
});

testChannelAdapter({
  name: "whatsapp",
  get adapter() {
    return conformanceIngress;
  },
  get validInput() {
    return samplePayload();
  },
  invalidInputs: [
    { label: "non-object", input: "bad", expectedCode: "invalid_payload" },
    {
      label: "unsupported",
      input: { object: "whatsapp_business_account", entry: [] },
      expectedCode: "invalid_payload",
    },
  ],
  expectedChannel: "whatsapp",
});

describe("WhatsAppWebhookVerifier", () => {
  it("accepts a valid Meta signature", async () => {
    const verifier = new WhatsAppWebhookVerifier("app-secret");
    const body = JSON.stringify(samplePayload());
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    const request = new Request("https://example.test/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });
    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects an invalid Meta signature", async () => {
    const verifier = new WhatsAppWebhookVerifier("app-secret");
    const request = new Request("https://example.test/api/whatsapp/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body: JSON.stringify(samplePayload()),
    });
    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});

describe("WhatsApp sender", () => {
  let mockServer: BunServer;
  let sendBodies: Array<Record<string, unknown>>;

  beforeAll(() => {
    sendBodies = [];
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  it("sends a reply via Cloud API", async () => {
    sendBodies = [];
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("Authorization")).toBe("Bearer access-token");
        const body = (await req.json()) as Record<string, unknown>;
        sendBodies.push(body);
        expect(body["to"]).toBe("15551234567");
        expect(body["type"]).toBe("text");
        return Response.json({ messages: [{ id: "wamid.reply001" }] });
      },
    });

    const sender = createWhatsAppSender("phone_123", "access-token", {
      apiBase: `http://localhost:${mockServer.port}`,
    });
    const result = await sender.sendMessage("15551234567", "Hello back");
    expect(result.messageId).toBe("wamid.reply001");
  });

  it("does not warn when the session window has more than one hour remaining", async () => {
    const warnings: string[] = [];
    const tracker = createWhatsAppSessionTracker();
    tracker.record({ recipient: "15551234567", expiresAt: "2024-03-19T12:00:00.000Z" });

    const sender = createWhatsAppSender("phone_123", "access-token", {
      apiBase: `http://localhost:${mockServer.port}`,
      sessionTracker: tracker,
      now: () => new Date("2024-03-19T09:30:00.000Z"),
      warn: (message) => warnings.push(message),
    });

    await sender.sendMessage("15551234567", "Hello back");
    expect(warnings).toEqual([]);
  });

  it("warns when less than one hour remains in the session window", async () => {
    const warnings: string[] = [];
    const tracker = createWhatsAppSessionTracker();
    tracker.record({ recipient: "15551234567", expiresAt: "2024-03-19T10:15:00.000Z" });

    const sender = createWhatsAppSender("phone_123", "access-token", {
      apiBase: `http://localhost:${mockServer.port}`,
      sessionTracker: tracker,
      now: () => new Date("2024-03-19T09:30:00.000Z"),
      warn: (message) => warnings.push(message),
    });

    await sender.sendMessage("15551234567", "Hello back");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("nearing the end of the 24-hour session window");
  });

  it("warns when the 24-hour session window is expired but still attempts delivery", async () => {
    const warnings: string[] = [];
    sendBodies = [];
    const tracker = createWhatsAppSessionTracker();
    tracker.record({ recipient: "15551234567", expiresAt: "2024-03-19T08:30:00.000Z" });

    const sender = createWhatsAppSender("phone_123", "access-token", {
      apiBase: `http://localhost:${mockServer.port}`,
      sessionTracker: tracker,
      now: () => new Date("2024-03-19T09:30:00.000Z"),
      warn: (message) => warnings.push(message),
    });

    await sender.sendMessage("15551234567", "Hello back");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("outside the 24-hour session window");
    expect(sendBodies).toHaveLength(1);
  });

  it("warns when no active inbound session is known but still attempts delivery", async () => {
    const warnings: string[] = [];
    sendBodies = [];

    const sender = createWhatsAppSender("phone_123", "access-token", {
      apiBase: `http://localhost:${mockServer.port}`,
      sessionTracker: createWhatsAppSessionTracker(),
      warn: (message) => warnings.push(message),
    });

    await sender.sendMessage("15551234567", "Hello back");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no active inbound session");
    expect(sendBodies).toHaveLength(1);
  });
});
