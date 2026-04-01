import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { TeamsIngress } from "@chat-agent-relay/channel-teams";
import type { AgentAdapter, AgentInvocationContext, AgentResult } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SqliteLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { FirstExecutablePathPipeline } from "../src/pipeline";
import type { PipelineConfig } from "../src/types";

type BunServer = Server<unknown>;

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "teams-integration-test.db");

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
        payload: { text: "Thanks, your Teams message was received.", status: "completed" },
        provider_extensions: { mock: { agent: "test" } },
      },
    }),
    describeCapabilities: () => ({ streaming: false, multiTurn: false, resume: false }),
  };
}

function sampleTeamsActivity(serviceUrl: string) {
  return {
    id: "activity-123",
    type: "message",
    text: "<at>Relay Bot</at> hello from teams",
    timestamp: "2026-04-01T12:00:00.000Z",
    serviceUrl,
    channelId: "msteams",
    conversation: { id: "conv-123", tenantId: "tenant-abc" },
    from: { id: "user-123", name: "Ada Lovelace" },
    recipient: { id: "bot-123", name: "Relay Bot" },
    channelData: { tenant: { id: "tenant-abc" } },
  };
}

describe("Teams -> Pipeline -> Agent integration", () => {
  let mockTeamsApi: BunServer;
  let mockTeamsPort: number;
  let validators: ContractHarnessValidators;
  let originalFetch: typeof globalThis.fetch;
  let teamsSendCalls: Array<{ url: string; method: string; authorization: string | null; body: Record<string, unknown> }>;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    teamsSendCalls = [];
    mockTeamsApi = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        teamsSendCalls.push({
          url: req.url,
          method: req.method,
          authorization: req.headers.get("authorization"),
          body,
        });
        return Response.json({ id: "reply-456" });
      },
    });
    mockTeamsPort = mockTeamsApi.port!;

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url === "https://login.microsoftonline.com/teams-tenant/oauth2/v2.0/token") {
        return new Response(JSON.stringify({ access_token: "teams-token", expires_in: 3600 }), { status: 200 });
      }
      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    validators = await ContractHarnessValidators.create();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    mockTeamsApi.stop(true);
    cleanTestDb();
  });

  async function createPipeline(ledgerStore?: SqliteLedgerStore): Promise<FirstExecutablePathPipeline> {
    const adapter = await TeamsIngress.create("app-id", "app-secret", "teams-tenant", "tenant_acme", "ws_support");
    const agent = createMockAgent();

    const config: PipelineConfig = {
      resolveAgent: (name) => (name === "test-agent" ? agent : undefined),
      routeFn: () => ({
        agentName: "test-agent",
        routeId: 0,
        matchType: "default",
        reason: "teams_integration",
      }),
      channel: adapter,
      ledgerStore,
    };

    return FirstExecutablePathPipeline.create(config);
  }

  it("runs the complete Teams -> Agent -> Teams happy path", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

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
    const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

    for (const event of result.events) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("carries the Teams user message through to agent and back", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

    expect(result.explanation.inboundText).toBe("hello from teams");
    expect(result.explanation.backendResponse).toBe("Thanks, your Teams message was received.");
  });

  it("delivers the agent response via Teams send function", async () => {
    teamsSendCalls = [];
    const pipeline = await createPipeline();
    await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

    expect(teamsSendCalls).toHaveLength(1);
    expect(teamsSendCalls[0]!.url).toBe(`http://localhost:${mockTeamsPort}/v3/conversations/conv-123/activities`);
    expect(teamsSendCalls[0]!.method).toBe("POST");
    expect(teamsSendCalls[0]!.authorization).toBe("Bearer teams-token");
    expect(teamsSendCalls[0]!.body["text"]).toBe("Thanks, your Teams message was received.");
  });

  it("message.received has channel=teams and Teams metadata", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

    const msgReceived = result.events[0]!;
    expect(msgReceived.channel).toBe("teams");
    const ext = msgReceived.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["teams"]!["activity_id"]).toBe("activity-123");
    expect(ext["teams"]!["conversation_id"]).toBe("conv-123");
    expect(ext["teams"]!["service_url"]).toBe(`http://localhost:${mockTeamsPort}`);
    expect(ext["teams"]!["tenant_id"]).toBe("tenant-abc");
  });

  it("maintains full causal chain with Teams ingress", async () => {
    const pipeline = await createPipeline();
    const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.causation_id).toBe(result.events[i - 1]!.event_id);
    }
  });

  it("persists all seven events in SQLite ledger", async () => {
    cleanTestDb();
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const pipeline = await createPipeline(store);
      const result = await pipeline.execute(sampleTeamsActivity(`http://localhost:${mockTeamsPort}`));

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
