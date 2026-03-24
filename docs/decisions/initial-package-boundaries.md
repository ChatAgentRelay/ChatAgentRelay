# CAP Initial Package Boundaries

This document records the initial package boundary for CAP's first code-facing work.

It exists to prevent premature package sprawl before the contract boundary has been proven.

## Decision Status

Decision made: **the currently approved code package set covers the complete first executable path: `packages/contract-harness`, `packages/event-ledger`, `packages/channel-web-chat`, `packages/middleware`, `packages/backend-http`, `packages/delivery`, and `packages/pipeline`**.

## Why This Boundary Exists

This document prevents premature package sprawl by recording what each package owns and what remains deferred.

The approved seven-package set implements the complete first executable path (happy path only) while keeping broader runtime concerns deferred.

## Foundation Package Set

`packages/contract-harness` owns only:
- loading canonical schema artifacts from `docs/schemas/`
- deterministic specialized-schema dispatch for the frozen seven-event chain
- envelope-first and specialized validation
- fixture loading for the first executable path
- chain-level invariant checks

`packages/event-ledger` owns only:
- append behavior for already-canonical events via the `LedgerStore` interface
- in-memory and SQLite-backed durable append implementations
- duplicate and idempotency checks at the append boundary
- replay helpers over stored facts
- audit explanation helpers derived from the frozen seven-event chain

It does not own external query API surfaces, projections, or runtime orchestration.

## Boundary Constraints

The following areas remain outside the approved package set:
- replay/query API surfaces exposed to external consumers
- projections or read models
- brokers, queues, or orchestration services beyond the first happy path
- deny-path handling or policy evaluation logic
- retry, dead-letter, or delivery recovery flows
- streaming delta support
- deployment surfaces

## Durable Ledger Extension

`packages/event-ledger` now includes a `SqliteLedgerStore` as a durable append boundary alongside the existing `InMemoryEventLedgerStore`.

The durable extension owns only:
- SQLite-backed append of already-canonical events
- duplicate detection at the append boundary
- basic retrieval for replay and audit verification
- full event fidelity across serialization/deserialization

It does not own:
- replay/query API surfaces exposed to external consumers
- projections or read models
- broker, queue, or orchestration services
- production Postgres migration strategy

The `LedgerStore` interface allows swapping between in-memory and durable backends.
This extension was approved as the Candidate 4 slice defined in `docs/decisions/repository-next-approved-slices.md`.

## Explicit Deferrals

The following package families are explicitly deferred and MUST NOT be introduced without explicit approval:
- channel adapter packages beyond `packages/channel-web-chat`
- backend adapter packages beyond `packages/backend-http`
- replay/query API packages for external consumers
- runtime orchestration packages beyond `packages/pipeline`
- projection/read-model packages
- infrastructure/deployment packages beyond local readiness needs

## Package Growth Rule

Additional packages should only be introduced after a follow-on implementation slice has been explicitly approved.

Future package boundaries must continue to preserve CAP's core architectural ownership model from the RFCs.

## Approved Channel-Side Extension

`packages/channel-web-chat` is now an approved narrow channel-side package.

It owns only:
- inbound web chat input validation at the adapter boundary
- stable idempotency key derivation from inbound delivery context
- canonicalization of validated input into `message.received`
- contract validation of the canonicalized output against the frozen schema layer

It does not own:
- HTTP server or transport listener
- middleware, policy, or routing behavior
- outbound delivery execution
- durable persistence

This package was approved as the Candidate 2 slice defined in `docs/decisions/repository-next-approved-slices.md`.

## Approved Backend-Side Extension

`packages/backend-http` is now an approved narrow backend-side package.

It owns only:
- constructing backend HTTP requests from `agent.invocation.requested` events
- invoking a generic HTTP backend endpoint
- mapping completed responses into `agent.response.completed` events
- contract validation of the mapped output against the frozen schema layer
- structured error reporting for backend failures

It does not own:
- streaming delta support
- tool event handling
- async callback mode
- cancellation
- framework-specific backend bindings

This package was approved as the Candidate 3 slice defined in `docs/decisions/repository-next-approved-slices.md`.

## Approved Middleware Extension

`packages/middleware` is an approved narrow middleware package.

It owns only:
- producing `policy.decision.made` events with a configurable policy id and an allow decision
- producing `route.decision.made` events with a configurable route and reason
- producing `agent.invocation.requested` events with backend and input event reference
- causal linkage: message.received -> policy -> route -> invocation
- contract validation of all three outputs against the frozen schema layer

It does not own:
- deny-path handling or policy evaluation logic
- multi-backend routing strategies
- load balancing or failover
- persistent policy or route configuration stores

## Approved Delivery Extension

`packages/delivery` is an approved narrow delivery package.

It owns only:
- producing `message.send.requested` from `agent.response.completed`
- invoking a provided send function and producing `message.sent` on completion
- causal linkage: agent.response.completed -> send.requested -> sent
- contract validation of both outputs against the frozen schema layer

It does not own:
- retry, dead-letter, or delivery recovery flows
- multi-channel delivery fanout
- delivery status tracking beyond the initial sent acknowledgement

## Approved Pipeline Extension

`packages/pipeline` is an approved narrow end-to-end orchestration package.

It owns only:
- wiring ingress, middleware, backend, delivery, and ledger into a single execute flow
- producing the complete seven-event happy-path chain from raw web chat input
- appending all events to a provided `LedgerStore` for replay and audit
- exposing replay by conversation id

It does not own:
- error recovery or partial pipeline execution
- multi-channel or multi-backend pipeline variants
- external API exposure or HTTP server concerns

## Immediate Outcome

For the current phase, repository code introduction consists of:
- root workspace/bootstrap files
- `packages/contract-harness` as the contract validation baseline
- `packages/event-ledger` with in-memory and SQLite-backed durable append
- `packages/channel-web-chat` as web chat ingress canonicalization boundary
- `packages/middleware` as policy, routing, and dispatch middleware
- `packages/backend-http` as generic HTTP backend invocation boundary
- `packages/delivery` as delivery orchestration boundary
- `packages/pipeline` as end-to-end first executable path orchestration
