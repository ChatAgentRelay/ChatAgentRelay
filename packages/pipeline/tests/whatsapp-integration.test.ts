import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WhatsAppIngress } from "@chat-agent-relay/channel-whatsapp";
import type { AgentAdapter, AgentInvocationContext, AgentResult } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "whatsapp-integration-test.db");

function cleanTestDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
}

function createMockAgent(): AgentAdapter {
  return {
    invoke: async (ctx: AgentInvocationContext): Promise<AgentResult> => ({
      ok: true,
      requestId: `req_${crypto.randomUUID()}`,
      event: {
        event_id: `evt_${crypto.randomUUID()}`,
        schema_version: "v1alpha1",
        event_type: "agent.response.completed",
        tenant_id: ctx.invocationEvent.tenant_id,
        workspace_id: ctx.invocationEvent.workspace_id,
        channel: ctx.invocationEvent.channel,
        ...(ctx.invocationEvent.channel_instance_id !== undefined
          ? { channel_instance_id: ctx.invocationEvent.channel_instance_id }
          : {}),
        conversation_id: ctx.invocationEvent.conversation_id,
        session_id: ctx.invocationEvent.session_id,
        correlation_id: ctx.invocationEvent.correlation_id,
        causation_id: ctx.invocationEvent.event_id,
        occurred_at: new Date().toISOString(),
        actor_type: "agent",
        payload: { text: "Hello back from WhatsApp.", status: "completed" },
        provider_extensions: { mock: { agent: "test" } },
      },
    }),
    describeCapabilities: () => ({
      streaming: false,
      multiTurn: false,
      resume: false,
      hitl: false,
      cancel: false,
      artifacts: false,
    }),
  };
}

function sampleWhatsAppMessage() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business_123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "phone_123", display_phone_number: "+15550001111" },
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.001",
                  timestamp: "1710756000",
                  type: "text",
                  text: { body: "Hello from WhatsApp" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsApp -> Pipeline -> Agent integration", () => {
  let mockWhatsAppApi: BunServer;
  let mockWhatsAppPort: number;
  let validators: ContractHarnessValidators;
  let sendCalls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    sendCalls = [];
    mockWhatsAppApi = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        sendCalls.push(body);
        return Response.json({ messages: [{ id: "wamid.reply001" }] });
      },
    });
    mockWhatsAppPort = mockWhatsAppApi.port!;

    validators = await ContractHarnessValidators.create();
  });

  afterAll(() => {
    mockWhatsAppApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const adapter = await WhatsAppIngress.create("phone_123", "access-token", {
      apiBase: `http://localhost:${mockWhatsAppPort}`,
    });
    const agent = createMockAgent();

    const config: PipelineConfig = {
      resolveAgent: (name) => (name === "test-agent" ? agent : undefined),
      routeFn: () => ({
        agentName: "test-agent",
        routeId: 0,
        matchType: "default",
        reason: "whatsapp_integration",
      }),
      channel: adapter,
      ...(ledgerStore !== undefined ? { ledgerStore } : {}),
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete WhatsApp -> Agent -> WhatsApp happy path", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleWhatsAppMessage());

    expect(result.events).toHaveLength(7);
    const types = result.events.map((e) => e.event_type);
    expect(types).toEqual([
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
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleWhatsAppMessage());

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("carries the WhatsApp user message through to agent and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleWhatsAppMessage());

    expect(result.explanation.inboundText).toBe("Hello from WhatsApp");
    expect(result.explanation.backendResponse).toBe("Hello back from WhatsApp.");
  });

  it("delivers the agent response via WhatsApp send function", async () => {
    sendCalls = [];
    const pipeline = await createPipeline();
    await pipeline.execute(sampleWhatsAppMessage());

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!["messaging_product"]).toBe("whatsapp");
    expect(sendCalls[0]!["to"]).toBe("15551234567");
    expect(sendCalls[0]!["type"]).toBe("text");
    expect(sendCalls[0]!["text"]).toEqual({ body: "Hello back from WhatsApp." });
  });

  it("message.received has channel=whatsapp and WhatsApp metadata", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleWhatsAppMessage());

    const msgReceived = result.events[0]!;
    expect(msgReceived.channel).toBe("whatsapp");
    const ext = msgReceived.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["whatsapp"]!["message_id"]).toBe("wamid.001");
    expect(ext["whatsapp"]!["from"]).toBe("15551234567");
    expect(ext["whatsapp"]!["phone_number_id"]).toBe("phone_123");
    expect(ext["whatsapp"]!["session_window_expires_at"]).toBe("2024-03-19T10:00:00.000Z");
  });

  it("maintains full causal chain with WhatsApp ingress", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleWhatsAppMessage());

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("persists all seven events in SQLite ledger", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const pipeline = await createPipeline(store);
      const result = await pipeline.execute(sampleWhatsAppMessage());

      const stored = store.getAll();
      expect(stored).toHaveLength(7);

      const conversationId = result.events[0]!.conversation_id;
      const replayed = pipeline.replayConversation(conversationId);
      expect(replayed).toHaveLength(7);
    } finally {
      store.close();
    }
  });
});
