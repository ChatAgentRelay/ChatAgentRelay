import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentAdapter, AgentInvocationContext } from "@chat-agent-relay/contract-harness";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { GenericHttpBackend } from "../src/invoke";
import type { BackendCompletedResponse } from "../src/types";

type BunServer = Server<unknown>;

function sampleInvocationEvent(): CanonicalEvent {
  return {
    event_id: "evt_103",
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel: "webchat",
    channel_instance_id: "webchat_acme_prod",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "corr_1",
    causation_id: "evt_102",
    occurred_at: "2026-03-18T10:00:03Z",
    actor_type: "system",
    payload: { backend: "generic-http-agent", input_event_id: "evt_100" },
  };
}

function sampleAgentContext(overrides?: Partial<AgentInvocationContext>): AgentInvocationContext {
  return {
    invocationEvent: sampleInvocationEvent(),
    messageText: "Where is my order?",
    route: { route_id: "default_webchat_agent", reason: "default_first_path_route" },
    policy: { policy_id: "default_ingress", decision: "allow" },
    ...overrides,
  };
}

function sampleCompletedResponse(): BackendCompletedResponse {
  return {
    request_id: "req_test",
    status: "completed",
    output: { text: "Your order shipped yesterday." },
    backend: {
      request_id: "backend_req_987",
      session_handle: "be_sess_42",
      agent_id: "support_agent_v1",
    },
  };
}

describe("GenericHttpBackend.asAgentAdapter()", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let adapter: AgentAdapter;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    validators = await ContractHarnessValidators.create();

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/healthy") {
          return Response.json(sampleCompletedResponse());
        }
        if (url.pathname === "/server-error") {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    mockPort = mockServer.port!;

    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/healthy`,
    });
    adapter = backend.asAgentAdapter();
  });

  afterAll(() => {
    mockServer.stop(true);
  });

  it("returns an object with describeCapabilities and invoke", () => {
    expect(typeof adapter.describeCapabilities).toBe("function");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("describeCapabilities returns streaming: false", () => {
    const caps = adapter.describeCapabilities();
    expect(caps).toEqual({
      streaming: false,
      hitl: false,
      cancel: false,
      artifacts: false,
    });
  });

  it("does not expose stream, resume, resumeStream, or cancel", () => {
    expect(adapter.stream).toBeUndefined();
    expect(adapter.resume).toBeUndefined();
    expect(adapter.resumeStream).toBeUndefined();
    expect(adapter.cancel).toBeUndefined();
  });

  it("invoke maps AgentInvocationContext and returns a contract-valid AgentResult", async () => {
    const result = await adapter.invoke(sampleAgentContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.requestId).toMatch(/^req_/);

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("invoke maps sessionHandle to backendSessionHandle", async () => {
    let capturedBody: unknown;
    const sessionServer = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json();
        return Response.json(sampleCompletedResponse());
      },
    });

    try {
      const backend = await GenericHttpBackend.create({
        endpoint: `http://localhost:${sessionServer.port}/session`,
      });
      const agentAdapter = backend.asAgentAdapter();

      await agentAdapter.invoke(sampleAgentContext({ sessionHandle: "agent_sess_99" }));

      const body = capturedBody as Record<string, unknown>;
      const session = body["backend_session"] as Record<string, string>;
      expect(session["handle"]).toBe("agent_sess_99");
    } finally {
      sessionServer.stop(true);
    }
  });

  it("invoke returns structured error on backend HTTP failure", async () => {
    const errorBackend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/server-error`,
    });
    const errorAdapter = errorBackend.asAgentAdapter();

    const result = await errorAdapter.invoke(sampleAgentContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_http_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("invoke returns structured error when backend is unreachable", async () => {
    const unreachable = await GenericHttpBackend.create({
      endpoint: "http://localhost:1/unreachable",
    });
    const unreachableAdapter = unreachable.asAgentAdapter();

    const result = await unreachableAdapter.invoke(sampleAgentContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });
});
