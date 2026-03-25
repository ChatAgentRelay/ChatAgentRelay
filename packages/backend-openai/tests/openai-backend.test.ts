import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import type { CanonicalEvent } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { InvocationContext } from "@cap/backend-http";
import { OpenAIBackend } from "../src/openai-backend";
import type { OpenAIChatResponse } from "../src/types";

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
    payload: { backend: "openai", input_event_id: "evt_100" },
  };
}

function sampleContext(): InvocationContext {
  return {
    invocationEvent: sampleInvocationEvent(),
    messageText: "Where is my order?",
    route: { route_id: "openai_agent", reason: "default_route" },
    policy: { policy_id: "default_ingress", decision: "allow" },
  };
}

function mockOpenAIResponse(): OpenAIChatResponse {
  return {
    id: "chatcmpl-abc123",
    object: "chat.completion",
    created: 1710000000,
    model: "gpt-4o-mini",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Your order shipped yesterday." },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  };
}

describe("OpenAI backend", () => {
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

  it("invokes OpenAI and returns a contract-valid agent.response.completed", async () => {
    startMock(async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      expect(body["model"]).toBe("gpt-4o-mini");
      const messages = body["messages"] as Array<Record<string, string>>;
      expect(messages).toHaveLength(2);
      expect(messages[0]!["role"]).toBe("system");
      expect(messages[1]!["content"]).toBe("Where is my order?");
      return Response.json(mockOpenAIResponse());
    });

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.event.actor_type).toBe("agent");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("preserves correlation chain from invocation event", async () => {
    startMock(() => Response.json(mockOpenAIResponse()));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.correlation_id).toBe("corr_1");
    expect(result.event.causation_id).toBe("evt_103");
  });

  it("includes OpenAI metadata in provider_extensions", async () => {
    startMock(() => Response.json(mockOpenAIResponse()));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["openai"]).toBeDefined();
    expect(ext["openai"]!["model"]).toBe("gpt-4o-mini");
    expect(ext["openai"]!["openai_id"]).toBe("chatcmpl-abc123");
    expect(ext["openai"]!["finish_reason"]).toBe("stop");
    expect(ext["openai"]!["total_tokens"]).toBe(28);
  });

  it("uses custom model and system prompt", async () => {
    startMock(async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      expect(body["model"]).toBe("gpt-4o");
      const messages = body["messages"] as Array<Record<string, string>>;
      expect(messages[0]!["content"]).toBe("You are a support agent.");
      return Response.json({ ...mockOpenAIResponse(), model: "gpt-4o" });
    });

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      model: "gpt-4o",
      systemPrompt: "You are a support agent.",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(true);
  });

  it("sends Authorization header with API key", async () => {
    startMock(async (req) => {
      expect(req.headers.get("Authorization")).toBe("Bearer my-secret-key");
      return Response.json(mockOpenAIResponse());
    });

    const backend = await OpenAIBackend.create({
      apiKey: "my-secret-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    await backend.invoke(sampleContext());
  });

  it("returns structured error on HTTP 429 (rate limit)", async () => {
    startMock(() => new Response("rate limited", { status: 429 }));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("openai_http_error");
    expect(result.error.retryable).toBe(true);
  });

  it("returns structured error on HTTP 500", async () => {
    startMock(() => new Response("internal error", { status: 500 }));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("returns error when OpenAI returns empty choices", async () => {
    startMock(() => Response.json({ ...mockOpenAIResponse(), choices: [] }));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("empty_response");
  });

  it("returns error when backend is unreachable", async () => {
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: "http://localhost:1",
    });

    const result = await backend.invoke(sampleContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });

  it("streams response chunks via invokeStreaming", async () => {
    const chunks = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Your "},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"order "},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"shipped."},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    startMock(() => new Response(
      new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
            await new Promise((r) => setTimeout(r, 10));
          }
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    ));

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });

    const generator = backend.invokeStreaming(sampleContext());
    const deltas: string[] = [];

    let finalResult;
    while (true) {
      const { done, value } = await generator.next();
      if (done) {
        finalResult = value;
        break;
      }
      deltas.push(value);
    }

    expect(deltas).toEqual(["Your ", "order ", "shipped."]);
    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("Your order shipped.");
  });
});
