import { DiscordIngress, DiscordSender } from "@chat-agent-relay/channel-discord";
import { SlackIngress, SlackSender } from "@chat-agent-relay/channel-slack";
import { ConfigDatabase, RouteEngine } from "@chat-agent-relay/config-store";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import { createPolicyFn, loadPolicyConfig } from "@chat-agent-relay/middleware";
import { FirstExecutablePathPipeline } from "@chat-agent-relay/pipeline";
import type { ChannelIngress, PipelineConfig, StreamingOptions } from "@chat-agent-relay/pipeline";
import { AgentRegistry } from "./agent-registry";
import { startApiServer } from "./api";
import { ChannelRegistry } from "./channel-registry";
import { logger } from "./logger";

const DRAIN_TIMEOUT_MS = 30_000;

export async function main() {
  const dbPath = process.env["CAR_DB_PATH"] ?? "./car.db";
  const encKey = process.env["CAR_ENCRYPTION_KEY"];

  const configDb = new ConfigDatabase(dbPath, encKey);

  const apiPort = Number(configDb.getSetting("api.port") ?? "3000");
  const streamingEnabled = configDb.getSetting("streaming.enabled") !== "false";
  const streamingIntervalMs = Number(configDb.getSetting("streaming.interval_ms") ?? "800");

  const ledgerPath = configDb.getSetting("ledger.path") ?? `${dbPath.replace(/\.db$/, "")}-ledger.db`;
  const ledgerStore = new SqliteLedgerStore(ledgerPath);

  const policySource = configDb.getSetting("policy.config");
  const policyConfig = loadPolicyConfig(policySource);
  const policyFn: PipelineConfig["policyFn"] =
    policyConfig.rules.length > 0 ? createPolicyFn(policyConfig) as PipelineConfig["policyFn"] : undefined;

  if (policyFn) {
    logger.info("Policy engine loaded", { rule_count: policyConfig.rules.length });
  }

  const routeEngine = new RouteEngine();
  routeEngine.load(configDb.listRoutes());

  const agentRegistry = new AgentRegistry();
  for (const agent of await configDb.listAgents()) {
    await agentRegistry.register(agent);
  }

  let inflightCount = 0;
  let shuttingDown = false;
  let drainResolve: (() => void) | undefined;

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
    channelName: string,
    ingress: ChannelIngress,
    pipelineInput: unknown,
    sendFn: (text: string) => Promise<{ providerMessageId: string }>,
    streaming: StreamingOptions | undefined,
  ) {
    const startTime = Date.now();
    try {
      const pipeline = await FirstExecutablePathPipeline.create({
        resolveAgent: (name) => agentRegistry.get(name),
        routeFn: (chName, text) => routeEngine.resolve({ channelName: chName, messageText: text }),
        ...(policyFn ? { policyFn } : {}),
        ingress,
        channelName,
        sendFn,
        ledgerStore,
        ...(streaming ? { streaming } : {}),
      });

      const result = await pipeline.execute(pipelineInput);
      const correlationId = result.events[0]?.correlation_id ?? "unknown";

      logger.info("Pipeline completed", {
        correlation_id: correlationId,
        event_count: result.events.length,
        channel: channelName,
        response_preview: result.explanation.backendResponse.slice(0, 100),
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      logger.error("Pipeline failed", {
        channel: channelName,
        error_message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration_ms: Date.now() - startTime,
      });
    }
  }

  async function handleSlackEvent(
    channelName: string,
    ingress: SlackIngress,
    sender: SlackSender,
    rawEvent: unknown,
  ) {
    const socketEvent = rawEvent as { payload: { event: Record<string, unknown> } };
    const event = socketEvent.payload.event;
    const eventType = event["type"] as string;

    if (eventType === "reaction_added" || eventType === "reaction_removed") {
      const result = ingress.canonicalizeReaction(event);
      if (result.ok) {
        ledgerStore.append(result.event);
        logger.info("Slack reaction recorded", { event_type: eventType });
      }
      return;
    }

    if (eventType === "message") {
      const subtype = event["subtype"] as string | undefined;
      if (subtype === "message_changed") {
        const result = ingress.canonicalizeMessageUpdate(event);
        if (result.ok) {
          ledgerStore.append(result.event);
          logger.info("Slack message edit recorded");
        }
        return;
      }
      if (subtype === "message_deleted") {
        const result = ingress.canonicalizeMessageDelete(event);
        if (result.ok) {
          ledgerStore.append(result.event);
          logger.info("Slack message delete recorded");
        }
        return;
      }
      if (subtype !== undefined) return;
    }

    if (eventType !== "message" && eventType !== "app_mention") return;
    if (event["bot_id"] !== undefined) return;

    const channel = event["channel"] as string;
    const threadTs = event["thread_ts"] as string | undefined;
    const sendFn = sender.createSendFn(channel, threadTs);
    const streaming = buildSlackStreaming(sender, channel, threadTs, streamingEnabled, streamingIntervalMs);

    await trackInflight(() => runPipeline(channelName, ingress, event, sendFn, streaming));
  }

  async function handleDiscordEvent(
    channelName: string,
    ingress: DiscordIngress,
    sender: DiscordSender,
    rawEvent: unknown,
  ) {
    const event = rawEvent as Record<string, unknown>;

    if ("emoji" in event && "message_id" in event) {
      const result = ingress.canonicalizeReaction(rawEvent);
      if (result.ok) {
        ledgerStore.append(result.event);
        logger.info("Discord reaction recorded");
      }
      return;
    }

    if ("id" in event && "channel_id" in event && !("content" in event) && !("author" in event)) {
      const result = ingress.canonicalizeMessageDelete(rawEvent);
      if (result.ok) {
        ledgerStore.append(result.event);
        logger.info("Discord message delete recorded");
      }
      return;
    }

    const author = event["author"] as { bot?: boolean } | undefined;
    if (author?.bot) return;

    const content = event["content"] as string | undefined;
    if (!content || content.trim().length === 0) return;

    const channelId = event["channel_id"] as string;
    const messageId = event["id"] as string;
    const sendFn = sender.createSendFn(channelId, messageId);
    const streaming = buildDiscordStreaming(sender, channelId, messageId, streamingEnabled, streamingIntervalMs);

    sender.sendTyping(channelId).catch(() => {});

    await trackInflight(() => runPipeline(channelName, ingress, rawEvent, sendFn, streaming));
  }

  async function handleMessage(channelName: string, ingress: unknown, sender: unknown, rawEvent: unknown) {
    if (ingress instanceof SlackIngress && sender instanceof SlackSender) {
      await handleSlackEvent(channelName, ingress, sender, rawEvent);
    } else if (ingress instanceof DiscordIngress && sender instanceof DiscordSender) {
      await handleDiscordEvent(channelName, ingress, sender, rawEvent);
    } else {
      const noopSend = async () => ({ providerMessageId: "noop" });
      await trackInflight(() =>
        runPipeline(channelName, ingress as ChannelIngress, rawEvent, noopSend, undefined),
      );
    }
  }

  const channelRegistry = new ChannelRegistry(handleMessage);
  for (const channel of await configDb.listChannels()) {
    await channelRegistry.register(channel);
  }

  const apiServer = startApiServer({ port: apiPort, ledgerStore, configDb, agentRegistry, channelRegistry });

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

function buildSlackStreaming(
  sender: SlackSender,
  channel: string,
  threadTs: string | undefined,
  enabled: boolean,
  intervalMs: number,
): StreamingOptions | undefined {
  if (!enabled) return undefined;
  let streamingMessageTs: string | undefined;
  return {
    enabled: true,
    updateIntervalMs: intervalMs,
    postInitial: async (placeholder: string) => {
      const result = await sender.send(channel, placeholder, threadTs);
      streamingMessageTs = result.providerMessageId;
      return result;
    },
    updateMessage: async (text: string) => {
      if (streamingMessageTs) {
        await sender.update(channel, streamingMessageTs, text);
      }
    },
  };
}

function buildDiscordStreaming(
  sender: DiscordSender,
  channelId: string,
  messageId: string,
  enabled: boolean,
  intervalMs: number,
): StreamingOptions | undefined {
  if (!enabled) return undefined;
  let streamingMessageId: string | undefined;
  return {
    enabled: true,
    updateIntervalMs: intervalMs,
    postInitial: async (placeholder: string) => {
      const result = await sender.send(channelId, placeholder, messageId);
      streamingMessageId = result.providerMessageId;
      return result;
    },
    updateMessage: async (text: string) => {
      if (streamingMessageId) {
        await sender.update(channelId, streamingMessageId, text);
      }
    },
  };
}
