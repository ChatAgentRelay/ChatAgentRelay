import type { ConfigStore } from "@chat-agent-relay/config-store";
import { SENSITIVE_FIELDS } from "@chat-agent-relay/config-store";
import type { LedgerStore, StoredCanonicalEvent } from "@chat-agent-relay/event-ledger";
import type { AgentRegistry } from "./agent-registry";
import type { ChannelRegistry } from "./channel-registry";
import { logger } from "./logger";

export type ApiConfig = {
  port: number;
  ledgerStore: LedgerStore;
  configDb: ConfigStore;
  agentRegistry: AgentRegistry;
  channelRegistry: ChannelRegistry;
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

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maskValue(value: unknown): string {
  if (typeof value !== "string") return "***";
  if (value.length <= 6) return "***";
  return value.slice(0, 4) + "...***";
}

function maskConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS[type] ?? [];
  if (fields.length === 0) return config;
  const masked = { ...config };
  for (const field of fields) {
    if (field in masked) {
      masked[field] = maskValue(masked[field]);
    }
  }
  return masked;
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
      ...(blocked
        ? {
            block_reason: blocked.payload["reason"] as string,
            block_stage: blocked.payload["block_stage"] as string,
          }
        : {}),
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
  const { ledgerStore, configDb, agentRegistry, channelRegistry, port } = config;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── Health ──────────────────────────────────────────────────────
      if (path === "/api/health") {
        const ledgerHealth = ledgerStore.healthCheck();
        const status = ledgerHealth.healthy ? "ok" : "degraded";
        return jsonResponse(
          {
            status,
            timestamp: new Date().toISOString(),
            ledger: ledgerHealth,
            uptime_seconds: Math.floor(process.uptime()),
          },
          ledgerHealth.healthy ? 200 : 503,
        );
      }

      // ── Agents CRUD ────────────────────────────────────────────────
      if (path === "/api/agents" && method === "GET") {
        const agents = await configDb.listAgents();
        return jsonResponse(agents.map((a) => ({ ...a, config: maskConfig(a.type, a.config) })));
      }

      if (path === "/api/agents" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const { name, type, config: agentConfig } = body;
        if (typeof name !== "string" || !name) return errorResponse("name is required", 400);
        if (typeof type !== "string" || !type) return errorResponse("type is required", 400);
        try {
          const record = await configDb.addAgent(name as string, type as "a2a" | "langgraph" | "acp" | "http", (agentConfig ?? {}) as Record<string, unknown>);
          await agentRegistry.register(record);
          return jsonResponse(
            { ...record, config: maskConfig(record.type, record.config) },
            201,
          );
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err), 409);
        }
      }

      const agentNameMatch = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agentNameMatch && method === "PUT") {
        const name = decodeURIComponent(agentNameMatch[1]!);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const updates: { config?: Record<string, unknown>; enabled?: boolean } = {};
        if (body["config"] !== undefined) updates.config = body["config"] as Record<string, unknown>;
        if (body["enabled"] !== undefined) updates.enabled = Boolean(body["enabled"]);
        const updated = await configDb.updateAgent(name, updates);
        if (!updated) return errorResponse("Agent not found", 404);
        await agentRegistry.register(updated);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      if (agentNameMatch && method === "DELETE") {
        const name = decodeURIComponent(agentNameMatch[1]!);
        const removed = configDb.removeAgent(name);
        if (!removed) return errorResponse("Agent not found", 404);
        await agentRegistry.unregister(name);
        return jsonResponse({ ok: true });
      }

      const agentEnableMatch = path.match(/^\/api\/agents\/([^/]+)\/enable$/);
      if (agentEnableMatch && method === "POST") {
        const name = decodeURIComponent(agentEnableMatch[1]!);
        const updated = await configDb.updateAgent(name, { enabled: true });
        if (!updated) return errorResponse("Agent not found", 404);
        await agentRegistry.register(updated);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      const agentDisableMatch = path.match(/^\/api\/agents\/([^/]+)\/disable$/);
      if (agentDisableMatch && method === "POST") {
        const name = decodeURIComponent(agentDisableMatch[1]!);
        const updated = await configDb.updateAgent(name, { enabled: false });
        if (!updated) return errorResponse("Agent not found", 404);
        await agentRegistry.unregister(name);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      // ── Channels CRUD ──────────────────────────────────────────────
      if (path === "/api/channels" && method === "GET") {
        const channels = await configDb.listChannels();
        return jsonResponse(channels.map((c) => ({ ...c, config: maskConfig(c.type, c.config) })));
      }

      if (path === "/api/channels" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const { name, type, config: channelConfig } = body;
        if (typeof name !== "string" || !name) return errorResponse("name is required", 400);
        if (typeof type !== "string" || !type) return errorResponse("type is required", 400);
        try {
          const record = await configDb.addChannel(name as string, type as "slack" | "discord" | "webchat", (channelConfig ?? {}) as Record<string, unknown>);
          await channelRegistry.register(record);
          return jsonResponse(
            { ...record, config: maskConfig(record.type, record.config) },
            201,
          );
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err), 409);
        }
      }

      const channelNameMatch = path.match(/^\/api\/channels\/([^/]+)$/);
      if (channelNameMatch && method === "PUT") {
        const name = decodeURIComponent(channelNameMatch[1]!);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const updates: { config?: Record<string, unknown>; enabled?: boolean } = {};
        if (body["config"] !== undefined) updates.config = body["config"] as Record<string, unknown>;
        if (body["enabled"] !== undefined) updates.enabled = Boolean(body["enabled"]);
        const updated = await configDb.updateChannel(name, updates);
        if (!updated) return errorResponse("Channel not found", 404);
        await channelRegistry.register(updated);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      if (channelNameMatch && method === "DELETE") {
        const name = decodeURIComponent(channelNameMatch[1]!);
        const removed = configDb.removeChannel(name);
        if (!removed) return errorResponse("Channel not found", 404);
        await channelRegistry.unregister(name);
        return jsonResponse({ ok: true });
      }

      const channelEnableMatch = path.match(/^\/api\/channels\/([^/]+)\/enable$/);
      if (channelEnableMatch && method === "POST") {
        const name = decodeURIComponent(channelEnableMatch[1]!);
        const updated = await configDb.updateChannel(name, { enabled: true });
        if (!updated) return errorResponse("Channel not found", 404);
        await channelRegistry.register(updated);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      const channelDisableMatch = path.match(/^\/api\/channels\/([^/]+)\/disable$/);
      if (channelDisableMatch && method === "POST") {
        const name = decodeURIComponent(channelDisableMatch[1]!);
        const updated = await configDb.updateChannel(name, { enabled: false });
        if (!updated) return errorResponse("Channel not found", 404);
        await channelRegistry.unregister(name);
        return jsonResponse({ ...updated, config: maskConfig(updated.type, updated.config) });
      }

      // ── Routes CRUD ────────────────────────────────────────────────
      if (path === "/api/routes" && method === "GET") {
        const routes = configDb.listRoutes();
        return jsonResponse(routes);
      }

      if (path === "/api/routes" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const { match_type, match_value, agent_name, priority } = body;
        if (typeof match_type !== "string") return errorResponse("match_type is required", 400);
        if (typeof agent_name !== "string") return errorResponse("agent_name is required", 400);
        try {
          const route = configDb.addRoute(
            match_type as "channel" | "pattern" | "default",
            (match_value as string | null) ?? null,
            agent_name as string,
            typeof priority === "number" ? priority : 0,
          );
          return jsonResponse(route, 201);
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : String(err), 409);
        }
      }

      const routeIdMatch = path.match(/^\/api\/routes\/(\d+)$/);
      if (routeIdMatch && method === "DELETE") {
        const id = Number(routeIdMatch[1]);
        const removed = configDb.removeRoute(id);
        if (!removed) return errorResponse("Route not found", 404);
        return jsonResponse({ ok: true });
      }

      // ── Config/Settings CRUD ───────────────────────────────────────
      if (path === "/api/config" && method === "GET") {
        const settings = configDb.listSettings();
        return jsonResponse(settings);
      }

      const configKeyMatch = path.match(/^\/api\/config\/([^/]+)$/);
      if (configKeyMatch && method === "PUT") {
        const key = decodeURIComponent(configKeyMatch[1]!);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const { value } = body;
        if (typeof value !== "string") return errorResponse("value (string) is required", 400);
        configDb.setSetting(key, value as string);
        return jsonResponse({ key, value });
      }

      if (configKeyMatch && method === "DELETE") {
        const key = decodeURIComponent(configKeyMatch[1]!);
        const removed = configDb.deleteSetting(key);
        if (!removed) return errorResponse("Setting not found", 404);
        return jsonResponse({ ok: true });
      }

      // ── Ledger query endpoints (existing) ──────────────────────────
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
