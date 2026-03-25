import { describe, it, expect, beforeAll } from "bun:test";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { CanonicalEvent } from "@cap/contract-harness";
import type { InvocationContext, InvocationResult } from "@cap/backend-http";

export type BackendAdapterUnderTest = {
  invoke(context: InvocationContext): Promise<InvocationResult>;
};

function sampleInvocationEvent(): CanonicalEvent {
  return {
    event_id: "evt_conf_103",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_conformance",
    workspace_id: "ws_test",
    channel: "test",
    channel_instance_id: "test_ch",
    conversation_id: "conv_conf",
    session_id: "sess_conf",
    correlation_id: "corr_conf",
    causation_id: "evt_conf_102",
    occurred_at: "2026-03-25T10:00:00Z",
    actor_type: "system",
    payload: { backend: "test_backend", input_event_id: "evt_conf_100" },
  };
}

export type BackendConformanceConfig = {
  name: string;
  adapter: BackendAdapterUnderTest;
  messageText?: string | undefined;
};

export function testBackendAdapter(config: BackendConformanceConfig): void {
  describe(`backend adapter conformance: ${config.name}`, () => {
    let validators: ContractHarnessValidators;

    beforeAll(async () => {
      validators = await ContractHarnessValidators.create();
    });

    function makeContext(): InvocationContext {
      return {
        invocationEvent: sampleInvocationEvent(),
        messageText: config.messageText ?? "Hello, how are you?",
        route: { route_id: "test_route", reason: "conformance_test" },
        policy: { policy_id: "test_policy", decision: "allow" },
      };
    }

    it("returns InvocationResult without throwing", async () => {
      const result = await config.adapter.invoke(makeContext());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("requestId");
    });

    it("produces a unique requestId", async () => {
      const r1 = await config.adapter.invoke(makeContext());
      const r2 = await config.adapter.invoke(makeContext());
      expect(r1.requestId).not.toBe(r2.requestId);
    });

    it("on success: produces schema-valid agent.response.completed", async () => {
      const result = await config.adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(result.event.event_type).toBe("agent.response.completed");
      const v = validators.validateEvent(result.event);
      expect(v.ok).toBe(true);
    });

    it("on success: preserves correlation_id from invocation event", async () => {
      const ctx = makeContext();
      const result = await config.adapter.invoke(ctx);
      if (!result.ok) return;

      expect(result.event.correlation_id).toBe(ctx.invocationEvent.correlation_id);
    });

    it("on success: sets causation_id to invocation event_id", async () => {
      const ctx = makeContext();
      const result = await config.adapter.invoke(ctx);
      if (!result.ok) return;

      expect(result.event.causation_id).toBe(ctx.invocationEvent.event_id);
    });

    it("on success: event has actor_type = agent", async () => {
      const result = await config.adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(result.event.actor_type).toBe("agent");
    });

    it("on success: event payload contains text string", async () => {
      const result = await config.adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(typeof result.event.payload["text"]).toBe("string");
      expect((result.event.payload["text"] as string).length).toBeGreaterThan(0);
    });

    it("on failure: returns structured error (not thrown)", async () => {
      const result = await config.adapter.invoke(makeContext());
      if (result.ok) return;

      expect(result.error).toHaveProperty("code");
      expect(result.error).toHaveProperty("message");
      expect(typeof result.error.retryable).toBe("boolean");
      expect(result.error).toHaveProperty("category");
    });
  });
}
