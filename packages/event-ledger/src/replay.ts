import { LedgerNotFoundError, LedgerValidationError } from "./errors";
import { InMemoryEventLedgerStore } from "./ledger-store";
import type { StoredCanonicalEvent, TimeRange } from "./types";

function compareOccurredAt(left: StoredCanonicalEvent, right: StoredCanonicalEvent): number {
  return Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
}

function inTimeRange(event: StoredCanonicalEvent, timeRange: TimeRange | undefined): boolean {
  if (!timeRange) {
    return true;
  }

  const occurredAt = Date.parse(event.occurred_at);

  if (!Number.isFinite(occurredAt)) {
    throw new LedgerValidationError(`Stored event has invalid occurred_at: ${event.event_id}`);
  }

  const start = timeRange.start ? Date.parse(timeRange.start) : undefined;
  const end = timeRange.end ? Date.parse(timeRange.end) : undefined;

  if (start !== undefined && !Number.isFinite(start)) {
    throw new LedgerValidationError("Expected timeRange.start to be a valid timestamp");
  }

  if (end !== undefined && !Number.isFinite(end)) {
    throw new LedgerValidationError("Expected timeRange.end to be a valid timestamp");
  }

  if (start !== undefined && occurredAt < start) {
    return false;
  }

  if (end !== undefined && occurredAt > end) {
    return false;
  }

  return true;
}

export class EventLedgerReader {
  constructor(private readonly store: InMemoryEventLedgerStore) {}

  replayConversation(conversationId: string): StoredCanonicalEvent[] {
    return this.store
      .getAll()
      .filter((event) => event.conversation_id === conversationId)
      .sort(compareOccurredAt);
  }

  getEvent(eventId: string): StoredCanonicalEvent {
    const event = this.store.getById(eventId);

    if (!event) {
      throw new LedgerNotFoundError(`Event not found for event_id ${eventId}`);
    }

    return event;
  }

  findByCorrelationId(correlationId: string): StoredCanonicalEvent[] {
    return this.store
      .getAll()
      .filter((event) => event.correlation_id === correlationId)
      .sort(compareOccurredAt);
  }

  findByTimeRange(timeRange: TimeRange): StoredCanonicalEvent[] {
    return this.store
      .getAll()
      .filter((event) => inTimeRange(event, timeRange))
      .sort(compareOccurredAt);
  }
}
