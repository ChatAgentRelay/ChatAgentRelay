# Chat Agent Relay Canonical Event Payload Layering Strategy

This document defines how event-family-specific payload contracts should layer on top of the canonical event envelope JSON Schema.

It follows these already-made decisions:
- `docs/decisions/schema-authoring-strategy-evaluation.md` — hybrid schema authoring is the chosen strategy
- `docs/decisions/canonical-event-machine-readable-strategy.md` — JSON Schema is the primary machine-readable format for the canonical event envelope

## Decision Status

Decision made: **use a layered schema model in which the canonical event envelope remains the stable base contract, and event-family-specific payload schemas are added incrementally as specialized overlays rather than baked into the first envelope schema**.

## Decision Scope

Choose how CAR should evolve from:
- one authoritative envelope JSON Schema
- to more specific event-family payload contracts
- without prematurely freezing every payload variant

## Why This Decision Exists

The machine-readable strategy already chose JSON Schema as the first-class contract format for the canonical event envelope.

That creates a follow-up design problem:
- how should payloads become more specific over time
- where should event-family-specific rules live
- how do we avoid turning the envelope schema into a large, brittle union too early

## Final Recommendation

Use a **layered payload strategy**:

1. keep the envelope schema focused on common top-level fields and shared structures
2. treat `payload` in the base envelope schema as intentionally broad
3. add event-family-specific payload schemas as separate artifacts
4. connect specialized schemas to the envelope through composition rather than replacing the envelope contract

## Recommended Operating Model

### 1. Base envelope stays stable
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json` defines the common envelope shape
- it remains the first validation boundary for all canonical events
- it should not try to encode every event-type-specific payload rule in its first versions

### 2. Event-family schemas are layered separately
Future payload specialization should be organized by event family, for example:
- messaging
- routing and policy
- agent lifecycle
- tools
- handoff
- identity
- audit and error

A later directory shape could look like:

```text
docs/schemas/
  canonical-model/
    canonical-event-envelope.schema.json
    events/
      messaging/
      routing/
      agent/
      tools/
      handoff/
      identity/
      audit/
```

### 3. Composition should be preferred over one giant schema
When CAR starts formalizing specialized payloads, prefer JSON Schema composition patterns such as:
- a base envelope schema
- specialized schemas that constrain `event_type`
- specialized schemas that refine `payload`

Conceptually:
- envelope schema validates common fields
- `message.received` schema says `event_type = message.received`
- that same specialized schema defines the payload shape relevant to inbound messages

This avoids making the first schema artifact an unmaintainable all-in-one union.

### 4. Specialize in phases
Payload formalization should follow CAR maturity:
- first: minimum-kernel events that most affect interoperability
- next: delivery, handoff, identity, and blocked/error flows
- later: richer audit, queueing, protocol trace, and provider-specific extensions where justified

### 5. Provider-native details stay outside canonical payloads unless promoted intentionally
- provider-native data should continue to live primarily in `provider_extensions`
- payload specialization should focus on canonical meaning, not provider callback mirrors
- if a provider-native field becomes cross-provider protocol meaning, it can later be promoted into canonical payload shape by RFC change first

## Guardrails

### Guardrail 1: envelope first
Do not skip the common envelope contract and jump directly to provider- or implementation-specific payload schemas.

### Guardrail 2: no giant early discriminator union
Do not encode every current and hypothetical future payload in one large schema immediately.

### Guardrail 3: RFC semantics remain normative
If a payload specialization conflicts with RFC meaning, the RFC must be corrected first or the specialized schema must be corrected.

### Guardrail 4: extension points stay open
Do not overconstrain `provider_extensions` or future payload families before real implementation pressure justifies it.

## First Practical Follow-up

The next specialization work should probably target only the highest-value event families:
1. `message.received`
2. `agent.invocation.requested`
3. `agent.response.completed`
4. `message.sent`
5. `event.blocked`

These give the best early interoperability value without forcing the whole protocol surface to freeze at once.

## Current Decision Statement

CAR should evolve canonical event payload contracts through a **layered JSON Schema model**:
- one stable envelope schema for shared contract shape
- separate event-family-specific schemas for payload specialization
- RFCs remain normative for meaning
- payload formalization should proceed incrementally, not all at once
