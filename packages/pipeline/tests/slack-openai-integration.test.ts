import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { OpenAIBackend } from "@chat-agent-relay/backend-openai";
import { SlackIngress } from "@chat-agent-relay/channel-slack";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "slack-openai-test.db");

function cleanTestDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
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

describe("Slack -> Pipeline -> OpenAI integration", () => {
  let mockOpenAI: BunServer;
  let mockOpenAIPort: number;
  let mockSlackApi: BunServer;
  let mockSlackPort: number;
  let validators: ContractHarnessValidators;
  let slackSendCalls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    mockOpenAI = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1710000000,
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "It is sunny and 22 degrees." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
        });
      },
    });
    mockOpenAIPort = mockOpenAI.port!;

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
    mockOpenAI.stop(true);
    mockSlackApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const ingress = await SlackIngress.create("tenant_acme", "ws_support");
    const backend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockOpenAIPort}`,
    });

    const originalFetch = globalThis.fetch;
    const mockSendFn = async (text: string) => {
      const response = await originalFetch(`http://localhost:${mockSlackPort}/chat.postMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "C1234567890", text }),
      });
      const body = (await response.json()) as { ts?: string };
      return { providerMessageId: body.ts ?? "unknown" };
    };

    const config: PipelineConfig = {
      middleware: {
        route: { route_id: "openai_agent", backend: "openai", reason: "slack_integration" },
      },
      backend,
      ingress,
      sendFn: mockSendFn,
      ledgerStore,
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete Slack -> OpenAI -> Slack happy path", async () => {
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

  it("carries the Slack user message through to OpenAI and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

    expect(result.explanation.inboundText).toBe("What is the weather today?");
    expect(result.explanation.backendResponse).toBe("It is sunny and 22 degrees.");
  });

  it("delivers the OpenAI response via Slack send function", async () => {
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

  it("agent.response.completed has OpenAI metadata", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleSlackMessage());

    const agentResp = result.events[4]!;
    expect(agentResp.event_type).toBe("agent.response.completed");
    const ext = agentResp.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["openai"]!["model"]).toBe("gpt-4o-mini");
    expect(ext["openai"]!["finish_reason"]).toBe("stop");
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
