#!/usr/bin/env bun
/**
 * CAR Demo Agent — a feature-showcase A2A agent.
 *
 * Demonstrates all major CAR capabilities:
 *   - Text Q&A (single-turn via LLM)
 *   - Streaming responses (real SSE text_delta)
 *   - Multi-turn conversation (contextId-based history)
 *   - Slash command handling (/help, /echo, /status)
 *   - HITL input-required flow (trigger: "approve ...")
 *   - Artifact responses (trigger: "artifact")
 *
 * Providers: OPENAI_API_KEY | ANTHROPIC_API_KEY | GEMINI_API_KEY
 * Port:      DEMO_AGENT_PORT (default 9100)
 */

const PORT = Number(process.env.DEMO_AGENT_PORT) || 9100;

type Provider = "openai" | "anthropic" | "gemini";

function detectProvider(): { provider: Provider; apiKey: string } {
  if (process.env.OPENAI_API_KEY) return { provider: "openai", apiKey: process.env.OPENAI_API_KEY };
  if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", apiKey: process.env.GEMINI_API_KEY };
  console.error("Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY");
  process.exit(1);
}

const { provider, apiKey } = detectProvider();
const LLM_TIMEOUT_MS = Number(process.env.DEMO_AGENT_TIMEOUT_MS) || 15_000;

const SYSTEM_PROMPT =
  "You are a helpful assistant connected through Chat Agent Relay. " +
  "Keep answers concise (1-3 sentences). If asked about yourself, mention you are a demo agent running behind CAR.";

// ── Conversation history store (contextId -> turns) ──────────────────

type Turn = { role: "user" | "agent"; text: string };
const conversations = new Map<string, Turn[]>();
const MAX_HISTORY = 20;

function getHistory(contextId: string): Turn[] {
  return conversations.get(contextId) ?? [];
}

function addTurn(contextId: string, role: "user" | "agent", text: string) {
  const history = conversations.get(contextId) ?? [];
  history.push({ role, text });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversations.set(contextId, history);
}

// ── HITL pending sessions (contextId -> pending state) ───────────────

type HitlPending = { prompt: string; originalText: string };
const hitlSessions = new Map<string, HitlPending>();

// ── LLM call per provider ────────────────────────────────────────────

async function callLLM(userText: string, contextId?: string): Promise<string> {
  const history = contextId ? getHistory(contextId) : [];
  switch (provider) {
    case "openai":
      return callOpenAI(userText, history);
    case "anthropic":
      return callAnthropic(userText, history);
    case "gemini":
      return callGemini(userText, history);
  }
}

async function callOpenAI(userText: string, history: Turn[]): Promise<string> {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const messages: { role: string; content: string }[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const t of history) messages.push({ role: t.role === "user" ? "user" : "assistant", content: t.text });
  messages.push({ role: "user", content: userText });

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 256 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "(no response)";
}

async function callAnthropic(userText: string, history: Turn[]): Promise<string> {
  const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const messages: { role: string; content: string }[] = [];
  for (const t of history) messages.push({ role: t.role === "user" ? "user" : "assistant", content: t.text });
  messages.push({ role: "user", content: userText });

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 256, system: SYSTEM_PROMPT, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text ?? "(no response)";
}

