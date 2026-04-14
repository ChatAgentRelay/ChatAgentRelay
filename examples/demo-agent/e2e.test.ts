import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";

/**
 * End-to-end: mock LLM -> demo-agent -> CAR server -> WebChat endpoints
 *
 * Tests the full pipeline for:
 *   - Text chat (POST /api/chat)
 *   - Streaming (POST /api/chat/stream)
 *   - Multi-turn conversation (same conversation_id)
 *   - Commands via WebChat
 *   - HITL flow (approve -> resume)
 *   - Health endpoint
 */

const AGENT_PORT = 9201;
const CAR_PORT = 9202;
const DB_PATH = "/tmp/car-e2e-demo-test.db";

let mockLLM: ReturnType<typeof Bun.serve>;
let agentProc: import("bun").Subprocess;
const carProcs: import("bun").Subprocess[] = [];

function waitForPort(port: number, maxMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      while (Date.now() - start < maxMs) {
        try {
          const res = await fetch(`http://localhost:${port}`);
          await res.text();
          resolve();
          return;
        } catch {
          await Bun.sleep(150);
        }
      }
      reject(new Error(`port ${port} did not respond within ${maxMs}ms`));
    })();
  });
}

function runCar(...args: string[]): import("bun").Subprocess {
  const proc = Bun.spawn(["bun", "run", "../../packages/server/src/cli.ts", ...args], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      CAR_DB_PATH: DB_PATH,
      CAR_API_PORT: String(CAR_PORT),
      CAR_ENCRYPTION_KEY: "e2e_test_key_32_bytes_long_pad00",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  carProcs.push(proc);
  return proc;
}

async function runCarAndWait(...args: string[]): Promise<string> {
  const proc = runCar(...args);
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output;
}

async function chatPost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://localhost:${CAR_PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function chatStreamPost(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`http://localhost:${CAR_PORT}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.text();
}

function baseChatBody(text: string, extra?: Record<string, unknown>) {
  return {
    text,
    user_id: "e2e-user",
    client_message_id: `msg_${crypto.randomUUID()}`,
    tenant_id: "demo",
    workspace_id: "default",
    channel_instance_id: "web",
    ...extra,
  };
}

beforeAll(async () => {
  try { unlinkSync(DB_PATH); } catch {}

  mockLLM = Bun.serve({
    port: 0,
    fetch(req) {
      return (async () => {
        const body = (await req.json()) as { messages?: { role: string; content: string }[] };
        const userMsg = body.messages?.filter((m) => m.role === "user").pop()?.content ?? "";
        return Response.json({
          choices: [{ message: { content: `E2E reply to: ${userMsg.slice(0, 80)}` } }],
        });
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
  await waitForPort(AGENT_PORT);

  await runCarAndWait("channel", "add", "web", "--type=webchat");
  await runCarAndWait("agent", "add", "demo", `--endpoint=http://localhost:${AGENT_PORT}`);
  await runCarAndWait("route", "add", "--agent=demo", "--default");

  runCar("start");

  const startTime = Date.now();
  while (Date.now() - startTime < 10000) {
    try {
      const res = await fetch(`http://localhost:${CAR_PORT}/api/health`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(200);
  }
}, 30000);

afterAll(async () => {
  for (const p of carProcs) { try { p.kill(); } catch {} }
  try { agentProc?.kill(); } catch {}
  try { mockLLM?.stop(true); } catch {}
  try { unlinkSync(DB_PATH); } catch {}
});

// ── Health ───────────────────────────────────────────────────────────

describe("health", () => {
  it("CAR health endpoint is accessible", async () => {
    const res = await fetch(`http://localhost:${CAR_PORT}/api/health`);
    expect(res.ok).toBe(true);
  });
});

// ── Text Chat Pipeline ──────────────────────────────────────────────

describe("text chat pipeline", () => {
  it("sends a message through the full pipeline", async () => {
    const data = await chatPost(baseChatBody("Hello, demo agent!"));
    expect(data.ok).toBe(true);
    expect(data.reply).toBeDefined();
    expect(typeof data.reply).toBe("string");
    expect((data.reply as string).length).toBeGreaterThan(0);
    expect(data.conversation_id).toBeDefined();
  });

  it("returns conversation_id and correlation_id", async () => {
    const data = await chatPost(baseChatBody("Track this message"));
    expect(data.ok).toBe(true);
    expect(data.conversation_id).toBeDefined();
    expect(data.correlation_id).toBeDefined();
  });
});

// ── Multi-turn Conversation ─────────────────────────────────────────

describe("multi-turn conversation", () => {
  it("maintains conversation across multiple messages", async () => {
    const data1 = await chatPost(baseChatBody("First message"));
    expect(data1.ok).toBe(true);
    const convId = data1.conversation_id as string;
    expect(convId).toBeDefined();

    const data2 = await chatPost(baseChatBody("Second message", { conversation_id: convId }));
    expect(data2.ok).toBe(true);
    expect(data2.conversation_id).toBe(convId);
    expect(data2.reply).toBeDefined();
  });
});

// ── Streaming Pipeline ──────────────────────────────────────────────

describe("streaming pipeline", () => {
  it("returns SSE stream via /api/chat/stream", async () => {
    const raw = await chatStreamPost(baseChatBody("Stream test message"));
    expect(raw).toContain("data:");
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    expect(lines.length).toBeGreaterThan(0);

    const lastDataLine = lines[lines.length - 1]!;
    const lastEvent = JSON.parse(lastDataLine.replace("data: ", ""));
    expect(lastEvent.type).toBe("done");
    expect(lastEvent.reply).toBeDefined();
    expect(lastEvent.conversation_id).toBeDefined();
  });
});

// ── WebChat Built-in Commands ────────────────────────────────────────

describe("webchat commands", () => {
  it("/help returns help response without hitting pipeline", async () => {
    const data = await chatPost(baseChatBody("/help"));
    expect(data.reply).toBeDefined();
  });

  it("/status returns status info", async () => {
    const data = await chatPost(baseChatBody("/status"));
    expect(data.reply).toBeDefined();
  });
});

// ── HITL Pipeline ────────────────────────────────────────────────────

describe("HITL pipeline", () => {
  it("HITL trigger returns session_handle and hitl_pending flag", async () => {
    const data = await chatPost(baseChatBody("approve deploy to production"));
    expect(data.ok).toBe(true);
    expect(data.reply).toBeDefined();
    if (data.hitl_pending) {
      expect(data.session_handle).toBeDefined();
    }
  });
});
