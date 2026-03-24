import { describe, it, expect, beforeAll } from "bun:test";
import type { CanonicalEvent } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import { DeliveryOrchestrator } from "../src/delivery";
import type { SendFn } from "../src/types";

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

const mockSendFn: SendFn = async (_text) => ({
  providerMessageId: "webchat_msg_9001",
});

describe("delivery orchestrator", () => {
  let orchestrator: DeliveryOrchestrator;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    orchestrator = await DeliveryOrchestrator.create();
    validators = await ContractHarnessValidators.create();
  });

  it("produces contract-valid message.send.requested and message.sent", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);

    expect(result.sendRequestedEvent.event_type).toBe("message.send.requested");
    expect(result.sentEvent.event_type).toBe("message.sent");

    const v1 = validators.validateEvent(result.sendRequestedEvent);
    expect(v1.ok).toBe(true);

    const v2 = validators.validateEvent(result.sentEvent);
    expect(v2.ok).toBe(true);
  });

  it("preserves correlation chain", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);
    expect(result.sendRequestedEvent.correlation_id).toBe("corr_1");
    expect(result.sentEvent.correlation_id).toBe("corr_1");
  });

  it("builds correct causal linkage: response -> send.requested -> sent", async () => {
    const resp = sampleAgentResponse();
    const result = await orchestrator.deliver(resp, mockSendFn);

    expect(result.sendRequestedEvent.causation_id).toBe(resp.event_id);
    expect(result.sentEvent.causation_id).toBe(result.sendRequestedEvent.event_id);
  });

  it("carries response text into send.requested payload", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);
    expect(result.sendRequestedEvent.payload["text"]).toBe("Your order shipped yesterday.");
  });

  it("carries provider message id into sent payload", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);
    expect(result.sentEvent.payload["provider_message_id"]).toBe("webchat_msg_9001");
    expect(result.providerMessageId).toBe("webchat_msg_9001");
  });

  it("send.requested has actor_type = system, sent has actor_type = channel_adapter", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);
    expect(result.sendRequestedEvent.actor_type).toBe("system");
    expect(result.sentEvent.actor_type).toBe("channel_adapter");
  });

  it("includes provider_extensions on message.sent", async () => {
    const result = await orchestrator.deliver(sampleAgentResponse(), mockSendFn);
    const ext = result.sentEvent.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["webchat"]).toBeDefined();
    expect(ext["webchat"]!["delivery_status"]).toBe("sent");
  });

  it("rejects non agent.response.completed input", async () => {
    const wrongEvent = { ...sampleAgentResponse(), event_type: "message.received" };
    await expect(orchestrator.deliver(wrongEvent, mockSendFn)).rejects.toThrow(
      "Expected agent.response.completed",
    );
  });

  it("rejects agent response without text in payload", async () => {
    const noText = { ...sampleAgentResponse(), payload: {} };
    await expect(orchestrator.deliver(noText, mockSendFn)).rejects.toThrow(
      "payload must contain text",
    );
  });
});
