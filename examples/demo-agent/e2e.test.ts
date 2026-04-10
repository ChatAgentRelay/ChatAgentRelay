import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";

/**
 * End-to-end: mock LLM -> demo-agent -> CAR server -> WebChat POST /api/chat
 *
 * Proves the demo agent works with a real CAR server pipeline.
 */

const AGENT_PORT = 9201;
const CAR_PORT = 9202;
const DB_PATH = "/tmp/car-e2e-demo-test.db";

let mockLLM: ReturnType<typeof Bun.serve>;
let agentProc: import("bun").Subprocess;
let carProcs: import("bun").Subprocess[] = [];

function waitForPort(port: number, maxMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise<void>(async (resolve, reject) => {
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(`http://localhost:${port}`);
        await res.text();
        return resolve();
      } catch {
        await Bun.sleep(150);
      }
    }
    reject(new Error(`port ${port} did not respond within ${maxMs}ms`));
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

beforeAll(async () => {
  try { unlinkSync(DB_PATH); } catch {}

  // 1. Start mock LLM (OpenAI-compatible)
  mockLLM = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        choices: [{ message: { content: "Hello from the demo agent through CAR!" } }],
      });
    },
  });

  // 2. Start demo agent
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

  // 3. Configure CAR: add webchat channel, demo agent, and route
  await runCarAndWait("channel", "add", "web", "--type=webchat");
  await runCarAndWait("agent", "add", "demo", `--endpoint=http://localhost:${AGENT_PORT}`);
  await runCarAndWait("route", "add", "--agent=demo", "--default");

  // 4. Start CAR server
  const carServer = runCar("start");

  // Wait for CAR to be ready
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
  for (const p of carProcs) {
    try { p.kill(); } catch {}
  }
  try { agentProc?.kill(); } catch {}
  try { mockLLM?.stop(true); } catch {}
  try { unlinkSync(DB_PATH); } catch {}
});

describe("demo-agent e2e with CAR server", () => {
  it("sends a WebChat message through the full pipeline", async () => {
    const res = await fetch(`http://localhost:${CAR_PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Hello, demo agent!",
        user_id: "e2e-user",
        client_message_id: `msg_${crypto.randomUUID()}`,
        tenant_id: "demo",
        workspace_id: "default",
        channel_instance_id: "web",
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.reply).toBe("Hello from the demo agent through CAR!");
    expect(data.conversation_id).toBeDefined();
  });

  it("CAR health endpoint is accessible", async () => {
    const res = await fetch(`http://localhost:${CAR_PORT}/api/health`);
    expect(res.ok).toBe(true);
  });
});
