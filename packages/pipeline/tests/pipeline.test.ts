import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";
import type { AgentAdapter, AgentResult, AgentInvocationContext, ChannelAdapter } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import { RateLimiter } from "@chat-agent-relay/middleware";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

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

function createMockAgent(text = "Your order shipped yesterday."): AgentAdapter {
  return {
    invoke: async (ctx: AgentInvocationContext): Promise<AgentResult> => ({
      ok: true,
      event: {
        event_id: `evt_${crypto.randomUUID()}`,
        schema_version: "v1alpha1",
        event_type: "agent.response.completed",
        tenant_id: ctx.invocationEvent.tenant_id,
        workspace_id: ctx.invocationEvent.workspace_id,
        channel: ctx.invocationEvent.channel,
        channel_instance_id: ctx.invocationEvent.channel_instance_id,
        conversation_id: ctx.invocationEvent.conversation_id,
        session_id: ctx.invocationEvent.session_id,
        correlation_id: ctx.invocationEvent.correlation_id,
        causation_id: ctx.invocationEvent.event_id,
        occurred_at: new Date().toISOString(),
        actor_type: "agent",
        payload: { text, status: "completed" },
        provider_extensions: { mock: { agent: "test" } },
      },
    }),
    describeCapabilities: () => ({
      streaming: false,
      multiTurn: false,
      resume: false,
    }),
  };
}

function createFailingAgent(): AgentAdapter {
  return {
    invoke: async (): Promise<AgentResult> => ({
      ok: false,
      error: { message: "Agent unreachable", retryable: true },
    }),
    describeCapabilities: () => ({ streaming: false, multiTurn: false, resume: false }),
  };
}

