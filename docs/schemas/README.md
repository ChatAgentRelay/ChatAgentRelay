# Chat Agent Relay Machine-Readable Schemas

This directory contains CAR's first machine-readable contract artifacts.

## Contract Hierarchy

The schema layer follows the repository's existing precedence rules:

1. RFCs remain normative for semantics
2. JSON Schema artifacts are authoritative for machine-readable contract shape
3. TypeScript implementation artifacts must align to the schema layer

That means:
- `docs/rfcs/` defines meaning
- `docs/schemas/` defines machine-readable validation shape
- implementation code must follow both, not replace them

## Current Layout

```text
docs/schemas/
  README.md
  canonical-model/
    canonical-event-envelope.schema.json
    events/
      messaging/
        message-received.schema.json
        message-send-requested.schema.json
        message-sent.schema.json
        message-delivery-updated.schema.json
      routing/
        policy-decision-made.schema.json
        route-decision-made.schema.json
      agent/
        agent-invocation-requested.schema.json
        agent-response-completed.schema.json
      handoff/
        handoff-requested.schema.json
      identity/
        identity-resolution-requested.schema.json
        identity-resolution-completed.schema.json
        identity-resolution-ambiguous.schema.json
        identity-resolution-challenge-sent.schema.json
      error/
        event-blocked.schema.json
```

## Validation Model

### 1. Validate against the base envelope first
Use:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`

This validates:
- common top-level fields
- required vs optional envelope shape
- shared enums such as `actor_type` and `event_type`
- shared structures such as `trace_context`, `attachments`, and `provider_extensions`

### 2. Validate against an event-specific schema second
Use the specialized event schema that matches `event_type`.

Examples:
- `message.received` → `docs/schemas/canonical-model/events/messaging/message-received.schema.json`
- `route.decision.made` → `docs/schemas/canonical-model/events/routing/route-decision-made.schema.json`
- `agent.response.completed` → `docs/schemas/canonical-model/events/agent/agent-response-completed.schema.json`
- `event.blocked` → `docs/schemas/canonical-model/events/error/event-blocked.schema.json`

These specialized schemas:
- compose with the base envelope using `allOf`
- constrain `event_type`
- add minimal payload requirements for that event family
- intentionally avoid overfreezing future payload evolution

## Design Rules

### Envelope-first
The base envelope schema is the stable contract boundary for all canonical events.

### Layered specialization
Event-family-specific payload rules live in separate schemas, not inside one giant union schema.

### Minimal freezing
The current schemas constrain only the highest-value event payload fields needed for early interoperability.

### Open extensions remain open
`provider_extensions` remains intentionally open and namespaced.

## Current Coverage

Current specialized coverage includes:
- inbound messaging
- outbound send request and send result messaging
- delivery state updates
- policy and route decisions
- agent invocation and completed response
- handoff requested
- blocked events
- identity resolution core events

## First Executable Path Fixture Baseline

The frozen seven-event happy-path fixture corpus lives under:
- `docs/schemas/fixtures/first-executable-path/`

That corpus is the current reusable contract-test baseline for:
- envelope-first validation
- specialized validation for the seven-event chain
- chain-level invariant checks
- bounded in-memory event-ledger happy-path tests

It does not approve broader runtime expansion beyond fixture-driven contract verification.

## What Is Not Covered Yet

The current schema set does not yet fully formalize:
- every event type in the envelope enum
- all payload variants for all event families
- transport bindings or OpenAPI descriptions
- code generation pipelines
- implementation-side validator loading/runtime wiring

## Recommended Consumption Pattern

For implementation work, the expected flow is:
1. read `event_type`
2. validate the event against the base envelope schema
3. resolve the matching specialized schema
4. validate against that specialized schema
5. treat failures as contract boundary failures, not as implicit payload coercion opportunities

## Next Likely Additions

The next schema work will likely include one or more of:
- `agent.response.delta`
- `handoff.started`
- `handoff.completed`
- `identity.linked`
- `error.occurred`
- `audit.annotation.added`
- tool event schemas

## Related Decision Documents

- `docs/decisions/canonical-event-machine-readable-strategy.md`
- `docs/decisions/canonical-event-payload-layering-strategy.md`
- `docs/decisions/typescript-validation-alignment-path.md`
