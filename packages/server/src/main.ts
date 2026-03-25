import { FirstExecutablePathPipeline } from "@cap/pipeline";
import { SlackIngress, SlackSender, SlackSocketConnection } from "@cap/channel-slack";
import type { SlackSocketEvent, SlackMessageEvent } from "@cap/channel-slack";
import { OpenAIBackend } from "@cap/backend-openai";
import { SqliteLedgerStore } from "@cap/event-ledger";
import { loadConfig } from "./config";
import { logger } from "./logger";

async function main() {
  const config = loadConfig();

  logger.info("Starting server", {
    tenant_id: config.cap.tenantId,
    workspace_id: config.cap.workspaceId,
    openai_model: config.openai.model,
    base_url: config.openai.baseUrl,
    sqlite_path: config.cap.sqlitePath,
  });

  const ledgerStore = new SqliteLedgerStore(config.cap.sqlitePath);
  const ingress = await SlackIngress.create(config.cap.tenantId, config.cap.workspaceId);
  const backend = await OpenAIBackend.create({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    systemPrompt: config.openai.systemPrompt,
    baseUrl: config.openai.baseUrl,
  });
  const sender = new SlackSender({ botToken: config.slack.botToken });

  const socket = new SlackSocketConnection({
    appToken: config.slack.appToken,
    onMessage: async (socketEvent: SlackSocketEvent) => {
      const event = socketEvent.payload.event;
      if (event.type !== "message") return;

      const msgEvent = event as SlackMessageEvent;
      if (msgEvent.subtype !== undefined) return;
      if (msgEvent.bot_id !== undefined) return;

      const startTime = Date.now();
      logger.info("Message received", {
        user: event.user,
        channel: event.channel,
        text_preview: event.text?.slice(0, 80),
      });

      try {
        const sendFn = sender.createSendFn(event.channel, event.thread_ts);

        const pipelineInstance = await FirstExecutablePathPipeline.create({
          middleware: {
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
    },
    onError: (error) => {
      logger.error("Socket error", { error_message: error.message });
    },
    onReconnect: (attempt) => {
      logger.warn("Reconnecting to Slack", { attempt });
    },
  });

  logger.info("Connecting to Slack Socket Mode");
  await socket.connect();
  logger.info("Connected, listening for messages");

  process.on("SIGINT", () => {
    logger.info("Shutting down (SIGINT)");
    socket.disconnect();
    ledgerStore.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down (SIGTERM)");
    socket.disconnect();
    ledgerStore.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("Fatal error", {
    error_message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
