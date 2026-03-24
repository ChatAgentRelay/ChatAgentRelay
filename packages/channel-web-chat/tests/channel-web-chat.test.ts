import { describe, it, expect, beforeAll } from "bun:test";
import { WebChatIngress } from "../src/canonicalize";
import { validateInboundInput } from "../src/validate-input";
import { deriveIdempotencyKey } from "../src/idempotency";
import type { InboundWebChatRequest } from "../src/types";

function validRequest(overrides?: Partial<InboundWebChatRequest>): InboundWebChatRequest {
  return {
    client_message_id: "web_msg_001",
    text: "Where is my order?",
    user_id: "user_123",
    display_name: "Alice",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel_instance_id: "webchat_acme_prod",
    ...overrides,
  };
}

describe("input validation", () => {
  it("accepts a valid inbound request", () => {
    const result = validateInboundInput(validRequest());
    expect(result.ok).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateInboundInput(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_payload");
    }
  });

  it("rejects missing client_message_id", () => {
    const { client_message_id: _, ...rest } = validRequest();
    const result = validateInboundInput(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("client_message_id");
    }
  });

  it("rejects empty text", () => {
    const result = validateInboundInput(validRequest({ text: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("text");
    }
  });

  it("rejects missing tenant_id", () => {
    const { tenant_id: _, ...rest } = validRequest();
    const result = validateInboundInput(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("tenant_id");
    }
  });

  it("preserves optional fields when present", () => {
    const result = validateInboundInput(
      validRequest({
        conversation_id: "conv_1",
        session_id: "sess_1",
        trace_id: "trace_1",
        span_id: "span_1",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.conversation_id).toBe("conv_1");
      expect(result.request.session_id).toBe("sess_1");
      expect(result.request.trace_id).toBe("trace_1");
    }
  });
});

describe("idempotency key derivation", () => {
  it("produces a stable key for the same input", () => {
    const request = validRequest();
    const key1 = deriveIdempotencyKey(request);
    const key2 = deriveIdempotencyKey(request);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different client_message_ids", () => {
    const key1 = deriveIdempotencyKey(validRequest({ client_message_id: "msg_001" }));
    const key2 = deriveIdempotencyKey(validRequest({ client_message_id: "msg_002" }));
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different tenants", () => {
    const key1 = deriveIdempotencyKey(validRequest({ tenant_id: "tenant_a" }));
    const key2 = deriveIdempotencyKey(validRequest({ tenant_id: "tenant_b" }));
    expect(key1).not.toBe(key2);
  });

  it("includes channel_instance_id in the key", () => {
    const key = deriveIdempotencyKey(validRequest());
    expect(key).toContain("webchat_acme_prod");
  });
});

describe("web chat ingress canonicalization", () => {
  let ingress: WebChatIngress;

  beforeAll(async () => {
    ingress = await WebChatIngress.create();
  });

  it("canonicalizes a valid request into a contract-valid message.received event", () => {
    const result = ingress.canonicalize(validRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = result.event;
    expect(event.event_type).toBe("message.received");
    expect(event.channel).toBe("webchat");
    expect(event.actor_type).toBe("end_user");
    expect(event.tenant_id).toBe("tenant_acme");
    expect(event.workspace_id).toBe("ws_support");
    expect(event.payload["text"]).toBe("Where is my order?");
    expect(event.event_id).toMatch(/^evt_/);
    expect(event.correlation_id).toMatch(/^corr_/);
    expect(event.schema_version).toBe("v1alpha1");
  });

  it("generates conversation_id and session_id when not provided", () => {
    const result = ingress.canonicalize(validRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toMatch(/^conv_/);
    expect(result.event.session_id).toMatch(/^sess_/);
  });

  it("preserves conversation_id and session_id when provided", () => {
    const result = ingress.canonicalize(
      validRequest({ conversation_id: "conv_existing", session_id: "sess_existing" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.conversation_id).toBe("conv_existing");
    expect(result.event.session_id).toBe("sess_existing");
  });

  it("includes provider_extensions with client_message_id", () => {
    const result = ingress.canonicalize(validRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const extensions = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    const webchat = extensions["webchat"];
    expect(webchat).toBeDefined();
    expect(webchat!["client_message_id"]).toBe("web_msg_001");
  });

  it("includes trace_context when trace_id is provided", () => {
    const result = ingress.canonicalize(
      validRequest({ trace_id: "trace_abc", span_id: "span_xyz" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tc = (result.event as Record<string, unknown>)["trace_context"] as Record<string, string>;
    expect(tc["trace_id"]).toBe("trace_abc");
    expect(tc["span_id"]).toBe("span_xyz");
  });

  it("includes actor with display_name when provided", () => {
    const result = ingress.canonicalize(validRequest({ display_name: "Alice" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.event["actor"] as Record<string, string>;
    expect(actor["id"]).toBe("user_123");
    expect(actor["display_name"]).toBe("Alice");
  });

  it("returns a stable idempotency key with the result", () => {
    const result = ingress.canonicalize(validRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("webchat:tenant_acme:webchat_acme_prod:web_msg_001");
  });

  it("rejects invalid raw input and returns an ingress error", () => {
    const result = ingress.canonicalize({ text: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("missing_field");
  });

  it("rejects completely invalid input", () => {
    const result = ingress.canonicalize(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_payload");
  });
});
