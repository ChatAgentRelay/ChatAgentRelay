import { watchFile, unwatchFile, type Stats } from "node:fs";
import type { AgentAdapter, AgentEvent, CanonicalEvent, ChannelAdapter, ChannelSender } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DeliveryOrchestrator } from "@chat-agent-relay/delivery";
import { buildWebChatStreaming, SessionStore as WebChatSessionStore } from "@chat-agent-relay/channel-web-chat";
import type { WebChatPipelineResult, WebChatStreamEvent } from "@chat-agent-relay/channel-web-chat";
import { SqliteConfigStore, RouteEngine } from "@chat-agent-relay/config-store";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import { createPolicyFn, IdempotencyStore, loadPolicyWithOverride, RateLimiter, type AccessControlConfig, type RateLimitScope } from "@chat-agent-relay/middleware";
import { FirstExecutablePathPipeline } from "@chat-agent-relay/pipeline";
import type { PipelineConfig } from "@chat-agent-relay/pipeline";
import type { StreamingOptions } from "@chat-agent-relay/pipeline";
import { createA2AFactory } from "./agent-factories";
import { AgentRegistry } from "./agent-registry";
import { startApiServer } from "./api";
import { createSlackFactory, createDiscordFactory, createWebChatFactory, createTelegramFactory, createLarkFactory, createDingTalkFactory, createTeamsFactory, createWhatsAppFactory } from "./channel-factories";
import { ChannelRegistry } from "./channel-registry";
import { logger } from "./logger";

const DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_PENDING_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

type PendingSession = {
  sessionHandle: string;
  agentName: string;
  createdAt: number;
  timeoutMs: number;
  inputRequestedEventId?: string | undefined;
};

export type PolicyFileWatcherOptions = {
  inboundPath?: string | undefined;
  outboundPath?: string | undefined;
  reloadPolicyConfig: (key: "policy.config" | "policy.outbound.config") => void;
  watchFileImpl?: typeof watchFile;
  unwatchFileImpl?: typeof unwatchFile;
};

function deriveEvent(
  source: CanonicalEvent,
  causationId: string,
  eventType: string,
  actorType: string,
  payload: Record<string, unknown>,
): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: eventType,
    tenant_id: source.tenant_id,
    workspace_id: source.workspace_id,
    channel: source.channel,
    channel_instance_id: source.channel_instance_id ?? source.channel,
    conversation_id: source.conversation_id,
    session_id: source.session_id,
    correlation_id: source.correlation_id,
    causation_id: causationId,
    occurred_at: new Date().toISOString(),
    actor_type: actorType,
    payload,
  };
}

export function setupPolicyFileWatchers(options: PolicyFileWatcherOptions): Array<() => void> {
  const watchStops: Array<() => void> = [];
  const watchFileImpl = options.watchFileImpl ?? watchFile;
  const unwatchFileImpl = options.unwatchFileImpl ?? unwatchFile;

  function register(key: "policy.config" | "policy.outbound.config", filePath: string): void {
    let lastSignature = "";
    const listener = (curr: Stats, prev: Stats) => {
      const changed = curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size || (!prev.isFile() && curr.isFile());
      if (!changed) {
        return;
      }

      const signature = `${curr.mtimeMs}:${curr.size}:${curr.ino}`;
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      logger.info("Policy file change detected", { key, file_path: filePath });
      options.reloadPolicyConfig(key);
    };

    watchFileImpl(filePath, { interval: 100 }, listener);
    watchStops.push(() => unwatchFileImpl(filePath, listener));
    logger.info("Watching policy file", { key, file_path: filePath });
  }

  if (options.inboundPath) {
    register("policy.config", options.inboundPath);
  }
  if (options.outboundPath) {
    register("policy.outbound.config", options.outboundPath);
  }

  return watchStops;
}

