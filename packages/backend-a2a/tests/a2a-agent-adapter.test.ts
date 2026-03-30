import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, AgentInvocationContext, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { A2AAgentAdapter } from "../src/a2a-agent-adapter";

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
    payload: { backend: "a2a", input_event_id: "evt_100" },
  };
}

function sampleContext(overrides?: Partial<AgentInvocationContext>): AgentInvocationContext {
  return {
    invocationEvent: sampleInvocationEvent(),
    messageText: "Where is my order?",
    route: { route_id: "a2a_agent", reason: "default_route" },
    policy: { policy_id: "default_ingress", decision: "allow" },
    ...overrides,
  };
}

function completedTaskResponse(requestId: string, text: string) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: "task_1",
      contextId: "ctx_1",
      status: {
        state: "completed",
        message: {
          kind: "message",
          messageId: "msg_resp_1",
          role: "agent",
          parts: [{ kind: "text", text }],
        },
        timestamp: new Date().toISOString(),
      },
    },
  };
}

function inputRequiredTaskResponse(requestId: string, prompt: string) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: "task_1",
      contextId: "ctx_1",
      status: {
        state: "input-required",
        message: {
          kind: "message",
          messageId: "msg_resp_1",
          role: "agent",
          parts: [{ kind: "text", text: prompt }],
        },
        timestamp: new Date().toISOString(),
      },
    },
  };
}

const AGENT_CARD = {
  name: "test-agent",
  description: "A test A2A agent",
  url: "http://localhost",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
};

