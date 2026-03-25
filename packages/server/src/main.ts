import { FirstExecutablePathPipeline } from "@cap/pipeline";
import { SlackIngress, SlackSender, SlackSocketConnection } from "@cap/channel-slack";
import type { SlackSocketEvent, SlackMessageEvent } from "@cap/channel-slack";
import { OpenAIBackend } from "@cap/backend-openai";
import { SqliteLedgerStore } from "@cap/event-ledger";
import { loadPolicyConfig, createPolicyFn } from "@cap/middleware";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { startApiServer } from "./api";
import { validateConfig, formatConfigErrors } from "./validate-config";

const DRAIN_TIMEOUT_MS = 30_000;

async function main() {
  const config = loadConfig();

  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    process.stderr.write(formatConfigErrors(configErrors));
    process.exit(1);
  }

  logger.info("Starting server", {
    tenant_id: config.cap.tenantId,
    workspace_id: config.cap.workspaceId,
    openai_model: config.openai.model,
    base_url: config.openai.baseUrl,
    sqlite_path: config.cap.sqlitePath,
  });

  const policySource = config.cap.policyConfig;
  const policyConfig = loadPolicyConfig(policySource);
  const policyFn = policyConfig.rules.length > 0 ? createPolicyFn(policyConfig) : undefined;

  if (policyFn) {
    logger.info("Policy engine loaded", { rule_count: policyConfig.rules.length });
  }

  const ledgerStore = new SqliteLedgerStore(config.cap.sqlitePath);
  const ingress = await SlackIngress.create(config.cap.tenantId, config.cap.workspaceId);
  const backend = await OpenAIBackend.create({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    systemPrompt: config.openai.systemPrompt,
    baseUrl: config.openai.baseUrl,
  });
  const sender = new SlackSender({ botToken: config.slack.botToken });

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

  const socket = new SlackSocketConnection({
    appToken: config.slack.appToken,
    onMessage: async (socketEvent: SlackSocketEvent) => {
      const event = socketEvent.payload.event;
      if (event.type !== "message") return;

      const msgEvent = event as SlackMessageEvent;
      if (msgEvent.subtype !== undefined) return;
      if (msgEvent.bot_id !== undefined) return;

      await trackInflight(async () => {
        const startTime = Date.now();
        logger.info("Message received", {
          user: event.user,
          channel: event.channel,
          text_preview: event.text?.slice(0, 80),
        });

        try {
          const sendFn = sender.createSendFn(event.channel, event.thread_ts);

          let streamingMessageTs: string | undefined;
          const streamingOptions = config.cap.streaming ? {
            enabled: true,
            updateIntervalMs: config.cap.streamingIntervalMs,
            postInitial: async (placeholder: string) => {
              const result = await sender.send(event.channel, placeholder, event.thread_ts);
              streamingMessageTs = result.providerMessageId;
              return result;
            },
            updateMessage: async (text: string) => {
              if (streamingMessageTs) {
                await sender.update(event.channel, streamingMessageTs, text);
              }
            },
          } : undefined;

          const pipelineInstance = await FirstExecutablePathPipeline.create({
            middleware: {
              policyId: "configurable_policy",
              policyFn,
              route: {
                route_id: config.cap.routeId,
                backend: "openai",
                reason: "slack_message",
              },
            },
            backend,
            ingress,
            sendFn,
            ledgerStore,
            streaming: streamingOptions,
          });

          const result = await pipelineInstance.execute(event);
          const correlationId = result.events[0]?.correlation_id ?? "unknown";

          logger.info("Pipeline completed", {
            correlation_id: correlationId,
            event_count: result.events.length,
            response_preview: result.explanation.backendResponse.slice(0, 100),
            duration_ms: Date.now() - startTime,
          });
        } catch (error) {
          logger.error("Pipeline failed", {
            error_message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            duration_ms: Date.now() - startTime,
          });
        }
      });
    },
    onError: (error: Error) => {
      logger.error("Socket error", { error_message: error.message });
    },
    onReconnect: (attempt: number) => {
      logger.warn("Reconnecting to Slack", { attempt });
    },
  });

  const apiServer = startApiServer({ port: config.cap.apiPort, ledgerStore });

  logger.info("Connecting to Slack Socket Mode");
  await socket.connect();
  logger.info("Connected, listening for messages");

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${signal})`, { inflight_count: inflightCount });

    socket.disconnect();

    await drainInflight();

    apiServer.stop(true);
    ledgerStore.close();
    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", () => { shutdown("SIGINT"); });
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
}

main().catch((error) => {
  logger.error("Fatal error", {
    error_message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
