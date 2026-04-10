import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SqliteConfigStore } from "@chat-agent-relay/config-store";
import type { StoredCanonicalEvent } from "@chat-agent-relay/event-ledger";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { AgentRegistry } from "../src/agent-registry";
import { startApiServer } from "../src/api";
import { ChannelRegistry } from "../src/channel-registry";

type BunServer = Server<unknown>;

function makeEvent(
  tenantId: string,
  conversationId: string,
  correlationId: string,
  eventType = "message.received",
): StoredCanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: eventType,
    tenant_id: tenantId,
    workspace_id: `ws_${tenantId}`,
    channel: "webchat",
    channel_instance_id: "webchat",
    conversation_id: conversationId,
    session_id: "sess_1",
    correlation_id: correlationId,
    occurred_at: new Date().toISOString(),
    actor_type: "end_user",
    payload: { text: `hello from ${tenantId}` },
  };
}

describe("Tenant isolation enabled", () => {
  let server: BunServer;
  let store: InMemoryEventLedgerStore;
  let baseUrl: string;

  let tenantAEvent: StoredCanonicalEvent;
  let tenantBEvent: StoredCanonicalEvent;
  let tenantAConvEvent2: StoredCanonicalEvent;

  beforeAll(() => {
    store = new InMemoryEventLedgerStore();

    tenantAEvent = makeEvent("tenant_A", "conv_shared", "corr_A");
    tenantBEvent = makeEvent("tenant_B", "conv_shared", "corr_B");
    tenantAConvEvent2 = makeEvent("tenant_A", "conv_shared", "corr_A", "agent.response.completed");

    store.append(tenantAEvent);
    store.append(tenantBEvent);
    store.append(tenantAConvEvent2);

    const configDb = new SqliteConfigStore(":memory:");
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({
      port: 0,
      ledgerStore: store,
      configDb,
      agentRegistry,
      channelRegistry,
      tenantIsolation: true,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("GET /api/conversations/:id/events scoped by X-Tenant-ID", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_shared/events`, {
      headers: { "X-Tenant-ID": "tenant_A" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: StoredCanonicalEvent[]; count: number };
    expect(body.count).toBe(2);
    expect(body.events.every((e) => e.tenant_id === "tenant_A")).toBe(true);
  });

  it("tenant B cannot see tenant A events on same conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_shared/events`, {
      headers: { "X-Tenant-ID": "tenant_B" },
    });
    const body = (await res.json()) as { events: StoredCanonicalEvent[]; count: number };
    expect(body.count).toBe(1);
    expect(body.events[0]!.tenant_id).toBe("tenant_B");
  });

  it("GET /api/correlations/:id/events scoped by X-Tenant-ID", async () => {
    const res = await fetch(`${baseUrl}/api/correlations/corr_A/events`, {
      headers: { "X-Tenant-ID": "tenant_A" },
    });
    const body = (await res.json()) as { events: StoredCanonicalEvent[]; count: number };
    expect(body.count).toBe(2);
  });

  it("tenant B gets empty for tenant A correlation", async () => {
    const res = await fetch(`${baseUrl}/api/correlations/corr_A/events`, {
      headers: { "X-Tenant-ID": "tenant_B" },
    });
    const body = (await res.json()) as { events: StoredCanonicalEvent[]; count: number };
    expect(body.count).toBe(0);
  });

  it("GET /api/events/:id returns 404 for wrong tenant", async () => {
    const res = await fetch(`${baseUrl}/api/events/${tenantAEvent.event_id}`, {
      headers: { "X-Tenant-ID": "tenant_B" },
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/events/:id returns event for correct tenant", async () => {
    const res = await fetch(`${baseUrl}/api/events/${tenantAEvent.event_id}`, {
      headers: { "X-Tenant-ID": "tenant_A" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StoredCanonicalEvent;
    expect(body.tenant_id).toBe("tenant_A");
  });

  it("GET /api/conversations/:id/audit scoped by tenant", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_shared/audit`, {
      headers: { "X-Tenant-ID": "tenant_A" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_events: number };
    expect(body.total_events).toBe(2);
  });

  it("no X-Tenant-ID header returns all events (unscoped)", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_shared/events`);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(3);
  });
});

describe("Tenant isolation disabled (default)", () => {
  let server: BunServer;
  let store: InMemoryEventLedgerStore;
  let baseUrl: string;

  beforeAll(() => {
    store = new InMemoryEventLedgerStore();
    store.append(makeEvent("tenant_A", "conv_1", "corr_1"));
    store.append(makeEvent("tenant_B", "conv_1", "corr_2"));

    const configDb = new SqliteConfigStore(":memory:");
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({
      port: 0,
      ledgerStore: store,
      configDb,
      agentRegistry,
      channelRegistry,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("X-Tenant-ID header is ignored when isolation is off", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_1/events`, {
      headers: { "X-Tenant-ID": "tenant_A" },
    });
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(2);
  });
});
