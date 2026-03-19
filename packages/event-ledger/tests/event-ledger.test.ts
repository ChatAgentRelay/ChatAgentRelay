import { describe, expect, test } from "bun:test";
import { loadFirstExecutablePathFixtures } from "@cap/contract-harness";
import { EventLedgerAppender, LedgerDuplicateConflictError } from "../src";

async function loadAppender(): Promise<EventLedgerAppender> {
  return EventLedgerAppender.create();
}

describe("event ledger append", () => {
  test("validates and appends the frozen seven-event fixture chain", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const appender = await loadAppender();

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
  });

  test("returns an explicit duplicate result for an equivalent repeated append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const appender = await loadAppender();
    const firstEvent = fixtures[0]!.event;

    const firstResult = appender.append(firstEvent);
    const duplicateResult = appender.append(firstEvent);

    expect(firstResult.status).toBe("appended");
    expect(duplicateResult.status).toBe("duplicate");
    expect(duplicateResult.event).toEqual(firstResult.event);
    expect(appender.getStore().getAll()).toHaveLength(1);
  });

  test("rejects a conflicting duplicate event_id append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const appender = await loadAppender();
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
});
