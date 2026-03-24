import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { loadFirstExecutablePathFixtures } from "@cap/contract-harness";
import type { CanonicalEvent } from "@cap/contract-harness";
import { SqliteLedgerStore } from "../src/sqlite-store";
import { EventLedgerAppender } from "../src/append";
import { EventLedgerReader } from "../src/replay";
import { explainFirstExecutablePath } from "../src/audit";
import { LedgerDuplicateConflictError } from "../src/errors";
import type { StoredCanonicalEvent } from "../src/types";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(import.meta.dir, "..", "dist");
const TEST_DB_PATH = join(TEST_DB_DIR, "test-ledger.db");

function cleanTestDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

describe("sqlite ledger store", () => {
  let events: CanonicalEvent[];

  beforeAll(async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    events = fixtures.map((f) => f.event);
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  beforeEach(() => {
    cleanTestDb();
  });

  afterAll(() => {
    cleanTestDb();
  });

  it("appends and retrieves events via the durable store", () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      for (const event of events) {
        const existing = store.append(event as StoredCanonicalEvent);
        expect(existing).toBeUndefined();
      }

      const all = store.getAll();
      expect(all).toHaveLength(7);
      expect(all[0]!.event_type).toBe("message.received");
      expect(all[6]!.event_type).toBe("message.sent");
    } finally {
      store.close();
    }
  });

  it("persists events across store reopens", () => {
    const store1 = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      for (const event of events) {
        store1.append(event as StoredCanonicalEvent);
      }
    } finally {
      store1.close();
    }

    const store2 = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const all = store2.getAll();
      expect(all).toHaveLength(7);
      expect(all[0]!.event_id).toBe(events[0]!.event_id);
      expect(all[6]!.event_id).toBe(events[6]!.event_id);
    } finally {
      store2.close();
    }
  });

  it("returns existing event for duplicate append", () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const first = events[0]!;
      store.append(first as StoredCanonicalEvent);

      const existing = store.append(first as StoredCanonicalEvent);
      expect(existing).toBeDefined();
      expect(existing!.event_id).toBe(first.event_id);
    } finally {
      store.close();
    }
  });

  it("retrieves events by id", () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      for (const event of events) {
        store.append(event as StoredCanonicalEvent);
      }

      const event = store.getById("evt_100");
      expect(event).toBeDefined();
      expect(event!.event_type).toBe("message.received");

      const missing = store.getById("evt_nonexistent");
      expect(missing).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("works with EventLedgerAppender for validated durable append", async () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const appender = await EventLedgerAppender.create(store);

      for (const event of events) {
        const result = appender.append(event);
        expect(result.status).toBe("appended");
      }

      const all = store.getAll();
      expect(all).toHaveLength(7);
    } finally {
      store.close();
    }
  });

  it("rejects conflicting duplicate via EventLedgerAppender", async () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const appender = await EventLedgerAppender.create(store);

      const first = events[0]!;
      appender.append(first);

      const conflicting = { ...first, payload: { text: "different text" } };
      expect(() => appender.append(conflicting)).toThrow(LedgerDuplicateConflictError);
    } finally {
      store.close();
    }
  });

  it("supports replay and audit over durable store", async () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      const appender = await EventLedgerAppender.create(store);

      for (const event of events) {
        appender.append(event);
      }

      const reader = new EventLedgerReader(store);
      const replayed = reader.replayConversation("conv_1");
      expect(replayed).toHaveLength(7);

      const explanation = explainFirstExecutablePath(replayed);
      expect(explanation.conversation_id).toBe("conv_1");
      expect(explanation.messageReceived.text).toBe("Where is my order?");
      expect(explanation.agentResponse.text).toBe("Your order shipped yesterday.");
      expect(explanation.policyDecision.decision).toBe("allow");
    } finally {
      store.close();
    }
  });

  it("preserves full event fidelity across serialization", () => {
    const store = new SqliteLedgerStore(TEST_DB_PATH);
    try {
      for (const event of events) {
        store.append(event as StoredCanonicalEvent);
      }

      for (const event of events) {
        const retrieved = store.getById(event.event_id);
        expect(retrieved).toBeDefined();
        expect(JSON.stringify(retrieved)).toBe(JSON.stringify(event));
      }
    } finally {
      store.close();
    }
  });
});
