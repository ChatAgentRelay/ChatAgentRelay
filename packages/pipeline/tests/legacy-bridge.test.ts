import { describe, expect, it } from "bun:test";
import type { InvocationContext, InvocationResult } from "@chat-agent-relay/backend-http";
import type { AgentInvocationContext, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { legacyBridge } from "../src/legacy-bridge";
import type { BackendAdapter } from "../src/types";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    event_id: "evt_test",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "t1",
    workspace_id: "ws1",
    channel: "web",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "cor_1",
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload: {},
    ...overrides,
  };
}

function makeAgentContext(overrides: Partial<AgentInvocationContext> = {}): AgentInvocationContext {
  return {
    invocationEvent: makeEvent(),
    messageText: "Hello",
    ...overrides,
  };
}

describe("legacyBridge", () => {
  describe("describeCapabilities", () => {
    it("returns streaming: false when backend has no invokeStreaming", () => {
      const backend: BackendAdapter = {
        async invoke() {
          return { ok: true, event: makeEvent(), requestId: "r1" };
        },
      };
      const agent = legacyBridge(backend);
      const caps = agent.describeCapabilities();

      expect(caps).toEqual({ streaming: false, hitl: false, cancel: false, artifacts: false });
    });

    it("returns streaming: true when backend has invokeStreaming", () => {
      const backend: BackendAdapter = {
        async invoke() {
          return { ok: true, event: makeEvent(), requestId: "r1" };
        },
        async *invokeStreaming() {
          return { ok: true as const, event: makeEvent(), requestId: "r1" };
        },
      };
      const agent = legacyBridge(backend);
      const caps = agent.describeCapabilities();

      expect(caps).toEqual({ streaming: true, hitl: false, cancel: false, artifacts: false });
    });
  });

  describe("invoke", () => {
    it("maps AgentInvocationContext to InvocationContext and returns success", async () => {
      const responseEvent = makeEvent({ event_type: "agent.response.completed", payload: { text: "Hi there" } });
      let capturedContext: InvocationContext | undefined;

      const backend: BackendAdapter = {
        async invoke(ctx: InvocationContext) {
          capturedContext = ctx;
          return { ok: true as const, event: responseEvent, requestId: "req_42" };
        },
      };

      const agent = legacyBridge(backend);
      const result = await agent.invoke(
        makeAgentContext({
          sessionHandle: "sess_handle_1",
          route: { route_id: "r1", reason: "default" },
          policy: { policy_id: "p1", decision: "allow" },
          conversationHistory: [{ role: "user", content: "Hello" }],
        }),
      );

      expect(capturedContext).toBeDefined();
      expect(capturedContext!.backendSessionHandle).toBe("sess_handle_1");
      expect(capturedContext!.route).toEqual({ route_id: "r1", reason: "default" });
      expect(capturedContext!.policy).toEqual({ policy_id: "p1", decision: "allow" });
      expect(capturedContext!.conversationHistory).toEqual([{ role: "user", content: "Hello" }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event).toBe(responseEvent);
        expect(result.requestId).toBe("req_42");
      }
    });

    it("maps error results correctly", async () => {
      const backend: BackendAdapter = {
        async invoke() {
          return {
            ok: false as const,
            requestId: "req_fail",
            error: {
              code: "TIMEOUT",
              message: "Backend timed out",
              retryable: true,
              category: "transport",
              details: { elapsed_ms: 30000 },
            },
          };
        },
      };

      const agent = legacyBridge(backend);
      const result = await agent.invoke(makeAgentContext());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.requestId).toBe("req_fail");
        expect(result.error.code).toBe("TIMEOUT");
        expect(result.error.message).toBe("Backend timed out");
        expect(result.error.retryable).toBe(true);
        expect(result.error.category).toBe("transport");
        expect(result.error.details).toEqual({ elapsed_ms: 30000 });
      }
    });
  });

  describe("stream", () => {
    it("wraps string yields into text_delta AgentEvents", async () => {
      const responseEvent = makeEvent({ event_type: "agent.response.completed", payload: { text: "Hello world" } });

      const backend: BackendAdapter = {
        async invoke() {
          return { ok: true as const, event: responseEvent, requestId: "r1" };
        },
        async *invokeStreaming(): AsyncGenerator<string, InvocationResult> {
          yield "Hello";
          yield " ";
          yield "world";
          return { ok: true as const, event: responseEvent, requestId: "req_stream" };
        },
      };

      const agent = legacyBridge(backend);
      expect(agent.stream).toBeDefined();

      const events: Array<{ type: string; content?: string }> = [];
      const generator = agent.stream!(makeAgentContext());

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          expect(value.ok).toBe(true);
          if (value.ok) {
            expect(value.requestId).toBe("req_stream");
          }
          break;
        }
        events.push(value);
      }

      expect(events).toEqual([
        { type: "text_delta", content: "Hello" },
        { type: "text_delta", content: " " },
        { type: "text_delta", content: "world" },
      ]);
    });

    it("is not present when backend has no invokeStreaming", () => {
      const backend: BackendAdapter = {
        async invoke() {
          return { ok: true as const, event: makeEvent(), requestId: "r1" };
        },
      };

      const agent = legacyBridge(backend);
      expect(agent.stream).toBeUndefined();
    });
  });

  it("does not provide resume, resumeStream, or cancel", () => {
    const backend: BackendAdapter = {
      async invoke() {
        return { ok: true as const, event: makeEvent(), requestId: "r1" };
      },
    };

    const agent = legacyBridge(backend);
    expect(agent.resume).toBeUndefined();
    expect(agent.resumeStream).toBeUndefined();
    expect(agent.cancel).toBeUndefined();
  });
});