async function callGemini(userText: string, history: Turn[]): Promise<string> {
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const t of history) contents.push({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] });
  contents.push({ role: "user", parts: [{ text: userText }] });

  const url = `${base}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 256 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
}

// ── A2A response builders ────────────────────────────────────────────

type A2APart = { kind: "text"; text: string } | { kind: "file"; file: Record<string, string> } | { kind: "data"; data: Record<string, unknown> };

function buildTaskResponse(requestId: string, text: string, contextId: string, state: string = "completed") {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: `task_${crypto.randomUUID()}`,
      contextId,
      status: {
        state,
        message: { kind: "message", messageId: `msg_${crypto.randomUUID()}`, role: "agent", parts: [{ kind: "text", text }] },
        timestamp: new Date().toISOString(),
      },
    },
  };
}

function buildTaskWithArtifacts(requestId: string, text: string, contextId: string, artifacts: unknown[]) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: `task_${crypto.randomUUID()}`,
      contextId,
      status: {
        state: "completed",
        message: { kind: "message", messageId: `msg_${crypto.randomUUID()}`, role: "agent", parts: [{ kind: "text", text }] },
        timestamp: new Date().toISOString(),
      },
      artifacts,
    },
  };
}

function buildErrorResponse(requestId: string, code: number, message: string) {
  return { jsonrpc: "2.0", id: requestId, error: { code, message } };
}

// ── SSE stream helpers ───────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStatusEvent(taskId: string, contextId: string, state: string, text?: string) {
  const msg = text
    ? { kind: "message", messageId: `msg_${crypto.randomUUID()}`, role: "agent", parts: [{ kind: "text", text }] }
    : undefined;
  return {
    kind: "status-update",
    taskId,
    contextId,
    status: { state, ...(msg ? { message: msg } : {}), timestamp: new Date().toISOString() },
  };
}

function buildArtifactEvent(taskId: string, contextId: string, artifact: unknown) {
  return { kind: "artifact-update", taskId, contextId, artifact };
}

// ── Command handlers ─────────────────────────────────────────────────

const HELP_TEXT = `Available commands:
- /help — Show this help message
- /echo <text> — Echo back the provided text
- /status — Show agent status and capabilities

Special triggers:
- "stream <text>" — Get a streaming response
- "approve <text>" — Trigger HITL approval flow
- "artifact" — Get a response with file artifacts
- Any other text — Chat with the LLM`;

function handleCommand(text: string): string | null {
  const lower = text.toLowerCase().trim();

  if (lower === "/help") return HELP_TEXT;

  if (lower.startsWith("/echo ")) return text.slice(6);
  if (lower === "/echo") return "(empty echo)";

  if (lower === "/status") {
    return [
      `Agent: CAR Demo Agent (${provider})`,
      `Status: Running on port ${PORT}`,
      `Capabilities: streaming, multi-turn, HITL, artifacts`,
      `Conversations tracked: ${conversations.size}`,
      `HITL sessions pending: ${hitlSessions.size}`,
    ].join("\n");
  }

  return null;
}

// ── Request routing ──────────────────────────────────────────────────

type RequestCategory = "command" | "stream" | "hitl_trigger" | "hitl_resume" | "artifact" | "chat";

function categorize(text: string, contextId: string): RequestCategory {
  const lower = text.toLowerCase().trim();
  if (lower.startsWith("/")) return "command";
  if (lower.startsWith("stream ") || lower === "stream") return "stream";
  if (lower.startsWith("approve ") || lower === "approve") return "hitl_trigger";
  if (hitlSessions.has(contextId)) return "hitl_resume";
  if (lower === "artifact" || lower.startsWith("artifact ")) return "artifact";
  return "chat";
}

// ── Streaming response handler ───────────────────────────────────────

async function handleStream(
  userText: string,
  contextId: string,
  requestId: string,
): Promise<Response> {
  const taskId = `task_${crypto.randomUUID()}`;
  const query = userText.replace(/^stream\s*/i, "") || "Tell me something interesting.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "working"))));

      try {
        const reply = await callLLM(query, contextId);
        addTurn(contextId, "user", query);

        const words = reply.split(" ");
        let accumulated = "";
        for (let i = 0; i < words.length; i++) {
          accumulated += (i > 0 ? " " : "") + words[i];
          controller.enqueue(
            encoder.encode(
              sseEvent({
                kind: "message",
                messageId: `msg_${crypto.randomUUID()}`,
                role: "agent",
                parts: [{ kind: "text", text: (i > 0 ? " " : "") + words[i] }],
              }),
            ),
          );
          await Bun.sleep(50);
        }

        addTurn(contextId, "agent", reply);
        controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "completed", reply))));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            sseEvent(
              buildStatusEvent(taskId, contextId, "failed", `LLM error: ${msg}`),
            ),
          ),
        );
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ── Artifact response builder ────────────────────────────────────────

function buildArtifactResponse(requestId: string, contextId: string) {
  const sampleCode = `// Generated by CAR Demo Agent
