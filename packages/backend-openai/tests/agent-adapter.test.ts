import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentAdapter, AgentEvent, AgentInvocationContext } from "@chat-agent-relay/contract-harness";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
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

function sampleAgentContext(overrides?: Partial<AgentInvocationContext>): AgentInvocationContext {
  return {
    invocationEvent: sampleInvocationEvent(),
    messageText: "Where is my order?",
    route: { route_id: "openai_agent", reason: "default_route" },
    policy: { policy_id: "default_ingress", decision: "allow" },
    ...overrides,
  };
}

function mockOpenAIResponse(): OpenAIChatResponse {
  return {
    id: "chatcmpl-abc123",
    object: "chat.completion",
    created: 1710000000,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Your order shipped yesterday." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  };
}

describe("OpenAIBackend.asAgentAdapter()", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let adapter: AgentAdapter;
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

  it("returns an object with describeCapabilities, invoke, and stream", async () => {
    startMock(() => Response.json(mockOpenAIResponse()));
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });
    adapter = backend.asAgentAdapter();

    expect(typeof adapter.describeCapabilities).toBe("function");
    expect(typeof adapter.invoke).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });

  it("describeCapabilities returns streaming: true", async () => {
    startMock(() => Response.json(mockOpenAIResponse()));
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });
    adapter = backend.asAgentAdapter();

    const caps = adapter.describeCapabilities();
    expect(caps).toEqual({
      streaming: true,
      hitl: false,
      cancel: false,
      artifacts: false,
    });
  });

  it("invoke returns a contract-valid AgentResult", async () => {
    startMock(() => Response.json(mockOpenAIResponse()));
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });
    adapter = backend.asAgentAdapter();

    const result = await adapter.invoke(sampleAgentContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Your order shipped yesterday.");
    expect(result.requestId).toMatch(/^req_/);

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("invoke returns structured error on HTTP 500", async () => {
    startMock(() => new Response("internal error", { status: 500 }));
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });
    adapter = backend.asAgentAdapter();

    const result = await adapter.invoke(sampleAgentContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("openai_http_error");
    expect(result.error.retryable).toBe(true);
  });

  it("stream yields text_delta events and returns AgentResult", async () => {
    const chunks = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Your "},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"order "},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1710000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"shipped."},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    startMock(
      () =>
        new Response(
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
        ),
    );

    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockPort}`,
    });
    adapter = backend.asAgentAdapter();

    const generator = adapter.stream!(sampleAgentContext());
    const events: AgentEvent[] = [];

    let finalResult;
    while (true) {
      const { done, value } = await generator.next();
      if (done) {
        finalResult = value;
        break;
      }
      events.push(value);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "text_delta", content: "Your " });
    expect(events[1]).toEqual({ type: "text_delta", content: "order " });
    expect(events[2]).toEqual({ type: "text_delta", content: "shipped." });

    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;
    expect(finalResult.event.payload["text"]).toBe("Your order shipped.");

    const v = validators.validateEvent(finalResult.event);
    expect(v.ok).toBe(true);
  });

  it("stream returns error when backend is unreachable", async () => {
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: "http://localhost:1",
    });
    adapter = backend.asAgentAdapter();

    const generator = adapter.stream!(sampleAgentContext());
    const { done, value } = await generator.next();

    expect(done).toBe(true);
    const result = value;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.retryable).toBe(true);
  });
});