export async function main() {
  const dbPath = process.env["CAR_DB_PATH"] ?? "./car.db";
  const encKey = process.env["CAR_ENCRYPTION_KEY"];

  const configDb = new SqliteConfigStore(dbPath, encKey);

  const apiPort = Number(
    process.env["CAR_API_PORT"]
    ?? configDb.getSetting("api.port")
    ?? "3000"
  );
  const streamingEnabled = configDb.getSetting("streaming.enabled") !== "false";
  const streamingIntervalMs = Number(configDb.getSetting("streaming.interval_ms") ?? "800");

  const ledgerPath = configDb.getSetting("ledger.path") ?? `${dbPath.replace(/\.db$/, "")}-ledger.db`;
  const ledgerStore = new SqliteLedgerStore(ledgerPath);
  const validators = await ContractHarnessValidators.getShared();
  const delivery = await DeliveryOrchestrator.create();

  const runtimePolicies: {
    inbound?: PipelineConfig["policyFn"];
    outbound?: PipelineConfig["outboundPolicyFn"];
  } = {};
  const policyWatchStops: Array<() => void> = [];

  function resolvePolicyConfig(key: "policy.config" | "policy.outbound.config", value?: string) {
    const envKey = key === "policy.outbound.config" ? "CAR_OUTBOUND_POLICY_FILE" : "CAR_POLICY_FILE";
    return loadPolicyWithOverride(process.env[envKey], value);
  }

  function reloadPolicyConfig(key: string, value?: string): void {
    const isOutbound = key === "policy.outbound.config";
    try {
      const policyConfig = resolvePolicyConfig(
        isOutbound ? "policy.outbound.config" : "policy.config",
        value,
      );
      const policyFn = policyConfig.rules.length > 0
        ? createPolicyFn(policyConfig) as PipelineConfig["policyFn"]
        : undefined;

      if (isOutbound) {
        runtimePolicies.outbound = policyFn as PipelineConfig["outboundPolicyFn"];
        logger.info("Outbound policy engine loaded", { rule_count: policyConfig.rules.length, source: process.env["CAR_OUTBOUND_POLICY_FILE"] ? "file" : "config" });
      } else {
        runtimePolicies.inbound = policyFn as PipelineConfig["policyFn"];
        logger.info("Policy engine loaded", { rule_count: policyConfig.rules.length, source: process.env["CAR_POLICY_FILE"] ? "file" : "config" });
      }
    } catch (error) {
      logger.error("Failed to reload policy config; preserving previous policy", {
        key,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }


  reloadPolicyConfig("policy.config", configDb.getSetting("policy.config"));
  reloadPolicyConfig("policy.outbound.config", configDb.getSetting("policy.outbound.config"));

  policyWatchStops.push(...setupPolicyFileWatchers({
    inboundPath: process.env["CAR_POLICY_FILE"],
    outboundPath: process.env["CAR_OUTBOUND_POLICY_FILE"],
    reloadPolicyConfig,
  }));

  const accessControlMode = configDb.getSetting("access_control.mode");
  const accessControlSenders = configDb.getSetting("access_control.senders");
  let accessControl: AccessControlConfig | undefined;
  if ((accessControlMode === "allowlist" || accessControlMode === "blocklist") && accessControlSenders) {
    try {
      const parsed = JSON.parse(accessControlSenders);
      if (Array.isArray(parsed)) {
        const senders = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
        if (senders.length > 0) {
          accessControl = { mode: accessControlMode, senders };
          logger.info("Access control loaded", { mode: accessControl.mode, sender_count: accessControl.senders.length });
        }
      }
    } catch (error) {
      logger.warn("Ignoring invalid access control config", {
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rateLimitMax = configDb.getSetting("rate_limit.max_per_minute");
  const rateLimitScope = configDb.getSetting("rate_limit.scope");
  let rateLimiter: RateLimiter | undefined;
  if (rateLimitMax && (rateLimitScope === "sender" || rateLimitScope === "conversation" || rateLimitScope === "tenant")) {
    const maxPerMinute = Number(rateLimitMax);
    if (Number.isFinite(maxPerMinute) && maxPerMinute > 0) {
      rateLimiter = new RateLimiter({
        maxPerMinute,
        scope: rateLimitScope as RateLimitScope,
      });
      logger.info("Rate limiter loaded", { max_per_minute: maxPerMinute, scope: rateLimitScope });
    }
  }

  const routeEngine = new RouteEngine();
  routeEngine.load(configDb.listRoutes());

  const agentRegistry = new AgentRegistry();
  agentRegistry.registerFactory("a2a", createA2AFactory());
  for (const agent of await configDb.listAgents()) {
    await agentRegistry.register(agent);
  }

  let inflightCount = 0;
  let shuttingDown = false;
  let drainResolve: (() => void) | undefined;
  const pendingSessions = new Map<string, PendingSession>();
  const pendingSessionTimeoutMs = Number(
    configDb.getSetting("hitl.pending.timeout_ms") ?? String(DEFAULT_PENDING_SESSION_TIMEOUT_MS),
  );
  const idempotencyTtlMs = Number(configDb.getSetting("idempotency.ttl_ms") ?? "300000");
  const idempotencyStore = new IdempotencyStore(
    Number.isFinite(idempotencyTtlMs) && idempotencyTtlMs > 0 ? idempotencyTtlMs : 300_000,
  );

  function trackInflight<T>(fn: () => Promise<T>): Promise<T> {
    if (shuttingDown) {
      logger.warn("Rejecting new request during shutdown");
      return Promise.reject(new Error("Server is shutting down"));
    }
    inflightCount++;
    return fn().finally(() => {
      inflightCount--;
      if (shuttingDown && inflightCount === 0 && drainResolve) {
        drainResolve();
      }
    });
  }

  async function drainInflight(): Promise<void> {
    if (inflightCount === 0) return;
    logger.info("Draining inflight requests", { inflight_count: inflightCount });
    return new Promise<void>((resolve) => {
      drainResolve = resolve;
      setTimeout(() => {
        if (inflightCount > 0) {
          logger.warn("Drain timeout reached, forcing shutdown", { remaining: inflightCount });
        }
        resolve();
      }, DRAIN_TIMEOUT_MS);
    });
  }

  async function runPipeline(
    adapter: ChannelAdapter,
    pipelineInput: unknown,
    streamingOverride?: StreamingOptions,
  ) {
    const startTime = Date.now();
    try {
      const pipeline = await FirstExecutablePathPipeline.create({
        resolveAgent: (name) => agentRegistry.get(name),
        routeFn: (chName, text) => routeEngine.resolve({ channelName: chName, messageText: text }),
        ...(runtimePolicies.inbound ? { policyFn: runtimePolicies.inbound } : {}),
        ...(runtimePolicies.outbound ? { outboundPolicyFn: runtimePolicies.outbound } : {}),
        ...(accessControl ? { accessControl } : {}),
        ...(rateLimiter ? { rateLimiter } : {}),
        channel: adapter,
        ledgerStore,
        streamingEnabled,
        streamingIntervalMs,
        ...(streamingOverride ? { streamingOverride } : {}),
      });

      const result = await pipeline.execute(pipelineInput);
      const correlationId = result.events[0]?.correlation_id ?? "unknown";

      logger.info("Pipeline completed", {
        correlation_id: correlationId,
        event_count: result.events.length,
        channel: adapter.channelType,
        response_preview: result.explanation.backendResponse.slice(0, 100),
        duration_ms: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error("Pipeline failed", {
        channel: adapter.channelType,
        error_message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  function validateAndAppend(event: CanonicalEvent): void {
    const validation = validators.validateEvent(event);
    if (!validation.ok) {
      const details = validation.failure.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Server produced invalid ${event.event_type}: ${details}`);
    }
    ledgerStore.append(event);
  }

  function extractPrompt(event: CanonicalEvent): string | undefined {
    const provider = event.provider_extensions?.["a2a"] as Record<string, unknown> | undefined;
    if (provider?.["input_required"] === true && typeof event.payload["text"] === "string") {
      return event.payload["text"] as string;
    }
    return undefined;
  }

  function resolveStreamingForSender(adapter: ChannelAdapter, sender: ChannelSender): StreamingOptions | undefined {
    const caps = adapter.describeCapabilities();
    if (caps.streaming.progressiveUpdate && sender.edit) {
      let messageId: string | undefined;
      return {
        enabled: true,
        updateIntervalMs: streamingIntervalMs,
        postInitial: async (placeholder: string) => {
          const result = await sender.send(placeholder);
          messageId = result.providerMessageId;
          return result;
        },
        updateMessage: async (text: string) => {
          if (messageId) await sender.edit!(messageId, text);
        },
      };
    }
    return undefined;
  }

  function storePendingSession(conversationId: string, session: PendingSession): void {
    pendingSessions.set(conversationId, session);
    webChatSessions.set(conversationId, session.sessionHandle);
  }

  function clearPendingSession(conversationId: string): void {
    pendingSessions.delete(conversationId);
    webChatSessions.remove(conversationId);
  }

  function getActivePendingSession(conversationId: string): PendingSession | undefined {
    const pending = pendingSessions.get(conversationId);
    if (!pending) return undefined;
    if (Date.now() - pending.createdAt > pending.timeoutMs) {
      clearPendingSession(conversationId);
      return undefined;
    }
    return pending;
  }

  function findPendingSessionByHandle(sessionHandle: string): { conversationId: string; pending: PendingSession } | undefined {
    for (const [conversationId, pending] of pendingSessions.entries()) {
      if (pending.sessionHandle === sessionHandle) {
        const active = getActivePendingSession(conversationId);
        if (active) return { conversationId, pending: active };
        return undefined;
      }
    }
    return undefined;
  }

  async function maybeRecordHitlPending(result: Awaited<ReturnType<typeof runPipeline>>): Promise<string | undefined> {
    if (!result.hitlPending || !result.sessionHandle) return undefined;

    const routeEvent = result.events.find((event) => event.event_type === "route.decision.made");
    const agentResponse = result.events.find((event) => event.event_type === "agent.response.completed");
    if (!routeEvent || !agentResponse) return undefined;

    const agentName = routeEvent.payload["route"];
    if (typeof agentName !== "string" || agentName.length === 0) return undefined;

    const prompt = extractPrompt(agentResponse);
    const inputRequested = deriveEvent(
      agentResponse,
      agentResponse.event_id,
      "agent.input.requested",
      "agent",
      {
        prompt: prompt ?? "Input required",
        session_handle: result.sessionHandle,
      },
    );
    validateAndAppend(inputRequested);

    const statusChanged = deriveEvent(
      agentResponse,
      inputRequested.event_id,
      "agent.status.changed",
      "system",
      {
        status: "input-required",
        session_handle: result.sessionHandle,
        ...(prompt ? { message: prompt } : {}),
      },
    );
    validateAndAppend(statusChanged);

    const conversationId = result.events[0]?.conversation_id;
    if (conversationId) {
      storePendingSession(conversationId, {
        sessionHandle: result.sessionHandle,
        agentName,
        createdAt: Date.now(),
        timeoutMs: pendingSessionTimeoutMs,
        inputRequestedEventId: inputRequested.event_id,
      });
    }

    return prompt;
  }

  async function resumePendingSession(
    adapter: ChannelAdapter,
    userEvent: CanonicalEvent,
    pending: PendingSession,
    onStreamEvent?: (event: WebChatStreamEvent) => void,
  ): Promise<WebChatPipelineResult> {
    const agent = agentRegistry.get(pending.agentName);
    if (!agent || !agent.resume) {
      clearPendingSession(userEvent.conversation_id);
      throw new Error(`Agent '${pending.agentName}' is unavailable for resume`);
    }

    validateAndAppend(userEvent);

    const inputProvided = deriveEvent(
      userEvent,
      userEvent.event_id,
      "agent.input.provided",
      "end_user",
      {
        text: typeof userEvent.payload["text"] === "string" ? userEvent.payload["text"] : "",
        session_handle: pending.sessionHandle,
        ...(pending.inputRequestedEventId ? { input_event_id: pending.inputRequestedEventId } : {}),
      },
    );
    validateAndAppend(inputProvided);

    const invocationEvent = deriveEvent(
      userEvent,
      inputProvided.event_id,
      "agent.invocation.requested",
      "system",
      {
        backend: pending.agentName,
        input_event_id: inputProvided.event_id,
      },
    );
    validateAndAppend(invocationEvent);

    const sender = adapter.createSender(userEvent);
    const streaming = onStreamEvent ? resolveStreamingForSender(adapter, sender) : undefined;
    const resumeInput = {
      messageText: typeof userEvent.payload["text"] === "string" ? userEvent.payload["text"] : "",
      invocationEvent,
    };

    let agentResult;
    if (streaming && agent.resumeStream) {
      const generator = agent.resumeStream(pending.sessionHandle, resumeInput);
      const postInitial = streaming.postInitial;
      const updateMessage = streaming.updateMessage;
      const initial = await postInitial("...");
      let accumulated = "";
      let lastUpdateTime = Date.now();
      let finalResult: IteratorResult<AgentEvent, Awaited<ReturnType<typeof agent.resume>>>;

      for (;;) {
        const next = await generator.next();
        if (next.done) {
          finalResult = next as IteratorResult<AgentEvent, Awaited<ReturnType<typeof agent.resume>>>;
          break;
        }
        const agentEvent = next.value;
        if (agentEvent.type === "text_delta") {
          accumulated += agentEvent.content;
          onStreamEvent?.({ type: "text_delta", content: agentEvent.content });
          if (Date.now() - lastUpdateTime >= (streaming.updateIntervalMs ?? streamingIntervalMs)) {
            await updateMessage(accumulated);
            lastUpdateTime = Date.now();
          }
        } else if (agentEvent.type === "status") {
          onStreamEvent?.({ type: "status", status: agentEvent.status });
        } else if (agentEvent.type === "input_required") {
          onStreamEvent?.({ type: "input_required", prompt: agentEvent.prompt, session_handle: pending.sessionHandle });
        }
      }

      if (accumulated) {
        await updateMessage(accumulated);
      }
      agentResult = finalResult!.value;
      void initial;
    } else {
      agentResult = await agent.resume(pending.sessionHandle, resumeInput);
    }

    if (!agentResult.ok) {
      throw new Error(agentResult.error.message);
    }

    validateAndAppend(agentResult.event);

    const prompt = extractPrompt(agentResult.event);
    if (prompt && agentResult.sessionHandle) {
      const inputRequested = deriveEvent(
        agentResult.event,
        agentResult.event.event_id,
        "agent.input.requested",
        "agent",
        { prompt, session_handle: agentResult.sessionHandle },
      );
      validateAndAppend(inputRequested);
      const statusChanged = deriveEvent(
        agentResult.event,
        inputRequested.event_id,
        "agent.status.changed",
        "system",
        { status: "input-required", session_handle: agentResult.sessionHandle, message: prompt },
      );
      validateAndAppend(statusChanged);
      storePendingSession(userEvent.conversation_id, {
        sessionHandle: agentResult.sessionHandle,
        agentName: pending.agentName,
        createdAt: Date.now(),
        timeoutMs: pending.timeoutMs,
        inputRequestedEventId: inputRequested.event_id,
      });
    } else {
      clearPendingSession(userEvent.conversation_id);
    }

    if (!prompt) {
      const deliveryResult = await delivery.deliver(agentResult.event, sender);
      ledgerStore.append(deliveryResult.sendRequestedEvent);
      ledgerStore.append(deliveryResult.sentEvent);
    }

    return {
      reply: typeof agentResult.event.payload["text"] === "string" ? agentResult.event.payload["text"] : "",
      conversationId: userEvent.conversation_id,
      correlationId: userEvent.correlation_id,
      sessionHandle: agentResult.sessionHandle,
      hitlPending: Boolean(prompt && agentResult.sessionHandle),
      ...(prompt ? { hitlPrompt: prompt } : {}),
    };
  }

  async function handleMessage(channelName: string, adapter: ChannelAdapter, rawEvent: unknown) {
    const result = adapter.canonicalize(rawEvent);
    if (!result.ok) return;

    if (idempotencyStore.isDuplicate(result.idempotencyKey)) {
      logger.info("Duplicate event ignored", {
        channel: channelName,
        event_type: result.event.event_type,
        idempotency_key: result.idempotencyKey,
      });
      return;
    }

    const eventType = result.event.event_type;

    if (eventType === "message.received") {
      const pending = getActivePendingSession(result.event.conversation_id);
      if (pending) {
        await trackInflight(() => resumePendingSession(adapter, result.event, pending).then(() => undefined));
        return;
      }
      await trackInflight(async () => {
        const pipelineResult = await runPipeline(adapter, rawEvent);
        await maybeRecordHitlPending(pipelineResult);
      });
    } else if (eventType === "command.received") {
      await trackInflight(() => runPipeline(adapter, rawEvent).then(() => undefined));
    } else {
      ledgerStore.append(result.event);
      logger.info("Event recorded", { event_type: eventType, channel: channelName });
    }
  }

  // ── WebChat Session Store ──────────────────────────────────────────────

  const webChatSessions = new WebChatSessionStore();

  async function runWebChatPipeline(
    channelName: string,
    adapter: ChannelAdapter,
    raw: unknown,
    onStreamEvent?: (event: WebChatStreamEvent) => void,
  ): Promise<WebChatPipelineResult> {
    const streamingOverride = onStreamEvent
      ? buildWebChatStreaming(onStreamEvent, streamingIntervalMs)
      : undefined;

    const result = await runPipeline(adapter, raw, streamingOverride);
    if (!result) {
      return { reply: "", conversationId: "", correlationId: "" };
    }

    const convId = result.events[0]?.conversation_id ?? "";
    const corrId = result.events[0]?.correlation_id ?? "";

    if (result.sessionHandle && convId) {
      webChatSessions.set(convId, result.sessionHandle);
    }

    const hitlPrompt = await maybeRecordHitlPending(result);

    return {
      reply: result.explanation.backendResponse,
      conversationId: convId,
      correlationId: corrId,
      sessionHandle: result.sessionHandle,
      hitlPending: result.hitlPending,
      ...(hitlPrompt ? { hitlPrompt } : {}),
    };
  }

  async function resumeWebChat(
    sessionHandle: string,
    text: string,
    onStreamEvent?: (event: WebChatStreamEvent) => void,
  ): Promise<WebChatPipelineResult> {
    const pendingEntry = findPendingSessionByHandle(sessionHandle);
    if (!pendingEntry) {
      throw new Error(`No pending session found for session handle: ${sessionHandle}`);
    }

    const webChatConnection = channelRegistry.list()
      .map((name) => channelRegistry.get(name))
      .find((channel) => channel?.type === "webchat");
    if (!webChatConnection) {
      throw new Error("No enabled webchat channel");
    }

    const userEvent: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: webChatConnection.tenantId,
      workspace_id: webChatConnection.workspaceId,
      channel: "webchat",
      channel_instance_id: "webchat",
      conversation_id: pendingEntry.conversationId,
      session_id: `sess_resume_${sessionHandle}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date().toISOString(),
      actor_type: "end_user",
      payload: { text },
    };

    const result = await resumePendingSession(webChatConnection.adapter, userEvent, pendingEntry.pending, onStreamEvent);
    if (result.sessionHandle) {
      webChatSessions.set(result.conversationId, result.sessionHandle);
    }
    return result;
  }

  const channelRegistry = new ChannelRegistry(handleMessage);
  channelRegistry.registerFactory("slack", createSlackFactory());
  channelRegistry.registerFactory("discord", createDiscordFactory());
  channelRegistry.registerFactory("webchat", createWebChatFactory());
  channelRegistry.registerFactory("telegram", createTelegramFactory());
  channelRegistry.registerFactory("lark", createLarkFactory());
  channelRegistry.registerFactory("dingtalk", createDingTalkFactory());
  channelRegistry.registerFactory("teams", createTeamsFactory());
  channelRegistry.registerFactory("whatsapp", createWhatsAppFactory());
  for (const channel of await configDb.listChannels()) {
    await channelRegistry.register(channel);
  }

  const apiKey = process.env["CAR_API_KEY"] ?? configDb.getSetting("api.key");
  const chatPublic = configDb.getSetting("api.chat.public") !== "false";

  const tenantIsolation = configDb.getSetting("tenant.isolation") === "true";

  const apiServer = startApiServer({
    port: apiPort,
    ledgerStore,
    configDb,
    agentRegistry,
    channelRegistry,
    routeEngine,
    webChatSessions,
    apiKey: apiKey || undefined,
    chatPublic,
    tenantIsolation,
    onConfigChanged: reloadPolicyConfig,
    runWebChatPipeline,
    resumeWebChat,
  });

  logger.info("Server started", {
    port: apiPort,
    agents: agentRegistry.list().join(", ") || "none",
    channels: channelRegistry.list().join(", ") || "none",
    streaming: streamingEnabled,
  });

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${signal})`, { inflight_count: inflightCount });

    await channelRegistry.shutdown();
    await drainInflight();
    for (const stopWatching of policyWatchStops) {
      stopWatching();
    }
    apiServer.stop(true);
    await agentRegistry.shutdown();
    ledgerStore.close();
    configDb.close();
    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}
