import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";
import type {
  AgentAdapter,
  AgentInvocationContext,
  AgentResult,
  ChannelAdapter,
  InboundAttachment,
} from "@chat-agent-relay/contract-harness";
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
        payload: { text, status: "completed" },
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

function createFailingAgent(): AgentAdapter {
  return {
    invoke: async (): Promise<AgentResult> => ({
      ok: false,
      requestId: `req_${crypto.randomUUID()}`,
      error: { code: "agent_unreachable", message: "Agent unreachable", retryable: true, category: "backend" },
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

/** Agent response includes optional reaction egress hint (see delivery.applyBestEffortReaction). */
function createMockAgentWithReactionHint(
  reaction: { emoji: string; target_message_id: string },
  text = "Your order shipped yesterday.",
): AgentAdapter {
  const base = createMockAgent(text);
  return {
    ...base,
    invoke: async (ctx: AgentInvocationContext): Promise<AgentResult> => {
      const r = await base.invoke(ctx);
      if (!r.ok) return r;
      const prev = r.event.provider_extensions;
      const baseExt =
        prev !== undefined && typeof prev === "object" && prev !== null && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
      return {
        ...r,
        event: {
          ...r.event,
          provider_extensions: {
            ...baseExt,
            reaction,
          },
        },
      };
    },
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

  it("calls sendTyping before agent.invoke when the sender implements sendTyping", async () => {
    const callOrder: string[] = [];
    const baseAgent = createMockAgent();
    const agent: AgentAdapter = {
      ...baseAgent,
      invoke: async (ctx: AgentInvocationContext) => {
        callOrder.push("invoke");
        return baseAgent.invoke(ctx);
      },
    };

    const typingChannel: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => {
          callOrder.push("send");
          return { providerMessageId: "webchat_1" };
        },
        sendTyping: async () => {
          callOrder.push("typing");
        },
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({ routeAgentName: "b1", channel: typingChannel, agent }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(callOrder[0]).toBe("typing");
    expect(callOrder[1]).toBe("invoke");
    expect(callOrder).toContain("send");
  });

  it("completes the happy path when the sender has no sendTyping", async () => {
    const channelWithoutTyping: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => ({ providerMessageId: "webchat_99" }),
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({ routeAgentName: "b1", channel: channelWithoutTyping }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.events).toHaveLength(7);
    expect(result.blocked).toBeUndefined();
  });

  it("ignores sendTyping failures and still completes the happy path", async () => {
    const flakyTypingChannel: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => ({ providerMessageId: "webchat_typing_err" }),
        sendTyping: async () => {
          throw new Error("typing indicator failed");
        },
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({ routeAgentName: "b1", channel: flakyTypingChannel }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.events).toHaveLength(7);
    expect(result.blocked).toBeUndefined();
  });

  it("calls addReaction when agent response includes provider_extensions.reaction", async () => {
    const reactionCalls: { messageId: string; emoji: string }[] = [];
    const reactionChannel: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => ({ providerMessageId: "webchat_reaction_1" }),
        addReaction: async (messageId, emoji) => {
          reactionCalls.push({ messageId, emoji });
        },
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        routeAgentName: "reaction_agent",
        channel: reactionChannel,
        agent: createMockAgentWithReactionHint({ emoji: "thumbsup", target_message_id: "msg_123" }),
      }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(reactionCalls).toEqual([{ messageId: "msg_123", emoji: "thumbsup" }]);
    expect(result.events.map((e) => e.event_type)).toContain("message.sent");
  });

  it("does not call addReaction when no reaction hint is present", async () => {
    let reactionCallCount = 0;
    const channel: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => ({ providerMessageId: "webchat_no_rx" }),
        addReaction: async () => {
          reactionCallCount++;
        },
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({ routeAgentName: "b1", channel, agent: createMockAgent() }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(reactionCallCount).toBe(0);
    expect(result.events).toHaveLength(7);
  });

  it("does not block delivery when addReaction fails", async () => {
    const reactionChannel: ChannelAdapter = {
      channelType: ingress.channelType,
      describeCapabilities: () => ingress.describeCapabilities(),
      canonicalize: (raw) => ingress.canonicalize(raw),
      createSender: () => ({
        send: async () => ({ providerMessageId: "webchat_rx_fail_ok" }),
        addReaction: async () => {
          throw new Error("reactions API unavailable");
        },
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        routeAgentName: "reaction_fail_agent",
        channel: reactionChannel,
        agent: createMockAgentWithReactionHint({ emoji: "+1", target_message_id: "msg_999" }),
      }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    expect(result.events).toHaveLength(7);
    expect(result.events[result.events.length - 1]!.event_type).toBe("message.sent");
    expect(result.explanation.providerMessageId).toBe("webchat_rx_fail_ok");
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
        send: async () => {
          throw new Error("Slack API unreachable");
        },
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
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        accessControl: { mode: "allowlist", senders: ["user_123"] },
      }),
    );

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBeUndefined();
    expect(result.events[0]!.event_type).toBe("message.received");
  });

  it("blocks senders missing from allowlist", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        accessControl: { mode: "allowlist", senders: ["someone_else"] },
      }),
    );

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[1]!.event_type).toBe("event.blocked");
    expect(result.events[1]!.payload["block_stage"]).toBe("access_control");
  });

  it("blocks senders included in blocklist", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        accessControl: { mode: "blocklist", senders: ["user_123"] },
      }),
    );

    const result = await pipeline.execute(validInput());
    expect(result.blocked).toBe(true);
    expect(result.events[1]!.payload["block_stage"]).toBe("access_control");
  });

  it("rate limits repeated messages from the same sender", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        rateLimiter: new RateLimiter({ maxPerMinute: 1, scope: "sender" }),
      }),
    );

    const first = await pipeline.execute(validInput());
    const second = await pipeline.execute({ ...validInput(), client_message_id: "web_msg_002" });

    expect(first.blocked).toBeUndefined();
    expect(second.blocked).toBe(true);
    expect(second.events[1]!.event_type).toBe("event.blocked");
    expect(second.events[1]!.payload["block_stage"]).toBe("rate_limit");
  });

  it("does not share sender-scoped limits across senders", async () => {
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        rateLimiter: new RateLimiter({ maxPerMinute: 1, scope: "sender" }),
      }),
    );

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
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        outboundPolicyId: "outbound_filter",
        outboundPolicyFn: () => ({ decision: "deny", reason: "pii_detected" }),
        agent: createMockAgent("SSN 123-45-6789"),
      }),
    );

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
    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({
        outboundPolicyId: "outbound_filter",
        outboundPolicyFn: () => ({ decision: "allow" }),
      }),
    );

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

  it("processes command.received through the full pipeline", async () => {
    const commandAdapter: ChannelAdapter = {
      channelType: "slack",
      describeCapabilities: () => ({
        channel: "slack",
        messaging: { text: true, attachments: false, reactions: false, threads: false },
        streaming: { progressiveUpdate: false, nativeStreaming: false },
        interactive: { buttons: false, menus: false, commands: true },
        delivery: { retry: true, chunking: false, edit: false },
      }),
      canonicalize: (raw: unknown) => {
        const input = raw as Record<string, string>;
        return {
          ok: true as const,
          idempotencyKey: `cmd:${input.trigger_id}`,
          event: {
            event_id: `evt_${crypto.randomUUID()}`,
            schema_version: "v1alpha1",
            event_type: "command.received",
            tenant_id: "tenant_acme",
            workspace_id: "ws_support",
            channel: "slack",
            channel_instance_id: "slack_acme",
            conversation_id: `conv_${crypto.randomUUID()}`,
            session_id: `sess_${crypto.randomUUID()}`,
            correlation_id: `corr_${crypto.randomUUID()}`,
            occurred_at: new Date().toISOString(),
            actor_type: "end_user",
            actor: { id: "user_123" },
            payload: { command_name: input.command, text: input.text, arguments: {} },
          },
        };
      },
      createSender: () => ({
        send: async (text: string) => ({ providerMessageId: `prov_${crypto.randomUUID()}` }),
      }),
    };

    const agent = createMockAgent("Command response: order status");
    const pipeline = await FirstExecutablePathPipeline.create({
      channel: commandAdapter,
      resolveAgent: (name) => (name === "cmd_agent" ? agent : undefined),
      routeFn: () => ({ agentName: "cmd_agent", routeId: 1, matchType: "default", reason: "default" }),
    });

    const result = await pipeline.execute({ command: "status", text: "my order", trigger_id: "t1" });

    expect(result.blocked).toBeUndefined();
    expect(result.events).toHaveLength(7);
    expect(result.events[0]!.event_type).toBe("command.received");
    expect(result.events[0]!.payload["command_name"]).toBe("status");
    expect(result.events.map((e) => e.event_type)).toEqual([
      "command.received",
      "policy.decision.made",
      "route.decision.made",
      "agent.invocation.requested",
      "agent.response.completed",
      "message.send.requested",
      "message.sent",
    ]);
    expect(result.explanation.inboundText).toBe("/status my order");
  });

  it("passes command text correctly to agent invocation context", async () => {
    let capturedContext: AgentInvocationContext | undefined;
    const capturingAgent: AgentAdapter = {
      invoke: async (ctx: AgentInvocationContext): Promise<AgentResult> => {
        capturedContext = ctx;
        return createMockAgent().invoke(ctx);
      },
      describeCapabilities: () => ({
        streaming: false, multiTurn: false, resume: false, hitl: false, cancel: false, artifacts: false,
      }),
    };

    const commandAdapter: ChannelAdapter = {
      channelType: "test",
      describeCapabilities: () => ({
        channel: "test",
        messaging: { text: true, attachments: false, reactions: false, threads: false },
        streaming: { progressiveUpdate: false, nativeStreaming: false },
        interactive: { buttons: false, menus: false, commands: true },
        delivery: { retry: true, chunking: false, edit: false },
      }),
      canonicalize: () => ({
        ok: true as const,
        idempotencyKey: "cmd:test",
        event: {
          event_id: `evt_${crypto.randomUUID()}`,
          schema_version: "v1alpha1",
          event_type: "command.received",
          tenant_id: "t1",
          workspace_id: "w1",
          channel: "test",
          channel_instance_id: "test1",
          conversation_id: `conv_${crypto.randomUUID()}`,
          session_id: `sess_${crypto.randomUUID()}`,
          correlation_id: `corr_${crypto.randomUUID()}`,
          occurred_at: new Date().toISOString(),
          actor_type: "end_user",
          payload: { command_name: "echo", text: "hello world", arguments: {} },
        },
      }),
      createSender: () => ({
        send: async () => ({ providerMessageId: `prov_${crypto.randomUUID()}` }),
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create({
      channel: commandAdapter,
      resolveAgent: () => capturingAgent,
      routeFn: () => ({ agentName: "test", routeId: 1, matchType: "default", reason: "default" }),
    });

    await pipeline.execute({});
    expect(capturedContext).toBeDefined();
    expect(capturedContext!.messageText).toBe("/echo hello world");
  });

  it("maps inbound attachments to FilePart entries in AgentInvocationContext.parts", async () => {
    let capturedContext: AgentInvocationContext | undefined;
    const capturingAgent: AgentAdapter = {
      invoke: async (ctx: AgentInvocationContext): Promise<AgentResult> => {
        capturedContext = ctx;
        return createMockAgent("Got your files.").invoke(ctx);
      },
      describeCapabilities: () => ({
        streaming: false,
        multiTurn: false,
        resume: false,
        hitl: false,
        cancel: false,
        artifacts: false,
      }),
    };

    const attachments: InboundAttachment[] = [
      {
        attachment_id: "att_1",
        kind: "file",
        filename: "notes.txt",
        mime_type: "text/plain",
        url: "https://cdn.example/notes.txt",
      },
      {
        attachment_id: "att_2",
        kind: "image",
        mime_type: "image/png",
        url: "https://cdn.example/pic.png",
      },
    ];

    const attachmentChannel: ChannelAdapter = {
      channelType: "test",
      describeCapabilities: () => ({
        channel: "test",
        messaging: { text: true, attachments: true, reactions: false, threads: false },
        streaming: { progressiveUpdate: false, nativeStreaming: false },
        interactive: { buttons: false, menus: false, commands: false },
        delivery: { retry: true, chunking: false, edit: false },
      }),
      canonicalize: () => ({
        ok: true as const,
        idempotencyKey: "attach:test",
        event: {
          event_id: `evt_${crypto.randomUUID()}`,
          schema_version: "v1alpha1",
          event_type: "message.received",
          tenant_id: "t1",
          workspace_id: "w1",
          channel: "test",
          channel_instance_id: "test1",
          conversation_id: `conv_${crypto.randomUUID()}`,
          session_id: `sess_${crypto.randomUUID()}`,
          correlation_id: `corr_${crypto.randomUUID()}`,
          occurred_at: new Date().toISOString(),
          actor_type: "end_user",
          payload: { text: "", attachments },
        },
      }),
      createSender: () => ({
        send: async () => ({ providerMessageId: `prov_${crypto.randomUUID()}` }),
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create({
      channel: attachmentChannel,
      resolveAgent: () => capturingAgent,
      routeFn: () => ({ agentName: "test", routeId: 1, matchType: "default", reason: "default" }),
    });

    const result = await pipeline.execute({});
    expect(result.blocked).toBeUndefined();
    expect(capturedContext).toBeDefined();
    expect(capturedContext!.parts).toBeDefined();
    expect(capturedContext!.parts).toEqual([
      {
        kind: "file",
        name: "notes.txt",
        mimeType: "text/plain",
        uri: "https://cdn.example/notes.txt",
      },
      {
        kind: "file",
        name: "att_2",
        mimeType: "image/png",
        uri: "https://cdn.example/pic.png",
      },
    ]);
  });

  it("propagates agent result artifacts onto agent.response.completed provider_extensions", async () => {
    const artifacts = [
      {
        artifactId: "art_1",
        name: "Export",
        parts: [
          {
            kind: "file" as const,
            name: "report.pdf",
            mimeType: "application/pdf",
            uri: "https://cdn.example/r.pdf",
          },
        ],
      },
    ];

    const agentWithArtifacts: AgentAdapter = {
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
          payload: { text: "Here is your file.", status: "completed" },
          provider_extensions: { mock: { agent: "artifacts_test" } },
        },
        artifacts,
      }),
      describeCapabilities: () => ({
        streaming: false,
        multiTurn: false,
        resume: false,
        hitl: false,
        cancel: false,
        artifacts: true,
      }),
    };

    const pipeline = await FirstExecutablePathPipeline.create(
      makeConfig({ routeAgentName: "default_webchat_agent", agent: agentWithArtifacts }),
    );
    const result = await pipeline.execute(validInput());

    expect(result.blocked).toBeUndefined();
    const completed = result.events.find((e) => e.event_type === "agent.response.completed");
    expect(completed).toBeDefined();
    const ext = completed!.provider_extensions as Record<string, unknown>;
    expect(ext["mock"]).toBeDefined();
    expect(ext["artifacts"]).toEqual(artifacts);
  });
});
