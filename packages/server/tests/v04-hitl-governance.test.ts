import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type {
  AgentAdapter,
  AgentEvent,
  AgentInvocationContext,
  AgentResult,
  CanonicalEvent,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
} from "@chat-agent-relay/contract-harness";
import { RouteEngine, SqliteConfigStore } from "@chat-agent-relay/config-store";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import { createPolicyFn, loadPolicyFromFile, type PolicyConfig, type PolicyDecision, type PolicyFn } from "@chat-agent-relay/middleware";
import type { Server } from "bun";
import { AgentRegistry } from "../src/agent-registry";
import { startApiServer } from "../src/api";
import { ChannelRegistry } from "../src/channel-registry";
import { setupPolicyFileWatchers } from "../src/main";

const DEFAULT_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

type BunServer = Server<unknown>;

type PendingSession = {
  sessionHandle: string;
  agentName: string;
  createdAt: number;
  timeoutMs: number;
  inputRequestedEventId?: string;
};


type RuntimeState = {
  inboundPolicy?: (event: CanonicalEvent) => PolicyDecision;
  outboundPolicy?: (event: CanonicalEvent) => PolicyDecision;
};

type Runtime = {
  server: BunServer;
  baseUrl: string;
  configDb: SqliteConfigStore;
  ledgerStore: InMemoryEventLedgerStore;
  agentRegistry: AgentRegistry;
  channelRegistry: ChannelRegistry;
  pendingSessions: Map<string, PendingSession>;
  sender: MockTextSender;
  adapter: PassThroughAdapter;
  sendIncoming: (event: CanonicalEvent) => Promise<void>;
  agent: MockAgent;
};

function nowIso(): string {
  return new Date().toISOString();
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function messageEvent(params: {
  channel: string;
  channelInstanceId: string;
  conversationId: string;
  text: string;
  providerExtensions: Record<string, unknown>;
}): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "message.received",
    tenant_id: "tenant_test",
    workspace_id: "ws_test",
    channel: params.channel,
    channel_instance_id: params.channelInstanceId,
    conversation_id: params.conversationId,
    session_id: `sess_${crypto.randomUUID()}`,
    correlation_id: `corr_${crypto.randomUUID()}`,
    occurred_at: nowIso(),
    actor_type: "end_user",
    actor: { id: `user_${crypto.randomUUID()}` },
    identity_refs: { channel_user_id: `user_${crypto.randomUUID()}` },
    payload: { text: params.text },
    provider_extensions: params.providerExtensions,
  };
}

function invocationEvent(channel: string, channelInstanceId: string, conversationId: string): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "agent.invocation.requested",
    tenant_id: "tenant_test",
    workspace_id: "ws_test",
    channel,
    channel_instance_id: channelInstanceId,
    conversation_id: conversationId,
    session_id: `sess_${crypto.randomUUID()}`,
    correlation_id: `corr_${crypto.randomUUID()}`,
    causation_id: `evt_${crypto.randomUUID()}`,
    occurred_at: nowIso(),
    actor_type: "system",
    payload: { backend: "mock-agent" },
  };
}

function successfulResponse(invocation: CanonicalEvent, text: string, options?: { sessionHandle?: string; inputRequired?: boolean }): AgentResult {
  return {
    ok: true,
    requestId: `req_${crypto.randomUUID()}`,
    event: {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "agent.response.completed",
      tenant_id: invocation.tenant_id,
      workspace_id: invocation.workspace_id,
      channel: invocation.channel,
      ...(invocation.channel_instance_id !== undefined
        ? { channel_instance_id: invocation.channel_instance_id }
        : {}),
      conversation_id: invocation.conversation_id,
      session_id: invocation.session_id,
      correlation_id: invocation.correlation_id,
      causation_id: invocation.event_id,
      occurred_at: nowIso(),
      actor_type: "agent",
      payload: { text, status: options?.inputRequired ? "input-required" : "completed" },
      provider_extensions: {
        a2a: {
          task_state: options?.inputRequired ? "input-required" : "completed",
          ...(options?.inputRequired ? { input_required: true } : {}),
        },
      },
    },
    ...(options?.sessionHandle ? { sessionHandle: options.sessionHandle } : {}),
  };
}

function inputRequiredResponse(channel: string, channelInstanceId: string, conversationId: string, prompt: string, sessionHandle: string): AgentResult {
  return successfulResponse(invocationEvent(channel, channelInstanceId, conversationId), prompt, {
    sessionHandle,
    inputRequired: true,
  });
}

class MockTextSender implements ChannelSender {
  sent: string[] = [];
  edits: Array<{ providerMessageId: string; text: string }> = [];
  private nextId = 1;

  async send(text: string): Promise<{ providerMessageId: string }> {
    this.sent.push(text);
    return { providerMessageId: `msg_${this.nextId++}` };
  }

  async edit(providerMessageId: string, text: string): Promise<void> {
    this.edits.push({ providerMessageId, text });
  }
}

class PassThroughAdapter implements ChannelAdapter {
  readonly channelType: string;
  duplicateMode = false;

