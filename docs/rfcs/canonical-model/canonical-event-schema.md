# RFC: Chat Agent Relay Canonical Event Schema

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | CAR core / adapter / agent implementers |
| **Version** | v0.2 |
| **Last Updated** | 2026-04-02 |

## 1. Abstract

This RFC defines the canonical event schema for Chat Agent Relay (CAR).

CAR is a standard relay layer between chat platforms and agents. The canonical event model is the center of gravity for that relay path. It standardizes how inbound messages, governance decisions, route decisions, agent invocation, outbound delivery, and auditable outcomes are represented.

On the agent side, CAR uses A2A as the standard protocol boundary, but this RFC focuses on the canonical event model rather than the transport details of that boundary.

This document explicitly separates:
- **Core** — event-schema semantics required to define CAR's canonical relay model
- **Extension** — optional event families or schema capabilities aligned with CAR
- **Future Considerations** — reserved long-range directions that are not current conformance requirements

## 2. Purpose

This document defines the platform's canonical event center: the event envelope and event families that make CAR replayable, governed, and auditable as a chat-to-agent relay system.

## 3. Product Boundary

For this RFC, the canonical event model is responsible for:
- representing the message path in a stable, replayable form
- preserving governance, routing, delivery, and audit semantics as durable events
- giving the rest of CAR a common internal contract

For this RFC, the canonical event model is not:
- a full agent-runtime state model
- a customer identity graph
- an operator inbox or queue product model
- a general-purpose storage format for every peripheral system around CAR

## 4. Layering Model

### 4.1 Core

Core schema semantics define the minimum canonical event model that a conforming CAR implementation MUST preserve.

### 4.2 Extension

Extension schema semantics define optional event families and fields that fit CAR without redefining its core relay identity.

### 4.3 Future Considerations

Future considerations preserve useful direction, but MUST NOT be interpreted as current schema requirements for conformance.

## 5. Core Design Principles

- Events are **append-only and replayable**
- Governance, routing, delivery, and audit operate on canonical events
- Conversation history is reconstructed from recorded events rather than mutable hidden state
- Provider-native differences are preserved through structured extension fields, not forced into the canonical core
- CAR models the relay path, not all possible runtime-internal or product-surface state

## 6. Core Canonical Event Model

### 6.1 Core Schema Statement

A conforming CAR implementation MUST provide a canonical event envelope that can represent the governed message path between chat platforms and agents.

The canonical event model is part of the minimum CAR relay kernel.

### 6.2 Core Envelope

A canonical event envelope MUST support the following core concerns:
- stable event identity
- canonical event type
- channel and conversation context
- correlation and causation across the message path
- occurrence time
- actor and actor-type context where relevant
- canonical payload
- optional structured provider extensions

### 6.3 Envelope Example

```json
{
  "event_id": "evt_01H...",
  "schema_version": "v1alpha1",
  "event_type": "message.received",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "channel": "slack",
  "channel_instance_id": "slack_support_prod",
  "conversation_id": "conv_123",
  "thread_id": "thr_123",
  "session_id": "sess_123",
  "message_id": "msg_123",
  "correlation_id": "corr_123",
  "causation_id": "evt_prev",
  "occurred_at": "2026-04-02T12:00:00Z",
  "actor": {
    "id": "user_ext_42",
    "display_name": "Alice"
  },
  "actor_type": "end_user",
  "payload": {
    "text": "hello"
  },
  "attachments": [],
  "provider_extensions": {
    "slack": {
      "team_id": "T123",
      "raw_event_type": "app_mention"
    }
  }
}
```

## 7. Core Fields

### 7.1 Required Core Fields

A conforming canonical event envelope MUST include support for:
- `event_id`
- `schema_version`
- `event_type`
- `tenant_id`
- `workspace_id`
- `channel`
- `channel_instance_id`
- `conversation_id`
- `session_id`
- `correlation_id`
- `occurred_at`
- `payload`

