# Chat Agent Relay First Executable Path Next Implementation Step

This document records the review-gate outcome after the first code-facing step for the frozen first executable path.

It does not plan the full runtime.
It exists to prevent a premature jump from docs-first convergence into broad implementation work.

## Objective

Record the post-harness review-gate outcome for the frozen seven-event happy path:
- `packages/contract-harness` now proves schema loading
- `packages/contract-harness` now proves `event_type` to specialized-schema resolution
- `packages/contract-harness` now proves envelope-first and specialized validation
- `packages/contract-harness` now proves chain-level contract assertions against the fixture set
- `packages/event-ledger` now exists as a narrow in-memory prototype for append, replay, and audit helpers only

## Why This Is the Right Next Step

This is the right next step because the repository has already moved past the original harness-only plan and now needs a docs-first review-gate record before any broader implementation discussion continues.

It is the smallest useful approved slice because it:
- records the completed validation-harness milestone without re-opening semantics
- records that the seven-event chain is already machine-consumable end to end
- acknowledges the existing narrow in-memory ledger prototype without treating it as approval for broader runtime work
- restores alignment between decision docs and the current repository state
- keeps later follow-on work gated behind explicit approval and narrow commits

It is intentionally narrower than runtime implementation.

## Review Inputs

The review-gate record should stay aligned to the following frozen inputs and completed narrow evidence:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`
- `docs/schemas/canonical-model/events/messaging/message-received.schema.json`
- `docs/schemas/canonical-model/events/routing/policy-decision-made.schema.json`
- `docs/schemas/canonical-model/events/routing/route-decision-made.schema.json`
- `docs/schemas/canonical-model/events/agent/agent-invocation-requested.schema.json`
- `docs/schemas/canonical-model/events/agent/agent-response-completed.schema.json`
- `docs/schemas/canonical-model/events/messaging/message-send-requested.schema.json`
- `docs/schemas/canonical-model/events/messaging/message-sent.schema.json`
- `docs/schemas/fixtures/first-executable-path/01-message.received.json`
- `docs/schemas/fixtures/first-executable-path/02-policy.decision.made.json`
- `docs/schemas/fixtures/first-executable-path/03-route.decision.made.json`
- `docs/schemas/fixtures/first-executable-path/04-agent.invocation.requested.json`
- `docs/schemas/fixtures/first-executable-path/05-agent.response.completed.json`
- `docs/schemas/fixtures/first-executable-path/06-message.send.requested.json`
- `docs/schemas/fixtures/first-executable-path/07-message.sent.json`
- `docs/decisions/first-executable-path-plan.md`
- `docs/decisions/first-executable-path-sequence-diagram.md`
- `docs/decisions/first-executable-path-event-contract-matrix.md`
- `packages/contract-harness`
- `packages/event-ledger`

## Current Review-Gate Record

### 1. Completed validation-harness milestone
`packages/contract-harness` now proves:
- base envelope schema loading
- specialized schema loading for the frozen chain
- deterministic `event_type` mapping
- envelope-first and specialized validation
- fixture-driven contract checks
- chain-level invariant assertions

#### Implementation Evidence
These links document existing narrow evidence at the review gate. They do not approve broader runtime work.

- `packages/contract-harness/src/constants.ts` records the frozen seven-event order and the explicit `event_type` -> schema-path mapping
- `packages/contract-harness/src/schema-loader.ts` loads the base envelope schema and the seven specialized schemas from `docs/schemas/`
- `packages/contract-harness/src/fixtures.ts` loads the frozen fixture corpus from `docs/schemas/fixtures/first-executable-path/`
- `packages/contract-harness/src/validators.ts` performs envelope-first validation, specialized validation, and explicit unknown-`event_type` failure
- `packages/contract-harness/src/chain-assertions.ts` asserts fixed order, shared IDs, stepwise causation, and strictly increasing `occurred_at`

### 2. Bounded ledger prototype scope
`packages/event-ledger` now proves only:
- in-memory append behavior for already-canonical events
- duplicate/idempotency handling at the prototype boundary
- replay helpers over the frozen fixture chain
- audit explanation helpers over the frozen fixture chain

#### Implementation Evidence
These links document existing narrow evidence at the review gate. They do not approve broader runtime work.

- `packages/event-ledger/src/append.ts` records bounded in-memory append behavior plus duplicate/idempotency handling at the prototype boundary
- `packages/event-ledger/src/ledger-store.ts` records the in-memory store boundary for already-canonical events
- `packages/event-ledger/src/replay.ts` records replay and lookup helpers over in-memory stored facts only
- `packages/event-ledger/src/audit.ts` records audit explanation helpers over the frozen seven-event chain

This package must be described as a bounded in-memory prototype, not as approval for durable storage or runtime surfaces.

### 3. Review gate and deferrals remain active
The post-harness state still does not approve:
- web chat ingress runtime
- backend HTTP runtime
- durable persistence or migrations
- replay/query API surfaces
- projections or read models
- brokers, queues, or orchestration services

This document is therefore a review-gate record, not a runtime start signal.

## What Must Not Start Yet

The review-gate state must not turn into broad runtime implementation.

The following must not start in this slice:
- web chat ingress server or adapter runtime
- real backend HTTP client implementation
- actual ledger persistence
- replay endpoint or query API
- broker, queue, or infra integration
- deny-path execution
- duplicate-ingress execution
- retry or dead-letter handling
- streaming delta support
- tool-event support
- handoff support
- attachments, rich text, or rich media support

It must also not re-open already-settled points such as:
- whether the happy path has seven events
- whether `message.send.requested` belongs in the chain
- whether `message.send.requested` has specialized schema coverage
- whether `message.send.requested` uses `actor_type = system`

## Completion Criteria

This review-gate record is complete only if all of the following are true:
- the decision docs no longer contradict the existence of `packages/contract-harness`
- the decision docs no longer contradict the existence of `packages/event-ledger`
- the completed harness milestone is recorded as complete
- the ledger package is described as a bounded in-memory prototype only
- replay/audit helpers are acknowledged only inside that narrow prototype boundary
- the added evidence links only document, record, and point to existing narrow evidence
- this remains a review-gate record, not a runtime start signal
- no broad runtime implementation is newly approved by these docs

## Outcome of This Step

If completed successfully, this document will produce a docs-first review-gate record that:
- the frozen seven-event happy path is already machine-readable
- the schema layer is already consumable in code
- the current prototype boundary is accurately described in decision docs
- broader runtime concerns remain explicitly deferred

That is the correct handoff point for later discussion, not for automatic runtime expansion.

## Required Sequence After This Step

Once the validation-harness milestone is complete, the approved sequence is:
1. hold the review gate defined in `docs/decisions/first-executable-path-validation-harness-scope.md`
2. confirm the schema layer is consumable as code-facing input, the frozen seven-event chain works as a machine-readable baseline, and no RFC, decision, or schema corrections are required before discussing a runtime slice
3. only if follow-on work is explicitly approved, land each future feature as its own commit

This sequence does not approve channel runtime, backend invocation runtime, ledger persistence, replay APIs, or broader package expansion by default.

If follow-on work is later approved, commit granularity must remain narrow:
- one approved feature per commit
- no bundling of unrelated work into the same commit
- no interpretation of the commit workflow as permission to exceed the approved boundary for that slice