  constructor(channelType: string, private readonly sender: MockTextSender) {
    this.channelType = channelType;
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: this.channelType,
      messaging: { text: true, attachments: false, reactions: true, threads: true },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: true },
      delivery: { retry: true, chunking: true, edit: true },
    };
  }

  canonicalize(raw: unknown) {
    const event = raw as CanonicalEvent;
    const stableKey = `${this.channelType}:${event.conversation_id}:${event.event_type}`;
    return { ok: true as const, event, idempotencyKey: this.duplicateMode ? stableKey : `${stableKey}:${crypto.randomUUID()}` };
  }

  createSender(): ChannelSender {
    return this.sender;
  }
}

class MockAgent implements AgentAdapter {
  invokeCalls: AgentInvocationContext[] = [];
  resumeCalls: Array<{ sessionHandle: string; messageText: string }> = [];
  invokeResult: AgentResult;
  resumeQueue: AgentResult[];
  resumeStreamQueue: Array<{ chunks: string[]; result: AgentResult }>;
  streaming: boolean;

  constructor(options: {
    invokeResult: AgentResult;
    resumeQueue?: AgentResult[];
    resumeStreamQueue?: Array<{ chunks: string[]; result: AgentResult }>;
    streaming?: boolean;
  }) {
    this.invokeResult = options.invokeResult;
    this.resumeQueue = [...(options.resumeQueue ?? [])];
    this.resumeStreamQueue = [...(options.resumeStreamQueue ?? [])];
    this.streaming = options.streaming ?? false;
  }

  describeCapabilities() {
    return {
      streaming: this.streaming,
      multiTurn: true,
      resume: true,
      hitl: true,
      cancel: false,
      artifacts: false,
    };
  }

  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    this.invokeCalls.push(context);
    return rebindResult(this.invokeResult, context.invocationEvent);
  }

  async resume(sessionHandle: string, input: { messageText: string; invocationEvent: CanonicalEvent }): Promise<AgentResult> {
    this.resumeCalls.push({ sessionHandle, messageText: input.messageText });
    const next = this.resumeQueue.shift();
    if (!next) {
      return {
        ok: false,
        requestId: `req_${crypto.randomUUID()}`,
        error: { code: "missing_resume", message: "No resume result configured", retryable: false, category: "user_error" },
      };
    }
    return rebindResult(next, input.invocationEvent);
  }

  async *resumeStream(sessionHandle: string, input: { messageText: string; invocationEvent: CanonicalEvent }): AsyncGenerator<AgentEvent, AgentResult> {
    this.resumeCalls.push({ sessionHandle, messageText: input.messageText });
    const next = this.resumeStreamQueue.shift();
    if (!next) {
      return {
        ok: false,
        requestId: `req_${crypto.randomUUID()}`,
        error: { code: "missing_resume_stream", message: "No resume stream result configured", retryable: false, category: "user_error" },
      };
    }
    for (const chunk of next.chunks) {
      yield { type: "text_delta", content: chunk };
    }
    return rebindResult(next.result, input.invocationEvent);
  }
}

function rebindResult(result: AgentResult, invocation: CanonicalEvent): AgentResult {
  if (!result.ok) return result;
  return {
    ...result,
    event: {
      ...result.event,
      tenant_id: invocation.tenant_id,
      workspace_id: invocation.workspace_id,
      channel: invocation.channel,
      ...(invocation.channel_instance_id !== undefined
        ? { channel_instance_id: invocation.channel_instance_id }
        : {}),
      conversation_id: invocation.conversation_id,
      session_id: invocation.session_id,
      correlation_id: invocation.correlation_id,
      causation_id: invocation.event_id,
      occurred_at: nowIso(),
    },
  };
}