### 7.2 Core Recommended Fields

A conforming implementation SHOULD support:
- `thread_id`
- `message_id`
- `causation_id`
- `actor`
- `actor_type`
- `attachments`
- `provider_extensions`

### 7.3 Actor Types

Allowed core actor types:
- `end_user`
- `agent`
- `system`
- `channel_adapter`

Additional actor types MAY be added as extensions if they do not distort the relay-centered model.

## 8. Core Event Families

### 8.1 Core Message-Path Event Families

A conforming CAR implementation MUST support core event families sufficient to model the governed relay path:

#### Messaging
- `message.received`
- `message.send.requested`
- `message.sent`

#### Governance and Routing
- `policy.decision.made`
- `route.decision.made`

#### Agent Relay
- `agent.invocation.requested`
- `agent.response.completed`

#### Error / Blocked Outcomes
- `event.blocked`

These events define the canonical minimum governed relay chain.

### 8.2 Core Happy Path

The canonical happy path is:

`message.received -> policy.decision.made -> route.decision.made -> agent.invocation.requested -> agent.response.completed -> message.send.requested -> message.sent`

### 8.3 Core Failure Semantics

When the governed relay path is denied, blocked, or fails terminally, the event model MUST preserve that outcome in auditable form rather than silently dropping it.

## 9. Payload and Metadata Boundaries

### 9.1 Payload

`payload` contains the canonical business fact for the event.

Examples include:
- message text
- governance decision result
- route decision result
- agent response content
- delivery outcome
- blocked reason and stage

### 9.2 Attachments

`attachments` SHOULD represent normalized attachment descriptors when attachment semantics matter to the relay path.

### 9.3 Provider Extensions

`provider_extensions` MAY preserve provider-native detail without making that detail part of CAR's canonical core semantics.

Rules:
- extensions SHOULD be namespaced by provider or integration key
- extensions MUST remain optional to the core model
- middleware and replay semantics MUST NOT depend on provider-native fields as the core source of truth
- large or sensitive raw provider payloads SHOULD NOT become the default canonical payload shape

## 10. Ordering, Correlation, and Replay

### 10.1 Ordering Model

A conforming CAR implementation SHOULD preserve best-effort event ordering within the relay scope needed for replay and audit.

CAR does not require a global total ordering across all tenants or conversations.

### 10.2 Correlation and Causation

A conforming implementation MUST preserve correlation across a single relay path and SHOULD preserve causation between parent and child events.

### 10.3 Replay Model

The canonical event ledger MUST be sufficient to reconstruct:
- the message path for a conversation or correlation scope
- the governance decision path
- the route decision path
- the delivery outcome path
- the blocked or failed path where applicable

## 11. Extension Event Families

The following event families and schema areas are aligned with CAR but are not required for all conforming implementations.

### 11.1 Messaging Extensions
- `message.delivery.updated`
- `message.updated`
- `message.deleted`
- `reaction.received`
- `command.received`

### 11.2 Agent Extensions
- `agent.status.changed`
- `agent.input.requested`
- `agent.input.provided`

These extend the relay path with richer interaction semantics but are not part of the minimum canonical chain.

### 11.3 Identity Extensions
- `identity.resolution.requested`
- `identity.resolution.completed`
- `identity.resolution.ambiguous`
- `identity.resolution.challenge.sent`

These support richer identity-related capabilities, but CAR does not require cross-channel identity workflows to remain CAR.

### 11.4 Handoff Extensions
- `handoff.requested`

Optional handoff signaling MAY exist, but queue or operator-workspace models are not part of the core canonical event identity.

### 11.5 Additional Envelope Extensions
Potential extension fields may include:
- richer trace-context structures
- richer artifact descriptors
- governance labels
- selected projection-support metadata that remains consistent with the relay model

## 12. Future Considerations

The following directions are intentionally non-normative in this RFC.

### 12.1 Operator and Queue Product Models
Examples:
- assignment events
- queue-state projections
- inbox workflow event families

