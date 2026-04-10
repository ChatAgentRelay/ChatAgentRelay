import type { WebChatIngress } from "./canonicalize";
import type {
  CanonicalizationResult,
  WebChatPipelineResult,
  WebChatResumeFn,
  WebChatResumeStreamingFn,
  WebChatStreamEvent,
  WebChatStreamingPipelineFn,
} from "./types";

// ── Response types ──────────────────────────────────────────────────────

export type WebChatResponse = {
  ok: boolean;
  conversation_id?: string;
  correlation_id?: string;
  reply?: string;
  session_handle?: string;
  hitl_pending?: boolean;
  hitl_prompt?: string;
  error?: string;
};

export type WebChatPipelineFn = (raw: unknown) => Promise<WebChatPipelineResult>;

export type WebChatHttpConfig = {
  port: number;
  ingress: WebChatIngress;
  pipelineFn: WebChatPipelineFn;
  streamingPipelineFn?: WebChatStreamingPipelineFn;
  resumeFn?: WebChatResumeFn;
  resumeStreamingFn?: WebChatResumeStreamingFn;
  corsOrigin?: string;
};

// ── Session Store ───────────────────────────────────────────────────────

export class SessionStore {
  private sessions = new Map<string, { sessionHandle: string; lastActive: number }>();

  set(conversationId: string, sessionHandle: string): void {
    this.sessions.set(conversationId, { sessionHandle, lastActive: Date.now() });
  }

  get(conversationId: string): string | undefined {
    const entry = this.sessions.get(conversationId);
    if (entry) {
      entry.lastActive = Date.now();
    }
    return entry?.sessionHandle;
  }

  remove(conversationId: string): boolean {
    return this.sessions.delete(conversationId);
  }

  info(conversationId: string): { sessionHandle: string; lastActive: number } | undefined {
    return this.sessions.get(conversationId);
  }

  get size(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }
}

// ── Slash Commands ──────────────────────────────────────────────────────

const BUILT_IN_COMMANDS: Record<string, (sessionStore: SessionStore, conversationId?: string) => WebChatResponse> = {
  "/help": () => ({
    ok: true,
    reply: [
      "Available commands:",
      "  /help    — Show this help message",
      "  /status  — Show session info",
      "  /clear   — Clear current session",
    ].join("\n"),
  }),
  "/status": (store) => ({
    ok: true,
    reply: `Active sessions: ${store.size}`,
  }),
  "/clear": (store, convId) => {
    if (convId) store.remove(convId);
    return { ok: true, reply: "Session cleared." };
  },
};

function tryHandleCommand(text: string, sessionStore: SessionStore, conversationId?: string): WebChatResponse | null {
  if (!text.startsWith("/")) return null;
  const cmd = text.split(" ")[0]!.toLowerCase();
  const handler = BUILT_IN_COMMANDS[cmd];
  if (!handler) return null;
  return handler(sessionStore, conversationId);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data: unknown, status = 200, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function sseResponse(
  handler: (send: (event: WebChatStreamEvent) => void, close: () => void) => void,
  origin = "*",
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: WebChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      handler(send, close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(origin),
    },
  });
}

// ── Server ──────────────────────────────────────────────────────────────

