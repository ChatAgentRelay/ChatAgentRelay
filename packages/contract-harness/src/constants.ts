export const ROOT_DIR = new URL("../../../", import.meta.url);

export const ENVELOPE_SCHEMA_PATH = "docs/schemas/canonical-model/canonical-event-envelope.schema.json";

export const FIRST_EXECUTABLE_PATH_EVENT_ORDER = [
  "message.received",
  "policy.decision.made",
  "route.decision.made",
  "agent.invocation.requested",
  "agent.response.completed",
  "message.send.requested",
  "message.sent",
] as const;

export type FirstExecutablePathEventType = (typeof FIRST_EXECUTABLE_PATH_EVENT_ORDER)[number];

export const SPECIALIZED_SCHEMA_PATHS: Record<FirstExecutablePathEventType, string> = {
  "message.received": "docs/schemas/canonical-model/events/messaging/message-received.schema.json",
  "policy.decision.made": "docs/schemas/canonical-model/events/routing/policy-decision-made.schema.json",
  "route.decision.made": "docs/schemas/canonical-model/events/routing/route-decision-made.schema.json",
  "agent.invocation.requested": "docs/schemas/canonical-model/events/agent/agent-invocation-requested.schema.json",
  "agent.response.completed": "docs/schemas/canonical-model/events/agent/agent-response-completed.schema.json",
  "message.send.requested": "docs/schemas/canonical-model/events/messaging/message-send-requested.schema.json",
  "message.sent": "docs/schemas/canonical-model/events/messaging/message-sent.schema.json",
};

export const FIXTURE_DIR_PATH = "docs/schemas/fixtures/first-executable-path";
