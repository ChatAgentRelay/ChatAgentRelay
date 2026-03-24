import { FirstExecutablePathPipeline } from "@cap/pipeline";
import { SlackIngress, SlackSender, SlackSocketConnection } from "@cap/channel-slack";
import type { SlackSocketEvent, SlackMessageEvent } from "@cap/channel-slack";
import { OpenAIBackend } from "@cap/backend-openai";
import { SqliteLedgerStore } from "@cap/event-ledger";
import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();

  console.log("[CAP] Starting server...");
  console.log(`[CAP] Tenant: ${config.cap.tenantId}, Workspace: ${config.cap.workspaceId}`);
  console.log(`[CAP] OpenAI model: ${config.openai.model}`);
  console.log(`[CAP] SQLite path: ${config.cap.sqlitePath}`);

  const ledgerStore = new SqliteLedgerStore(config.cap.sqlitePath);
  const ingress = await SlackIngress.create(config.cap.tenantId, config.cap.workspaceId);
  const backend = await OpenAIBackend.create({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    systemPrompt: config.openai.systemPrompt,
  });
  const sender = new SlackSender({ botToken: config.slack.botToken });

  const pipeline = await FirstExecutablePathPipeline.create({
    middleware: {
      route: {
        route_id: config.cap.routeId,
        backend: "openai",
        reason: "default_slack_route",
      },
    },
    backend,
    ingress,
    sendFn: async () => ({ providerMessageId: "pending" }),
    ledgerStore,
  });

  const socket = new SlackSocketConnection({
    appToken: config.slack.appToken,
    onMessage: async (socketEvent: SlackSocketEvent) => {
      const event = socketEvent.payload.event;
      if (event.type !== "message") return;
      if ((event as SlackMessageEvent).subtype !== undefined) return;

      console.log(`[CAP] Received message from ${event.user} in ${event.channel}: ${event.text}`);

      try {
        const sendFn = sender.createSendFn(event.channel, event.thread_ts);

        const localPipeline = await FirstExecutablePathPipeline.create({
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

        const result = await localPipeline.execute(event);

        console.log(`[CAP] Pipeline completed: ${result.events.length} events`);
        console.log(`[CAP] Response: ${result.explanation.backendResponse.slice(0, 100)}`);
      } catch (error) {
        console.error(`[CAP] Pipeline error:`, error instanceof Error ? error.message : error);
      }
    },
    onError: (error) => {
      console.error(`[CAP] Socket error:`, error.message);
    },
  });

  console.log("[CAP] Connecting to Slack Socket Mode...");
  await socket.connect();
  console.log("[CAP] Connected! Listening for messages...");

  process.on("SIGINT", () => {
    console.log("\n[CAP] Shutting down...");
    socket.disconnect();
    ledgerStore.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[CAP] Shutting down...");
    socket.disconnect();
    ledgerStore.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[CAP] Fatal error:", error);
  process.exit(1);
});
