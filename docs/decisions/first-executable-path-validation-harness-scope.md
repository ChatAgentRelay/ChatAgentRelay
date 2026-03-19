# CAP First Executable Path Validation Harness Scope

This document fixes the first allowed code slice for CAP in operational terms.

It exists to prevent the first implementation work from expanding into broad runtime concerns before the contract boundary is proven.

## Decision Status

Decision made: **the first allowed code slice is a validation harness for the frozen seven-event first executable path, and that milestone is now complete**.

## Scope Objective

The completed first package slice implements only the contract-consumption boundary needed to prove that the frozen first executable path is machine-consumable.

That means the slice is limited to:
- schema loading
- deterministic `event_type` -> specialized schema resolution
- envelope-first validation
- specialized validation
- fixture-driven checks
- chain-level invariant assertions

## Frozen Input Set

This slice consumes the already-frozen contract corpus directly:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`
- the seven specialized schemas used by the frozen happy path
- `docs/schemas/fixtures/first-executable-path/`
- the first executable path decision documents that define the chain and its invariants

The harness is a consumer of those artifacts.
It is not a replacement for them.

## Allowed Responsibilities

The first validation harness MAY do the following.

### 1. Load the base envelope schema
It may load:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`

### 2. Load the seven specialized schemas for the frozen chain
It may load exactly the specialized schemas for:
- `message.received`
- `policy.decision.made`
- `route.decision.made`
- `agent.invocation.requested`
- `agent.response.completed`
- `message.send.requested`
- `message.sent`

### 3. Resolve specialized schemas deterministically from `event_type`
It may define one explicit mapping from the above `event_type` values to their matching schema artifacts.

Unknown or out-of-scope `event_type` values must fail explicitly.

### 4. Validate envelope first, then specialized schema second
It may validate canonical events in this exact order:
1. base envelope validation
2. specialized schema resolution
3. specialized validation

Validation failures must remain explicit contract-boundary failures.
The harness must not silently coerce data into passing shape.

### 5. Load the frozen fixture set
It may load fixtures from:
- `docs/schemas/fixtures/first-executable-path/`

### 6. Assert chain-level invariants
It may assert the frozen chain rules for:
- fixed seven-event order
- shared `tenant_id`
- shared `workspace_id`
- shared `conversation_id`
- shared `session_id`
- shared `correlation_id`
- stepwise `causation_id` linkage
- monotonically increasing `occurred_at`

### 7. Add tests for the narrow contract boundary
It may use Bun tests to prove:
- happy-path fixture validity
- explicit failures for invalid fixtures
- explicit failures for unknown `event_type`

## Explicitly Forbidden in This Slice

This slice MUST NOT start broad runtime work.

The following are out of scope and forbidden here:
- web ingress runtime
- backend HTTP invocation logic
- ledger persistence or migrations
- replay or query APIs
- projection or read-model logic
- broker, queue, or infrastructure integration
- tool support
- handoff support
- streaming delta handling
- attachments, rich text, or rich media support
- out-of-scope event families beyond the frozen seven-event chain

## Boundary Interpretation

`packages/contract-harness` is a contract harness.
It is not:
- a channel adapter
- a middleware runtime
- a backend adapter
- a ledger component
- an API surface

Its job is to prove that CAP's frozen first executable path is consumable as machine-readable input before any broader runtime slice is discussed.

## Completion Criteria

This validation-harness slice is complete only if all of the following are true:
- the base envelope schema is loadable
- the seven specialized schemas are loadable
- `event_type` dispatch is explicit and deterministic for the frozen chain
- every happy-path fixture passes envelope validation
- every happy-path fixture passes specialized validation
- chain-level assertions pass for order, shared identifiers, causation, and time monotonicity
- explicit failure cases exist for unknown `event_type` and invalid fixtures
- the work remains inside the contract-consumer boundary

## Review Gate After Completion

After this slice passes, work must stop at a review gate.

That review should confirm:
- the schema layer is consumable as code-facing input
- the frozen seven-event chain works as a machine-readable baseline
- `packages/contract-harness` satisfies the validation-harness milestone
- `packages/event-ledger` exists only as a bounded in-memory prototype for append, replay, and audit helpers over already-canonical events
- no additional RFC, decision, or schema corrections are required before discussing a later slice
- channel runtime, backend runtime, durable persistence, replay/query APIs, projections, brokers, and orchestration services remain deferred
