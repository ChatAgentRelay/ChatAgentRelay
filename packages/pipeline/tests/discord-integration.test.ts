import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DiscordIngress } from "@chat-agent-relay/channel-discord";
import type { AgentAdapter, AgentInvocationContext, AgentResult } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "discord-integration-test.db");

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
        payload: { text: "It is sunny and 22 degrees.", status: "completed" },
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

function sampleDiscordMessage() {
  return {
    id: "1234567890123456789",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888",
    author: { id: "111122223333444455", username: "test_user", bot: false },
    content: "What is the weather today?",
    timestamp: "2026-03-28T10:00:00.000Z",
  };
}

function sampleDiscordDM() {
  return {
    id: "1234567890123456790",
    channel_id: "1111222233334444",
    author: { id: "111122223333444455", username: "dm_user", bot: false },
    content: "Hello from DM",
    timestamp: "2026-03-28T10:01:00.000Z",
  };
}

function sampleDiscordThreadMessage() {
  return {
    id: "1234567890123456791",
    channel_id: "9876543210987654321",
    guild_id: "5555666677778888",
    author: { id: "111122223333444455", username: "thread_user", bot: false },
    content: "Following up in thread",
    timestamp: "2026-03-28T10:02:00.000Z",
    message_reference: { message_id: "1234567890123456789", channel_id: "9876543210987654321" },
  };
}

describe("Discord -> Pipeline -> Agent integration", () => {
  let mockDiscordApi: BunServer;
  let mockDiscordPort: number;
  let validators: ContractHarnessValidators;
  let discordSendCalls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    discordSendCalls = [];
    mockDiscordApi = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        discordSendCalls.push(body);
        return Response.json({
          id: "9999888877776666",
          channel_id: "9876543210987654321",
          content: body["content"] as string,
        });
      },
    });
    mockDiscordPort = mockDiscordApi.port!;

    validators = await ContractHarnessValidators.create();
  });

  afterAll(() => {
    mockDiscordApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const adapter = await DiscordIngress.create("test-discord-token", "tenant_acme", "ws_gaming", {
      apiBase: `http://localhost:${mockDiscordPort}`,
    });
    const agent = createMockAgent();

    const config: PipelineConfig = {
      resolveAgent: (name) => (name === "test-agent" ? agent : undefined),
      routeFn: () => ({
        agentName: "test-agent",
        routeId: 0,
        matchType: "default",
        reason: "discord_integration",
      }),
      channel: adapter,
      ...(ledgerStore !== undefined ? { ledgerStore } : {}),
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete Discord -> Agent -> Discord happy path", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordMessage());

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
    const result = await pipeline.execute(sampleDiscordMessage());

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("carries the Discord user message through to agent and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordMessage());

    expect(result.explanation.inboundText).toBe("What is the weather today?");
    expect(result.explanation.backendResponse).toBe("It is sunny and 22 degrees.");
  });

  it("delivers the agent response via Discord send function", async () => {
    discordSendCalls = [];
    const pipeline = await createPipeline();
    await pipeline.execute(sampleDiscordMessage());

    expect(discordSendCalls).toHaveLength(1);
    expect(discordSendCalls[0]!["content"]).toBe("It is sunny and 22 degrees.");
  });

  it("message.received has channel=discord and Discord metadata", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordMessage());

    const msgReceived = result.events[0]!;
    expect(msgReceived.channel).toBe("discord");
    const ext = msgReceived.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["discord"]!["message_id"]).toBe("1234567890123456789");
    expect(ext["discord"]!["channel_id"]).toBe("9876543210987654321");
    expect(ext["discord"]!["guild_id"]).toBe("5555666677778888");
  });

  it("maintains full causal chain with Discord ingress", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordMessage());

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("handles Discord DM messages correctly", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordDM());

    expect(result.events).toHaveLength(7);
    const msgReceived = result.events[0]!;
    expect(msgReceived.conversation_id).toContain("discord:dm:");
  });

  it("handles Discord thread messages correctly", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordThreadMessage());

    expect(result.events).toHaveLength(7);
    const msgReceived = result.events[0]!;
    expect(msgReceived.conversation_id).toContain("discord:thread:");
  });

  it("persists all seven events in SQLite ledger", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const pipeline = await createPipeline(store);
      const result = await pipeline.execute(sampleDiscordMessage());

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
