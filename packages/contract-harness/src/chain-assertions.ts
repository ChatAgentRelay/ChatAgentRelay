import { FIRST_EXECUTABLE_PATH_EVENT_ORDER } from "./constants";
import type { CanonicalEvent } from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertFirstExecutablePathChain(events: CanonicalEvent[]): void {
  assert(
    events.length === FIRST_EXECUTABLE_PATH_EVENT_ORDER.length,
    `Expected ${FIRST_EXECUTABLE_PATH_EVENT_ORDER.length} events, received ${events.length}`,
  );

  const [firstEvent, ...restEvents] = events;

  assert(firstEvent !== undefined, "Expected first event to exist");
  assert(
    firstEvent.event_type === FIRST_EXECUTABLE_PATH_EVENT_ORDER[0],
    `Expected first event type ${FIRST_EXECUTABLE_PATH_EVENT_ORDER[0]}, received ${firstEvent.event_type}`,
  );
  assert(firstEvent.causation_id === undefined, "Expected root event to omit causation_id");

  const sharedKeys: Array<keyof CanonicalEvent> = [
    "tenant_id",
    "workspace_id",
    "conversation_id",
    "session_id",
    "correlation_id",
  ];

  for (const [index, event] of events.entries()) {
    const expectedType = FIRST_EXECUTABLE_PATH_EVENT_ORDER[index];
    assert(
      event.event_type === expectedType,
      `Expected event ${index + 1} to be ${expectedType}, received ${event.event_type}`,
    );

    for (const key of sharedKeys) {
      assert(event[key] === firstEvent[key], `Expected ${String(key)} to remain stable across the chain`);
    }

    const occurredAt = Date.parse(event.occurred_at);
    assert(Number.isFinite(occurredAt), `Expected occurred_at to be parseable for event ${event.event_id}`);

    if (index > 0) {
      const previousEvent = events[index - 1];
      assert(previousEvent !== undefined, `Expected previous event to exist for index ${index}`);
      const previousOccurredAt = Date.parse(previousEvent.occurred_at);

      assert(
        event.causation_id === previousEvent.event_id,
        `Expected ${event.event_id} causation_id to equal ${previousEvent.event_id}`,
      );
      assert(
        occurredAt > previousOccurredAt,
        `Expected occurred_at to increase strictly between ${previousEvent.event_id} and ${event.event_id}`,
      );
    }
  }

  for (const event of restEvents) {
    assert(event.causation_id !== undefined, `Expected non-root event ${event.event_id} to include causation_id`);
  }
}
