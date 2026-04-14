import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const AGENT_PORT = 9199;
let mockLLM: ReturnType<typeof Bun.serve>;
let agentProc: import("bun").Subprocess;

function jsonrpc(method: string, text: string, contextId?: string) {
  const parts = text ? [{ kind: "text", text }] : [];
  return {
    jsonrpc: "2.0",
    id: `req_${crypto.randomUUID()}`,
    method,
    params: { message: { kind: "message", messageId: `msg_${crypto.randomUUID()}`, role: "user", parts, ...(contextId ? { contextId } : {}) } },
  };
}

async function send(method: string, text: string, contextId?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://localhost:${AGENT_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonrpc(method, text, contextId)),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function sendStream(text: string, contextId?: string): Promise<string> {
  const res = await fetch(`http://localhost:${AGENT_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(jsonrpc("message/stream", text, contextId)),
  });
  return await res.text();
}

function getResultText(data: Record<string, unknown>): string {
  const result = data.result as Record<string, unknown>;
  const status = result.status as Record<string, unknown>;
  const msg = status.message as Record<string, unknown>;
  const parts = msg.parts as { kind: string; text?: string }[];
  return parts.filter((p) => p.kind === "text").map((p) => p.text).join("");
}

function getResultState(data: Record<string, unknown>): string {
  const result = data.result as Record<string, unknown>;
  const status = result.status as Record<string, unknown>;
  return status.state as string;
}

function getContextId(data: Record<string, unknown>): string {
  const result = data.result as Record<string, unknown>;
  return result.contextId as string;
}

beforeAll(async () => {
  mockLLM = Bun.serve({
    port: 0,
    fetch(req) {
      return (async () => {
        const body = (await req.json()) as { messages?: { role: string; content: string }[] };
        const userMsg = body.messages?.filter((m) => m.role === "user").pop()?.content ?? "";
        const reply = `Mock LLM reply to: ${userMsg.slice(0, 50)}`;
        return Response.json({ choices: [{ message: { content: reply } }] });
      })();
    },
  });

  agentProc = Bun.spawn(["bun", "run", "agent.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://localhost:${mockLLM.port}`,
      DEMO_AGENT_PORT: String(AGENT_PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/.well-known/agent.json`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(150);
  }
}, 15000);

afterAll(() => {
  try { agentProc?.kill(); } catch {}
  try { mockLLM?.stop(true); } catch {}
});

// ── Agent Card ───────────────────────────────────────────────────────

describe("agent card", () => {
  it("returns correct agent card with streaming capability", async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/.well-known/agent.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as Record<string, unknown>;
    expect(card.name).toBe("CAR Demo Agent");
    expect(card.version).toBe("2.0.0");
    const caps = card.capabilities as Record<string, unknown>;
    expect(caps.streaming).toBe(true);
    const skills = card.skills as { id: string }[];
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("chat");
    expect(ids).toContain("streaming");
    expect(ids).toContain("hitl");
    expect(ids).toContain("artifacts");
    expect(ids).toContain("commands");
  });
});

// ── Text Chat (message/send) ─────────────────────────────────────────

describe("text chat (message/send)", () => {
  it("returns LLM response for normal text", async () => {
    const data = await send("message/send", "Hello agent");
    expect(data.error).toBeUndefined();
    const text = getResultText(data);
    expect(text).toContain("Mock LLM reply");
    expect(getResultState(data)).toBe("completed");
  });

  it("handles empty message parts gracefully", async () => {
    const data = await send("message/send", "");
    expect(data.error).toBeUndefined();
    const text = getResultText(data);
    expect(text).toContain("no text content");
  });

  it("returns contextId for conversation tracking", async () => {
    const data = await send("message/send", "Track me");
    const ctxId = getContextId(data);
    expect(ctxId).toBeDefined();
    expect(typeof ctxId).toBe("string");
  });
});

// ── Multi-turn Conversation ──────────────────────────────────────────

describe("multi-turn conversation", () => {
  it("maintains context across turns with same contextId", async () => {
    const ctx = `ctx_test_${crypto.randomUUID()}`;

    const data1 = await send("message/send", "My name is Alice", ctx);
    expect(getResultState(data1)).toBe("completed");

    const data2 = await send("message/send", "What is my name?", ctx);
    expect(getResultState(data2)).toBe("completed");
    const text2 = getResultText(data2);
    expect(text2).toBeDefined();
    expect(text2.length).toBeGreaterThan(0);
  });
});

// ── Commands ─────────────────────────────────────────────────────────

describe("commands", () => {
  it("/help returns help text", async () => {
    const data = await send("message/send", "/help");
    const text = getResultText(data);
    expect(text).toContain("Available commands");
    expect(text).toContain("/echo");
    expect(text).toContain("/status");
    expect(getResultState(data)).toBe("completed");
  });

  it("/echo returns echoed text", async () => {
    const data = await send("message/send", "/echo Hello World!");
    const text = getResultText(data);
    expect(text).toBe("Hello World!");
  });

  it("/echo with no text returns empty echo", async () => {
    const data = await send("message/send", "/echo");
    const text = getResultText(data);
    expect(text).toBe("(empty echo)");
  });

  it("/status returns agent status", async () => {
    const data = await send("message/send", "/status");
    const text = getResultText(data);
    expect(text).toContain("CAR Demo Agent");
    expect(text).toContain("openai");
    expect(text).toContain("Running on port");
  });
});

// ── Streaming (message/stream) ───────────────────────────────────────

describe("streaming (message/stream)", () => {
  it("returns SSE stream with text deltas for 'stream' trigger", async () => {
    const raw = await sendStream("stream Hello streaming");
    expect(raw).toContain("data:");
    expect(raw).toContain("[DONE]");
    expect(raw).toContain("status-update");
    expect(raw).toContain("working");
    expect(raw).toContain("completed");
  });

  it("returns SSE with message parts (text deltas)", async () => {
    const raw = await sendStream("stream Tell me a fact");
    const lines = raw.split("\n").filter((l) => l.startsWith("data:") && !l.includes("[DONE]"));
    const events = lines.map((l) => JSON.parse(l.replace("data: ", "")));
    const messageEvents = events.filter((e: Record<string, unknown>) => e.kind === "message");
    expect(messageEvents.length).toBeGreaterThan(0);
    for (const msg of messageEvents) {
      expect(msg.role).toBe("agent");
      expect(msg.parts[0].kind).toBe("text");
    }
  });

  it("handles 'stream' via message/send as normal response", async () => {
    const data = await send("message/send", "stream Hello");
    expect(data.error).toBeUndefined();
    expect(getResultState(data)).toBe("completed");
    const text = getResultText(data);
    expect(text).toContain("Mock LLM reply");
  });
});

// ── HITL (input-required) ────────────────────────────────────────────

describe("HITL (input-required)", () => {
  it("returns input-required state for 'approve' trigger via message/send", async () => {
    const ctx = `ctx_hitl_${crypto.randomUUID()}`;
    const data = await send("message/send", "approve deploy to production", ctx);
    expect(data.error).toBeUndefined();
    expect(getResultState(data)).toBe("input-required");
    const text = getResultText(data);
    expect(text).toContain("confirm");
    expect(text).toContain("deploy to production");
  });

  it("completes HITL flow: trigger -> confirm -> completed", async () => {
    const ctx = `ctx_hitl_flow_${crypto.randomUUID()}`;

    const trigger = await send("message/send", "approve delete user data", ctx);
    expect(getResultState(trigger)).toBe("input-required");

    const confirm = await send("message/send", "yes", ctx);
    expect(getResultState(confirm)).toBe("completed");
    const text = getResultText(confirm);
    expect(text).toContain("Approved");
    expect(text).toContain("delete user data");
  });

  it("handles HITL cancellation", async () => {
    const ctx = `ctx_hitl_cancel_${crypto.randomUUID()}`;

    await send("message/send", "approve risky action", ctx);
    const cancel = await send("message/send", "no", ctx);
    expect(getResultState(cancel)).toBe("completed");
    const text = getResultText(cancel);
    expect(text).toContain("Cancelled");
    expect(text).toContain("risky action");
  });

  it("returns SSE input-required for streaming HITL", async () => {
    const ctx = `ctx_hitl_stream_${crypto.randomUUID()}`;
    const raw = await sendStream("approve streaming approval");
    expect(raw).toContain("input-required");
    expect(raw).toContain("[DONE]");
  });
});

// ── Artifacts ────────────────────────────────────────────────────────

describe("artifacts", () => {
  it("returns artifacts for 'artifact' trigger via message/send", async () => {
    const data = await send("message/send", "artifact");
    expect(data.error).toBeUndefined();
    expect(getResultState(data)).toBe("completed");
    const result = data.result as Record<string, unknown>;
    const artifacts = result.artifacts as Record<string, unknown>[];
    expect(artifacts).toBeDefined();
    expect(artifacts.length).toBe(2);

    const fileArt = artifacts[0] as { name: string; parts: { kind: string }[] };
    expect(fileArt.name).toBe("greeting.ts");
    expect(fileArt.parts[0].kind).toBe("file");

    const dataArt = artifacts[1] as { name: string; parts: { kind: string }[] };
    expect(dataArt.name).toBe("sample-data.json");
    expect(dataArt.parts[0].kind).toBe("data");
  });

  it("returns artifact events in stream mode", async () => {
    const raw = await sendStream("artifact");
    expect(raw).toContain("artifact-update");
    expect(raw).toContain("greeting.ts");
    expect(raw).toContain("sample-data.json");
    expect(raw).toContain("completed");
    expect(raw).toContain("[DONE]");
  });
});

// ── Error Handling ───────────────────────────────────────────────────

describe("error handling", () => {
  it("returns -32601 for unknown methods", async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "task/unknown", params: {} }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error.code).toBe(-32601);
  });

  it("returns 405 for non-POST requests", async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}`, { method: "PUT" });
    expect(res.status).toBe(405);
  });

  it("returns -32700 for invalid JSON", async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error.code).toBe(-32700);
  });
});