export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to Chat Agent Relay.\`;
}`;

  const sampleData = { generated_at: new Date().toISOString(), agent: "CAR Demo Agent", provider, items: [1, 2, 3] };

  const artifacts = [
    {
      artifactId: `art_${crypto.randomUUID()}`,
      name: "greeting.ts",
      parts: [{ kind: "file", file: { name: "greeting.ts", mimeType: "text/typescript", bytes: btoa(sampleCode) } }],
    },
    {
      artifactId: `art_${crypto.randomUUID()}`,
      name: "sample-data.json",
      parts: [{ kind: "data", data: sampleData }],
    },
  ];

  return buildTaskWithArtifacts(
    requestId,
    "Here are the generated artifacts: a TypeScript file and a JSON data object.",
    contextId,
    artifacts,
  );
}

// ── Artifact streaming response ──────────────────────────────────────

function handleArtifactStream(contextId: string, requestId: string): Response {
  const taskId = `task_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  const sampleCode = `// Generated by CAR Demo Agent
export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to Chat Agent Relay.\`;
}`;

  const sampleData = { generated_at: new Date().toISOString(), agent: "CAR Demo Agent", provider, items: [1, 2, 3] };

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "working"))));
      await Bun.sleep(50);

      const art1 = {
        artifactId: `art_${crypto.randomUUID()}`,
        name: "greeting.ts",
        parts: [{ kind: "file", file: { name: "greeting.ts", mimeType: "text/typescript", bytes: btoa(sampleCode) } }],
      };
      controller.enqueue(encoder.encode(sseEvent(buildArtifactEvent(taskId, contextId, art1))));
      await Bun.sleep(50);

      const art2 = {
        artifactId: `art_${crypto.randomUUID()}`,
        name: "sample-data.json",
        parts: [{ kind: "data", data: sampleData }],
      };
      controller.enqueue(encoder.encode(sseEvent(buildArtifactEvent(taskId, contextId, art2))));
      await Bun.sleep(50);

      const text = "Here are the generated artifacts: a TypeScript file and a JSON data object.";
      controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "completed", text))));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ── HITL streaming handler ───────────────────────────────────────────

function handleHitlTriggerStream(userText: string, contextId: string, requestId: string): Response {
  const taskId = `task_${crypto.randomUUID()}`;
  const action = userText.replace(/^approve\s*/i, "") || "the pending action";
  const prompt = `Please confirm: Do you approve "${action}"? Reply "yes" to confirm or "no" to cancel.`;
  hitlSessions.set(contextId, { prompt, originalText: action });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "working"))));
      await Bun.sleep(50);
      controller.enqueue(encoder.encode(sseEvent(buildStatusEvent(taskId, contextId, "input-required", prompt))));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ── Agent Card ───────────────────────────────────────────────────────

const AGENT_CARD = {
  name: "CAR Demo Agent",
  description: `Feature-showcase agent backed by ${provider} — demonstrates streaming, multi-turn, HITL, commands, and artifacts through Chat Agent Relay`,
  url: `http://localhost:${PORT}`,
  version: "2.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    { id: "chat", name: "General Chat", description: "Multi-turn conversation with LLM" },
    { id: "commands", name: "Commands", description: "Built-in commands: /help, /echo, /status" },
    { id: "streaming", name: "Streaming", description: "Progressive text streaming (trigger: 'stream ...')" },
    { id: "hitl", name: "Human-in-the-Loop", description: "Approval flow (trigger: 'approve ...')" },
    { id: "artifacts", name: "Artifacts", description: "File and data artifact generation (trigger: 'artifact')" },
  ],
};

