import { beforeAll, describe, expect, it } from "bun:test";
import type { CanonicalEvent, ChannelSender } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DeliveryExhaustedError, DeliveryOrchestrator } from "../src/delivery";

function sampleAgentResponse(): CanonicalEvent {
  return {
    event_id: "evt_104",
    schema_version: "v1alpha1",
    event_type: "agent.response.completed",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel: "webchat",
    channel_instance_id: "webchat_acme_prod",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "corr_1",
    causation_id: "evt_103",
    occurred_at: "2026-03-18T10:00:04Z",
    actor_type: "agent",
    payload: { text: "Your order shipped yesterday." },
  };
}

const mockSender: ChannelSender = {
  send: async (_text) => ({
    providerMessageId: "webchat_msg_9001",
  }),
};

describe("delivery orchestrator", () => {
  let orchestrator: DeliveryOrchestrator;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    orchestrator = await DeliveryOrchestrator.create();
    validators = await ContractHarnessValidators.create();
  });

  it("produces contract-valid message.send.requested and message.sent", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);

    expect(result.sendRequestedEvent.event_type).toBe("message.send.requested");
    expect(result.sentEvent.event_type).toBe("message.sent");

    const v1 = validators.validateEvent(result.sendRequestedEvent);
    expect(v1.ok).toBe(true);

    const v2 = validators.validateEvent(result.sentEvent);
    expect(v2.ok).toBe(true);
  });

  it("preserves correlation chain", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);
    expect(result.sendRequestedEvent.correlation_id).toBe("corr_1");
    expect(result.sentEvent.correlation_id).toBe("corr_1");
  });

  it("builds correct causal linkage: response -> send.requested -> sent", async () => {
    const resp = sampleAgentResponse();
    const result = await orchestrator.deliver(resp, mockSender);

    expect(result.sendRequestedEvent.causation_id).toBe(resp.event_id);
    expect(result.sentEvent.causation_id).toBe(result.sendRequestedEvent.event_id);
  });

  it("carries response text into send.requested payload", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);
    expect(result.sendRequestedEvent.payload["text"]).toBe("Your order shipped yesterday.");
  });

  it("carries provider message id into sent payload", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);
    expect(result.sentEvent.payload["provider_message_id"]).toBe("webchat_msg_9001");
    expect(result.providerMessageId).toBe("webchat_msg_9001");
  });

  it("send.requested has actor_type = system, sent has actor_type = channel_adapter", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);
    expect(result.sendRequestedEvent.actor_type).toBe("system");
    expect(result.sentEvent.actor_type).toBe("channel_adapter");
  });

  it("includes provider_extensions on message.sent", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSender);
    const ext = result.sentEvent.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["webchat"]).toBeDefined();
    expect(ext["webchat"]!["delivery_status"]).toBe("sent");
  });

  it("sends rich message after text when sender supports sendRichMessage and payload has rich_blocks", async () => {
    const richCalls: unknown[] = [];
    const richSender: ChannelSender = {
      send: async () => ({ providerMessageId: "plain-1" }),
      sendRichMessage: async (message) => {
        richCalls.push(message);
        return { providerMessageId: "rich-1" };
      },
    };

    const resp: CanonicalEvent = {
      ...sampleAgentResponse(),
      payload: {
        text: "Plain summary.",
        rich_blocks: [
          { type: "header", text: "Details" },
          { type: "text", text: "More info" },
        ],
      },
    };

    const result = await orchestrator.deliver(resp, richSender);
    expect(result.providerMessageId).toBe("plain-1");
    expect(richCalls).toHaveLength(1);
    const m = richCalls[0] as { blocks: unknown[]; fallbackText: string };
    expect(m.fallbackText).toBe("Plain summary.");
    expect(m.blocks).toEqual([
      { type: "header", text: "Details" },
      { type: "text", text: "More info" },
    ]);
  });

  it("skips rich delivery when rich_blocks is absent", async () => {
    let richCalls = 0;
    const sender: ChannelSender = {
      send: async () => ({ providerMessageId: "p" }),
      sendRichMessage: async () => {
        richCalls++;
        return { providerMessageId: "r" };
      },
    };
    await orchestrator.deliver(sampleAgentResponse(), sender);
    expect(richCalls).toBe(0);
  });

  it("rejects non agent.response.completed input", async () => {
    const wrongEvent = { ...sampleAgentResponse(), event_type: "message.received" };
    await expect(orchestrator.deliver(wrongEvent, mockSender)).rejects.toThrow("Expected agent.response.completed");
  });

  it("rejects agent response without text in payload", async () => {
    const noText = { ...sampleAgentResponse(), payload: {} };
    await expect(orchestrator.deliver(noText, mockSender)).rejects.toThrow("payload must contain text");
  });

  it("retries on failure and succeeds on 3rd attempt", async () => {
    let callCount = 0;
    const flakySender: ChannelSender = {
      send: async () => {
        callCount++;
        if (callCount < 3) throw new Error("temporary failure");
        return { providerMessageId: "msg_retry_ok" };
      },
    };

    const retryOrch = await DeliveryOrchestrator.create({ maxRetries: 3, baseDelayMs: 10 });
    const result = await retryOrch.deliver(sampleAgentResponse(), flakySender);

    expect(callCount).toBe(3);
    expect(result.providerMessageId).toBe("msg_retry_ok");
  });

  it("throws DeliveryExhaustedError after all retries fail", async () => {
    const alwaysFail: ChannelSender = {
      send: async () => {
        throw new Error("permanent failure");
      },
    };

    const retryOrch = await DeliveryOrchestrator.create({ maxRetries: 2, baseDelayMs: 10 });

    try {
      await retryOrch.deliver(sampleAgentResponse(), alwaysFail);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryExhaustedError);
      if (error instanceof DeliveryExhaustedError) {
        expect(error.attempts).toBe(3);
        expect(error.lastError.message).toBe("permanent failure");
      }
    }
  });

  it("calls sendAttachment for file parts in provider_extensions.artifacts after text send", async () => {
    const callOrder: string[] = [];
    const sender: ChannelSender = {
      send: async () => {
        callOrder.push("send");
        return { providerMessageId: "main_msg" };
      },
      sendAttachment: async (att) => {
        callOrder.push(`attach:${att.name}`);
        return { providerMessageId: `att_${att.name}` };
      },
    };

    const response: CanonicalEvent = {
      ...sampleAgentResponse(),
      provider_extensions: {
        artifacts: [
          {
            artifactId: "a1",
            parts: [
              { kind: "file", name: "f1.png", mimeType: "image/png", uri: "https://example.com/f1.png" },
              { kind: "text", content: "skip me" },
            ],
          },
        ],
      },
    };

    const result = await orchestrator.deliver(response, sender);

    expect(callOrder[0]).toBe("send");
    expect(callOrder).toEqual(["send", "attach:f1.png"]);
    expect(result.providerMessageId).toBe("main_msg");
  });

  it("delivers text normally when no artifacts are present", async () => {
    let attachmentCalls = 0;
    const sender: ChannelSender = {
      send: async () => ({ providerMessageId: "plain" }),
      sendAttachment: async () => {
        attachmentCalls++;
        return { providerMessageId: "x" };
      },
    };

    const result = await orchestrator.deliver(sampleAgentResponse(), sender);

    expect(result.providerMessageId).toBe("plain");
    expect(attachmentCalls).toBe(0);
  });

  it("does not fail delivery when sendAttachment throws", async () => {
    let attachmentCalls = 0;
    const sender: ChannelSender = {
      send: async () => ({ providerMessageId: "text_ok" }),
      sendAttachment: async () => {
        attachmentCalls++;
        throw new Error("attachment failed");
      },
    };

    const response: CanonicalEvent = {
      ...sampleAgentResponse(),
      provider_extensions: {
        artifacts: [
          {
            artifactId: "a1",
            parts: [{ kind: "file", name: "doc.pdf", mimeType: "application/pdf", uri: "https://example.com/doc.pdf" }],
          },
        ],
      },
    };

    const result = await orchestrator.deliver(response, sender);

    expect(result.providerMessageId).toBe("text_ok");
    expect(attachmentCalls).toBe(1);
  });

  it("skips attachment egress when sender has no sendAttachment", async () => {
    const sender: ChannelSender = {
      send: async () => ({ providerMessageId: "only_text" }),
    };

    const response: CanonicalEvent = {
      ...sampleAgentResponse(),
      provider_extensions: {
        artifacts: [
          {
            artifactId: "a1",
            parts: [{ kind: "file", name: "x.bin", mimeType: "application/octet-stream", uri: "https://example.com/x" }],
          },
        ],
      },
    };

    const result = await orchestrator.deliver(response, sender);
    expect(result.providerMessageId).toBe("only_text");
  });

  it("uses sendButtons when payload has buttons and sender implements sendButtons", async () => {
    let sendCalls = 0;
    let sendButtonsCalls = 0;
    const sender: ChannelSender = {
      send: async () => {
        sendCalls++;
        return { providerMessageId: "via-send" };
      },
      sendButtons: async (text, buttons) => {
        sendButtonsCalls++;
        expect(text).toBe("Pick one");
        expect(buttons).toEqual([
          { id: "a", label: "A", style: "primary" },
          { id: "b", label: "B", value: "vb" },
        ]);
        return { providerMessageId: "via-buttons" };
      },
    };

    const resp: CanonicalEvent = {
      ...sampleAgentResponse(),
      payload: {
        text: "Pick one",
        buttons: [
          { id: "a", label: "A", style: "primary" },
          { id: "b", label: "B", value: "vb" },
        ],
      },
    };

    const result = await orchestrator.deliver(resp, sender);

    expect(sendCalls).toBe(0);
    expect(sendButtonsCalls).toBe(1);
    expect(result.providerMessageId).toBe("via-buttons");
    expect(result.sendRequestedEvent.payload["buttons"]).toEqual([
      { id: "a", label: "A", style: "primary" },
      { id: "b", label: "B", value: "vb" },
    ]);
  });

  it("falls back to send when payload has buttons but sender has no sendButtons", async () => {
    let sendCalls = 0;
    const sender: ChannelSender = {
      send: async (text) => {
        sendCalls++;
        expect(text).toBe("Pick one");
        return { providerMessageId: "plain" };
      },
    };

    const resp: CanonicalEvent = {
      ...sampleAgentResponse(),
      payload: {
        text: "Pick one",
        buttons: [{ id: "x", label: "X" }],
      },
    };

    const result = await orchestrator.deliver(resp, sender);

    expect(sendCalls).toBe(1);
    expect(result.providerMessageId).toBe("plain");
    expect(result.sendRequestedEvent.payload["buttons"]).toBeUndefined();
  });

  it("retries sendButtons on failure like regular send", async () => {
    let callCount = 0;
    const flakySender: ChannelSender = {
      send: async () => ({ providerMessageId: "should-not-use" }),
      sendButtons: async () => {
        callCount++;
        if (callCount < 3) throw new Error("buttons channel flaky");
        return { providerMessageId: "buttons_ok" };
      },
    };

    const resp: CanonicalEvent = {
      ...sampleAgentResponse(),
      payload: {
        text: "Choose",
        buttons: [{ id: "y", label: "Y" }],
      },
    };

    const retryOrch = await DeliveryOrchestrator.create({ maxRetries: 3, baseDelayMs: 10 });
    const result = await retryOrch.deliver(resp, flakySender);

    expect(callCount).toBe(3);
    expect(result.providerMessageId).toBe("buttons_ok");
  });
});
