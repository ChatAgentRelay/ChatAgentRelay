import type { HealthStatus, LedgerStore, StoredCanonicalEvent, TenantScope } from "./types";

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

  getById(eventId: string, scope?: TenantScope): StoredCanonicalEvent | undefined {
    const event = this.eventsById.get(eventId);
    if (!event) return undefined;
    if (scope?.tenantId && event.tenant_id !== scope.tenantId) return undefined;
    return cloneEvent(event);
  }

  getAll(scope?: TenantScope): StoredCanonicalEvent[] {
    let events = this.orderedEventIds
      .map((eventId) => this.eventsById.get(eventId))
      .filter((event): event is StoredCanonicalEvent => event !== undefined);
    if (scope?.tenantId) {
      events = events.filter((event) => event.tenant_id === scope.tenantId);
    }
    return events.map(cloneEvent);
  }

  getByConversationId(conversationId: string, scope?: TenantScope): StoredCanonicalEvent[] {
    return this.getAll(scope).filter((event) => event.conversation_id === conversationId);
  }

  getByCorrelationId(correlationId: string, scope?: TenantScope): StoredCanonicalEvent[] {
    return this.getAll(scope).filter((event) => event.correlation_id === correlationId);
  }

  healthCheck(): HealthStatus {
    return {
      healthy: true,
      event_count: this.orderedEventIds.length,
      backend: "in-memory",
    };
  }

  close(): void {
    this.eventsById.clear();
    this.orderedEventIds.length = 0;
  }
}
