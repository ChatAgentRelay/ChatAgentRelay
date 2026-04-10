#!/usr/bin/env bun
/**
 * CAR Demo Agent — a minimal A2A-compatible agent backed by an LLM.
 *
 * Supports OpenAI, Anthropic (Claude), and Google (Gemini) as providers.
 * Set one of these environment variables to use it:
 *
 *   OPENAI_API_KEY    → uses gpt-4o-mini
 *   ANTHROPIC_API_KEY → uses claude-3-5-haiku-latest
 *   GEMINI_API_KEY    → uses gemini-2.0-flash
 *
 * Start:  bun run agent.ts
 * Port:   DEMO_AGENT_PORT (default 9100)
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

// ── LLM call per provider ────────────────────────────────────────────

async function callLLM(userText: string): Promise<string> {
  switch (provider) {
    case "openai":
      return callOpenAI(userText);
    case "anthropic":
      return callAnthropic(userText);
    case "gemini":
      return callGemini(userText);
  }
}

async function callOpenAI(userText: string): Promise<string> {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
      max_tokens: 256,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "(no response)";
}

async function callAnthropic(userText: string): Promise<string> {
  const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text ?? "(no response)";
}

async function callGemini(userText: string): Promise<string> {
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 256 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
}

// ── A2A response builder ─────────────────────────────────────────────

function buildTaskResponse(requestId: string, text: string) {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      id: `task_${crypto.randomUUID()}`,
      contextId: `ctx_${crypto.randomUUID()}`,
      status: {
        state: "completed",
        message: {
          kind: "message",
          messageId: `msg_${crypto.randomUUID()}`,
          role: "agent",
          parts: [{ kind: "text", text }],
        },
        timestamp: new Date().toISOString(),
      },
    },
  };
}

function buildErrorResponse(requestId: string, code: number, message: string) {
  return { jsonrpc: "2.0", id: requestId, error: { code, message } };
}

const AGENT_CARD = {
  name: "CAR Demo Agent",
  description: `Demo agent backed by ${provider} — connected through Chat Agent Relay`,
  url: `http://localhost:${PORT}`,
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [{ id: "chat", name: "General Chat", description: "General-purpose conversation" }],
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

    if (method !== "message/send" && method !== "message/stream") {
      return Response.json(buildErrorResponse(requestId, -32601, `Unknown method: ${method}`));
    }

    const params = body.params as Record<string, unknown> | undefined;
    const message = params?.message as Record<string, unknown> | undefined;
    const parts = (message?.parts ?? []) as { kind: string; text?: string }[];
    const userText = parts
      .filter((p) => p.kind === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");

    if (!userText) {
      return Response.json(buildTaskResponse(requestId, "I received your message, but it had no text content."));
    }

    try {
      const reply = await callLLM(userText);
      return Response.json(buildTaskResponse(requestId, reply));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`LLM call failed: ${msg}`);
      return Response.json(buildErrorResponse(requestId, -32000, `LLM error: ${msg}`));
    }
  },
});

console.log(`Demo agent (${provider}) listening on http://localhost:${PORT}`);
console.log(`Agent card: http://localhost:${PORT}/.well-known/agent.json`);
