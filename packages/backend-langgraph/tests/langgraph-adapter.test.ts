import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, AgentInvocationContext, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { LangGraphAdapter } from "../src/langgraph-adapter";

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
    payload: { backend: "langgraph", input_event_id: "evt_100" },
  };
}

function sampleContext(overrides?: Partial<AgentInvocationContext>): AgentInvocationContext {
  return {
    invocationEvent: sampleInvocationEvent(),
    messageText: "Where is my order?",
    route: { route_id: "langgraph_agent", reason: "default_route" },
    policy: { policy_id: "default_ingress", decision: "allow" },
    ...overrides,
  };
}

function mockRunResult(content = "Your order shipped yesterday.") {
  return {
    messages: [
      { type: "human", content: "Where is my order?", id: "msg-h1" },
      { type: "ai", content, id: "msg-a1" },
    ],
  };
}

function mockInterruptResult() {
  return {
    messages: [
      { type: "human", content: "Transfer $500", id: "msg-h1" },
      { type: "ai", content: "Please confirm the transfer.", id: "msg-a1" },
    ],
    __interrupt__: [
      {
        value: { question: "Do you confirm the $500 transfer?" },
        resumable: true,
        ns: ["human_review:abc123"],
        when: "during",
      },
    ],
  };
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((r) => setTimeout(r, 5));
      }
      controller.close();
    },
  });
}