// ── HTTP server ──────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
      return Response.json(AGENT_CARD);
    }

    if (req.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(buildErrorResponse("0", -32700, "Parse error"), { status: 400 });
    }

    const method = body.method as string;
    const requestId = (body.id as string) ?? "0";
    const isStream = method === "message/stream";

    if (method !== "message/send" && method !== "message/stream") {
      return Response.json(buildErrorResponse(requestId, -32601, `Unknown method: ${method}`));
    }

    const params = body.params as Record<string, unknown> | undefined;
    const message = params?.message as Record<string, unknown> | undefined;
    const parts = (message?.parts ?? []) as { kind: string; text?: string }[];
    const userText = parts.flatMap((p) => (p.kind === "text" && p.text ? [p.text] : [])).join("\n");
    const contextId = (message?.contextId as string) ?? `ctx_${crypto.randomUUID()}`;

    if (!userText) {
      return Response.json(buildTaskResponse(requestId, "I received your message, but it had no text content.", contextId));
    }

    const category = categorize(userText, contextId);

    // ── Commands ─────────────────────────────────────────────────────
    if (category === "command") {
      const response = handleCommand(userText);
      if (response !== null) {
        return Response.json(buildTaskResponse(requestId, response, contextId));
      }
      // Unknown command -> fall through to chat
    }

    // ── Streaming ────────────────────────────────────────────────────
    if (category === "stream" && isStream) {
      return handleStream(userText, contextId, requestId);
    }
    if (category === "stream" && !isStream) {
      const query = userText.replace(/^stream\s*/i, "") || "Tell me something interesting.";
      try {
        addTurn(contextId, "user", query);
        const reply = await callLLM(query, contextId);
        addTurn(contextId, "agent", reply);
        return Response.json(buildTaskResponse(requestId, reply, contextId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json(buildErrorResponse(requestId, -32000, `LLM error: ${msg}`));
      }
    }

    // ── HITL trigger ─────────────────────────────────────────────────
    if (category === "hitl_trigger") {
      const action = userText.replace(/^approve\s*/i, "") || "the pending action";
      const prompt = `Please confirm: Do you approve "${action}"? Reply "yes" to confirm or "no" to cancel.`;
      hitlSessions.set(contextId, { prompt, originalText: action });

      if (isStream) {
        return handleHitlTriggerStream(userText, contextId, requestId);
      }
      return Response.json(buildTaskResponse(requestId, prompt, contextId, "input-required"));
    }

    // ── HITL resume ──────────────────────────────────────────────────
    if (category === "hitl_resume") {
      const pending = hitlSessions.get(contextId)!;
      hitlSessions.delete(contextId);
      const lower = userText.toLowerCase().trim();
      const approved = lower === "yes" || lower === "y" || lower === "confirm";
      const reply = approved
        ? `Approved! Action "${pending.originalText}" has been executed.`
        : `Cancelled. Action "${pending.originalText}" was not executed.`;
      addTurn(contextId, "user", userText);
      addTurn(contextId, "agent", reply);
      return Response.json(buildTaskResponse(requestId, reply, contextId));
    }

    // ── Artifacts ────────────────────────────────────────────────────
    if (category === "artifact") {
      if (isStream) {
        return handleArtifactStream(contextId, requestId);
      }
      return Response.json(buildArtifactResponse(requestId, contextId));
    }

    // ── Default: LLM chat (multi-turn) ──────────────────────────────
    try {
      addTurn(contextId, "user", userText);
      const reply = await callLLM(userText, contextId);
      addTurn(contextId, "agent", reply);

      if (isStream) {
        return handleStream(`stream ${userText}`, contextId, requestId);
      }
      return Response.json(buildTaskResponse(requestId, reply, contextId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`LLM call failed: ${msg}`);
      return Response.json(buildErrorResponse(requestId, -32000, `LLM error: ${msg}`));
    }
  },
});

console.log(`Demo agent (${provider}) listening on http://localhost:${PORT}`);
console.log(`Agent card: http://localhost:${PORT}/.well-known/agent.json`);
console.log("Features: streaming, multi-turn, HITL, commands, artifacts");
