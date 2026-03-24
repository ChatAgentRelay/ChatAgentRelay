import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { ContractHarnessValidators } from "@cap/contract-harness";
import { SqliteLedgerStore } from "@cap/event-ledger";
import { GenericHttpBackend } from "@cap/backend-http";
import { WebChatIngress } from "@cap/channel-web-chat";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "pipeline-test.db");

function cleanTestDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
}

function validInput() {
  return {
    client_message_id: "web_msg_001",
    text: "Where is my order?",
    user_id: "user_123",
    display_name: "Alice",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel_instance_id: "webchat_acme_prod",
  };
}

describe("first executable path pipeline (end-to-end)", () => {
  let mockServer: BunServer;
  let mockPort: number;
  let validators: ContractHarnessValidators;
  let ingress: WebChatIngress;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    mockServer = Bun.serve({
      port: 0,
      fetch(_req) {
        return Response.json({
          request_id: "req_test",
          status: "completed",
          output: { text: "Your order shipped yesterday." },
          backend: {
            request_id: "backend_req_987",
            session_handle: "be_sess_42",
            agent_id: "support_agent_v1",
          },
        });
      },
    });
    mockPort = mockServer.port!;
    validators = await ContractHarnessValidators.create();
    ingress = await WebChatIngress.create();
  });

  afterAll(() => {
    mockServer.stop(true);
    cleanTestDb();
  });

  async function makeConfig(overrides?: Partial<PipelineConfig>): Promise<PipelineConfig> {
    return {
      middleware: {
        route: { route_id: "default_webchat_agent", backend: "generic-http-agent", reason: "default_first_path_route" },
      },
      backend: await GenericHttpBackend.create({ endpoint: `http://localhost:${mockPort}` }),
      ingress,
      sendFn: async () => ({ providerMessageId: "webchat_msg_9001" }),
      ...overrides,
    };
  }

  it("runs the full seven-event happy path with in-memory ledger", async () => {
    const config = await makeConfig();
    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.events).toHaveLength(7);

    const eventTypes = result.events.map((e) => e.event_type);
    expect(eventTypes).toEqual([
      "message.received",
      "policy.decision.made",
      "route.decision.made",
      "agent.invocation.requested",
      "agent.response.completed",
      "message.send.requested",
      "message.sent",
    ]);
  });

  it("all seven events pass contract validation", async () => {
    const config = await makeConfig({
      middleware: { route: { route_id: "r1", backend: "b1", reason: "test" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("maintains causal chain across all seven events", async () => {
    const config = await makeConfig({
      middleware: { route: { route_id: "r1", backend: "b1" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.events[0]!.causation_id).toBeUndefined();

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("shares correlation_id across all seven events", async () => {
    const config = await makeConfig({
      middleware: { route: { route_id: "r1", backend: "b1" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    const correlationId = result.events[0]!.correlation_id;
    for (const event of result.events) {
      expect(event.correlation_id).toBe(correlationId);
    }
  });

  it("returns correct explanation summary", async () => {
    const config = await makeConfig();
    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.explanation.inboundText).toBe("Where is my order?");
    expect(result.explanation.policyDecision).toBe("allow");
    expect(result.explanation.selectedRoute).toBe("default_webchat_agent");
    expect(result.explanation.backendResponse).toBe("Your order shipped yesterday.");
    expect(result.explanation.providerMessageId).toBe("webchat_msg_9001");
  });

  it("appends all seven events to ledger and replays them", async () => {
    const config = await makeConfig({
      middleware: { route: { route_id: "r1", backend: "b1" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    const conversationId = result.events[0]!.conversation_id;
    const replayed = pipeline.replayConversation(conversationId);
    expect(replayed).toHaveLength(7);
    expect(replayed.map((e) => e.event_type)).toEqual(
      result.events.map((e) => e.event_type),
    );
  });

  it("works with SQLite durable ledger store", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const config = await makeConfig({
        middleware: { route: { route_id: "r1", backend: "b1" } },
        sendFn: async () => ({ providerMessageId: "msg_001" }),
        ledgerStore: store,
      });

      const pipeline = await FirstExecutablePathPipeline.create(config);
      const result = await pipeline.execute(validInput());

      expect(result.events).toHaveLength(7);

      const stored = store.getAll();
      expect(stored).toHaveLength(7);
    } finally {
      store.close();
    }
  });

  it("fails gracefully when backend is down", async () => {
    const config = await makeConfig({
      backend: await GenericHttpBackend.create({ endpoint: "http://localhost:1/down" }),
      middleware: { route: { route_id: "r1", backend: "b1" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    await expect(pipeline.execute(validInput())).rejects.toThrow("Backend invocation failed");
  });

  it("fails gracefully with invalid input", async () => {
    const config = await makeConfig({
      middleware: { route: { route_id: "r1", backend: "b1" } },
      sendFn: async () => ({ providerMessageId: "msg_001" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    await expect(pipeline.execute({ text: "" })).rejects.toThrow("Ingress failed");
  });
});
