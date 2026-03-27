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

export const AUDIT_EVENT_TYPES = {
  messageReceived: "message.received",
  policyDecisionMade: "policy.decision.made",
  routeDecisionMade: "route.decision.made",
  agentInvocationRequested: "agent.invocation.requested",
  agentResponseCompleted: "agent.response.completed",
  messageSendRequested: "message.send.requested",
  messageSent: "message.sent",
} as const;
