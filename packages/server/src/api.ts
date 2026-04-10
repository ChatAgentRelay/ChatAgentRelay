import { SessionStore as WebChatSessionStore } from "@chat-agent-relay/channel-web-chat";
import type {
  WebChatPipelineResult,
  WebChatStreamEvent,
} from "@chat-agent-relay/channel-web-chat";
import type { ConfigStore } from "@chat-agent-relay/config-store";
import { SENSITIVE_FIELDS } from "@chat-agent-relay/config-store";
import type { ChannelType } from "@chat-agent-relay/config-store";
import type { RouteEngine } from "@chat-agent-relay/config-store";
import type { LedgerStore, StoredCanonicalEvent, TenantScope } from "@chat-agent-relay/event-ledger";
import type { AgentRegistry } from "./agent-registry";
import type { ChannelAdapter } from "@chat-agent-relay/contract-harness";
import type { ChannelConnection, ChannelRegistry } from "./channel-registry";
import { logger } from "./logger";

export type ApiConfig = {
  port: number;
  ledgerStore: LedgerStore;
  configDb: ConfigStore;
  agentRegistry: AgentRegistry;
  channelRegistry: ChannelRegistry;
  routeEngine?: RouteEngine;
  webChatSessions?: WebChatSessionStore;
  apiKey?: string | undefined;
  chatPublic?: boolean | undefined;
  tenantIsolation?: boolean | undefined;
  onConfigChanged?: ((key: string, value: string) => void) | undefined;
  runWebChatPipeline?: (
    channelName: string,
    adapter: ChannelAdapter,
    raw: unknown,
    onStreamEvent?: (event: WebChatStreamEvent) => void,
  ) => Promise<WebChatPipelineResult>;
  resumeWebChat?: (
    sessionHandle: string,
    text: string,
    onStreamEvent?: (event: WebChatStreamEvent) => void,
  ) => Promise<WebChatPipelineResult>;
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

function sseResponse(
  handler: (send: (event: WebChatStreamEvent) => void, close: () => void) => void,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: WebChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream closed */ }
      };
      const close = () => {
        try { controller.close(); } catch { /* already closed */ }
      };
      handler(send, close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

const WEBCHAT_COMMANDS: Record<string, (sessions: WebChatSessionStore, convId?: string) => Record<string, unknown>> = {
  "/help": () => ({
    ok: true,
    reply: "Available commands:\n  /help — Show this help\n  /status — Session info\n  /clear — Clear session",
  }),
  "/status": (s) => ({ ok: true, reply: `Active sessions: ${s.size}` }),
  "/clear": (s, c) => { if (c) s.remove(c); return { ok: true, reply: "Session cleared." }; },
};

function resolveWebChat(registry: ChannelRegistry): { adapter: ChannelAdapter | null; channelName: string } {
  for (const name of registry.list()) {
    const ch = registry.get(name);
    if (ch && ch.type === "webchat") {
      return { adapter: ch.adapter, channelName: name };
    }
  }
  return { adapter: null, channelName: "" };
}

function resolveChannelByType(registry: ChannelRegistry, type: string): ChannelConnection | undefined {
  for (const name of registry.list()) {
    const channel = registry.get(name);
    if (channel?.type === type) return channel;
  }
  return undefined;
}

async function verifyWebhookRequest(
  req: globalThis.Request,
  verify: ((request: globalThis.Request) => Promise<boolean>) | undefined,
): Promise<{ ok: true; request: globalThis.Request } | { ok: false; response: Response }> {
  if (!verify) {
    return { ok: true, request: req };
  }

  const verified = await verify(req.clone() as unknown as globalThis.Request);
  if (!verified) {
    return { ok: false, response: errorResponse("Unauthorized webhook request", 401) };
  }

  return { ok: true, request: req };
}

export function startApiServer(config: ApiConfig): ReturnType<typeof Bun.serve> {
  const { ledgerStore, configDb, agentRegistry, channelRegistry, port } = config;
  const routeEngine = config.routeEngine;
  const webChatSessions = config.webChatSessions ?? new WebChatSessionStore();
  const runWebChat = config.runWebChatPipeline;
  const resumeWebChat = config.resumeWebChat;
  const apiKey = config.apiKey;
  const chatPublic = config.chatPublic ?? true;
  const tenantIsolation = config.tenantIsolation ?? false;
  const onConfigChanged = config.onConfigChanged;

  if (apiKey) {
    logger.info("API authentication enabled");
  } else {
    logger.warn("API authentication disabled \u2014 set CAR_API_KEY or api.key to secure the API");
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      try {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── Auth middleware ───────────────────────────────────────────
      if (apiKey) {
        const isPublicPath =
          path === "/api/health" ||
          (method === "OPTIONS" && path.startsWith("/api/chat")) ||
          (chatPublic && path.startsWith("/api/chat"));

        if (!isPublicPath) {
          const authHeader = req.headers.get("Authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
          if (token !== apiKey) {
            return errorResponse("Unauthorized", 401);
          }
        }
      }

      // ── Tenant scope ────────────────────────────────────────────────
      let tenantScope: TenantScope | undefined;
      if (tenantIsolation) {
        const tenantHeader = req.headers.get("X-Tenant-ID");
        if (tenantHeader) {
          tenantScope = { tenantId: tenantHeader };
        }
      }

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
          const record = await configDb.addAgent(name as string, type as "a2a", (agentConfig ?? {}) as Record<string, unknown>);
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
        const validChannelTypes = ["slack", "discord", "webchat", "telegram", "lark", "dingtalk", "teams", "whatsapp"];
        if (!validChannelTypes.includes(type as string)) {
          return errorResponse(`Invalid channel type. Valid: ${validChannelTypes.join(", ")}`, 400);
        }
        try {
          const record = await configDb.addChannel(name as string, type as ChannelType, (channelConfig ?? {}) as Record<string, unknown>);
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
          if (routeEngine) routeEngine.load(configDb.listRoutes());
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
        if (routeEngine) routeEngine.load(configDb.listRoutes());
        return jsonResponse({ ok: true });
      }

      const routeEnableMatch = path.match(/^\/api\/routes\/(\d+)\/enable$/);
      if (routeEnableMatch && method === "POST") {
        const id = Number(routeEnableMatch[1]);
        const updated = configDb.updateRouteEnabled(id, true);
        if (!updated) return errorResponse("Route not found", 404);
        const route = configDb.listRoutes().find((candidate) => candidate.id === id);
        if (!route) return errorResponse("Route not found", 404);
        if (routeEngine) routeEngine.load(configDb.listRoutes());
        return jsonResponse(route);
      }

      const routeDisableMatch = path.match(/^\/api\/routes\/(\d+)\/disable$/);
      if (routeDisableMatch && method === "POST") {
        const id = Number(routeDisableMatch[1]);
        const updated = configDb.updateRouteEnabled(id, false);
        if (!updated) return errorResponse("Route not found", 404);
        const route = configDb.listRoutes().find((candidate) => candidate.id === id);
        if (!route) return errorResponse("Route not found", 404);
        if (routeEngine) routeEngine.load(configDb.listRoutes());
        return jsonResponse(route);
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
        if ((key === "policy.config" || key === "policy.outbound.config") && onConfigChanged) {
          onConfigChanged(key, value);
        }
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
        const events = ledgerStore.getByConversationId(conversationId, tenantScope);
        return jsonResponse({ conversation_id: conversationId, events, count: events.length });
      }

      const correlationMatch = path.match(/^\/api\/correlations\/([^/]+)\/events$/);
      if (correlationMatch) {
        const correlationId = correlationMatch[1]!;
        const events = ledgerStore.getByCorrelationId(correlationId, tenantScope);
        return jsonResponse({ correlation_id: correlationId, events, count: events.length });
      }

      const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
      if (eventMatch) {
        const eventId = eventMatch[1]!;
        const event = ledgerStore.getById(eventId, tenantScope);
        if (!event) {
          return errorResponse("Event not found", 404);
        }
        return jsonResponse(event);
      }

      const auditMatch = path.match(/^\/api\/conversations\/([^/]+)\/audit$/);
      if (auditMatch) {
        const conversationId = auditMatch[1]!;
        const events = ledgerStore.getByConversationId(conversationId, tenantScope);
        if (events.length === 0) {
          return errorResponse("No events found for conversation", 404);
        }
        return jsonResponse(buildAuditExplanation(conversationId, events));
      }

      const slackWebhookPath = path === "/api/slack/events" || path === "/api/slack/commands";
      if (slackWebhookPath && method === "POST") {
        const slackChannel = resolveChannelByType(channelRegistry, "slack");
        if (!slackChannel) return errorResponse("No enabled slack channel", 404);

        const signingSecret = await configDb.getChannel(slackChannel.name)
          .then((record) => typeof record?.config["signingSecret"] === "string" ? record.config["signingSecret"] : undefined);
        const verification = await verifyWebhookRequest(
          req,
          signingSecret ? async (request) => {
            const { SlackWebhookVerifier } = await import("@chat-agent-relay/channel-slack");
            return new SlackWebhookVerifier(signingSecret).verify(request);
          } : undefined,
        );
        if (!verification.ok) return verification.response;

        let rawEvent: unknown;
        const contentType = req.headers.get("content-type") ?? "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const body = await req.text();
          const params = new URLSearchParams(body);
          rawEvent = Object.fromEntries(params.entries());
        } else {
          rawEvent = await readJsonBody(req);
        }

        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await slackChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      if (path === "/api/teams/messages" && method === "POST") {
        const teamsChannel = resolveChannelByType(channelRegistry, "teams");
        if (!teamsChannel) return errorResponse("No enabled teams channel", 404);

        const teamsConfig = await configDb.getChannel(teamsChannel.name);
        const appId = typeof teamsConfig?.config["appId"] === "string" ? teamsConfig.config["appId"] : undefined;
        if (!appId) return errorResponse("Teams appId is not configured", 500);

        const verification = await verifyWebhookRequest(
          req,
          async (request) => {
            const { TeamsWebhookVerifier } = await import("@chat-agent-relay/channel-teams");
            return new TeamsWebhookVerifier(appId).verify(request);
          },
        );
        if (!verification.ok) return verification.response;

        const rawEvent = await readJsonBody(req);
        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await teamsChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      if (path === "/api/telegram/webhook" && method === "POST") {
        const telegramChannel = resolveChannelByType(channelRegistry, "telegram");
        if (!telegramChannel) return errorResponse("No enabled telegram channel", 404);

        const telegramConfig = await configDb.getChannel(telegramChannel.name);
        const secretToken = typeof telegramConfig?.config["secretToken"] === "string"
          ? telegramConfig.config["secretToken"]
          : undefined;

        const verification = await verifyWebhookRequest(
          req,
          secretToken ? async (request) => {
            const { TelegramWebhookVerifier } = await import("@chat-agent-relay/channel-telegram");
            return new TelegramWebhookVerifier(secretToken).verify(request);
          } : undefined,
        );
        if (!verification.ok) return verification.response;

        const rawEvent = await readJsonBody(req);
        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await telegramChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      if (path === "/api/lark/webhook" && method === "POST") {
        const larkChannel = resolveChannelByType(channelRegistry, "lark");
        if (!larkChannel) return errorResponse("No enabled lark channel", 404);

        const larkConfig = await configDb.getChannel(larkChannel.name);
        const encryptKey = typeof larkConfig?.config["encryptKey"] === "string"
          ? larkConfig.config["encryptKey"]
          : undefined;

        const verification = await verifyWebhookRequest(
          req,
          encryptKey ? async (request) => {
            const { LarkWebhookVerifier } = await import("@chat-agent-relay/channel-lark");
            return new LarkWebhookVerifier(encryptKey).verify(request);
          } : undefined,
        );
        if (!verification.ok) return verification.response;

        const rawEvent = await readJsonBody(req);
        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await larkChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      if (path === "/api/dingtalk/webhook" && method === "POST") {
        const dingtalkChannel = resolveChannelByType(channelRegistry, "dingtalk");
        if (!dingtalkChannel) return errorResponse("No enabled dingtalk channel", 404);

        const dingtalkConfig = await configDb.getChannel(dingtalkChannel.name);
        const secret = typeof dingtalkConfig?.config["secret"] === "string"
          ? dingtalkConfig.config["secret"]
          : undefined;

        const verification = await verifyWebhookRequest(
          req,
          secret ? async (request) => {
            const { DingTalkWebhookVerifier } = await import("@chat-agent-relay/channel-dingtalk");
            return new DingTalkWebhookVerifier(secret).verify(request);
          } : undefined,
        );
        if (!verification.ok) return verification.response;

        const rawEvent = await readJsonBody(req);
        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await dingtalkChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      if (path === "/api/whatsapp/webhook" && method === "GET") {
        const whatsappChannel = resolveChannelByType(channelRegistry, "whatsapp");
        if (!whatsappChannel) return errorResponse("No enabled whatsapp channel", 404);

        const whatsappConfig = await configDb.getChannel(whatsappChannel.name);
        const verifyToken = typeof whatsappConfig?.config["verifyToken"] === "string"
          ? whatsappConfig.config["verifyToken"]
          : undefined;

        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      }

      if (path === "/api/whatsapp/webhook" && method === "POST") {
        const whatsappChannel = resolveChannelByType(channelRegistry, "whatsapp");
        if (!whatsappChannel) return errorResponse("No enabled whatsapp channel", 404);

        const whatsappConfig = await configDb.getChannel(whatsappChannel.name);
        const appSecret = typeof whatsappConfig?.config["appSecret"] === "string"
          ? whatsappConfig.config["appSecret"]
          : undefined;

        const verification = await verifyWebhookRequest(
          req,
          appSecret ? async (request) => {
            const { WhatsAppWebhookVerifier } = await import("@chat-agent-relay/channel-whatsapp");
            return new WhatsAppWebhookVerifier(appSecret).verify(request);
          } : undefined,
        );
        if (!verification.ok) return verification.response;

        const rawEvent = await readJsonBody(req);
        if (!rawEvent) return errorResponse("Invalid webhook body", 400);
        await whatsappChannel.onMessage(rawEvent);
        return jsonResponse({ ok: true });
      }

      // ── WebChat endpoints ──────────────────────────────────────────

      if (method === "OPTIONS" && path.startsWith("/api/chat")) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (path === "/api/chat" && method === "POST") {
        if (!runWebChat) return errorResponse("WebChat not configured", 501);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);

        const text = (body["text"] as string) ?? "";
        const cmd = text.startsWith("/") ? text.split(" ")[0]!.toLowerCase() : null;
        if (cmd && WEBCHAT_COMMANDS[cmd]) {
          return jsonResponse(WEBCHAT_COMMANDS[cmd]!(webChatSessions, body["conversation_id"] as string));
        }

        const { adapter, channelName } = resolveWebChat(channelRegistry);
        if (!adapter) return errorResponse("No enabled webchat channel", 404);

        try {
          const result = await runWebChat(channelName, adapter, body);
          return jsonResponse({
            ok: true,
            conversation_id: result.conversationId,
            correlation_id: result.correlationId,
            reply: result.reply,
            session_handle: result.sessionHandle,
            hitl_pending: result.hitlPending,
            hitl_prompt: result.hitlPrompt,
          });
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : "Pipeline failed", 500);
        }
      }

      if (path === "/api/chat/stream" && method === "POST") {
        if (!runWebChat) return errorResponse("WebChat not configured", 501);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);

        const text = (body["text"] as string) ?? "";
        const cmd = text.startsWith("/") ? text.split(" ")[0]!.toLowerCase() : null;
        if (cmd && WEBCHAT_COMMANDS[cmd]) {
          return jsonResponse(WEBCHAT_COMMANDS[cmd]!(webChatSessions, body["conversation_id"] as string));
        }

        const { adapter, channelName } = resolveWebChat(channelRegistry);
        if (!adapter) return errorResponse("No enabled webchat channel", 404);

        return sseResponse((send, close) => {
          runWebChat(channelName, adapter, body, send)
            .then((result) => {
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
        });
      }

      if (path === "/api/chat/resume" && method === "POST") {
        if (!resumeWebChat) return errorResponse("Resume not configured", 501);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const sh = body["session_handle"] as string;
        const text = body["text"] as string;
        if (!sh || !text) return errorResponse("session_handle and text are required", 400);

        try {
          const result = await resumeWebChat(sh, text);
          return jsonResponse({
            ok: true,
            conversation_id: result.conversationId,
            correlation_id: result.correlationId,
            reply: result.reply,
            session_handle: result.sessionHandle,
          });
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : "Resume failed", 500);
        }
      }

      if (path === "/api/chat/resume/stream" && method === "POST") {
        if (!resumeWebChat) return errorResponse("Resume not configured", 501);
        const body = await readJsonBody(req);
        if (!body) return errorResponse("Invalid JSON body", 400);
        const sh = body["session_handle"] as string;
        const text = body["text"] as string;
        if (!sh || !text) return errorResponse("session_handle and text are required", 400);

        return sseResponse((send, close) => {
          resumeWebChat(sh, text, send)
            .then((result) => {
              send({
                type: "done",
                conversation_id: result.conversationId,
                correlation_id: result.correlationId,
                reply: result.reply,
                ...(result.sessionHandle !== undefined ? { session_handle: result.sessionHandle } : {}),
              });
              close();
            })
            .catch((error) => {
              send({ type: "error", message: error instanceof Error ? error.message : "Resume failed" });
              close();
            });
        });
      }

      const chatSessionMatch = path.match(/^\/api\/chat\/sessions\/(.+)$/);
      if (chatSessionMatch && method === "GET") {
        const convId = decodeURIComponent(chatSessionMatch[1]!);
        const info = webChatSessions.info(convId);
        if (!info) return errorResponse("Session not found", 404);
        return jsonResponse({
          ok: true,
          conversation_id: convId,
          session_handle: info.sessionHandle,
          last_active: new Date(info.lastActive).toISOString(),
        });
      }

      return errorResponse("Not found", 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Unhandled API error", { error_message: msg });
      const isDecryptionError = msg.includes("CAR_ENCRYPTION_KEY") || msg.includes("Decryption failed");
      return errorResponse(
        isDecryptionError ? `Config error: ${msg}` : "Internal server error",
        500,
      );
    }
    },
  });

  logger.info("API server started", { port });
  return server;
}