describe("LangGraphAdapter", () => {
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

  // ── invoke tests ──────────────────────────────────────────────────────

  it("invoke happy path — returns contract-valid agent.response.completed", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-001", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        const body = (await req.json()) as Record<string, unknown>;
        expect(body["assistant_id"]).toBe("agent");
        return Response.json(mockRunResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.event.actor_type).toBe("agent");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("invoke with interrupt — returns sessionHandle and interrupt info", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-002", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return Response.json(mockInterruptResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sessionHandle).toBe("thread-002");
    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["langgraph"]!["interrupted"]).toBe(true);
    expect(ext["langgraph"]!["thread_id"]).toBe("thread-002");
  });

  // ── stream tests ──────────────────────────────────────────────────────

  it("stream happy path — yields text_delta events and returns full text", async () => {
    const sseChunks = [
      'event: metadata\ndata: {"run_id": "run-001"}\n\n',
      'event: messages\ndata: [{"type": "AIMessageChunk", "content": "Your "}, {"langgraph_node": "agent"}]\n\n',
      'event: messages\ndata: [{"type": "AIMessageChunk", "content": "order "}, {"langgraph_node": "agent"}]\n\n',
      'event: messages\ndata: [{"type": "AIMessageChunk", "content": "shipped."}, {"langgraph_node": "agent"}]\n\n',
      "event: end\ndata: null\n\n",
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-003", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/stream")) {
        return new Response(sseStream(sseChunks), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (req.method === "GET" && url.pathname.startsWith("/threads/")) {
        return Response.json({ values: { messages: [] } });
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
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

    expect(events[0]).toEqual({ type: "status", status: "working" });
    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.map((d) => (d as { content: string }).content)).toEqual(["Your ", "order ", "shipped."]);

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("Your order shipped.");
  });

  it("stream with interrupt — yields input_required and sets sessionHandle", async () => {
    const sseChunks = [
      'event: metadata\ndata: {"run_id": "run-002"}\n\n',
      'event: messages\ndata: [{"type": "AIMessageChunk", "content": "Processing transfer..."}, {"langgraph_node": "agent"}]\n\n',
      "event: end\ndata: null\n\n",
    ];

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-004", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/stream")) {
        return new Response(sseStream(sseChunks), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (req.method === "GET" && url.pathname === "/threads/thread-004") {
        return Response.json({
          values: {
            messages: [],
            __interrupt__: [{
              value: { question: "Confirm transfer?" },
              resumable: true,
              ns: ["human_review:xyz"],
              when: "during",
            }],
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
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

    const inputRequired = events.find((e) => e.type === "input_required");
    expect(inputRequired).toBeDefined();
    expect((inputRequired as { prompt: string }).prompt).toBe("Confirm transfer?");

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.sessionHandle).toBe("thread-004");
  });

  // ── resume tests ──────────────────────────────────────────────────────

  it("resume — sends command.resume and returns response", async () => {
    let receivedBody: Record<string, unknown> | undefined;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-005", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json(mockRunResult("Transfer confirmed and completed."));
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.resume("thread-005", {
      messageText: "Yes, confirm",
      invocationEvent: sampleInvocationEvent(),
    });

    expect(receivedBody).toBeDefined();
    expect((receivedBody!["command"] as Record<string, unknown>)["resume"]).toBe("Yes, confirm");
    expect(receivedBody!["input"]).toBeUndefined();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.payload["text"]).toBe("Transfer confirmed and completed.");
  });

  // ── cancel test ───────────────────────────────────────────────────────

  it("cancel — sends DELETE and does not throw", async () => {
    let deleteReceived = false;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "DELETE" && url.pathname.includes("/runs/")) {
        deleteReceived = true;
        return new Response(null, { status: 200 });
      }
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-006", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/stream")) {
        const chunks = [
          'event: metadata\ndata: {"run_id": "run-cancel-001"}\n\n',
          'event: messages\ndata: [{"type": "AIMessageChunk", "content": "Hello"}, {"langgraph_node": "agent"}]\n\n',
          "event: end\ndata: null\n\n",
        ];
        return new Response(sseStream(chunks), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (req.method === "GET" && url.pathname.startsWith("/threads/")) {
        return Response.json({ values: { messages: [] } });
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });

    // Stream to populate the run_id in runMap
    const gen = adapter.stream(sampleContext());
    while (true) {
      const { done } = await gen.next();
      if (done) break;
    }

    await adapter.cancel("thread-006");
    expect(deleteReceived).toBe(true);
  });

  // ── thread reuse ──────────────────────────────────────────────────────

  it("thread reuse — same conversation_id reuses thread", async () => {
    let threadCreationCount = 0;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        threadCreationCount++;
        return Response.json({ thread_id: "thread-007", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return Response.json(mockRunResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });

    await adapter.invoke(sampleContext());
    await adapter.invoke(sampleContext());

    expect(threadCreationCount).toBe(1);
  });

  // ── error handling ────────────────────────────────────────────────────

  it("error handling — returns structured error on HTTP 500", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-err", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      return new Response("internal error", { status: 500 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("langgraph_http_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("error handling — returns error on invalid JSON response", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-json", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return new Response("not valid json {{{{", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_response");
  });

  it("error handling — returns error when backend is unreachable", async () => {
    const adapter = await LangGraphAdapter.create({ endpoint: "http://localhost:1" });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });

  // ── correlation chain ─────────────────────────────────────────────────

  it("correlation chain — correlation_id and causation_id preserved", async () => {
    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-corr", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return Response.json(mockRunResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({ endpoint: `http://localhost:${mockPort}` });
    const result = await adapter.invoke(sampleContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.correlation_id).toBe("corr_1");
    expect(result.event.causation_id).toBe("evt_103");
    expect(result.event.conversation_id).toBe("conv_1");
  });

  // ── API key header ────────────────────────────────────────────────────

  it("API key header — X-Api-Key is sent when apiKey configured", async () => {
    let receivedApiKey: string | null = null;

    startMock(async (req) => {
      const url = new URL(req.url);
      receivedApiKey = req.headers.get("X-Api-Key");
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-auth", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        return Response.json(mockRunResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
      apiKey: "lg-secret-key-123",
    });

    await adapter.invoke(sampleContext());
    expect(receivedApiKey).not.toBeNull();
    expect(receivedApiKey!).toInclude("lg-secret-key-123");
  });

  // ── custom assistant_id ───────────────────────────────────────────────

  it("custom assistant_id — respects config.assistantId", async () => {
    let receivedAssistantId: string | undefined;

    startMock(async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/threads") {
        return Response.json({ thread_id: "thread-custom", created_at: "2026-03-18T10:00:00Z", metadata: {}, status: "idle" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/runs/wait")) {
        const body = (await req.json()) as Record<string, unknown>;
        receivedAssistantId = body["assistant_id"] as string;
        return Response.json(mockRunResult());
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = await LangGraphAdapter.create({
      endpoint: `http://localhost:${mockPort}`,
      assistantId: "my-custom-agent",
    });

    await adapter.invoke(sampleContext());
    expect(receivedAssistantId).toBe("my-custom-agent");
  });

  // ── describeCapabilities ──────────────────────────────────────────────

  it("describeCapabilities — returns correct capabilities", async () => {
    const adapter = await LangGraphAdapter.create({ endpoint: "http://localhost:1" });
    const caps = adapter.describeCapabilities();

    expect(caps).toEqual({ streaming: true, hitl: true, cancel: true, artifacts: false });
  });
});
