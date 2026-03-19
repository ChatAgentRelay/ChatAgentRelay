# CAP Initial Package Boundaries

This document records the initial package boundary for CAP's first code-facing work.

It exists to prevent premature package sprawl before the contract boundary has been proven.

## Decision Status

Decision made: **the currently approved narrow code package set is `packages/contract-harness` plus one bounded in-memory prototype package: `packages/event-ledger`**.

## Why This Boundary Exists

The repository is moving from docs-first convergence into implementation readiness, not into full runtime construction.

That means the currently approved narrow package set should:
- consume the frozen contract corpus
- prove schema-loading and validation behavior
- prove a bounded in-memory append/replay/audit prototype against the frozen seven-event path
- remain independent from runtime subsystem choices that are not yet approved to start

These packages are therefore narrow contract and prototype consumers, not approved runtime subsystems.

## Initial Package Set

The allowed initial package set is:
- `packages/contract-harness`
- `packages/event-ledger`

No broader runtime package surface should be introduced in this phase.

## Responsibilities of the Current Package Set

`packages/contract-harness` owns only:
- loading canonical schema artifacts from `docs/schemas/`
- deterministic specialized-schema dispatch for the frozen seven-event chain
- envelope-first validation
- specialized validation
- fixture loading for the first executable path
- chain-level invariant checks
- Bun tests for happy-path and explicit failure-path contract checks

It exists to consume and verify the frozen contract corpus.

`packages/event-ledger` owns only:
- in-memory append behavior for already-canonical events
- duplicate and idempotency checks at the prototype boundary
- replay helpers over in-memory stored facts
- audit explanation helpers derived from the frozen seven-event chain
- Bun tests proving the bounded prototype against the frozen fixture path

It does not approve durable storage, external query surfaces, projections, or runtime orchestration.

## Why These Are Not Runtime Subsystems

`packages/contract-harness` and `packages/event-ledger` do not own:
- transport behavior
- middleware orchestration
- backend invocation
- durable ledger persistence
- replay endpoints or query APIs
- read models
- deployment surfaces

Their outputs are validation results, in-memory prototype behavior, and test assertions only.

## Explicit Deferrals

The following package families are explicitly deferred and MUST NOT be introduced in this phase:
- channel adapter packages
- backend adapter packages
- durable ledger packages beyond the current in-memory prototype
- replay/query API packages
- runtime orchestration packages
- projection/read-model packages
- infrastructure/deployment packages beyond local readiness needs

Examples of deferred package shapes include, but are not limited to:
- `packages/channel-*`
- `packages/backend-*`
- `packages/ledger-*`
- `packages/replay-*`
- `packages/runtime-*`

## Package Growth Rule

Additional packages should only be introduced after the validation harness milestone is complete and a follow-on implementation slice has been explicitly approved.

Future package boundaries must continue to preserve CAP's core architectural ownership model from the RFCs.

## Immediate Outcome

For the current phase, repository code introduction should consist of:
- root workspace/bootstrap files
- `packages/contract-harness` as the completed validation-harness milestone
- `packages/event-ledger` as a bounded in-memory append/replay/audit prototype tied to the frozen seven-event path
- no broader package surface
