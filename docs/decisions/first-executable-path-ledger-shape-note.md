# CAP First Executable Path Ledger Shape Note

This document captures the ledger assumptions implied by `docs/decisions/first-executable-path-plan.md`.

It is a planning/design note for the first runtime slice, not a storage-engine-specific schema migration and not an approval for durable storage work to begin.

## Purpose

Make the first-path persistence assumptions concrete enough that implementation work can proceed without reopening basic questions about:
- what gets appended
- what idempotency must protect
- what replay must return
- what audit explanation must be derivable from the ledger alone

## First-Path Ledger Role

For the first executable path, the relational append-only ledger is the source of truth for:
- the full seven-event happy path
- replay by conversation
- audit explanation of policy and routing decisions
- state reconstruction inputs for future projections

The ledger is not a disposable log sink.

## Facts That Must Be Appended

The following facts MUST be durably appended for the happy path:
1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

No step in this chain may live only in:
- backend-private runtime state
- UI memory
- transient process logs
- non-durable callback state

## Minimum Ledger Record Expectations

Each appended record must preserve at least:
- `event_id`
- `schema_version`
- `event_type`
- `tenant_id`
- `workspace_id`
- `channel`
- `channel_instance_id` when relevant to the event
- `conversation_id`
- `session_id`
- `correlation_id`
- `causation_id` when not the root event
- `occurred_at`
- `actor_type`
- canonical `payload`
- `provider_extensions` when needed

This note does not require a finalized physical table schema yet. It does require that the physical design preserve these logical facts without mutating prior records.

## Append Discipline

### Append-only
The primary ledger table or equivalent storage structure must be append-only in behavior for canonical facts in this slice.

That means:
- later events add facts
- earlier events are not overwritten to represent later state
- current state is reconstructed from the chain rather than stored as the only truth

### Durable before truth claims
A boundary should not treat a canonical fact as fully recorded unless it has reached the durable append boundary according to implementation policy.

For the first slice, the key planning assumption is that the system should not rely on only in-memory event chains.

## Idempotency Assumptions

### Ingress idempotency
The first idempotency problem to solve is duplicate inbound delivery.

For the first path:
- the web chat adapter must derive a stable dedupe/idempotency key for inbound delivery
- duplicate ingress must not create multiple happy-path chains for the same logical inbound message
- duplicate checks should occur inside the same serialized processing scope used for append decisions

### Event append idempotency
At the append boundary:
- each canonical fact should have a stable `event_id`
- the ledger must reject duplicate appends or safely no-op equivalent duplicate append attempts
- consumers remain idempotent
- CAP still assumes at-least-once internal processing rather than exactly-once guarantees

### Happy-path implication
A repeated inbound request should not produce:
- a second `message.received`
- a second allow decision
- a second backend invocation
- a second outbound send
for the same logical ingress unless later protocol semantics explicitly require it

## Replay Assumptions

### Required replay target
The first mandatory replay target is:
- by `conversation_id`

### Replay output expectation
Replay by conversation must be sufficient to reconstruct, in order:
1. inbound message receipt
2. allow policy result
3. route decision
4. backend invocation
5. backend completed response
6. outbound send request
7. final send result

### Minimal replay access patterns
The first ledger design must support practical access patterns for:
- all events for one conversation in occurrence order
- a time-bounded range for audit/debug follow-up
- lookup by `event_id`
- lookup by `correlation_id` when tracing one execution path

## Audit Explanation Assumptions

The first path must let an operator or implementer explain, from the ledger alone:
- what the user sent
- whether policy allowed it
- which route was selected
- which backend was invoked
- what response came back
- what outbound send was requested
- what final send result was recorded

The explanation chain should be derivable using:
- chronological event order
- `correlation_id`
- `causation_id`
- narrow decision payloads on policy and route events

## Provider-Native and Trace Boundaries

The ledger should preserve canonical facts directly.

Provider-native or browser-native details should:
- stay in `provider_extensions` when they are needed for interpretation
- remain outside the canonical core when they do not represent cross-provider meaning

Raw protocol traces, if retained later, are a separate concern.

This first-path ledger note does not require a secure trace store implementation, only that canonical ledger shape must not be distorted to absorb all raw trace detail.

## Projection Assumptions

Projections remain follow-on and disposable.

For the first slice, the ledger must be sufficient to support later reconstruction of:
- latest conversation status
- latest send outcome
- later route or handoff projections

But projection tables or caches are not required to define the first ledger truth model.

## Non-Goals of This Note

This note intentionally does not freeze:
- the final Postgres table layout
- partitioning or sharding strategy
- companion store selection
- analytics or search schema design
- broker integration
- exactly-once semantics

## Current Review-Gate Use

This note should currently be read against the implemented narrow evidence:
- `packages/event-ledger/src/append.ts` proves append validation and duplicate handling only inside a bounded in-memory store
- `packages/event-ledger/src/replay.ts` proves replay helpers only inside that bounded in-memory store
- `packages/event-ledger/src/audit.ts` proves audit explanation helpers only inside that bounded in-memory store

It is therefore a ledger-shape decision note for later discussion, not permission to begin physical ledger-table work, durable persistence, or replay/query API implementation.
