import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { OpenAIBackend } from "@chat-agent-relay/backend-openai";
import { DiscordIngress } from "@chat-agent-relay/channel-discord";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { legacyBridge } from "../src/legacy-bridge";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "discord-openai-test.db");

function cleanTestDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
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

describe("Discord -> Pipeline -> OpenAI integration", () => {
  let mockOpenAI: BunServer;
  let mockOpenAIPort: number;
  let mockDiscordApi: BunServer;
  let mockDiscordPort: number;
  let validators: ContractHarnessValidators;
  let discordSendCalls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    mockOpenAI = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          id: "chatcmpl-discord-test",
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
    mockOpenAI.stop(true);
    mockDiscordApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const ingress = await DiscordIngress.create("tenant_acme", "ws_gaming");
    const openaiBackend = await OpenAIBackend.create({
      apiKey: "test-key",
      baseUrl: `http://localhost:${mockOpenAIPort}`,
    });
    const agentAdapter = legacyBridge(openaiBackend);

    const originalFetch = globalThis.fetch;
    const mockSendFn = async (text: string) => {
      const response = await originalFetch(`http://localhost:${mockDiscordPort}/channels/9876543210987654321/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const body = (await response.json()) as { id?: string };
      return { providerMessageId: body.id ?? "unknown" };
    };

    const config: PipelineConfig = {
      resolveAgent: (name) => (name === "openai" ? agentAdapter : undefined),
      routeFn: () => ({
        agentName: "openai",
        routeId: 0,
        matchType: "default",
        reason: "discord_integration",
      }),
      channelName: "9876543210987654321",
      ingress,
      sendFn: mockSendFn,
      ledgerStore,
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete Discord -> OpenAI -> Discord happy path", async () => {
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

  it("carries the Discord user message through to OpenAI and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleDiscordMessage());

    expect(result.explanation.inboundText).toBe("What is the weather today?");
    expect(result.explanation.backendResponse).toBe("It is sunny and 22 degrees.");
  });

  it("delivers the OpenAI response via Discord send function", async () => {
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
