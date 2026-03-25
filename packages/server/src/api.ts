import type { LedgerStore } from "@cap/event-ledger";
import { logger } from "./logger";

export type ApiConfig = {
  port: number;
  ledgerStore: LedgerStore;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

export function startApiServer(config: ApiConfig): ReturnType<typeof Bun.serve> {
  const { ledgerStore, port } = config;

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/api/health") {
        return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
      }

      const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)\/events$/);
      if (conversationMatch) {
        const conversationId = conversationMatch[1]!;
        const events = ledgerStore.getByConversationId(conversationId);
        return jsonResponse({ conversation_id: conversationId, events, count: events.length });
      }

      const correlationMatch = path.match(/^\/api\/correlations\/([^/]+)\/events$/);
      if (correlationMatch) {
        const correlationId = correlationMatch[1]!;
        const events = ledgerStore.getByCorrelationId(correlationId);
        return jsonResponse({ correlation_id: correlationId, events, count: events.length });
      }

      const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
      if (eventMatch) {
        const eventId = eventMatch[1]!;
        const event = ledgerStore.getById(eventId);
        if (!event) {
          return errorResponse("Event not found", 404);
        }
        return jsonResponse(event);
      }

      return errorResponse("Not found", 404);
    },
  });

  logger.info("API server started", { port });
  return server;
}