These are future product-surface concerns layered on top of the relay ledger, not part of the current core schema definition.

### 12.2 Broad Runtime-Internal State Modeling
Examples:
- agent-internal tool lifecycle modeling
- rich runtime workflow graph modeling
- private execution-state families

These are outside the primary purpose of CAR's canonical relay model.

### 12.3 Peripheral Storage and Trace Concerns
Examples:
- secure raw trace references standardized as a first-class schema requirement
- broad observability-specific record families
- external-system projection schemas

These may be valuable later, but they are not current conformance requirements for the canonical event model.

## 13. Example Core Ledger

### 13.1 Inbound Message
```json
{
  "event_id": "evt_100",
  "event_type": "message.received",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "channel": "slack",
  "channel_instance_id": "slack_support_prod",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "occurred_at": "2026-04-02T12:00:00Z",
  "actor": {"id": "U123"},
  "actor_type": "end_user",
  "payload": {"text": "Where is my order?"}
}
```

### 13.2 Policy Decision
```json
{
  "event_id": "evt_101",
  "event_type": "policy.decision.made",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_100",
  "occurred_at": "2026-04-02T12:00:01Z",
  "actor_type": "system",
  "payload": {"policy": "default_ingress", "decision": "allow"}
}
```

### 13.3 Route Decision
```json
{
  "event_id": "evt_102",
  "event_type": "route.decision.made",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_101",
  "occurred_at": "2026-04-02T12:00:01Z",
  "actor_type": "system",
  "payload": {"route": "support-agent", "reason": "default_support_route"}
}
```

### 13.4 Agent Invocation
```json
{
  "event_id": "evt_103",
  "event_type": "agent.invocation.requested",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_102",
  "occurred_at": "2026-04-02T12:00:02Z",
  "actor_type": "system",
  "payload": {"agent": "support-agent", "input_event_id": "evt_100"}
}
```

### 13.5 Agent Response
```json
{
  "event_id": "evt_104",
  "event_type": "agent.response.completed",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_103",
  "occurred_at": "2026-04-02T12:00:04Z",
  "actor": {"id": "agent_support"},
  "actor_type": "agent",
  "payload": {"text": "Your order shipped yesterday."}
}
```

### 13.6 Outbound Delivery Requested
```json
{
  "event_id": "evt_105",
  "event_type": "message.send.requested",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "channel": "slack",
  "channel_instance_id": "slack_support_prod",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_104",
  "occurred_at": "2026-04-02T12:00:05Z",
  "actor_type": "system",
  "payload": {"text": "Your order shipped yesterday."}
}
```

### 13.7 Outbound Delivered
```json
{
  "event_id": "evt_106",
  "event_type": "message.sent",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "channel": "slack",
  "channel_instance_id": "slack_support_prod",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_105",
  "occurred_at": "2026-04-02T12:00:06Z",
  "actor_type": "channel_adapter",
  "payload": {"provider_message_id": "slack_msg_555"}
}
```

## 14. Conformance

A conforming CAR canonical event model MUST:
- provide a stable canonical event envelope for the relay path
- represent the core governed event chain in auditable form
- preserve correlation across a message path
- preserve replayability of governance, routing, invocation, delivery, and blocked outcomes
- distinguish canonical facts from provider-native extensions

A conforming implementation is NOT required to provide every extension or future consideration in this RFC.

## 15. Security Considerations

Implementations SHOULD:
- avoid making raw provider payloads the canonical internal contract
- keep sensitive provider-native detail out of the canonical core unless needed for relay semantics
- preserve auditability while still allowing optional downstream redaction or projection systems
- keep the canonical event model centered on relay facts rather than agent-internal or workspace-product state

## 16. Open Questions

- Which extension event families should eventually move into dedicated RFCs?
- Which extension fields should be standardized more strongly versus left implementation-specific?
- Where should future product-surface or observability-specific schemas be separated from the relay-centered canonical model?
