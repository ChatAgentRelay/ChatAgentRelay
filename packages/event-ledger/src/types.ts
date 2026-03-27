import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";

export type StoredCanonicalEvent = CanonicalEvent & {
  schema_version: string;
  channel: string;
  actor_type: string;
  payload: Record<string, unknown>;
  channel_instance_id?: string;
  provider_extensions?: Record<string, unknown>;
};

export type HealthStatus = {
  healthy: boolean;
  event_count: number;
  backend: string;
  error?: string | undefined;
};

export interface LedgerStore {
  append(event: StoredCanonicalEvent): StoredCanonicalEvent | undefined;
  getById(eventId: string): StoredCanonicalEvent | undefined;
  getAll(): StoredCanonicalEvent[];
  getByConversationId(conversationId: string): StoredCanonicalEvent[];
  getByCorrelationId(correlationId: string): StoredCanonicalEvent[];
  healthCheck(): HealthStatus;
}

export type AppendSuccess = {
  status: "appended";
  event: StoredCanonicalEvent;
};

export type AppendDuplicate = {
  status: "duplicate";
  event: StoredCanonicalEvent;
};

export type AppendResult = AppendSuccess | AppendDuplicate;

export type TimeRange = {
  start?: string;
  end?: string;
};

export type LedgerQuery = {
  conversation_id?: string;
  correlation_id?: string;
  timeRange?: TimeRange;
};

export type AuditExplanation = {
  conversation_id: string;
  correlation_id: string;
  messageReceived: {
    event_id: string;
    text: string;
  };
  policyDecision: {
    event_id: string;
    decision: string;
    policy: string;
  };
  routeDecision: {
    event_id: string;
    route: string;
    reason: string;
  };
  agentInvocation: {
    event_id: string;
    backend: string;
    input_event_id: string;
  };
  agentResponse: {
    event_id: string;
    text: string;
  };
  messageSendRequested: {
    event_id: string;
    text: string;
  };
  messageSent: {
    event_id: string;
    provider_message_id: string;
  };
};
