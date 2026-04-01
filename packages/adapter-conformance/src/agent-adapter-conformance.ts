import { beforeAll, describe, expect, it } from "bun:test";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentInvocationContext,
  CanonicalEvent,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";

export type AgentAdapterConformanceConfig = {
  name: string;
  adapter: AgentAdapter | (() => AgentAdapter) | (() => Promise<AgentAdapter>);
  context: AgentInvocationContext;
  supportsStreaming?: boolean;
  supportsHitl?: boolean;
};

function sampleInvocationEvent(): CanonicalEvent {
  return {
    event_id: "evt_agent_conf_103",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_conformance",
    workspace_id: "ws_test",
    channel: "test",
    channel_instance_id: "test_ch",
    conversation_id: "conv_conf",
    session_id: "sess_conf",
    correlation_id: "corr_agent_conf",
    causation_id: "evt_agent_conf_102",
    occurred_at: "2026-03-25T10:00:00Z",
    actor_type: "system",
    payload: { backend: "test_backend", input_event_id: "evt_agent_conf_100" },
  };
}

async function resolveAdapter(
  adapter: AgentAdapter | (() => AgentAdapter) | (() => Promise<AgentAdapter>),
): Promise<AgentAdapter> {
  if (typeof adapter === "function") {
    return await adapter();
  }
  return adapter;
}

export function testAgentAdapter(config: AgentAdapterConformanceConfig): void {
  describe(`agent adapter conformance: ${config.name}`, () => {
    let validators: ContractHarnessValidators;
    let adapter: AgentAdapter;

    beforeAll(async () => {
      validators = await ContractHarnessValidators.getShared();
      adapter = await resolveAdapter(config.adapter);
    });

    function makeContext(): AgentInvocationContext {
      return {
        ...config.context,
        invocationEvent: config.context.invocationEvent ?? sampleInvocationEvent(),
      };
    }

    it("describeCapabilities() returns valid capabilities object", () => {
      const caps = adapter.describeCapabilities();
      expect(typeof caps.streaming).toBe("boolean");
      expect(typeof caps.multiTurn).toBe("boolean");
      expect(typeof caps.resume).toBe("boolean");
      expect(typeof caps.hitl).toBe("boolean");
      expect(typeof caps.cancel).toBe("boolean");
      expect(typeof caps.artifacts).toBe("boolean");
    });

    it("invoke() returns without throwing", async () => {
      const result = await adapter.invoke(makeContext());
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("requestId");
    });

    it("invoke() returns unique requestId", async () => {
      const r1 = await adapter.invoke(makeContext());
      const r2 = await adapter.invoke(makeContext());
      expect(r1.requestId).not.toBe(r2.requestId);
    });

    it("invoke() success: event is schema-valid agent.response.completed", async () => {
      const result = await adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(result.event.event_type).toBe("agent.response.completed");
      const v = validators.validateEvent(result.event);
      expect(v.ok).toBe(true);
    });

    it("invoke() success: preserves correlation_id", async () => {
      const ctx = makeContext();
      const result = await adapter.invoke(ctx);
      if (!result.ok) return;

      expect(result.event.correlation_id).toBe(ctx.invocationEvent.correlation_id);
    });

    it("invoke() success: causation_id = invocation event_id", async () => {
      const ctx = makeContext();
      const result = await adapter.invoke(ctx);
      if (!result.ok) return;

      expect(result.event.causation_id).toBe(ctx.invocationEvent.event_id);
    });

    it("invoke() success: actor_type = agent", async () => {
      const result = await adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(result.event.actor_type).toBe("agent");
    });

    it("invoke() success: payload.text is non-empty string", async () => {
      const result = await adapter.invoke(makeContext());
      if (!result.ok) return;

      expect(typeof result.event.payload["text"]).toBe("string");
      expect((result.event.payload["text"] as string).length).toBeGreaterThan(0);
    });

    it("on failure: returns structured error (not thrown)", async () => {
      const result = await adapter.invoke(makeContext());
      if (result.ok) return;

      expect(result.error).toHaveProperty("code");
      expect(result.error).toHaveProperty("message");
      expect(typeof result.error.retryable).toBe("boolean");
      expect(result.error).toHaveProperty("category");
    });

    if (config.supportsStreaming) {
      it("capabilities declare streaming support", () => {
        const caps = adapter.describeCapabilities();
        expect(caps.streaming).toBe(true);
      });

      it("stream() method exists", () => {
        expect(typeof adapter.stream).toBe("function");
      });

      it("stream() yields AgentEvent objects", async () => {
        if (!adapter.stream) return;

        const events: AgentEvent[] = [];
        const gen = adapter.stream(makeContext());
        let done = false;
        while (!done) {
          const next = await gen.next();
          if (next.done) {
            done = true;
          } else {
            const evt = next.value;
            expect(evt).toHaveProperty("type");
            expect(["status", "text_delta", "artifact", "input_required"]).toContain(evt.type);
            events.push(evt);
          }
        }
      });

      it("stream() final result is valid", async () => {
        if (!adapter.stream) return;

        const gen = adapter.stream(makeContext());
        let finalResult: Awaited<ReturnType<typeof gen.next>> | undefined;
        while (true) {
          const next = await gen.next();
          if (next.done) {
            finalResult = next;
            break;
          }
        }

        expect(finalResult).toBeDefined();
        const result = finalResult!.value;
        expect(result).toHaveProperty("ok");
        expect(result).toHaveProperty("requestId");

        if (result.ok) {
          expect(result.event.event_type).toBe("agent.response.completed");
          const v = validators.validateEvent(result.event);
          expect(v.ok).toBe(true);
        }
      });
    }

    if (config.supportsStreaming === false) {
      it("capabilities declare no streaming support", () => {
        const caps = adapter.describeCapabilities();
        expect(caps.streaming).toBe(false);
      });
    }

    if (config.supportsHitl) {
      it("capabilities declare HITL support", () => {
        const caps = adapter.describeCapabilities();
        expect(caps.hitl).toBe(true);
      });

      it("resume() method exists", () => {
        expect(typeof adapter.resume).toBe("function");
      });
    }
  });
}