async function createRuntime(options: {
  channelName: string;
  channelType: string;
  agent: MockAgent;
  initialInboundPolicy?: (event: CanonicalEvent) => PolicyDecision;
  initialOutboundPolicy?: (event: CanonicalEvent) => PolicyDecision;
  pendingTimeoutMs?: number;
}): Promise<Runtime> {
  const configDb = new SqliteConfigStore(":memory:");
  const ledgerStore = new InMemoryEventLedgerStore();
  const pendingSessions = new Map<string, PendingSession>();
  const runtimeState: RuntimeState = {
    ...(options.initialInboundPolicy !== undefined ? { inboundPolicy: options.initialInboundPolicy } : {}),
    ...(options.initialOutboundPolicy !== undefined ? { outboundPolicy: options.initialOutboundPolicy } : {}),
  };
  const sender = new MockTextSender();
  const adapter = new PassThroughAdapter(options.channelType, sender);
  const agentName = "mock-agent";
  const pendingTimeoutMs = options.pendingTimeoutMs ?? DEFAULT_PENDING_TIMEOUT_MS;

  const agentRegistry = new AgentRegistry();
  agentRegistry.registerFactory("a2a", async () => options.agent);
  await configDb.addAgent(agentName, "a2a", { endpoint: "http://mock-agent" });
  for (const record of await configDb.listAgents()) {
    await agentRegistry.register(record);
  }

  const channelRegistry = new ChannelRegistry(async () => {});
  await configDb.addChannel(options.channelName, options.channelType as never, {});

  function deriveEvent(source: CanonicalEvent, causationId: string, eventType: string, actorType: string, payload: Record<string, unknown>): CanonicalEvent {
    return {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: eventType,
      tenant_id: source.tenant_id,
      workspace_id: source.workspace_id,
      channel: source.channel,
      ...(source.channel_instance_id !== undefined ? { channel_instance_id: source.channel_instance_id } : {}),
      conversation_id: source.conversation_id,
      session_id: source.session_id,
      correlation_id: source.correlation_id,
      causation_id: causationId,
      occurred_at: nowIso(),
      actor_type: actorType,
      payload,
    };
  }

  function activePending(conversationId: string): PendingSession | undefined {
    const pending = pendingSessions.get(conversationId);
    if (!pending) return undefined;
    if (Date.now() - pending.createdAt > pending.timeoutMs) {
      pendingSessions.delete(conversationId);
      return undefined;
    }
    return pending;
  }

  function storePending(conversationId: string, result: AgentResult): void {
    if (!result.ok || !result.sessionHandle) return;
    const a2a = result.event.provider_extensions?.["a2a"] as Record<string, unknown> | undefined;
    if (a2a?.["input_required"] !== true) return;

    const requested = deriveEvent(result.event, result.event.event_id, "agent.input.requested", "agent", {
      prompt: result.event.payload["text"],
      session_handle: result.sessionHandle,
    });
    ledgerStore.append(requested);
    ledgerStore.append(deriveEvent(result.event, requested.event_id, "agent.status.changed", "system", {
      status: "input-required",
      session_handle: result.sessionHandle,
      message: result.event.payload["text"],
    }));
    pendingSessions.set(conversationId, {
      sessionHandle: result.sessionHandle,
      agentName,
      createdAt: Date.now(),
      timeoutMs: pendingTimeoutMs,
      inputRequestedEventId: requested.event_id,
    });
  }

  async function runInitial(event: CanonicalEvent): Promise<void> {
    ledgerStore.append(event);

    const inboundDecision = runtimeState.inboundPolicy?.(event) ?? { decision: "allow" as const };
    const inboundPolicy = deriveEvent(event, event.event_id, "policy.decision.made", "system", {
      decision: inboundDecision.decision,
      ...(inboundDecision.reason ? { reason: inboundDecision.reason } : {}),
    });
    ledgerStore.append(inboundPolicy);
    if (inboundDecision.decision === "deny") {
      ledgerStore.append(deriveEvent(event, inboundPolicy.event_id, "event.blocked", "system", {
        reason: inboundDecision.reason ?? "denied",
        block_stage: "governance",
        retryable: false,
      }));
      return;
    }

    const routeEvent = deriveEvent(event, inboundPolicy.event_id, "route.decision.made", "system", {
      route: agentName,
      route_id: 1,
      match_type: "default",
      reason: "test-route",
    });
    ledgerStore.append(routeEvent);

    const invokeEvent = deriveEvent(event, routeEvent.event_id, "agent.invocation.requested", "system", {
      backend: agentName,
    });
    ledgerStore.append(invokeEvent);

    const result = await options.agent.invoke({ messageText: String(event.payload["text"] ?? ""), invocationEvent: invokeEvent });
    if (!result.ok) throw new Error(result.error.message);
    ledgerStore.append(result.event);
    storePending(event.conversation_id, result);

    const a2a = result.event.provider_extensions?.["a2a"] as Record<string, unknown> | undefined;
    if (a2a?.["input_required"] === true) {
      await sender.send(String(result.event.payload["text"] ?? ""));
      return;
    }

    const outboundDecision = runtimeState.outboundPolicy?.(result.event) ?? { decision: "allow" as const };
    const outboundPolicy = deriveEvent(result.event, result.event.event_id, "policy.decision.made", "system", {
      decision: outboundDecision.decision,
      stage: "outbound",
      ...(outboundDecision.reason ? { reason: outboundDecision.reason } : {}),
    });
    ledgerStore.append(outboundPolicy);
    if (outboundDecision.decision === "deny") {
      ledgerStore.append(deriveEvent(result.event, outboundPolicy.event_id, "event.blocked", "system", {
        reason: outboundDecision.reason ?? "denied",
        block_stage: "outbound_governance",
        retryable: false,
      }));
      return;
    }

    await sender.send(String(result.event.payload["text"] ?? ""));
  }

  async function resumePending(event: CanonicalEvent, pending: PendingSession): Promise<void> {
    ledgerStore.append(event);
    const inputProvided = deriveEvent(event, event.event_id, "agent.input.provided", "end_user", {
      text: event.payload["text"],
      session_handle: pending.sessionHandle,
      ...(pending.inputRequestedEventId ? { input_event_id: pending.inputRequestedEventId } : {}),
    });
    ledgerStore.append(inputProvided);
    const invokeEvent = deriveEvent(event, inputProvided.event_id, "agent.invocation.requested", "system", {
      backend: pending.agentName,
      input_event_id: inputProvided.event_id,
      resume: true,
    });
    ledgerStore.append(invokeEvent);

    let result: AgentResult;
    if (options.agent.describeCapabilities().streaming && options.agent.resumeStream) {
      const placeholder = await sender.send("...");
      let accumulated = "";
      const stream = options.agent.resumeStream(pending.sessionHandle, {
        messageText: String(event.payload["text"] ?? ""),
        invocationEvent: invokeEvent,
      });
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          result = next.value;
          break;
        }
        if (next.value.type === "text_delta") {
          accumulated += next.value.content;
          await sender.edit(placeholder.providerMessageId, accumulated);
        }
      }
    } else {
      result = await options.agent.resume(pending.sessionHandle, {
        messageText: String(event.payload["text"] ?? ""),
        invocationEvent: invokeEvent,
      });
    }

    if (!result.ok) throw new Error(result.error.message);
    ledgerStore.append(result.event);

    const a2a = result.event.provider_extensions?.["a2a"] as Record<string, unknown> | undefined;
    if (a2a?.["input_required"] === true) {
      storePending(event.conversation_id, result);
      await sender.send(String(result.event.payload["text"] ?? ""));
      return;
    }

    pendingSessions.delete(event.conversation_id);
    const outboundDecision = runtimeState.outboundPolicy?.(result.event) ?? { decision: "allow" as const };
    const outboundPolicy = deriveEvent(result.event, result.event.event_id, "policy.decision.made", "system", {
      decision: outboundDecision.decision,
      stage: "outbound",
      ...(outboundDecision.reason ? { reason: outboundDecision.reason } : {}),
    });
    ledgerStore.append(outboundPolicy);
    if (outboundDecision.decision === "deny") {
      ledgerStore.append(deriveEvent(result.event, outboundPolicy.event_id, "event.blocked", "system", {
        reason: outboundDecision.reason ?? "denied",
        block_stage: "outbound_governance",
        retryable: false,
      }));
      return;
    }

    if (!options.agent.describeCapabilities().streaming) {
      await sender.send(String(result.event.payload["text"] ?? ""));
    }
  }

  async function sendIncoming(event: CanonicalEvent): Promise<void> {
    const canonicalized = adapter.canonicalize(event);
    if (!canonicalized.ok) return;

    if (sendIncoming.seenKeys.has(canonicalized.idempotencyKey)) {
      return;
    }
    sendIncoming.seenKeys.add(canonicalized.idempotencyKey);

    const pending = activePending(canonicalized.event.conversation_id);
    if (pending) {
      await resumePending(canonicalized.event, pending);
      return;
    }
    await runInitial(canonicalized.event);
  }

  sendIncoming.seenKeys = new Set<string>();

  const server = startApiServer({
    port: 0,
    ledgerStore,
    configDb,
    agentRegistry,
    channelRegistry,
    onConfigChanged: (key, value) => {
      if (key === "policy.config") {
        try {
          const parsed = JSON.parse(value) as { rules?: Array<{ condition?: { type?: string; value?: string }; action?: "allow" | "deny"; reason?: string }> };
          const rule = parsed.rules?.[0];
          if (!rule) {
            delete runtimeState.inboundPolicy;
            return;
          }
          if (rule.condition?.type !== "channel" || !rule.condition.value || !rule.action) throw new Error("invalid");
          runtimeState.inboundPolicy = (event) => event.channel === rule.condition!.value!
            ? { decision: rule.action!, ...(rule.reason ? { reason: rule.reason } : {}) }
            : { decision: "allow" };
        } catch {
          // preserve previous policy
        }
      }

      if (key === "policy.outbound.config") {
        try {
          const parsed = JSON.parse(value) as { rules?: Array<{ condition?: { type?: string; pattern?: string }; action?: "allow" | "deny"; reason?: string }> };
          const rule = parsed.rules?.[0];
          if (!rule) {
            delete runtimeState.outboundPolicy;
            return;
          }
          if (rule.condition?.type !== "keyword" || !rule.condition.pattern || !rule.action) throw new Error("invalid");
          const pattern = rule.condition.pattern.toLowerCase();
          runtimeState.outboundPolicy = (event) => String(event.payload["text"] ?? "").toLowerCase().includes(pattern)
            ? { decision: rule.action!, ...(rule.reason ? { reason: rule.reason } : {}) }
            : { decision: "allow" };
        } catch {
          // preserve previous policy
        }
      }
    },
  });

  return {
    server,
    baseUrl: `http://localhost:${server.port}`,
    configDb,
    ledgerStore,
    agentRegistry,
    channelRegistry,
    pendingSessions,
    sender,
    adapter,
    sendIncoming,
    agent: options.agent,
  };
}

