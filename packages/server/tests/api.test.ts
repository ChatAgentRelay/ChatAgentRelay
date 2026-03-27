import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StoredCanonicalEvent } from "@chat-agent-relay/event-ledger";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { startApiServer } from "../src/api";

type BunServer = Server<unknown>;

function makeEvent(overrides: Partial<StoredCanonicalEvent> = {}): StoredCanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "message.received",
    tenant_id: "t1",
    workspace_id: "ws1",
    channel: "test",
    channel_instance_id: "test_ch",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "corr_1",
    occurred_at: new Date().toISOString(),
    actor_type: "end_user",
    payload: { text: "hello" },
    ...overrides,
  };
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  return (await res.json()) as Record<string, unknown>;
}

describe("replay/query API", () => {
  let server: BunServer;
  let store: InMemoryEventLedgerStore;
  let baseUrl: string;
  let event1: StoredCanonicalEvent;
  let event2: StoredCanonicalEvent;
  let event3: StoredCanonicalEvent;

  beforeAll(() => {
    store = new InMemoryEventLedgerStore();
    event1 = makeEvent({ conversation_id: "conv_A", correlation_id: "corr_X" });
    event2 = makeEvent({ conversation_id: "conv_A", correlation_id: "corr_X", event_type: "agent.response.completed" });
    event3 = makeEvent({ conversation_id: "conv_B", correlation_id: "corr_Y" });
    store.append(event1);
    store.append(event2);
    store.append(event3);

    server = startApiServer({ port: 0, ledgerStore: store });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("GET /api/health returns ok with ledger status", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await getJson(`${baseUrl}/api/health`);
    expect(body["status"]).toBe("ok");
    expect(body["timestamp"]).toBeDefined();
    expect(body["uptime_seconds"]).toBeDefined();
    const ledger = body["ledger"] as Record<string, unknown>;
    expect(ledger["healthy"]).toBe(true);
    expect(ledger["backend"]).toBe("in-memory");
    expect(typeof ledger["event_count"]).toBe("number");
  });

  it("GET /api/conversations/:id/events returns events by conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_A/events`);
    expect(res.status).toBe(200);
    const body = await getJson(`${baseUrl}/api/conversations/conv_A/events`);
    expect(body["conversation_id"]).toBe("conv_A");
    expect(body["count"]).toBe(2);
    expect(body["events"]).toHaveLength(2);
    const events = body["events"] as Array<{ event_id: string }>;
    expect(events[0]!.event_id).toBe(event1.event_id);
    expect(events[1]!.event_id).toBe(event2.event_id);
  });

  it("GET /api/conversations/:id/events returns empty for unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_NONE/events`);
    expect(res.status).toBe(200);
    const body = await getJson(`${baseUrl}/api/conversations/conv_NONE/events`);
    expect(body["count"]).toBe(0);
    expect(body["events"]).toHaveLength(0);
  });

  it("GET /api/correlations/:id/events returns events by correlation", async () => {
    const res = await fetch(`${baseUrl}/api/correlations/corr_X/events`);
    expect(res.status).toBe(200);
    const body = await getJson(`${baseUrl}/api/correlations/corr_X/events`);
    expect(body["correlation_id"]).toBe("corr_X");
    expect(body["count"]).toBe(2);
  });

  it("GET /api/events/:id returns a single event", async () => {
    const res = await fetch(`${baseUrl}/api/events/${event1.event_id}`);
    expect(res.status).toBe(200);
    const body = await getJson(`${baseUrl}/api/events/${event1.event_id}`);
    expect(body["event_id"]).toBe(event1.event_id);
    expect(body["event_type"]).toBe("message.received");
  });

  it("GET /api/events/:id returns 404 for unknown event", async () => {
    const res = await fetch(`${baseUrl}/api/events/evt_nonexistent`);
    expect(res.status).toBe(404);
    const body = await getJson(`${baseUrl}/api/events/evt_nonexistent`);
    expect(body["error"]).toBe("Event not found");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("GET /api/conversations/:id/audit returns structured audit explanation", async () => {
    const body = await getJson(`${baseUrl}/api/conversations/conv_A/audit`);
    expect(body["conversation_id"]).toBe("conv_A");
    expect(body["total_events"]).toBe(2);
    expect(body["turns"]).toHaveLength(1);
  });

  it("GET /api/conversations/:id/audit returns 404 for empty conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv_NONE/audit`);
    expect(res.status).toBe(404);
  });

  it("GET /api/conversations/:id/audit includes blocked info", async () => {
    const blockedEvent = makeEvent({
      conversation_id: "conv_C",
      correlation_id: "corr_Z",
      event_type: "message.received",
    });
    const blockEvent = makeEvent({
      conversation_id: "conv_C",
      correlation_id: "corr_Z",
      event_type: "event.blocked",
      payload: { reason: "spam_detected", block_stage: "governance", retryable: false },
    });
    store.append(blockedEvent);
    store.append(blockEvent);

    const body = await getJson(`${baseUrl}/api/conversations/conv_C/audit`);
    const turns = body["turns"] as Array<{ blocked: boolean; block_reason: string; block_stage: string }>;
    expect(turns[0]!.blocked).toBe(true);
    expect(turns[0]!.block_reason).toBe("spam_detected");
    expect(turns[0]!.block_stage).toBe("governance");
  });
});
