import type { LedgerStore, StoredCanonicalEvent } from "./types";

function cloneEvent(event: StoredCanonicalEvent): StoredCanonicalEvent {
  return structuredClone(event);
}

export class InMemoryEventLedgerStore implements LedgerStore {
  private readonly eventsById = new Map<string, StoredCanonicalEvent>();
  private readonly orderedEventIds: string[] = [];

  append(event: StoredCanonicalEvent): StoredCanonicalEvent | undefined {
    const existingEvent = this.eventsById.get(event.event_id);

    if (existingEvent) {
      return cloneEvent(existingEvent);
    }

    this.eventsById.set(event.event_id, cloneEvent(event));
    this.orderedEventIds.push(event.event_id);

    return undefined;
  }

  getById(eventId: string): StoredCanonicalEvent | undefined {
    const event = this.eventsById.get(eventId);
    return event ? cloneEvent(event) : undefined;
  }

  getAll(): StoredCanonicalEvent[] {
    return this.orderedEventIds
      .map((eventId) => this.eventsById.get(eventId))
      .filter((event): event is StoredCanonicalEvent => event !== undefined)
      .map(cloneEvent);
  }

  getByConversationId(conversationId: string): StoredCanonicalEvent[] {
    return this.getAll().filter((event) => event.conversation_id === conversationId);
  }

  getByCorrelationId(correlationId: string): StoredCanonicalEvent[] {
    return this.getAll().filter((event) => event.correlation_id === correlationId);
  }
}
