import { beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DingTalkIngress } from "../src/dingtalk-ingress";
import { DingTalkWebhookVerifier } from "../src/dingtalk-verifier";

function makeCallback(overrides: Record<string, unknown> = {}) {
  return {
    msgtype: "text",
    text: { content: "Hello from DingTalk" },
    msgId: "msg_abc123",
    createAt: 1700000000000,
    conversationType: "2",
    conversationId: "cidXYZ",
    conversationTitle: "Test Group",
    senderId: "user_001",
    senderNick: "Alice",
    senderStaffId: "staff_001",
    chatbotUserId: "bot_001",
    sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
    sessionWebhookExpiredTime: 1700003600000,
    ...overrides,
  };
}

describe("DingTalkWebhookVerifier", () => {
  const secret = "dingtalk-secret";

  function sign(timestamp: string): string {
    return createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  }

  it("accepts a matching DingTalk sign query", async () => {
    const timestamp = "1710756000000";
    const verifier = new DingTalkWebhookVerifier(secret);
    const request = new Request(
      `https://example.test/api/dingtalk/webhook?timestamp=${timestamp}&sign=${encodeURIComponent(sign(timestamp))}`,
      {
        method: "POST",
        body: JSON.stringify(makeCallback()),
      },
    );

    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects a missing DingTalk sign query", async () => {
    const verifier = new DingTalkWebhookVerifier(secret);
    const request = new Request("https://example.test/api/dingtalk/webhook?timestamp=1710756000000", {
      method: "POST",
      body: JSON.stringify(makeCallback()),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });

  it("rejects a mismatched DingTalk sign query", async () => {
    const verifier = new DingTalkWebhookVerifier(secret);
    const request = new Request(
      "https://example.test/api/dingtalk/webhook?timestamp=1710756000000&sign=invalid-signature",
      {
        method: "POST",
        body: JSON.stringify(makeCallback()),
      },
    );

    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});

describe("DingTalk ingress", () => {
  let ingress: DingTalkIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await DingTalkIngress.create("tenant-dt", "workspace-dt");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a valid callback into a contract-valid message.received", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("message.received");
    expect(result.event.channel).toBe("dingtalk");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.tenant_id).toBe("tenant-dt");
    expect(result.event.workspace_id).toBe("workspace-dt");
    expect(result.event.payload["text"]).toBe("Hello from DingTalk");
    expect(result.event.event_id).toMatch(/^evt_/);
    expect(result.event.correlation_id).toMatch(/^corr_/);
    expect(result.event.schema_version).toBe("v1alpha1");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("maps conversation_id with dt- prefix", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.conversation_id).toBe("dt-cidXYZ");
  });

  it("sets session_id equal to conversation_id", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.session_id).toBe(result.event.conversation_id);
  });

  it("sets channel_instance_id with dingtalk- prefix", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.channel_instance_id).toBe("dingtalk-cidXYZ");
  });

  it("derives a stable idempotency key from msgId", () => {
    const r1 = ingress.canonicalize(makeCallback());
    const r2 = ingress.canonicalize(makeCallback());
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.idempotencyKey).toBe("dt-msg_abc123");
    expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
  });

  it("preserves DingTalk-specific fields in provider_extensions", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["dingtalk"]!["msg_id"]).toBe("msg_abc123");
    expect(ext["dingtalk"]!["conversation_type"]).toBe("2");
    expect(ext["dingtalk"]!["conversation_title"]).toBe("Test Group");
    expect(ext["dingtalk"]!["session_webhook"]).toBe("https://oapi.dingtalk.com/robot/sendBySession?session=abc");
    expect(ext["dingtalk"]!["chatbot_user_id"]).toBe("bot_001");
    expect(ext["dingtalk"]!["sender_staff_id"]).toBe("staff_001");
  });

  it("includes is_admin when present", () => {
    const result = ingress.canonicalize(makeCallback({ isAdmin: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["dingtalk"]!["is_admin"]).toBe(true);
  });

  it("omits optional fields from provider_extensions when absent", () => {
    const cb = makeCallback();
    delete (cb as Record<string, unknown>)["conversationTitle"];
    delete (cb as Record<string, unknown>)["senderStaffId"];
    const result = ingress.canonicalize(cb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["dingtalk"]!["conversation_title"]).toBeUndefined();
    expect(ext["dingtalk"]!["sender_staff_id"]).toBeUndefined();
    expect(ext["dingtalk"]!["is_admin"]).toBeUndefined();
  });

  it("maps actor with id and display_name", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actor = result.event["actor"] as { id: string; display_name: string };
    expect(actor.id).toBe("user_001");
    expect(actor.display_name).toBe("Alice");
  });

  it("maps identity_refs.channel_user_id from senderId", () => {
    const result = ingress.canonicalize(makeCallback());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.event["identity_refs"] as Record<string, string>;
    expect(refs["channel_user_id"]).toBe("user_001");
  });

  it("uses createAt timestamp for occurred_at", () => {
    const result = ingress.canonicalize(makeCallback({ createAt: 1700000000000 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.occurred_at).toBe(new Date(1700000000000).toISOString());
  });

  it("rejects null input", () => {
    const result = ingress.canonicalize(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_payload");
  });

  it("rejects undefined input", () => {
    const result = ingress.canonicalize(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_payload");
  });

  it("rejects non-object input", () => {
    const result = ingress.canonicalize(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_payload");
  });

  it("rejects non-text msgtype", () => {
    const result = ingress.canonicalize(makeCallback({ msgtype: "image" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_msgtype");
  });

  it("rejects missing text.content", () => {
    const result = ingress.canonicalize(makeCallback({ text: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_field");
  });

  it("rejects empty text.content", () => {
    const result = ingress.canonicalize(makeCallback({ text: { content: "  " } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_content");
  });

  it("rejects missing required string fields", () => {
    for (const field of [
      "msgId",
      "senderId",
      "senderNick",
      "conversationId",
      "conversationType",
      "chatbotUserId",
      "sessionWebhook",
    ]) {
      const result = ingress.canonicalize(makeCallback({ [field]: undefined }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("missing_field");
      expect(result.error.field).toBe(field);
    }
  });

  it("rejects missing createAt", () => {
    const result = ingress.canonicalize(makeCallback({ createAt: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_field");
    expect(result.error.field).toBe("createAt");
  });

  it("rejects missing sessionWebhookExpiredTime", () => {
    const result = ingress.canonicalize(makeCallback({ sessionWebhookExpiredTime: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_field");
    expect(result.error.field).toBe("sessionWebhookExpiredTime");
  });

  it("describeCapabilities returns correct metadata", () => {
    const caps = ingress.describeCapabilities();
    expect(caps.channel).toBe("dingtalk");
    expect(caps.messaging.text).toBe(true);
    expect(caps.messaging.attachments).toBe(false);
    expect(caps.messaging.reactions).toBe(false);
    expect(caps.streaming.nativeStreaming).toBe(false);
    expect(caps.delivery.retry).toBe(true);
    expect(caps.delivery.edit).toBe(false);
  });
});
