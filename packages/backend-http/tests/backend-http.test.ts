import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { buildBackendRequest } from "../src/build-request";
import { GenericHttpBackend } from "../src/invoke";
import { mapCompletedResponse } from "../src/map-response";
import type { BackendCompletedResponse, InvocationContext } from "../src/types";

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
    payload: {
      backend: "generic-http-agent",
      input_event_id: "evt_100",
    },
  };
}

function sampleContext(overrides?: Partial<InvocationContext>): InvocationContext {
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
    trace_context: {
      trace_id: "trace_123",
      span_id: "span_104",
      parent_span_id: "span_103",
    },
  };
}

describe("build backend request", () => {
  it("constructs a request with CAR identifiers and input message", () => {
    const ctx = sampleContext();
    const request = buildBackendRequest(ctx);

    expect(request.request_id).toMatch(/^req_/);
    expect(request.car.event.event_id).toBe("evt_103");
    expect(request.car.input.message.text).toBe("Where is my order?");
    expect(request.car.context.route.route_id).toBe("default_webchat_agent");
    expect(request.car.context.policy.decision).toBe("allow");
  });

  it("includes backend_session when handle is provided", () => {
    const ctx = sampleContext({ backendSessionHandle: "be_sess_42" });
    const request = buildBackendRequest(ctx);

    expect(request.backend_session).toBeDefined();
    expect(request.backend_session!.handle).toBe("be_sess_42");
  });

  it("omits backend_session when no handle is provided", () => {
    const ctx = sampleContext();
    const request = buildBackendRequest(ctx);

    expect(request.backend_session).toBeUndefined();
  });

  it("uses default route and policy when not provided", () => {
    const ctx = sampleContext({ route: undefined, policy: undefined });
    const request = buildBackendRequest(ctx);

    expect(request.car.context.route.route_id).toBe("default");
    expect(request.car.context.policy.decision).toBe("allow");
  });
});

describe("map completed response", () => {
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    validators = await ContractHarnessValidators.create();
  });

  it("maps a backend response into a contract-valid agent.response.completed event", () => {
    const event = mapCompletedResponse(sampleInvocationEvent(), sampleCompletedResponse());

    expect(event.event_type).toBe("agent.response.completed");
    expect(event.actor_type).toBe("agent");
    expect(event.causation_id).toBe("evt_103");
    expect(event.correlation_id).toBe("corr_1");
    expect(event.tenant_id).toBe("tenant_acme");
    expect(event.payload["text"]).toBe("Your order shipped yesterday.");

    const validation = validators.validateEvent(event);
    expect(validation.ok).toBe(true);
  });

  it("preserves actor.id from backend agent_id", () => {
    const event = mapCompletedResponse(sampleInvocationEvent(), sampleCompletedResponse());
    const actor = (event as Record<string, unknown>)["actor"] as Record<string, string>;
    expect(actor["id"]).toBe("support_agent_v1");
  });

  it("preserves trace_context from backend response", () => {
    const event = mapCompletedResponse(sampleInvocationEvent(), sampleCompletedResponse());
    const tc = (event as Record<string, unknown>)["trace_context"] as Record<string, string>;
    expect(tc["trace_id"]).toBe("trace_123");
    expect(tc["span_id"]).toBe("span_104");
  });

  it("preserves backend metadata in provider_extensions", () => {
    const event = mapCompletedResponse(sampleInvocationEvent(), sampleCompletedResponse());
    const ext = event.provider_extensions as Record<string, Record<string, unknown>>;
    const backend = ext["generic_http_backend"];
    expect(backend).toBeDefined();
    expect(backend!["backend_request_id"]).toBe("backend_req_987");
    expect(backend!["backend_session_handle"]).toBe("be_sess_42");
  });
});

describe("generic HTTP backend integration", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let backend: GenericHttpBackend;

  beforeAll(async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/healthy") {
          return Response.json(sampleCompletedResponse());
        }
        if (url.pathname === "/error") {
          return Response.json({
            request_id: "req_err",
            status: "failed",
            error: {
              code: "backend_timeout",
              message: "Took too long",
              retryable: true,
              category: "timeout",
            },
          });
        }
        if (url.pathname === "/bad-json") {
          return new Response("not json", { status: 200 });
        }
        if (url.pathname === "/server-error") {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    mockPort = mockServer.port!;

    backend = await GenericHttpBackend.create({ endpoint: `http://localhost:${mockPort}/healthy` });
  });

  afterAll(() => {
    mockServer.stop(true);
  });

  it("invokes a healthy backend and returns a contract-valid agent.response.completed", async () => {
    const result = await backend.invoke(sampleContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.event.causation_id).toBe("evt_103");
    expect(result.requestId).toMatch(/^req_/);
  });

  it("returns a structured error when backend returns a failure response", async () => {
    const errorBackend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/error`,
    });
    const result = await errorBackend.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_timeout");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("timeout");
  });

  it("returns an error when backend returns invalid JSON", async () => {
    const badBackend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/bad-json`,
    });
    const result = await badBackend.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_response");
  });

  it("returns an error when backend returns HTTP 500", async () => {
    const errorBackend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/server-error`,
    });
    const result = await errorBackend.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_http_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("returns an error when backend is unreachable", async () => {
    const unreachableBackend = await GenericHttpBackend.create({
      endpoint: "http://localhost:1/unreachable",
    });
    const result = await unreachableBackend.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });
});
