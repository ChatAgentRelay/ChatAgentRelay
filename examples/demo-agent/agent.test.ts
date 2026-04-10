import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * Test the demo agent's A2A protocol compliance.
 *
 * We mock the LLM endpoint so no real API key is needed.
 * The test verifies:
 *   1. Agent card served at /.well-known/agent.json
 *   2. message/send returns a valid A2A task response
 *   3. Unknown methods get JSON-RPC error
 *   4. Empty text parts get a graceful response
 */

let agentProcess: import("bun").Subprocess;
let agentPort: number;
let mockLLMServer: ReturnType<typeof Bun.serve>;

function a2aRequest(method: string, userText: string) {
  return {
    jsonrpc: "2.0",
    id: `req_${crypto.randomUUID()}`,
    method,
    params: {
      message: {
        kind: "message",
        messageId: `msg_${crypto.randomUUID()}`,
        role: "user",
        parts: [{ kind: "text", text: userText }],
        contextId: `ctx_${crypto.randomUUID()}`,
      },
    },
  };
}

beforeAll(async () => {
  mockLLMServer = Bun.serve({
    port: 0,
    fetch(req) {
      return Response.json({
        choices: [{ message: { content: "Mock LLM reply for testing" } }],
      });
    },
  });

  agentPort = 9199;

  agentProcess = Bun.spawn(["bun", "run", "agent.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://localhost:${mockLLMServer.port}`,
      DEMO_AGENT_PORT: String(agentPort),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the agent to start listening
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://localhost:${agentPort}/.well-known/agent.json`);
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
});

afterAll(() => {
  agentProcess?.kill();
  mockLLMServer?.stop(true);
});

describe("demo-agent A2A compliance", () => {
  it("serves agent card at /.well-known/agent.json", async () => {
    const res = await fetch(`http://localhost:${agentPort}/.well-known/agent.json`);
    expect(res.ok).toBe(true);
    const card = await res.json();
    expect(card.name).toBe("CAR Demo Agent");
    expect(card.capabilities).toHaveProperty("streaming", false);
    expect(card.url).toContain(String(agentPort));
  });

  it("handles message/send with valid A2A task response", async () => {
    const body = a2aRequest("message/send", "Hello demo agent");
    const res = await fetch(`http://localhost:${agentPort}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;

    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(body.id);

    const result = data.result as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.contextId).toBeDefined();

    const status = result.status as Record<string, unknown>;
    expect(status.state).toBe("completed");
    expect(status.timestamp).toBeDefined();

    const message = status.message as Record<string, unknown>;
    expect(message.role).toBe("agent");
    expect(message.kind).toBe("message");

    const parts = message.parts as { kind: string; text: string }[];
    expect(parts.length).toBeGreaterThan(0);
    expect(parts[0].kind).toBe("text");
    expect(typeof parts[0].text).toBe("string");
    expect(parts[0].text.length).toBeGreaterThan(0);
  });

  it("returns JSON-RPC error for unknown method", async () => {
    const res = await fetch(`http://localhost:${agentPort}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req_1",
        method: "task/unknown",
        params: {},
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeDefined();
    const error = data.error as Record<string, unknown>;
    expect(error.code).toBe(-32601);
  });

  it("handles empty text parts gracefully", async () => {
    const res = await fetch(`http://localhost:${agentPort}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req_empty",
        method: "message/send",
        params: { message: { kind: "message", role: "user", parts: [] } },
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    const result = data.result as Record<string, unknown>;
    expect(result).toBeDefined();
    expect((result.status as Record<string, unknown>).state).toBe("completed");
  });

  it("rejects non-POST requests", async () => {
    const res = await fetch(`http://localhost:${agentPort}`, { method: "PUT" });
    expect(res.status).toBe(405);
  });
});
