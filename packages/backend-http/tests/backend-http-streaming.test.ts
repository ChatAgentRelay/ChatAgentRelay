import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { GenericHttpBackend } from "../src/invoke";
import type { InvocationContext, InvocationResult } from "../src/types";

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

function ssePayload(chunks: string[]): string {
  return chunks.map((c) => `data: ${c}\n\n`).join("");
}

async function collectGenerator(
  gen: AsyncGenerator<string, InvocationResult>,
): Promise<{ chunks: string[]; result: InvocationResult }> {
  const chunks: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await gen.next();
  }
  return { chunks, result: next.value };
}

describe("SSE streaming", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    validators = await ContractHarnessValidators.create();

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/stream") {
          const body = ssePayload([
            '{"content": "Hello"}',
            '{"content": " world"}',
            '{"content": "!"}',
            "[DONE]",
          ]);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (url.pathname === "/stream-nested") {
          const body = ssePayload([
            '{"output": {"text": "chunk1"}}',
            '{"output": {"text": "chunk2"}}',
            "[DONE]",
          ]);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (url.pathname === "/stream-done-only") {
          const body = ssePayload(["[DONE]"]);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (url.pathname === "/stream-empty") {
          return new Response("", {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (url.pathname === "/stream-error") {
          return new Response("Internal Server Error", { status: 500 });
        }

        if (url.pathname === "/custom-stream") {
          const body = ssePayload([
            '{"content": "custom-endpoint-chunk"}',
            "[DONE]",
          ]);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });
    mockPort = mockServer.port!;
  });

  afterAll(() => {
    mockServer.stop(true);
  });

  it("yields SSE chunks and returns a valid event on happy path", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual(["Hello", " world", "!"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.event_type).toBe("agent.response.completed");
    expect(result.event.payload["text"]).toBe("Hello world!");
  });

  it("extracts deltas using custom deltaTextField (nested path)", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream-nested`,
      streaming: { enabled: true, deltaTextField: "output.text" },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.payload["text"]).toBe("chunk1chunk2");
  });

  it("handles [DONE] sentinel and terminates cleanly", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks } = await collectGenerator(gen);

    expect(chunks).not.toContain("[DONE]");
    expect(chunks.length).toBe(3);
  });

  it("returns failure when stream yields no content", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream-empty`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_response");
  });

  it("returns failure when stream contains only [DONE]", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream-done-only`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("empty_response");
  });

  it("returns failure on HTTP error during stream request", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream-error`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("backend_http_error");
    expect(result.error.retryable).toBe(true);
    expect(result.error.category).toBe("dependency_failure");
  });

  it("returns a schema-valid canonical event on completion", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: true },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { result } = await collectGenerator(gen);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validation = validators.validateEvent(result.event);
    expect(validation.ok).toBe(true);

    expect(result.event.correlation_id).toBe("corr_1");
    expect(result.event.causation_id).toBe("evt_103");
    expect(result.event.actor_type).toBe("agent");
  });

  it("does not expose invokeStreaming when streaming is disabled", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: false },
    });

    expect(backend.invokeStreaming).toBeUndefined();
  });

  it("does not expose invokeStreaming when streaming config is absent", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
    });

    expect(backend.invokeStreaming).toBeUndefined();
  });

  it("uses streaming.endpoint when specified instead of main endpoint", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/unused`,
      streaming: {
        enabled: true,
        endpoint: `http://localhost:${mockPort}/custom-stream`,
      },
    });

    const gen = backend.invokeStreaming!(sampleContext());
    const { chunks, result } = await collectGenerator(gen);

    expect(chunks).toEqual(["custom-endpoint-chunk"]);
    expect(result.ok).toBe(true);
  });
});

describe("SSE streaming agent adapter", () => {
  let mockServer: BunServer;
  let mockPort: number;

  beforeAll(() => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/stream") {
          const body = ssePayload([
            '{"content": "alpha"}',
            '{"content": "beta"}',
            "[DONE]",
          ]);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    mockPort = mockServer.port!;
  });

  afterAll(() => {
    mockServer.stop(true);
  });

  it("reports streaming capability when enabled", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: true },
    });
    const adapter = backend.asAgentAdapter();

    expect(adapter.describeCapabilities().streaming).toBe(true);
    expect(adapter.stream).toBeDefined();
  });

  it("reports no streaming capability when disabled", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
    });
    const adapter = backend.asAgentAdapter();

    expect(adapter.describeCapabilities().streaming).toBe(false);
    expect(adapter.stream).toBeUndefined();
  });

  it("streams AgentEvent text_delta events through agent adapter", async () => {
    const backend = await GenericHttpBackend.create({
      endpoint: `http://localhost:${mockPort}/stream`,
      streaming: { enabled: true },
    });
    const adapter = backend.asAgentAdapter();

    const gen = adapter.stream!(sampleContext());
    const events: unknown[] = [];
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    const result = next.value;

    expect(events).toEqual([
      { type: "text_delta", content: "alpha" },
      { type: "text_delta", content: "beta" },
    ]);
    expect(result.ok).toBe(true);
  });
});