export function startWebChatServer(config: WebChatHttpConfig) {
  const { ingress, pipelineFn, streamingPipelineFn, resumeFn, resumeStreamingFn, port, corsOrigin = "*" } = config;

  const sessionStore = new SessionStore();

  async function readBody(req: Request): Promise<unknown | null> {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }

  function toPipelineResult(result: WebChatPipelineResult): WebChatResponse {
    if (result.sessionHandle && result.conversationId) {
      sessionStore.set(result.conversationId, result.sessionHandle);
    }

    return {
      ok: true,
      conversation_id: result.conversationId,
      correlation_id: result.correlationId,
      reply: result.reply,
      ...(result.sessionHandle !== undefined ? { session_handle: result.sessionHandle } : {}),
      ...(result.hitlPending !== undefined ? { hitl_pending: result.hitlPending } : {}),
      ...(result.hitlPrompt !== undefined ? { hitl_prompt: result.hitlPrompt } : {}),
    };
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        return jsonResponse(null, 204, corsOrigin);
      }

      const url = new URL(req.url);
      const path = url.pathname;

      // ── Health ──────────────────────────────────────────────────────
      if (path === "/api/health") {
        return jsonResponse({ status: "ok" }, 200, corsOrigin);
      }

      // ── POST /api/chat — sync response ─────────────────────────────
      if (path === "/api/chat" && req.method === "POST") {
        const body = await readBody(req);
        if (!body) {
          return jsonResponse({ ok: false, error: "Invalid JSON body" } satisfies WebChatResponse, 400, corsOrigin);
        }

        const cmdResult = tryHandleCommand(
          ((body as Record<string, unknown>)["text"] as string) ?? "",
          sessionStore,
          (body as Record<string, unknown>)["conversation_id"] as string,
        );
        if (cmdResult) return jsonResponse(cmdResult, 200, corsOrigin);

        const canonResult: CanonicalizationResult = ingress.canonicalize(body);
        if (!canonResult.ok) {
          return jsonResponse(
            { ok: false, error: canonResult.error.message } satisfies WebChatResponse,
            400,
            corsOrigin,
          );
        }

        try {
          const result = await pipelineFn(body);
          return jsonResponse(toPipelineResult(result), 200, corsOrigin);
        } catch (error) {
          return jsonResponse(
            { ok: false, error: error instanceof Error ? error.message : "Pipeline failed" } satisfies WebChatResponse,
            500,
            corsOrigin,
          );
        }
      }

      // ── POST /api/chat/stream — SSE streaming ──────────────────────
      if (path === "/api/chat/stream" && req.method === "POST") {
        if (!streamingPipelineFn) {
          return jsonResponse(
            { ok: false, error: "Streaming not configured" } satisfies WebChatResponse,
            501,
            corsOrigin,
          );
        }

        const body = await readBody(req);
        if (!body) {
          return jsonResponse({ ok: false, error: "Invalid JSON body" } satisfies WebChatResponse, 400, corsOrigin);
        }

        const cmdResult = tryHandleCommand(
          ((body as Record<string, unknown>)["text"] as string) ?? "",
          sessionStore,
          (body as Record<string, unknown>)["conversation_id"] as string,
        );
        if (cmdResult) return jsonResponse(cmdResult, 200, corsOrigin);

        const canonResult: CanonicalizationResult = ingress.canonicalize(body);
        if (!canonResult.ok) {
          return jsonResponse(
            { ok: false, error: canonResult.error.message } satisfies WebChatResponse,
            400,
            corsOrigin,
          );
        }

        return sseResponse((send, close) => {
          streamingPipelineFn(body, send)
            .then((result) => {
              if (result.sessionHandle && result.conversationId) {
                sessionStore.set(result.conversationId, result.sessionHandle);
              }
              send({
                type: "done",
                conversation_id: result.conversationId,
                correlation_id: result.correlationId,
                reply: result.reply,
                ...(result.sessionHandle !== undefined ? { session_handle: result.sessionHandle } : {}),
                ...(result.hitlPending !== undefined ? { hitl_pending: result.hitlPending } : {}),
              });
              close();
            })
            .catch((error) => {
              send({ type: "error", message: error instanceof Error ? error.message : "Pipeline failed" });
              close();
            });
        }, corsOrigin);
      }

      // ── POST /api/chat/resume — HITL resume (sync) ─────────────────
      if (path === "/api/chat/resume" && req.method === "POST") {
        if (!resumeFn) {
          return jsonResponse({ ok: false, error: "Resume not configured" } satisfies WebChatResponse, 501, corsOrigin);
        }

        const body = (await readBody(req)) as Record<string, unknown> | null;
        if (!body) {
          return jsonResponse({ ok: false, error: "Invalid JSON body" } satisfies WebChatResponse, 400, corsOrigin);
        }

        const sessionHandle = body["session_handle"] as string | undefined;
        const text = body["text"] as string | undefined;
        if (!sessionHandle || !text) {
          return jsonResponse(
            { ok: false, error: "session_handle and text are required" } satisfies WebChatResponse,
            400,
            corsOrigin,
          );
        }

        try {
          const result = await resumeFn(sessionHandle, text);
          return jsonResponse(toPipelineResult(result), 200, corsOrigin);
        } catch (error) {
          return jsonResponse(
            { ok: false, error: error instanceof Error ? error.message : "Resume failed" } satisfies WebChatResponse,
            500,
            corsOrigin,
          );
        }
      }

      // ── POST /api/chat/resume/stream — HITL resume (SSE) ───────────
      if (path === "/api/chat/resume/stream" && req.method === "POST") {
        if (!resumeStreamingFn) {
          return jsonResponse(
            { ok: false, error: "Resume streaming not configured" } satisfies WebChatResponse,
            501,
            corsOrigin,
          );
        }

        const body = (await readBody(req)) as Record<string, unknown> | null;
        if (!body) {
          return jsonResponse({ ok: false, error: "Invalid JSON body" } satisfies WebChatResponse, 400, corsOrigin);
        }

        const sessionHandle = body["session_handle"] as string | undefined;
        const text = body["text"] as string | undefined;
        if (!sessionHandle || !text) {
          return jsonResponse(
            { ok: false, error: "session_handle and text are required" } satisfies WebChatResponse,
            400,
            corsOrigin,
          );
        }

        return sseResponse((send, close) => {
          resumeStreamingFn(sessionHandle, text, send)
            .then((result) => {
              if (result.sessionHandle && result.conversationId) {
                sessionStore.set(result.conversationId, result.sessionHandle);
              }
              send({
                type: "done",
                conversation_id: result.conversationId,
                correlation_id: result.correlationId,
                reply: result.reply,
                ...(result.sessionHandle !== undefined ? { session_handle: result.sessionHandle } : {}),
                ...(result.hitlPending !== undefined ? { hitl_pending: result.hitlPending } : {}),
              });
              close();
            })
            .catch((error) => {
              send({ type: "error", message: error instanceof Error ? error.message : "Resume failed" });
              close();
            });
        }, corsOrigin);
      }

      // ── GET /api/chat/sessions/:id — session info ──────────────────
      const sessionMatch = path.match(/^\/api\/chat\/sessions\/(.+)$/);
      if (sessionMatch && req.method === "GET") {
        const conversationId = decodeURIComponent(sessionMatch[1]!);
        const info = sessionStore.info(conversationId);
        if (!info) {
          return jsonResponse({ ok: false, error: "Session not found" }, 404, corsOrigin);
        }
        return jsonResponse(
          {
            ok: true,
            conversation_id: conversationId,
            session_handle: info.sessionHandle,
            last_active: new Date(info.lastActive).toISOString(),
          },
          200,
          corsOrigin,
        );
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404, corsOrigin);
    },
  });

  return { server, sessionStore };
}
