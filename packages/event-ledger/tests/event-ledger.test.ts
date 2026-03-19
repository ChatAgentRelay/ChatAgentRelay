import { describe, expect, test } from "bun:test";
import { assertFirstExecutablePathChain, loadFirstExecutablePathFixtures } from "@cap/contract-harness";
import { EventLedgerAppender, EventLedgerReader, LedgerDuplicateConflictError } from "../src";

async function loadLedger(): Promise<{ appender: EventLedgerAppender; reader: EventLedgerReader }> {
  const appender = await EventLedgerAppender.create();
  const reader = new EventLedgerReader(appender.getStore());

  return { appender, reader };
}

describe("event ledger", () => {
  test("validates and appends the frozen seven-event fixture chain", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures) {
      const result = appender.append(fixture.event);
      expect(result.status).toBe("appended");
      expect(result.event.event_id).toBe(fixture.event.event_id);
      expect(result.event.schema_version).toBe(fixture.event.schema_version);
      expect(result.event.event_type).toBe(fixture.event.event_type);
      expect(result.event.tenant_id).toBe(fixture.event.tenant_id);
      expect(result.event.workspace_id).toBe(fixture.event.workspace_id);
      expect(result.event.channel).toBe(fixture.event.channel);
      expect(result.event.channel_instance_id).toBe(fixture.event.channel_instance_id);
      expect(result.event.conversation_id).toBe(fixture.event.conversation_id);
      expect(result.event.session_id).toBe(fixture.event.session_id);
      expect(result.event.correlation_id).toBe(fixture.event.correlation_id);
      expect(result.event.causation_id).toBe(fixture.event.causation_id);
      expect(result.event.occurred_at).toBe(fixture.event.occurred_at);
      expect(result.event.actor_type).toBe(fixture.event.actor_type);
      expect(result.event.payload).toEqual(fixture.event.payload);
      expect(result.event.provider_extensions).toEqual(fixture.event.provider_extensions);
    }

    const replayedEvents = reader.replayConversation(fixtures[0]!.event.conversation_id);
    expect(replayedEvents).toHaveLength(7);
    expect(() => assertFirstExecutablePathChain(replayedEvents)).not.toThrow();
  });

  test("returns an explicit duplicate result for an equivalent repeated append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();
    const firstEvent = fixtures[0]!.event;

    const firstResult = appender.append(firstEvent);
    const duplicateResult = appender.append(firstEvent);

    expect(firstResult.status).toBe("appended");
    expect(duplicateResult.status).toBe("duplicate");
    expect(duplicateResult.event).toEqual(firstResult.event);
    expect(reader.replayConversation(firstEvent.conversation_id)).toHaveLength(1);
  });

  test("rejects a conflicting duplicate event_id append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender } = await loadLedger();
    const firstEvent = fixtures[0]!.event;

    appender.append(firstEvent);

    const conflictingDuplicate = {
      ...firstEvent,
      payload: {
        text: "A different text body",
      },
    };

    expect(() => appender.append(conflictingDuplicate)).toThrow(LedgerDuplicateConflictError);
  });

  test("replays by conversation, finds by correlation, gets by id, and filters by time range", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures) {
      appender.append(fixture.event);
    }

    const replayedEvents = reader.replayConversation("conv_1");
    const correlationEvents = reader.findByCorrelationId("corr_1");
    const fetchedEvent = reader.getEvent("evt_104");
    const timeRangeEvents = reader.findByTimeRange({
      start: "2026-03-18T10:00:02Z",
      end: "2026-03-18T10:00:04Z",
    });

    expect(replayedEvents.map((event) => event.event_id)).toEqual([
      "evt_100",
      "evt_101",
      "evt_102",
      "evt_103",
      "evt_104",
      "evt_105",
      "evt_106",
    ]);
    expect(correlationEvents.map((event) => event.event_id)).toEqual(replayedEvents.map((event) => event.event_id));
    expect(fetchedEvent).toEqual(replayedEvents[4]!);
    expect(timeRangeEvents.map((event) => event.event_id)).toEqual(["evt_102", "evt_103", "evt_104"]);
  });
});