describe("A2AAgentAdapter", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    validators = await ContractHarnessValidators.create();
  });

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  function startMock(handler: (req: Request) => Response | Promise<Response>) {
    if (mockServer) mockServer.stop(true);
    mockServer = Bun.serve({ port: 0, fetch: handler });
    mockPort = mockServer.port!;
  }

  // ── 1. Agent Card fetch ──────────────────────────────────────────────

  it("fetches agent card and uses capabilities", async () => {
    startMock((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const caps = adapter.describeCapabilities();
    expect(caps.streaming).toBe(true);
    expect(caps.hitl).toBe(true);
    expect(caps.cancel).toBe(true);
    expect(caps.artifacts).toBe(true);
  });

  it("works when agent card is unavailable", async () => {
    startMock(() => new Response("not found", { status: 404 }));

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const caps = adapter.describeCapabilities();
    expect(caps.streaming).toBe(true);
  });

  // ── 2. invoke happy path ─────────────────────────────────────────────

  it("invokes A2A agent and returns contract-valid agent.response.completed", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      expect(body["jsonrpc"]).toBe("2.0");
      expect(body["method"]).toBe("message/send");
      const params = body["params"] as Record<string, unknown>;
      const message = params["message"] as Record<string, unknown>;
      expect(message["role"]).toBe("user");
      const parts = message["parts"] as Array<Record<string, string>>;
      expect(parts[0]!["text"]).toBe("Where is my order?");

      return Response.json(completedTaskResponse(body["id"] as string, "Your order shipped yesterday."));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.event.actor_type).toBe("agent");
    expect(result.sessionHandle).toBe("ctx_1");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  // ── 3. invoke with input-required ────────────────────────────────────

  it("handles input-required state from invoke", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json(
        inputRequiredTaskResponse(body["id"] as string, "Please provide your order number"),
      );
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload["text"]).toBe("Please provide your order number");
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["a2a"]!["input_required"]).toBe(true);
    expect(ext["a2a"]!["task_state"]).toBe("input-required");
    expect(result.sessionHandle).toBe("ctx_1");
  });

  // ── 4. stream happy path ─────────────────────────────────────────────

  it("streams A2A events and returns final result", async () => {
    const sseChunks = [
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_1", status: { state: "working", timestamp: new Date().toISOString() }, final: false })}\n\n`,
      `data: ${JSON.stringify({ kind: "message", messageId: "msg_1", role: "agent", parts: [{ kind: "text", text: "Your " }] })}\n\n`,
      `data: ${JSON.stringify({ kind: "message", messageId: "msg_2", role: "agent", parts: [{ kind: "text", text: "order shipped." }] })}\n\n`,
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_1", status: { state: "completed", timestamp: new Date().toISOString() }, final: true })}\n\n`,
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      expect(body["method"]).toBe("message/stream");

      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise((r) => setTimeout(r, 5));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const gen = adapter.stream(sampleContext());
    const events: AgentEvent[] = [];
    let finalResult;

    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      events.push(value);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toEqual({ type: "status", status: "working" });
    expect(events[1]).toEqual({ type: "text_delta", content: "Your " });
    expect(events[2]).toEqual({ type: "text_delta", content: "order shipped." });

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("Your order shipped.");
    expect(finalResult.sessionHandle).toBe("ctx_1");

    const v = validators.validateEvent(finalResult.event);
    expect(v.ok).toBe(true);
  });

  // ── 5. stream with HITL ──────────────────────────────────────────────

  it("yields input_required event during stream", async () => {
    const sseChunks = [
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_1", status: { state: "working", timestamp: new Date().toISOString() }, final: false })}\n\n`,
      `data: ${JSON.stringify({ kind: "message", messageId: "msg_1", role: "agent", parts: [{ kind: "text", text: "I need more info. " }] })}\n\n`,
      `data: ${JSON.stringify({
        kind: "status-update",
        taskId: "task_1",
        contextId: "ctx_1",
        status: {
          state: "input-required",
          message: { kind: "message", messageId: "msg_2", role: "agent", parts: [{ kind: "text", text: "What is your order number?" }] },
          timestamp: new Date().toISOString(),
        },
        final: true,
      })}\n\n`,
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise((r) => setTimeout(r, 5));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const gen = adapter.stream(sampleContext());
    const events: AgentEvent[] = [];
    let finalResult;

    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      events.push(value);
    }

    const inputEvent = events.find((e) => e.type === "input_required");
    expect(inputEvent).toBeDefined();
    expect((inputEvent as { type: "input_required"; prompt: string }).prompt).toBe(
      "What is your order number?",
    );

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("I need more info. ");
  });

  // ── 6. resume ────────────────────────────────────────────────────────

  it("resume sends correct contextId", async () => {
    let capturedContextId: string | undefined;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      const params = body["params"] as Record<string, unknown>;
      const message = params["message"] as Record<string, unknown>;
      capturedContextId = message["contextId"] as string;

      return Response.json(completedTaskResponse(body["id"] as string, "Order #12345 shipped."));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.resume("ctx_session_42", {
      messageText: "Order 12345",
      invocationEvent: sampleInvocationEvent(),
    });

    expect(capturedContextId).toBe("ctx_session_42");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.payload["text"]).toBe("Order #12345 shipped.");
  });

  // ── 7. cancel ────────────────────────────────────────────────────────

  it("cancel sends correct JSON-RPC method", async () => {
    let capturedMethod: string | undefined;
    let capturedId: string | undefined;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      capturedMethod = body["method"] as string;
      const params = body["params"] as Record<string, unknown>;
      capturedId = params["id"] as string;

      return Response.json({ jsonrpc: "2.0", id: body["id"], result: {} });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    await adapter.cancel("task_cancel_42");

    expect(capturedMethod).toBe("task/cancel");
    expect(capturedId).toBe("task_cancel_42");
  });

  // ── 8. error handling ────────────────────────────────────────────────

  it("returns error on HTTP 500", async () => {
    startMock((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      return new Response("internal error", { status: 500 });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("a2a_http_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("returns error on HTTP 429", async () => {
    startMock((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      return new Response("rate limited", { status: 429 });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.retryable).toBe(true);
  });

  it("returns error when backend is unreachable", async () => {
    startMock((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      return new Response("ok");
    });

    // Create with a valid server first (for agent card), then point to bad port
    const adapter = await A2AAgentAdapter.create({
      endpoint: "http://localhost:1",
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });

  it("returns error on invalid JSON response", async () => {
    startMock((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      return new Response("not json at all", {
        headers: { "Content-Type": "application/json" },
      });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_response");
  });

  it("returns error on JSON-RPC error response", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json({
        jsonrpc: "2.0",
        id: body["id"],
        error: { code: -32600, message: "Invalid request" },
      });
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("a2a_rpc_error");
    expect(result.error.message).toBe("Invalid request");
  });

  // ── 9. correlation chain ─────────────────────────────────────────────

  it("preserves correlation_id and causation_id from invocation event", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json(completedTaskResponse(body["id"] as string, "Response text"));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.correlation_id).toBe("corr_1");
    expect(result.event.causation_id).toBe("evt_103");
    expect(result.event.tenant_id).toBe("tenant_acme");
    expect(result.event.workspace_id).toBe("ws_support");
    expect(result.event.conversation_id).toBe("conv_1");
    expect(result.event.session_id).toBe("sess_1");
    expect(result.event.channel).toBe("webchat");
    expect(result.event.channel_instance_id).toBe("webchat_acme_prod");
  });

  // ── 10. schema validation ───────────────────────────────────────────

  it("produced events pass ContractHarnessValidators", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json(completedTaskResponse(body["id"] as string, "Schema-valid response"));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const result = await adapter.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const envelopeResult = validators.validateEnvelope(result.event);
    expect(envelopeResult.ok).toBe(true);

    const specializedResult = validators.validateSpecialized(result.event);
    expect(specializedResult.ok).toBe(true);

    const fullResult = validators.validateEvent(result.event);
    expect(fullResult.ok).toBe(true);
  });

  // ── 11. stream with artifact ────────────────────────────────────────

  it("yields artifact events during stream", async () => {
    const sseChunks = [
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_1", status: { state: "working", timestamp: new Date().toISOString() }, final: false })}\n\n`,
      `data: ${JSON.stringify({ kind: "artifact-update", taskId: "task_1", contextId: "ctx_1", artifact: { artifactId: "art_1", name: "report.txt", parts: [{ kind: "text", text: "Report content" }] } })}\n\n`,
      `data: ${JSON.stringify({ kind: "message", messageId: "msg_1", role: "agent", parts: [{ kind: "text", text: "Here is your report." }] })}\n\n`,
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_1", status: { state: "completed", timestamp: new Date().toISOString() }, final: true })}\n\n`,
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise((r) => setTimeout(r, 5));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const gen = adapter.stream(sampleContext());
    const events: AgentEvent[] = [];
    let finalResult;

    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      events.push(value);
    }

    const artifactEvent = events.find((e) => e.type === "artifact");
    expect(artifactEvent).toBeDefined();
    if (artifactEvent?.type === "artifact") {
      expect(artifactEvent.artifact.artifactId).toBe("art_1");
      expect(artifactEvent.artifact.name).toBe("report.txt");
    }

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.artifacts).toHaveLength(1);
  });

  // ── 12. custom headers are sent ─────────────────────────────────────

  it("sends custom headers from config", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      expect(req.headers.get("Authorization")).toBe("Bearer test-token");
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json(completedTaskResponse(body["id"] as string, "ok"));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
      headers: { Authorization: "Bearer test-token" },
    });

    await adapter.invoke(sampleContext());
  });

  // ── 13. sessionHandle passed as contextId ───────────────────────────

  it("uses sessionHandle as contextId when provided", async () => {
    let capturedContextId: string | undefined;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as Record<string, unknown>;
      const params = body["params"] as Record<string, unknown>;
      const message = params["message"] as Record<string, unknown>;
      capturedContextId = message["contextId"] as string;
      return Response.json(completedTaskResponse(body["id"] as string, "ok"));
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    await adapter.invoke(sampleContext({ sessionHandle: "existing_ctx_99" }));
    expect(capturedContextId).toBe("existing_ctx_99");
  });

  // ── 14. resumeStream ────────────────────────────────────────────────

  it("resumeStream sends contextId and yields events", async () => {
    let capturedContextId: string | undefined;

    const sseChunks = [
      `data: ${JSON.stringify({ kind: "message", messageId: "msg_1", role: "agent", parts: [{ kind: "text", text: "Resumed response." }] })}\n\n`,
      `data: ${JSON.stringify({ kind: "status-update", taskId: "task_1", contextId: "ctx_resume", status: { state: "completed", timestamp: new Date().toISOString() }, final: true })}\n\n`,
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent.json") {
        return Response.json(AGENT_CARD);
      }
      const body = (await req.json()) as Record<string, unknown>;
      const params = body["params"] as Record<string, unknown>;
      const message = params["message"] as Record<string, unknown>;
      capturedContextId = message["contextId"] as string;

      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise((r) => setTimeout(r, 5));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const adapter = await A2AAgentAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
    });

    const gen = adapter.resumeStream("ctx_resume", {
      messageText: "Order number is 12345",
      invocationEvent: sampleInvocationEvent(),
    });

    const events: AgentEvent[] = [];
    let finalResult;

    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      events.push(value);
    }

    expect(capturedContextId).toBe("ctx_resume");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text_delta", content: "Resumed response." });

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("Resumed response.");
  });
});
