import type { CanonicalizationResult } from "./types";
import type { WebChatIngress } from "./canonicalize";

export type WebChatResponse = {
  ok: boolean;
  conversation_id?: string | undefined;
  correlation_id?: string | undefined;
  reply?: string | undefined;
  error?: string | undefined;
};

export type WebChatPipelineFn = (
  raw: unknown,
) => Promise<{ reply: string; conversationId: string; correlationId: string }>;

export type WebChatHttpConfig = {
  port: number;
  ingress: WebChatIngress;
  pipelineFn: WebChatPipelineFn;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export function startWebChatServer(config: WebChatHttpConfig) {
  const { ingress, pipelineFn, port } = config;

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        return jsonResponse(null, 204);
      }

      const url = new URL(req.url);

      if (url.pathname === "/api/health") {
        return jsonResponse({ status: "ok" });
      }

      if (url.pathname === "/api/chat" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ ok: false, error: "Invalid JSON body" } satisfies WebChatResponse, 400);
        }

        const canonResult: CanonicalizationResult = ingress.canonicalize(body);
        if (!canonResult.ok) {
          return jsonResponse(
            { ok: false, error: canonResult.error.message } satisfies WebChatResponse,
            400,
          );
        }

        try {
          const result = await pipelineFn(body);
          return jsonResponse({
            ok: true,
            conversation_id: result.conversationId,
            correlation_id: result.correlationId,
            reply: result.reply,
          } satisfies WebChatResponse);
        } catch (error) {
          return jsonResponse(
            { ok: false, error: error instanceof Error ? error.message : "Pipeline failed" } satisfies WebChatResponse,
            500,
          );
        }
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404);
    },
  });

  return server;
}
