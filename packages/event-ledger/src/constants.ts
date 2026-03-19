export const REQUIRED_LEDGER_EVENT_FIELDS = [
  "event_id",
  "schema_version",
  "event_type",
  "tenant_id",
  "workspace_id",
  "channel",
  "conversation_id",
  "session_id",
  "correlation_id",
  "occurred_at",
  "actor_type",
  "payload",
] as const;