describe("first executable path pipeline (end-to-end)", () => {
  let validators: ContractHarnessValidators;
  let ingress: WebChatIngress;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    validators = await ContractHarnessValidators.create();
    ingress = await WebChatIngress.create();
  });

  afterAll(() => {
    cleanTestDb();
  });

  function makeConfig(
    overrides?: Partial<PipelineConfig> & { routeAgentName?: string; agent?: AgentAdapter },
  ): PipelineConfig {
    const routeAgentName = overrides?.routeAgentName ?? "default_webchat_agent";
    const agent = overrides?.agent ?? createMockAgent();
    const { routeAgentName: _rna, agent: _agent, ...rest } = overrides ?? {};
    return {
      resolveAgent: (name) => (name === routeAgentName ? agent : undefined),
      routeFn: () => ({
        agentName: routeAgentName,
        routeId: 1,
        matchType: "default",
        reason: "default_first_path_route",
      }),
      channel: ingress,
      ...rest,
    };
  }

  it("runs the full seven-event happy path with in-memory ledger", async () => {
    const config = makeConfig();
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
    const config = makeConfig({
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("maintains causal chain across all seven events", async () => {
    const config = makeConfig({
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.events[0]!.causation_id).toBeUndefined();

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("shares correlation_id across all seven events", async () => {
    const config = makeConfig({
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    const correlationId = result.events[0]!.correlation_id;
    for (const event of result.events) {
      expect(event.correlation_id).toBe(correlationId);
    }
  });

  it("returns correct explanation summary", async () => {
    const config = makeConfig();
    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.explanation.inboundText).toBe("Where is my order?");
    expect(result.explanation.policyDecision).toBe("allow");
    expect(result.explanation.selectedRoute).toBe("default_webchat_agent");
    expect(result.explanation.backendResponse).toBe("Your order shipped yesterday.");
    expect(result.explanation.providerMessageId).toMatch(/^webchat_\d+$/);
  });

  it("appends all seven events to ledger and replays them", async () => {
    const config = makeConfig({
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    const conversationId = result.events[0]!.conversation_id;
    const replayed = pipeline.replayConversation(conversationId);
    expect(replayed).toHaveLength(7);
    expect(replayed.map((e) => e.event_type)).toEqual(result.events.map((e) => e.event_type));
  });

  it("works with SQLite durable ledger store", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const config = makeConfig({
        routeAgentName: "b1",
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

  it("produces event.blocked when backend is down", async () => {
    const config = makeConfig({
      resolveAgent: (name) => (name === "b1" ? createFailingAgent() : undefined),
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBeDefined();
    expect(result.events).toHaveLength(5);

    const blockedEvent = result.events[4]!;
    expect(blockedEvent.event_type).toBe("event.blocked");
    expect(blockedEvent.payload["block_stage"]).toBe("backend_invocation");

    const v = validators.validateEvent(blockedEvent);
    expect(v.ok).toBe(true);
  });

  it("produces event.blocked when delivery fails after retries exhausted", async () => {
    const failingAdapter: ChannelAdapter = {
      channelType: "test",
      describeCapabilities: () => ({
        channel: "test",
        messaging: { text: true, attachments: false, reactions: false, threads: false },
        streaming: { progressiveUpdate: false, nativeStreaming: false },
        interactive: { buttons: false, menus: false, commands: false },
        delivery: { retry: false, chunking: false, edit: false },
      }),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => { throw new Error("Slack API unreachable"); },
      }),
    };
    const config = await makeConfig({
      routeAgentName: "b1",
      channel: failingAdapter,
      retryConfig: { maxRetries: 0 },
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("Slack API unreachable");
    expect(result.events).toHaveLength(6);

    const blockedEvent = result.events[5]!;
    expect(blockedEvent.event_type).toBe("event.blocked");
    expect(blockedEvent.payload["block_stage"]).toBe("delivery");
    expect(blockedEvent.payload["retryable"]).toBe(false);

    const v = validators.validateEvent(blockedEvent);
    expect(v.ok).toBe(true);
  });

  it("fails gracefully with invalid input", async () => {
    const config = makeConfig({
      routeAgentName: "b1",
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    await expect(pipeline.execute({ text: "" })).rejects.toThrow("Ingress failed");
  });

  it("builds conversation history from ledger for multi-turn context", async () => {
    const { InMemoryEventLedgerStore } = await import("@chat-agent-relay/event-ledger");
    const sharedStore = new InMemoryEventLedgerStore();

    const firstInput = validInput();
    const config = makeConfig({ ledgerStore: sharedStore });
    const pipeline1 = await FirstExecutablePathPipeline.create(config);
    const result1 = await pipeline1.execute(firstInput);
    expect(result1.events).toHaveLength(7);

    const conversationId = result1.events[0]!.conversation_id;

    const secondInput = {
      ...firstInput,
      client_message_id: "web_msg_002",
      text: "What is the tracking number?",
      conversation_id: conversationId,
      session_id: result1.events[0]!.session_id,
    };

    const config2 = makeConfig({ ledgerStore: sharedStore });
    const pipeline2 = await FirstExecutablePathPipeline.create(config2);
    const result2 = await pipeline2.execute(secondInput);
    expect(result2.events).toHaveLength(7);

    const stored = sharedStore.getByConversationId(conversationId);
    const userMsgs = stored.filter((e) => e.event_type === "message.received");
    const assistantMsgs = stored.filter((e) => e.event_type === "agent.response.completed");
    expect(userMsgs.length).toBeGreaterThanOrEqual(2);
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("short-circuits with event.blocked when policy denies", async () => {
    const config = makeConfig({
      policyId: "content_filter",
      policyFn: () => ({ decision: "deny", reason: "spam_detected" }),
    });

    const pipeline = await FirstExecutablePathPipeline.create(config);
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("spam_detected");
    expect(result.events).toHaveLength(3);
    expect(result.events[0]!.event_type).toBe("message.received");
    expect(result.events[1]!.event_type).toBe("policy.decision.made");
    expect(result.events[1]!.payload["decision"]).toBe("deny");
    expect(result.events[1]!.payload["stage"]).toBe("inbound");
    expect(result.events[2]!.event_type).toBe("event.blocked");
    expect(result.events[2]!.payload["block_stage"]).toBe("governance");

    const v = validators.validateEvent(result.events[2]!);
    expect(v.ok).toBe(true);
  });

  it("allows senders included in allowlist", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      accessControl: { mode: "allowlist", senders: ["user_123"] },
    }));

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBeUndefined();
    expect(result.events[0]!.event_type).toBe("message.received");
  });

  it("blocks senders missing from allowlist", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      accessControl: { mode: "allowlist", senders: ["someone_else"] },
    }));

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[1]!.event_type).toBe("event.blocked");
    expect(result.events[1]!.payload["block_stage"]).toBe("access_control");
  });

  it("blocks senders included in blocklist", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      accessControl: { mode: "blocklist", senders: ["user_123"] },
    }));

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBe(true);
    expect(result.events[1]!.payload["block_stage"]).toBe("access_control");
  });

  it("rate limits repeated messages from the same sender", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      rateLimiter: new RateLimiter({ maxPerMinute: 1, scope: "sender" }),
    }));

    const first = await pipeline.execute(validInput());
    const second = await pipeline.execute({ ...validInput(), client_message_id: "web_msg_002" });

    expect(first.blocked).toBeUndefined();
    expect(second.blocked).toBe(true);
    expect(second.events[1]!.event_type).toBe("event.blocked");
    expect(second.events[1]!.payload["block_stage"]).toBe("rate_limit");
  });

  it("does not share sender-scoped limits across senders", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      rateLimiter: new RateLimiter({ maxPerMinute: 1, scope: "sender" }),
    }));

    const first = await pipeline.execute(validInput());
    const second = await pipeline.execute({
      ...validInput(),
      client_message_id: "web_msg_002",
      user_id: "user_456",
    });

    expect(first.blocked).toBeUndefined();
    expect(second.blocked).toBeUndefined();
  });

  it("blocks outbound delivery when outbound policy denies", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      outboundPolicyId: "outbound_filter",
      outboundPolicyFn: () => ({ decision: "deny", reason: "pii_detected" }),
      agent: createMockAgent("SSN 123-45-6789"),
    }));

    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("pii_detected");
    expect(result.events).toHaveLength(7);
    expect(result.events[5]!.event_type).toBe("policy.decision.made");
    expect(result.events[5]!.payload["stage"]).toBe("outbound");
    expect(result.events[6]!.event_type).toBe("event.blocked");
    expect(result.events[6]!.payload["block_stage"]).toBe("outbound_governance");
  });

  it("delivers normally when outbound policy allows", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig({
      outboundPolicyId: "outbound_filter",
      outboundPolicyFn: () => ({ decision: "allow" }),
    }));

    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(result.events.map((event) => event.event_type)).toEqual([
      "message.received",
      "policy.decision.made",
      "route.decision.made",
      "agent.invocation.requested",
      "agent.response.completed",
      "policy.decision.made",
      "message.send.requested",
      "message.sent",
    ]);
    expect(result.events[5]!.payload["stage"]).toBe("outbound");
  });

  it("keeps existing behavior when no new governance config is supplied", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(makeConfig());
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(result.events).toHaveLength(7);
    expect(result.events.map((event) => event.event_type)).not.toContain("event.blocked");
  });
});
