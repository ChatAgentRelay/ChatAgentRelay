# CAP First Executable Path Fixture Set

This directory contains the machine-readable happy-path contract fixtures for the frozen first executable CAP path.

These fixtures are not new normative RFC content.

They exist to provide a stable schema-consumption and contract-test baseline for the seven-event happy path already fixed by:
- `docs/decisions/first-executable-path-plan.md`
- `docs/decisions/first-executable-path-sequence-diagram.md`
- `docs/decisions/first-executable-path-event-contract-matrix.md`
- `docs/decisions/first-executable-path-backend-http-example.md`

## Purpose

This fixture set makes the first happy path concrete enough for later implementation-side validation and contract harness work without starting broad runtime implementation.

It is the frozen full-corpus baseline for the seven-event happy path and is intended to be reused directly by:
- `packages/contract-harness`
- `packages/event-ledger` within its bounded in-memory prototype scope

It is intended to support:
- envelope-first validation
- specialized schema validation by `event_type`
- chain-level invariant checks across the full path
- fixture-driven contract harness work before broader runtime code exists

## Fixed Happy-Path Event Order

1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

## Files

- `01-message.received.json`
- `02-policy.decision.made.json`
- `03-route.decision.made.json`
- `04-agent.invocation.requested.json`
- `05-agent.response.completed.json`
- `06-message.send.requested.json`
- `07-message.sent.json`

## Validation Expectations

Each fixture in this directory is expected to satisfy both:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`
- the specialized schema matching its `event_type`

The specialized schema mapping for this fixture set is:
- `message.received` -> `docs/schemas/canonical-model/events/messaging/message-received.schema.json`
- `policy.decision.made` -> `docs/schemas/canonical-model/events/routing/policy-decision-made.schema.json`
- `route.decision.made` -> `docs/schemas/canonical-model/events/routing/route-decision-made.schema.json`
- `agent.invocation.requested` -> `docs/schemas/canonical-model/events/agent/agent-invocation-requested.schema.json`
- `agent.response.completed` -> `docs/schemas/canonical-model/events/agent/agent-response-completed.schema.json`
- `message.send.requested` -> `docs/schemas/canonical-model/events/messaging/message-send-requested.schema.json`
- `message.sent` -> `docs/schemas/canonical-model/events/messaging/message-sent.schema.json`

## Chain Invariants Locked by This Fixture Set

All seven fixtures preserve the same:
- `tenant_id`
- `workspace_id`
- `conversation_id`
- `session_id`
- `correlation_id`
- `channel`
- `channel_instance_id`

Additional chain rules:
- `message.received` is the root event and does not require a prior `causation_id`
- every later event sets `causation_id` to the immediately previous event's `event_id`
- `occurred_at` is strictly increasing across the chain
- the path remains plain-text only
- `message.send.requested` uses `actor_type = system`

## Scope Boundaries

This fixture set intentionally excludes:
- deny paths
- duplicate ingress handling
- retries and dead-letter behavior
- streaming deltas
- tool events
- handoff
- attachments
- rich text or rich media
- replay API shape
- transport or infrastructure implementation details

## Consumption Guidance

A first implementation-facing contract harness should treat this directory as a frozen seven-event baseline and should:
1. load the base envelope schema
2. resolve the specialized schema from `event_type`
3. validate each fixture against the envelope first
4. validate each fixture against the specialized schema second
5. assert cross-fixture invariants for order, causation, and shared identifiers
