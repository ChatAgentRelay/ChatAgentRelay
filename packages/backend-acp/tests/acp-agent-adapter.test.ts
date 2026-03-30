import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { ACPAgentAdapter } from "../src/acp-agent-adapter";
import type { ACPConfig } from "../src/types";

const MOCK_AGENT_PATH = new URL("./mock-acp-agent.ts", import.meta.url).pathname;

function makeInvocationEvent(): CanonicalEvent {
  return {
    event_id: "evt_acp_test_001",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_acp_test",
    workspace_id: "ws_test",
    channel: "test",
    channel_instance_id: "test_ch",
    conversation_id: "conv_acp_001",
    session_id: "sess_acp_001",
    correlation_id: "corr_acp_001",
    causation_id: "evt_acp_test_000",
    occurred_at: "2026-03-28T10:00:00Z",
    actor_type: "system",
    payload: { backend: "acp", input_event_id: "evt_acp_test_000" },
  };
}

function makeConfig(overrides?: Partial<ACPConfig> & { env?: Record<string, string> }): ACPConfig {
  return {
    command: "bun",
    args: ["run", MOCK_AGENT_PATH],
    timeoutMs: 10_000,
    ...overrides,
    env: overrides?.env,
  };
}

describe("ACPAgentAdapter", () => {
  let validators: ContractHarnessValidators;
  let adapters: ACPAgentAdapter[] = [];

  beforeAll(async () => {
    validators = await ContractHarnessValidators.create();
  });

  afterEach(async () => {
    for (const adapter of adapters) {
      await adapter.shutdown();
    }
    adapters = [];
  });

  async function createAdapter(overrides?: Partial<ACPConfig> & { env?: Record<string, string> }): Promise<ACPAgentAdapter> {
    const adapter = await ACPAgentAdapter.create(makeConfig(overrides));
    adapters.push(adapter);
    return adapter;
  }

  it("describeCapabilities() returns valid structure", async () => {
    const adapter = await createAdapter();
    const caps = adapter.describeCapabilities();
    expect(typeof caps.streaming).toBe("boolean");
    expect(typeof caps.hitl).toBe("boolean");
    expect(typeof caps.cancel).toBe("boolean");
    expect(typeof caps.artifacts).toBe("boolean");
    expect(caps.streaming).toBe(true);
    expect(caps.cancel).toBe(true);
  });

  it("invoke() returns successful result", async () => {
    const adapter = await createAdapter();
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Hello",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Hello from ACP agent");
    expect(result.sessionHandle).toBeTruthy();
  });

  it("invoke() preserves correlation chain", async () => {
    const adapter = await createAdapter();
    const invEvent = makeInvocationEvent();
    const result = await adapter.invoke({
      invocationEvent: invEvent,
      messageText: "Test correlation",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.correlation_id).toBe(invEvent.correlation_id);
    expect(result.event.causation_id).toBe(invEvent.event_id);
    expect(result.event.actor_type).toBe("agent");
  });

  it("invoke() result passes schema validation", async () => {
    const adapter = await createAdapter();
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Schema test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validation = validators.validateEvent(result.event);
    expect(validation.ok).toBe(true);
  });

  it("invoke() with custom response text", async () => {
    const adapter = await createAdapter({
      env: { MOCK_RESPONSE_TEXT: "Custom response from mock" },
    });
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Hello",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.payload["text"]).toBe("Custom response from mock");
  });

  it("invoke() generates unique requestIds", async () => {
    const adapter = await createAdapter();
    const ctx = {
      invocationEvent: makeInvocationEvent(),
      messageText: "Test unique IDs",
    };
    const r1 = await adapter.invoke(ctx);
    const r2 = await adapter.invoke(ctx);
    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it("invoke() handles agent error", async () => {
    const adapter = await createAdapter({ env: { MOCK_FAIL: "true" } });
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "This should fail",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBeTruthy();
    expect(result.error.message).toBeTruthy();
  });

  it("invoke() includes ACP provider_extensions", async () => {
    const adapter = await createAdapter();
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Check extensions",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, unknown>;
    expect(ext).toHaveProperty("acp");
    const acpExt = ext["acp"] as Record<string, unknown>;
    expect(acpExt).toHaveProperty("session_id");
    expect(acpExt).toHaveProperty("agent_name");
  });

  it("stream() yields events and returns result", async () => {
    const adapter = await createAdapter();
    const gen = adapter.stream!({
      invocationEvent: makeInvocationEvent(),
      messageText: "Stream test",
    });

    const events: AgentEvent[] = [];
    let finalResult: Awaited<ReturnType<typeof gen.next>> | undefined;

    while (true) {
      const next = await gen.next();
      if (next.done) {
        finalResult = next;
        break;
      }
      events.push(next.value);
    }

    expect(events.length).toBeGreaterThan(0);
    const hasTextDelta = events.some((e) => e.type === "text_delta");
    const hasStatus = events.some((e) => e.type === "status");
    expect(hasTextDelta || hasStatus).toBe(true);

    expect(finalResult).toBeDefined();
    const result = finalResult!.value;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Hello from ACP agent");
  });

  it("stream() result passes schema validation", async () => {
    const adapter = await createAdapter();
    const gen = adapter.stream!({
      invocationEvent: makeInvocationEvent(),
      messageText: "Stream schema test",
    });

    let finalResult: Awaited<ReturnType<typeof gen.next>> | undefined;
    while (true) {
      const next = await gen.next();
      if (next.done) { finalResult = next; break; }
    }

    const result = finalResult!.value;
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validation = validators.validateEvent(result.event);
    expect(validation.ok).toBe(true);
  });

  it("resume() sends prompt to existing session", async () => {
    const adapter = await createAdapter();

    const firstResult = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "First message",
    });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;

    const sessionHandle = firstResult.sessionHandle!;
    const resumeResult = await adapter.resume!(sessionHandle, {
      messageText: "Follow-up message",
      invocationEvent: makeInvocationEvent(),
    });

    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;
    expect(resumeResult.event.event_type).toBe("agent.response.completed");
    expect(resumeResult.sessionHandle).toBe(sessionHandle);
  });

  it("cancel() does not throw", async () => {
    const adapter = await createAdapter();

    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Get session",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(adapter.cancel!(result.sessionHandle!)).resolves.toBeUndefined();
  });

  it("reuses session for same conversation_id", async () => {
    const adapter = await createAdapter();
    const ctx = {
      invocationEvent: makeInvocationEvent(),
      messageText: "First",
    };

    const r1 = await adapter.invoke(ctx);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await adapter.invoke(ctx);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r1.sessionHandle).toBe(r2.sessionHandle);
  });

  it("creates different sessions for different conversation_ids", async () => {
    const adapter = await createAdapter();

    const evt1 = makeInvocationEvent();
    evt1.conversation_id = "conv_A";
    const r1 = await adapter.invoke({ invocationEvent: evt1, messageText: "Conv A" });
    expect(r1.ok).toBe(true);

    const evt2 = makeInvocationEvent();
    evt2.conversation_id = "conv_B";
    const r2 = await adapter.invoke({ invocationEvent: evt2, messageText: "Conv B" });
    expect(r2.ok).toBe(true);

    if (!r1.ok || !r2.ok) return;
    expect(r1.sessionHandle).not.toBe(r2.sessionHandle);
  });

  it("shutdown() terminates the process cleanly", async () => {
    const adapter = await ACPAgentAdapter.create(makeConfig());
    await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Before shutdown",
    });

    await adapter.shutdown();
    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "After shutdown (respawns)",
    });
    expect(result.ok).toBe(true);
    await adapter.shutdown();
  });

  it("permission request with auto-approve policy", async () => {
    const adapter = await createAdapter({
      permissionPolicy: "auto-approve",
      env: { MOCK_PERMISSION: "true" },
    });

    const result = await adapter.invoke({
      invocationEvent: makeInvocationEvent(),
      messageText: "Permission test",
    });

    expect(result.ok).toBe(true);
  });

  it("hitl describeCapabilities reflects policy", async () => {
    const hitlAdapter = await createAdapter({ permissionPolicy: "hitl" });
    expect(hitlAdapter.describeCapabilities().hitl).toBe(true);

    const autoAdapter = await createAdapter({ permissionPolicy: "auto-approve" });
    expect(autoAdapter.describeCapabilities().hitl).toBe(false);
  });
});
