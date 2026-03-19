# CAP First Executable Path Implementation Checklist

This document is a review-gate checklist artifact for the frozen first executable path.

It is not a new RFC.
It does not expand runtime scope.
It exists to make the current review-gate state explicit and keep later follow-on work mechanical and bounded.

## Purpose

Provide one checklist that lets a later implementer determine:
- which first-path artifacts are already frozen
- which narrow milestones are already complete
- which work must remain deferred
- what criteria must be met before any broader runtime work is approved

## Locked Scope

The following first-path assumptions are now locked for this slice:
- the happy path is a seven-event chain
- the chain order is fixed
- the path remains plain-text only
- `message.send.requested` is part of the chain and is not optional
- `message.send.requested` already has specialized schema coverage
- `message.send.requested` uses `actor_type = system`
- the validation model remains envelope-first, then specialized-schema validation
- the repository remains docs-first even though it now contains narrow contract and ledger prototypes

The frozen seven-event chain is:
1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

## Docs-First Artifact Checklist

Use this section to confirm the docs-first baseline remains sufficiently frozen at the current review gate.

- [x] `docs/decisions/first-executable-path-plan.md` freezes the first executable path
- [x] `docs/decisions/first-executable-path-sequence-diagram.md` freezes the event order and runtime boundaries
- [x] `docs/decisions/first-executable-path-event-contract-matrix.md` provides the compact seven-event contract view
- [x] `docs/decisions/first-executable-path-ledger-shape-note.md` captures append, idempotency, replay, and audit assumptions
- [x] `docs/decisions/first-executable-path-backend-http-example.md` fixes the narrow backend request/response example
- [x] base envelope schema exists at `docs/schemas/canonical-model/canonical-event-envelope.schema.json`
- [x] specialized schema exists for `message.received`
- [x] specialized schema exists for `policy.decision.made`
- [x] specialized schema exists for `route.decision.made`
- [x] specialized schema exists for `agent.invocation.requested`
- [x] specialized schema exists for `agent.response.completed`
- [x] specialized schema exists for `message.send.requested`
- [x] specialized schema exists for `message.sent`
- [x] fixture set exists under `docs/schemas/fixtures/first-executable-path/`
- [x] fixture set covers the full frozen seven-event happy path

### Artifact Alignment Checks

- [x] the fixture set preserves shared `tenant_id`, `workspace_id`, `conversation_id`, `session_id`, and `correlation_id`
- [x] each fixture after the first links `causation_id` to the immediately previous `event_id`
- [x] `occurred_at` is monotonically increasing across the chain
- [x] all fixture payloads remain plain-text-only where applicable
- [x] `message.send.requested` is treated as a schema-backed event, not as an open gap
- [x] `message.send.requested` is treated as `actor_type = system`, not implementation-defined

## First Implementation Slice Checklist

The first code-facing validation slice is complete in `packages/contract-harness` and should remain the baseline contract boundary.

The completed validation-harness slice includes:

- [x] load the base envelope schema from `docs/schemas/canonical-model/canonical-event-envelope.schema.json`
- [x] load the seven specialized schemas for the frozen chain
- [x] define one deterministic `event_type` -> specialized-schema mapping for the frozen chain
- [x] validate every fixture against the base envelope first
- [x] validate every fixture against its specialized schema second
- [x] fail explicitly when a fixture has an unknown or unmapped `event_type`
- [x] fail explicitly when envelope validation fails
- [x] fail explicitly when specialized validation fails
- [x] add chain-level assertions for shared identifiers across the seven fixtures
- [x] add chain-level assertions for ordered causal linkage across the seven fixtures
- [x] add chain-level assertions for monotonically increasing `occurred_at`
- [x] treat the fixture set as the baseline contract corpus for the first path
- [x] keep implementation-side naming and types aligned to the schema layer rather than redefining the contract elsewhere

### Grouped Implemented Evidence
These links point to existing review-gate evidence only. They do not change approval state and do not approve broader runtime work.

#### Contract harness evidence
- [x] deterministic event order and explicit schema mapping are recorded in `packages/contract-harness/src/constants.ts`
- [x] schema loading from `docs/schemas/` is recorded in `packages/contract-harness/src/schema-loader.ts`
- [x] frozen fixture loading is recorded in `packages/contract-harness/src/fixtures.ts`
- [x] envelope-first validation, specialized validation, and unknown-`event_type` failure are recorded in `packages/contract-harness/src/validators.ts`
- [x] chain assertions for fixed order, shared IDs, causation, and increasing `occurred_at` are recorded in `packages/contract-harness/src/chain-assertions.ts`

### Boundary Discipline for the First Slice

- [x] keep the work limited to schema loading, schema resolution, validation, and chain assertions
- [x] keep the work fixture-driven rather than transport-driven
- [x] keep failures explicit rather than silently coercing input
- [x] avoid introducing broad runtime control flow while validating the contract boundary

## Current Prototype Alignment

The repository now also contains `packages/event-ledger` as a bounded in-memory prototype.

That prototype is currently aligned only if it remains limited to:
- append behavior for already-canonical events
- duplicate/idempotency checks at the in-memory prototype boundary
- replay helpers over the frozen seven-event path
- audit explanation helpers over the frozen seven-event path

Implemented evidence for the current prototype alignment:
- `packages/event-ledger/src/append.ts` records append validation plus duplicate/idempotency handling at the prototype boundary
- `packages/event-ledger/src/ledger-store.ts` records the in-memory store boundary
- `packages/event-ledger/src/replay.ts` records replay and lookup helpers over in-memory stored facts only
- `packages/event-ledger/src/audit.ts` records audit explanation helpers over the frozen seven-event chain

This prototype does not approve broader runtime expansion.
These evidence links do not change approval state.

## Deferred Items Checklist

The following work must remain deferred in this round even if it seems adjacent:

- [ ] do not start the web chat runtime ingress implementation
- [ ] do not start the real backend HTTP invocation path
- [ ] do not start actual ledger persistence or migrations
- [ ] do not start replay endpoint implementation
- [ ] do not start broker, queue, or infra integration
- [ ] do not start deny-path implementation
- [ ] do not start duplicate-ingress handling implementation
- [ ] do not start retry or dead-letter flows
- [ ] do not start streaming delta support
- [ ] do not start tool-event support
- [ ] do not start handoff support
- [ ] do not start attachments, rich text, or rich media support
- [ ] do not broaden the chain beyond the frozen seven-event baseline

## Exit Criteria

This checklist is satisfied for the current review-gate milestone only if all of the following are true:

- [x] the seven-event fixture set is treated as the frozen happy-path baseline
- [x] every fixture can be resolved from `event_type` to one specialized schema
- [x] every fixture passes envelope validation
- [x] every fixture passes specialized validation
- [x] the chain-level assertions pass for shared IDs, causal linkage, and event ordering
- [x] the implementation-facing work remains confined to the contract boundary for `packages/contract-harness`
- [x] any existing ledger code is limited to the bounded in-memory prototype described in the decision docs
- [x] no channel runtime, backend runtime, durable persistence, replay/query API surface, projection package, broker, or orchestration service has been newly approved

## Ready-for-Later-Approval Signal

The current repository is ready for later follow-on discussion when a later implementer can clearly see that:
- the contract corpus is frozen enough to load and validate
- the seven-event path is schema-backed end to end
- the validation and fixture-harness boundary has already been proven
- the event-ledger package is still only a bounded in-memory prototype
- broader runtime work is still intentionally deferred until a later slice is explicitly approved
- the evidence links only trace existing review-gate facts and do not act as a runtime start signal
