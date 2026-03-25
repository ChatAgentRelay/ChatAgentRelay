import type { LedgerStore, StoredCanonicalEvent } from "@cap/event-ledger";
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

type AuditTurn = {
  correlation_id: string;
  user_message: string;
  policy_decision: string;
  route: string;
  agent_response: string;
  blocked: boolean;
  block_reason?: string;
  block_stage?: string;
  events: StoredCanonicalEvent[];
};

function buildAuditExplanation(conversationId: string, events: StoredCanonicalEvent[]) {
  const correlations = new Map<string, StoredCanonicalEvent[]>();
  for (const event of events) {
    const cid = event.correlation_id;
    const existing = correlations.get(cid);
    if (existing) {
      existing.push(event);
    } else {
      correlations.set(cid, [event]);
    }
  }

  const turns: AuditTurn[] = [];
  for (const [correlationId, chainEvents] of correlations) {
    const msgReceived = chainEvents.find((e) => e.event_type === "message.received");
    const policy = chainEvents.find((e) => e.event_type === "policy.decision.made");
    const route = chainEvents.find((e) => e.event_type === "route.decision.made");
    const agentResp = chainEvents.find((e) => e.event_type === "agent.response.completed");
    const blocked = chainEvents.find((e) => e.event_type === "event.blocked");

    turns.push({
      correlation_id: correlationId,
      user_message: (msgReceived?.payload["text"] as string) ?? "",
      policy_decision: (policy?.payload["decision"] as string) ?? "unknown",
      route: (route?.payload["route"] as string) ?? "",
      agent_response: (agentResp?.payload["text"] as string) ?? "",
      blocked: blocked !== undefined,
      ...(blocked ? {
        block_reason: blocked.payload["reason"] as string,
        block_stage: blocked.payload["block_stage"] as string,
      } : {}),
      events: chainEvents,
    });
  }

  return {
    conversation_id: conversationId,
    total_events: events.length,
    turns,
  };
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

      const auditMatch = path.match(/^\/api\/conversations\/([^/]+)\/audit$/);
      if (auditMatch) {
        const conversationId = auditMatch[1]!;
        const events = ledgerStore.getByConversationId(conversationId);
        if (events.length === 0) {
          return errorResponse("No events found for conversation", 404);
        }
        return jsonResponse(buildAuditExplanation(conversationId, events));
      }

      return errorResponse("Not found", 404);
    },
  });

  logger.info("API server started", { port });
  return server;
}
