import { describe, expect, it } from "bun:test";
import { InMemoryEventLedgerStore } from "../src/ledger-store";
import { SqliteLedgerStore } from "../src/sqlite-store";
import type { StoredCanonicalEvent } from "../src/types";

function makeEvent(tenantId: string, conversationId: string, correlationId: string): StoredCanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "message.received",
    tenant_id: tenantId,
    workspace_id: `ws_${tenantId}`,
    channel: "test",
    channel_instance_id: "test",
    conversation_id: conversationId,
    session_id: "sess_1",
    correlation_id: correlationId,
    occurred_at: new Date().toISOString(),
    actor_type: "end_user",
    payload: { text: "hello" },
  };
}

function runTenantScopeTests(
  name: string,
  createStore: () => { store: import("../src/types").LedgerStore; cleanup: () => void },
) {
  describe(`${name} tenant scope`, () => {
    it("getAll with tenantId returns only that tenant's events", () => {
      const { store, cleanup } = createStore();
      try {
        store.append(makeEvent("t1", "conv_1", "corr_1"));
        store.append(makeEvent("t2", "conv_1", "corr_2"));
        store.append(makeEvent("t1", "conv_2", "corr_3"));

        const t1Events = store.getAll({ tenantId: "t1" });
        expect(t1Events).toHaveLength(2);
        expect(t1Events.every((e) => e.tenant_id === "t1")).toBe(true);

        const t2Events = store.getAll({ tenantId: "t2" });
        expect(t2Events).toHaveLength(1);
        expect(t2Events[0]!.tenant_id).toBe("t2");

        const allEvents = store.getAll();
        expect(allEvents).toHaveLength(3);
      } finally {
        cleanup();
      }
    });

    it("getByConversationId with tenantId filters by tenant", () => {
      const { store, cleanup } = createStore();
      try {
        store.append(makeEvent("t1", "conv_shared", "corr_1"));
        store.append(makeEvent("t2", "conv_shared", "corr_2"));

        const t1Events = store.getByConversationId("conv_shared", { tenantId: "t1" });
        expect(t1Events).toHaveLength(1);
        expect(t1Events[0]!.tenant_id).toBe("t1");

        const allEvents = store.getByConversationId("conv_shared");
        expect(allEvents).toHaveLength(2);
      } finally {
        cleanup();
      }
    });

    it("getByCorrelationId with tenantId filters by tenant", () => {
      const { store, cleanup } = createStore();
      try {
        const e1 = makeEvent("t1", "conv_1", "corr_shared");
        const e2 = makeEvent("t2", "conv_2", "corr_shared");
        store.append(e1);
        store.append(e2);

        const t1Events = store.getByCorrelationId("corr_shared", { tenantId: "t1" });
        expect(t1Events).toHaveLength(1);
        expect(t1Events[0]!.tenant_id).toBe("t1");
      } finally {
        cleanup();
      }
    });

    it("getById with wrong tenantId returns undefined", () => {
      const { store, cleanup } = createStore();
      try {
        const event = makeEvent("t1", "conv_1", "corr_1");
        store.append(event);

        expect(store.getById(event.event_id, { tenantId: "t1" })).toBeDefined();
        expect(store.getById(event.event_id, { tenantId: "t2" })).toBeUndefined();
        expect(store.getById(event.event_id)).toBeDefined();
      } finally {
        cleanup();
      }
    });

    it("getAll without scope returns everything", () => {
      const { store, cleanup } = createStore();
      try {
        store.append(makeEvent("t1", "c1", "r1"));
        store.append(makeEvent("t2", "c2", "r2"));
        store.append(makeEvent("t3", "c3", "r3"));

        expect(store.getAll()).toHaveLength(3);
        expect(store.getAll({})).toHaveLength(3);
        expect(store.getAll({})).toHaveLength(3);
      } finally {
        cleanup();
      }
    });
  });
}

runTenantScopeTests("InMemory", () => {
  const store = new InMemoryEventLedgerStore();
  return { store, cleanup: () => store.close() };
});

runTenantScopeTests("SQLite", () => {
  const store = new SqliteLedgerStore(":memory:");
  return { store, cleanup: () => store.close() };
});