describe("v0.4 governance API", () => {
  const runtimes: Runtime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      const runtime = runtimes.pop()!;
      runtime.server.stop(true);
      await runtime.channelRegistry.shutdown();
      await runtime.agentRegistry.shutdown();
      runtime.ledgerStore.close();
      runtime.configDb.close();
    }
  });

  it("enables and disables routes live", async () => {
    const configDb = new SqliteConfigStore(":memory:");
    await configDb.addAgent("agent-a", "a2a", { endpoint: "http://a" });
    const route = configDb.addRoute("default", null, "agent-a", 0);
    const routeEngine = new RouteEngine();
    routeEngine.load(configDb.listRoutes());

    const server = startApiServer({
      port: 0,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry: new ChannelRegistry(async () => {}),
      routeEngine,
    });
    const baseUrl = `http://localhost:${server.port}`;

    const disabled = await fetch(`${baseUrl}/api/routes/${route.id}/disable`, { method: "POST" });
    expect(disabled.status).toBe(200);
    expect(routeEngine.resolve({ channelName: "webchat", messageText: "hello" })).toBeNull();

    const enabled = await fetch(`${baseUrl}/api/routes/${route.id}/enable`, { method: "POST" });
    expect(enabled.status).toBe(200);
    expect(routeEngine.resolve({ channelName: "webchat", messageText: "hello" })?.agentName).toBe("agent-a");

    server.stop(true);
    configDb.close();
  });

  it("reloads inbound policy config on next request callback", async () => {
    const configDb = new SqliteConfigStore(":memory:");
    let latest: { key: string; value: string } | undefined;

    const server = startApiServer({
      port: 0,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry: new ChannelRegistry(async () => {}),
      onConfigChanged: (key, value) => {
        latest = { key, value };
      },
    });
    const baseUrl = `http://localhost:${server.port}`;

    const res = await fetch(`${baseUrl}/api/config/policy.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: '{"rules":[]}' }),
    });
    expect(res.status).toBe(200);
    expect(latest).toEqual({ key: "policy.config", value: '{"rules":[]}' });

    server.stop(true);
    configDb.close();
  });

  it("reloads outbound policy config on next request callback", async () => {
    const configDb = new SqliteConfigStore(":memory:");
    let latest: { key: string; value: string } | undefined;

    const server = startApiServer({
      port: 0,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry: new ChannelRegistry(async () => {}),
      onConfigChanged: (key, value) => {
        latest = { key, value };
      },
    });
    const baseUrl = `http://localhost:${server.port}`;

    const res = await fetch(`${baseUrl}/api/config/policy.outbound.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: '{"rules":[]}' }),
    });
    expect(res.status).toBe(200);
    expect(latest).toEqual({ key: "policy.outbound.config", value: '{"rules":[]}' });

    server.stop(true);
    configDb.close();
  });

  it("resumes a pending Slack conversation in the same conversation", async () => {
    const conversationId = "slack_thread_1710756000.000001";
    const sessionHandle = "slack-hitl-session";
    const agent = new MockAgent({
      invokeResult: inputRequiredResponse("slack", "slack_C123", conversationId, "What is your order number?", sessionHandle),
      resumeQueue: [successfulResponse(invocationEvent("slack", "slack_C123", conversationId), "Thanks, order #12345 is on the way.")],
    });

    const runtime = await createRuntime({ channelName: "slack-main", channelType: "slack", agent });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C123",
      conversationId,
      text: "Where is my package?",
      providerExtensions: { slack: { channel_id: "C123", thread_ts: "1710756000.000001" } },
    }));

    expect(runtime.pendingSessions.get(conversationId)?.sessionHandle).toBe(sessionHandle);
    expect(runtime.sender.sent).toContain("What is your order number?");

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C123",
      conversationId,
      text: "Order 12345",
      providerExtensions: { slack: { channel_id: "C123", thread_ts: "1710756000.000001" } },
    }));

    expect(runtime.agent.resumeCalls).toEqual([{ sessionHandle, messageText: "Order 12345" }]);
    expect(runtime.pendingSessions.has(conversationId)).toBe(false);
    expect(runtime.sender.sent.at(-1)).toBe("Thanks, order #12345 is on the way.");
    expect(runtime.ledgerStore.getByConversationId(conversationId).some((event) => event.event_type === "agent.input.provided")).toBe(true);
  });

  it("resumes a pending Teams conversation in the same conversation", async () => {
    const conversationId = "conv-teams-123";
    const sessionHandle = "teams-hitl-session";
    const agent = new MockAgent({
      invokeResult: inputRequiredResponse("teams", "teams-conv-teams-123", conversationId, "Please confirm your ticket number.", sessionHandle),
      resumeQueue: [successfulResponse(invocationEvent("teams", "teams-conv-teams-123", conversationId), "Thanks, ticket #42 is confirmed.")],
    });

    const runtime = await createRuntime({ channelName: "teams-main", channelType: "teams", agent });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "teams",
      channelInstanceId: "teams-conv-teams-123",
      conversationId,
      text: "I need help with my ticket",
      providerExtensions: { teams: { conversation_id: conversationId, service_url: "https://smba.trafficmanager.net/amer/", activity_id: "activity-1" } },
    }));

    expect(runtime.pendingSessions.get(conversationId)?.sessionHandle).toBe(sessionHandle);
    expect(runtime.sender.sent).toContain("Please confirm your ticket number.");

    await runtime.sendIncoming(messageEvent({
      channel: "teams",
      channelInstanceId: "teams-conv-teams-123",
      conversationId,
      text: "Ticket 42",
      providerExtensions: { teams: { conversation_id: conversationId, service_url: "https://smba.trafficmanager.net/amer/", activity_id: "activity-2" } },
    }));

    expect(runtime.agent.resumeCalls).toEqual([{ sessionHandle, messageText: "Ticket 42" }]);
    expect(runtime.pendingSessions.has(conversationId)).toBe(false);
    expect(runtime.sender.sent.at(-1)).toBe("Thanks, ticket #42 is confirmed.");
    expect(runtime.ledgerStore.getByConversationId(conversationId).some((event) => event.event_type === "agent.input.provided")).toBe(true);
  });

  it("supports chained input-required for Discord resume", async () => {
    const conversationId = "discord:channel:9876543210987654321";
    const firstHandle = "discord-hitl-1";
    const secondHandle = "discord-hitl-2";
    const agent = new MockAgent({
      invokeResult: inputRequiredResponse("discord", "discord_guild_555", conversationId, "Need your order number.", firstHandle),
      resumeQueue: [
        inputRequiredResponse("discord", "discord_guild_555", conversationId, "Need your ZIP code.", secondHandle),
        successfulResponse(invocationEvent("discord", "discord_guild_555", conversationId), "Thanks, everything is verified."),
      ],
    });

    const runtime = await createRuntime({ channelName: "discord-main", channelType: "discord", agent });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "Help me with my order",
      providerExtensions: { discord: { channel_id: "9876543210987654321" } },
    }));
    expect(runtime.pendingSessions.get(conversationId)?.sessionHandle).toBe(firstHandle);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "12345",
      providerExtensions: { discord: { channel_id: "9876543210987654321" } },
    }));
    expect(runtime.pendingSessions.get(conversationId)?.sessionHandle).toBe(secondHandle);
    expect(runtime.sender.sent.at(-1)).toBe("Need your ZIP code.");

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "90210",
      providerExtensions: { discord: { channel_id: "9876543210987654321" } },
    }));

    expect(runtime.agent.resumeCalls).toEqual([
      { sessionHandle: firstHandle, messageText: "12345" },
      { sessionHandle: secondHandle, messageText: "90210" },
    ]);
    expect(runtime.pendingSessions.has(conversationId)).toBe(false);
    expect(runtime.sender.sent.at(-1)).toBe("Thanks, everything is verified.");
  });

  it("falls back to normal routing after timeout", async () => {
    const conversationId = "slack_thread_timeout";
    const agent = new MockAgent({
      invokeResult: inputRequiredResponse("slack", "slack_C123", conversationId, "Need more info.", "timed-out-session"),
      resumeQueue: [successfulResponse(invocationEvent("slack", "slack_C123", conversationId), "should not resume")],
    });

    const runtime = await createRuntime({
      channelName: "slack-timeout",
      channelType: "slack",
      agent,
      pendingTimeoutMs: 5,
    });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C123",
      conversationId,
      text: "First",
      providerExtensions: { slack: { channel_id: "C123" } },
    }));
    const pending = runtime.pendingSessions.get(conversationId)!;
    pending.createdAt = Date.now() - 10;

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C123",
      conversationId,
      text: "Second",
      providerExtensions: { slack: { channel_id: "C123" } },
    }));

    expect(runtime.agent.resumeCalls).toHaveLength(0);
    expect(runtime.agent.invokeCalls).toHaveLength(2);
  });

  it("hot-reloads inbound policy for the next request and preserves the old policy on invalid config", async () => {
    const conversationId = "conv-policy-inbound";
    const agent = new MockAgent({
      invokeResult: successfulResponse(invocationEvent("discord", "discord_guild_555", conversationId), "Allowed response"),
    });

    const runtime = await createRuntime({
      channelName: "discord-policy",
      channelType: "discord",
      agent,
      initialInboundPolicy: (event) => event.channel === "slack" ? { decision: "deny", reason: "slack blocked" } : { decision: "allow" },
    });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "hello",
      providerExtensions: { discord: { channel_id: "987" } },
    }));
    expect(runtime.agent.invokeCalls).toHaveLength(1);

    const updated = await fetch(`${runtime.baseUrl}/api/config/policy.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify({ rules: [{ condition: { type: "channel", value: "discord" }, action: "deny", reason: "discord blocked" }] }) }),
    });
    expect(updated.status).toBe(200);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "hello again",
      providerExtensions: { discord: { channel_id: "987" } },
    }));
    expect(runtime.agent.invokeCalls).toHaveLength(1);

    const invalid = await fetch(`${runtime.baseUrl}/api/config/policy.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "{not-json" }),
    });
    expect(invalid.status).toBe(200);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "still blocked",
      providerExtensions: { discord: { channel_id: "987" } },
    }));
    expect(runtime.agent.invokeCalls).toHaveLength(1);

    const blocked = runtime.ledgerStore.getByConversationId(conversationId).filter((event) => event.event_type === "event.blocked");
    expect(blocked.at(-1)?.payload["reason"]).toBe("discord blocked");
  });

  it("hot-reloads outbound policy for the next request and preserves the old policy on invalid config", async () => {
    const conversationId = "conv-policy-outbound";
    const agent = new MockAgent({
      invokeResult: successfulResponse(invocationEvent("slack", "slack_C999", conversationId), "safe output"),
    });

    const runtime = await createRuntime({ channelName: "slack-policy", channelType: "slack", agent });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C999",
      conversationId,
      text: "hello",
      providerExtensions: { slack: { channel_id: "C999" } },
    }));
    expect(runtime.sender.sent.at(-1)).toBe("safe output");

    runtime.agent.invokeResult = successfulResponse(invocationEvent("slack", "slack_C999", conversationId), "contains secret data");
    const updated = await fetch(`${runtime.baseUrl}/api/config/policy.outbound.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify({ rules: [{ condition: { type: "keyword", pattern: "secret" }, action: "deny", reason: "secret blocked" }] }) }),
    });
    expect(updated.status).toBe(200);

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C999",
      conversationId,
      text: "hello again",
      providerExtensions: { slack: { channel_id: "C999" } },
    }));
    expect(runtime.sender.sent.at(-1)).toBe("safe output");

    const invalid = await fetch(`${runtime.baseUrl}/api/config/policy.outbound.config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "{broken" }),
    });
    expect(invalid.status).toBe(200);

    await runtime.sendIncoming(messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C999",
      conversationId,
      text: "hello third time",
      providerExtensions: { slack: { channel_id: "C999" } },
    }));
    expect(runtime.sender.sent.at(-1)).toBe("safe output");

    const blocked = runtime.ledgerStore.getByConversationId(conversationId).filter((event) => event.event_type === "event.blocked");
    expect(blocked.at(-1)?.payload["reason"]).toBe("secret blocked");
  });

  it("does not start policy watchers when env paths are absent", () => {
    const watchCalls: string[] = [];
    const stops = setupPolicyFileWatchers({
      reloadPolicyConfig: () => {
        throw new Error("should not reload");
      },
      watchFileImpl: ((filePath: string) => {
        watchCalls.push(filePath);
        return undefined as unknown as import("node:fs").StatWatcher;
      }) as unknown as typeof import("node:fs").watchFile,
      unwatchFileImpl: (() => {}) as typeof import("node:fs").unwatchFile,
    });

    expect(watchCalls).toEqual([]);
    expect(stops).toEqual([]);
  });

  it("reloads inbound policy from watched file edits and preserves previous policy on invalid YAML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-watch-"));
    const file = join(dir, "policy.yaml");
    const watched: Array<{ filePath: string; listener: (curr: { mtimeMs: number; size: number; ino: number; isFile: () => boolean }, prev: { mtimeMs: number; size: number; ino: number; isFile: () => boolean }) => void }> = [];
    const reloads: Array<"policy.config" | "policy.outbound.config"> = [];
    const runtimeState: RuntimeState = {
      inboundPolicy: (event) => event.channel === "slack" ? { decision: "deny", reason: "slack blocked" } : { decision: "allow" },
    };
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    writeFileSync(file, "rules:\n  - id: slack-only\n    action: deny\n    condition:\n      type: channel\n      value: slack\n");

    const stops = setupPolicyFileWatchers({
      inboundPath: file,
      reloadPolicyConfig: (key) => {
        reloads.push(key);
        try {
          const parsed = loadPolicyFromFile(file) as PolicyConfig;
          const rule = parsed.rules[0];
          if (rule) {
            runtimeState.inboundPolicy = createPolicyFn(parsed);
          } else {
            delete runtimeState.inboundPolicy;
          }
        } catch {
          console.error("preserving previous policy");
        }
      },
      watchFileImpl: ((filePath: string, _options: unknown, listener: typeof watched[number]["listener"]) => {
        watched.push({ filePath, listener });
        return undefined as unknown as import("node:fs").StatWatcher;
      }) as unknown as typeof import("node:fs").watchFile,
      unwatchFileImpl: (() => {}) as typeof import("node:fs").unwatchFile,
    });

    expect(watched).toHaveLength(1);
    expect(watched[0]?.filePath).toBe(file);

    writeFileSync(file, "rules:\n  - id: discord-only\n    action: deny\n    condition:\n      type: channel\n      value: discord\n");
    watched[0]!.listener(
      { mtimeMs: 2, size: 1, ino: 1, isFile: () => true },
      { mtimeMs: 1, size: 1, ino: 1, isFile: () => true },
    );
    await nextTick();
    expect(reloads).toEqual(["policy.config"]);
    expect(runtimeState.inboundPolicy?.(messageEvent({ channel: "discord", channelInstanceId: "discord_test", conversationId: "conv-watch-discord", text: "hi", providerExtensions: { discord: { channel_id: "987" } } })).decision).toBe("deny");
    expect(runtimeState.inboundPolicy?.(messageEvent({ channel: "slack", channelInstanceId: "slack_test", conversationId: "conv-watch-slack", text: "hi", providerExtensions: { slack: { channel_id: "C123" } } })).decision).toBe("allow");

    writeFileSync(file, "rules: [\n");
    watched[0]!.listener(
      { mtimeMs: 3, size: 2, ino: 1, isFile: () => true },
      { mtimeMs: 2, size: 1, ino: 1, isFile: () => true },
    );
    await nextTick();
    expect(runtimeState.inboundPolicy?.(messageEvent({ channel: "discord", channelInstanceId: "discord_test", conversationId: "conv-watch-discord", text: "hi", providerExtensions: { discord: { channel_id: "987" } } })).decision).toBe("deny");
    expect(errorSpy).toHaveBeenCalled();

    for (const stop of stops) stop();
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves previous outbound policy on watched file deletion or unreadable file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-watch-"));
    const file = join(dir, "outbound.yaml");
    const watched: Array<{ listener: (curr: { mtimeMs: number; size: number; ino: number; isFile: () => boolean }, prev: { mtimeMs: number; size: number; ino: number; isFile: () => boolean }) => void }> = [];
    const runtimeState: RuntimeState = {
      outboundPolicy: (event) => String(event.payload["text"] ?? "").includes("secret") ? { decision: "deny", reason: "secret blocked" } : { decision: "allow" },
    };
    const warnSpy = spyOn(console, "error").mockImplementation(() => {});

    writeFileSync(file, "rules:\n  - id: block-secret\n    action: deny\n    condition:\n      type: keyword\n      pattern: secret\n");

    const stops = setupPolicyFileWatchers({
      outboundPath: file,
      reloadPolicyConfig: () => {
        try {
          const parsed = loadPolicyFromFile(file) as PolicyConfig;
          runtimeState.outboundPolicy = createPolicyFn(parsed) as PolicyFn;
        } catch {
          console.error("preserving previous outbound policy");
        }
      },
      watchFileImpl: ((_filePath: string, _options: unknown, listener: typeof watched[number]["listener"]) => {
        watched.push({ listener });
        return undefined as unknown as import("node:fs").StatWatcher;
      }) as unknown as typeof import("node:fs").watchFile,
      unwatchFileImpl: (() => {}) as typeof import("node:fs").unwatchFile,
    });

    rmSync(file, { force: true });
    watched[0]!.listener(
      { mtimeMs: 2, size: 0, ino: 1, isFile: () => false },
      { mtimeMs: 1, size: 10, ino: 1, isFile: () => true },
    );
    await nextTick();
    expect(runtimeState.outboundPolicy?.(messageEvent({ channel: "slack", channelInstanceId: "slack_test", conversationId: "conv-watch-outbound", text: "contains secret", providerExtensions: { slack: { channel_id: "C123" } } })).decision).toBe("deny");

    writeFileSync(file, "rules:\n  - id: block-secret\n    action: deny\n    condition:\n      type: keyword\n      pattern: secret\n");
    chmodSync(file, 0o000);
    watched[0]!.listener(
      { mtimeMs: 3, size: 10, ino: 1, isFile: () => true },
      { mtimeMs: 2, size: 10, ino: 1, isFile: () => true },
    );
    await nextTick();
    expect(runtimeState.outboundPolicy?.(messageEvent({ channel: "slack", channelInstanceId: "slack_test", conversationId: "conv-watch-outbound", text: "contains secret", providerExtensions: { slack: { channel_id: "C123" } } })).decision).toBe("deny");
    expect(warnSpy).toHaveBeenCalled();

    chmodSync(file, 0o644);
    for (const stop of stops) stop();
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores duplicate events at ingress before processing", async () => {
    const conversationId = "slack:channel:dupe";
    const agent = new MockAgent({
      invokeResult: successfulResponse(invocationEvent("slack", "slack_C123", conversationId), "Processed once"),
    });

    const runtime = await createRuntime({ channelName: "slack-main", channelType: "slack", agent });
    runtimes.push(runtime);
    runtime.adapter.duplicateMode = true;

    const event = messageEvent({
      channel: "slack",
      channelInstanceId: "slack_C123",
      conversationId,
      text: "dedupe me",
      providerExtensions: { slack: { channel_id: "C123", ts: "1710756000.000100" } },
    });

    await runtime.sendIncoming(event);
    await runtime.sendIncoming({ ...event, event_id: `evt_${crypto.randomUUID()}`, correlation_id: `corr_${crypto.randomUUID()}` });

    expect(runtime.agent.invokeCalls).toHaveLength(1);
    expect(runtime.sender.sent).toEqual(["Processed once"]);
    const replies = runtime.ledgerStore.getByConversationId(conversationId).filter((entry) => entry.event_type === "agent.response.completed");
    expect(replies).toHaveLength(1);
  });

  it("uses streaming resume when the channel supports progressive updates", async () => {
    const conversationId = "discord:channel:streaming";
    const sessionHandle = "discord-stream-hitl";
    const agent = new MockAgent({
      invokeResult: inputRequiredResponse("discord", "discord_guild_555", conversationId, "Need more info.", sessionHandle),
      resumeStreamQueue: [{
        chunks: ["Resumed ", "response"],
        result: successfulResponse(invocationEvent("discord", "discord_guild_555", conversationId), "Resumed response"),
      }],
      streaming: true,
    });

    const runtime = await createRuntime({ channelName: "discord-stream", channelType: "discord", agent });
    runtimes.push(runtime);

    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "start",
      providerExtensions: { discord: { channel_id: "987" } },
    }));
    await runtime.sendIncoming(messageEvent({
      channel: "discord",
      channelInstanceId: "discord_guild_555",
      conversationId,
      text: "resume me",
      providerExtensions: { discord: { channel_id: "987" } },
    }));

    expect(runtime.agent.resumeCalls).toEqual([{ sessionHandle, messageText: "resume me" }]);
    expect(runtime.sender.sent).toContain("...");
    expect(runtime.sender.edits).toEqual([
      { providerMessageId: "msg_2", text: "Resumed " },
      { providerMessageId: "msg_2", text: "Resumed response" },
    ]);
  });
});
