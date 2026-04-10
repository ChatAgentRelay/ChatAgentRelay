import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { SlackIngress } from "@chat-agent-relay/channel-slack";
import type { AgentAdapter, AgentResult, AgentInvocationContext } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "slack-integration-test.db");

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
    describeCapabilities: () => ({ streaming: false, multiTurn: false, resume: false, hitl: false, cancel: false, artifacts: false }),
  };
}

function sampleSlackMessage() {
  return {
    type: "message",
    channel: "C1234567890",
    user: "U9876543210",
    text: "What is the weather today?",
    ts: "1710756000.000100",
    team: "T0001",
    channel_type: "channel",
  };
}

describe("Slack -> Pipeline -> Agent integration", () => {
  let mockSlackApi: BunServer;
  let mockSlackPort: number;
  let validators: ContractHarnessValidators;
  let slackSendCalls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    slackSendCalls = [];
    mockSlackApi = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        slackSendCalls.push(body);
        return Response.json({ ok: true, channel: body["channel"], ts: "1710756001.000200" });
      },
    });
    mockSlackPort = mockSlackApi.port!;

    validators = await ContractHarnessValidators.create();
  });

  afterAll(() => {
    mockSlackApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const adapter = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support", {
      apiBase: `http://localhost:${mockSlackPort}`,
    });
    const agent = createMockAgent();

    const config: PipelineConfig = {
      resolveAgent: (name) => (name === "test-agent" ? agent : undefined),
      routeFn: () => ({
        agentName: "test-agent",
        routeId: 0,
        matchType: "default",
        reason: "slack_integration",
      }),
      channel: adapter,
      ...(ledgerStore !== undefined ? { ledgerStore } : {}),
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete Slack -> Agent -> Slack happy path", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

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
    const result = await pipeline.execute(sampleSlackMessage());

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("carries the Slack user message through to agent and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

    expect(result.explanation.inboundText).toBe("What is the weather today?");
    expect(result.explanation.backendResponse).toBe("It is sunny and 22 degrees.");
  });

  it("delivers the agent response via Slack send function", async () => {
    slackSendCalls = [];
    const pipeline = await createPipeline();
    await pipeline.execute(sampleSlackMessage());

    expect(slackSendCalls).toHaveLength(1);
    expect(slackSendCalls[0]!["text"]).toBe("It is sunny and 22 degrees.");
    expect(slackSendCalls[0]!["channel"]).toBe("C1234567890");
  });

  it("message.received has channel=slack and Slack metadata", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

    const msgReceived = result.events[0]!;
    expect(msgReceived.channel).toBe("slack");
    const ext = msgReceived.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["slack"]!["channel_id"]).toBe("C1234567890");
    expect(ext["slack"]!["ts"]).toBe("1710756000.000100");
  });

  it("maintains full causal chain with Slack ingress", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("persists all seven events in SQLite ledger", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const pipeline = await createPipeline(store);
      const result = await pipeline.execute(sampleSlackMessage());

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
