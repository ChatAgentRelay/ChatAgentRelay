# CAP First Executable Path Plan

This document operationalizes already-decided RFC and decision inputs into one narrow implementation/design slice for the first executable CAP kernel path.

It does not redefine CAP architecture or canonical semantics. Those remain governed by:
- `docs/rfcs/`
- existing decision documents
- `docs/schemas/` for machine-readable contract shape

Its purpose is to freeze one precise first runtime path tightly enough that follow-on design artifacts and later review-gate discussion can proceed without re-opening first-order scope.

## Purpose

Define the first executable CAP kernel path for:
- web chat ingress
- canonical middleware and governance
- generic HTTP / streaming backend invocation
- outbound web chat delivery
- append-only relational ledger persistence

This plan remains a design-boundary artifact. It fixes the exact happy path, validation boundaries, persistence expectations, delivery boundary, and explicit deferrals for the first runtime slice, but it does not approve that runtime slice to start now.

## Inputs and Fixed Decisions

This plan assumes the following decisions are already fixed:
- first real channel: `web chat`
- first backend binding: `generic HTTP / streaming`
- primary ledger baseline: relational append-only Postgres-class store
- machine-readable validation path: JSON Schema with Ajv alignment for TypeScript implementation
- payload layering: base envelope plus specialized event schemas

These inputs are derived from:
- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/adapters/channel-adapter-contract.md`
- `docs/rfcs/adapters/backend-agent-adapter-contract.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`
- `docs/decisions/first-real-channel-evaluation.md`
- `docs/decisions/first-backend-binding-evaluation.md`
- `docs/decisions/primary-ledger-storage-evaluation.md`
- `docs/decisions/typescript-validation-alignment-path.md`
- `docs/decisions/canonical-event-machine-readable-strategy.md`
- `docs/decisions/canonical-event-payload-layering-strategy.md`
- `docs/decisions/initial-v1-scope-recommendations.md`
- `docs/schemas/README.md`

## Planning Goal

Translate the already-fixed direction into one single, executable minimum-kernel path that answers all of the following for day-one runtime work:
- what exact scenario the first implementation proves
- which canonical events are in the first chain
- which runtime boundaries must exist immediately
- what each boundary minimally owns
- what must be durably appended to the ledger
- what replay and audit explanation must be possible from that ledger chain
- what is explicitly deferred so scope does not expand during implementation

## First Executable Scope

The first executable path proves exactly one user-visible scenario:

> A user sends one plain-text message from a first-party web chat surface. The web chat adapter validates the source, derives dedupe/idempotency information, canonicalizes the input, and emits `message.received`. Middleware enriches minimal context, emits one allow policy result, emits one route decision, invokes one generic HTTP backend, receives one completed plain-text response, emits a delivery request, sends one outbound plain-text web chat message, emits `message.sent`, and records the full chain as replayable, auditable append-only facts in the relational ledger.

This path is intentionally narrow.

### In scope
- one inbound web chat text message
- source validation at the web chat boundary
- one stable ingress dedupe/idempotency derivation
- canonicalization into one `message.received`
- one minimal context-enrichment step
- one allow result via `policy.decision.made`
- one route selection via `route.decision.made`
- one generic backend invocation via `agent.invocation.requested`
- one completed backend response via `agent.response.completed`
- one outbound delivery orchestration step via `message.send.requested`
- one successful web chat send via `message.sent`
- append-only ledger persistence for the complete chain
- replay by conversation
- audit explanation derived from the ledger chain

### Out of scope for this slice
- multiple inbound event kinds
- multiple policy outcomes in the same flow
- multi-route routing strategies
- tool execution
- handoff
- rich media or rich content
- edits, deletes, or delivery callbacks beyond the minimum send result
- broad projection/read-model design
- framework-specific backend integrations

## System Boundaries for This Slice

The day-one runtime skeleton for this slice must preserve the architectural ownership model from the RFCs.

### Web chat adapter boundary
Owns:
- receive the inbound web chat request
- perform source validation appropriate to the first-party web path
- derive or surface a stable ingress dedupe/idempotency key
- translate provider-native/browser-native input into canonical event shape
- preserve channel-native metadata under `provider_extensions` when needed
- translate outbound canonical send requests into web chat delivery actions

Does not own:
- policy decision
- route decision
- tenant-level governance logic
- ledger truth beyond append submission

### Canonical event validation boundary
Owns:
- envelope validation using the base canonical schema
- event-specific validation using specialized schemas when present
- deterministic failure when a canonical event does not satisfy contract shape

Does not own:
- payload coercion as a hidden behavior
- business-policy interpretation

### Middleware / policy boundary
Owns:
- minimal context enrichment required to make the first path executable
- pre-route allow decision
- emitting auditable canonical decision facts
- preserving correlation and causation links

Does not own:
- provider-native translation
- backend-private session semantics

### Routing boundary
Owns:
- selecting the single backend target for the first path
- emitting a route decision fact with enough reason metadata for replay and audit

Does not own:
- backend execution itself
- channel delivery translation

### Generic backend adapter boundary
Owns:
- accepting one canonical invocation request
- mapping CAP conversation/session identifiers to backend session handles if needed
- invoking one generic HTTP / streaming backend contract
- mapping runtime output into canonical response or structured error shape
- preserving correlation and trace propagation

Does not own:
- canonical conversation identity
- route truth
- ledger truth

### Delivery boundary
Owns:
- consuming `agent.response.completed`
- producing `message.send.requested`
- translating canonical outbound payload into a web chat send operation
- producing `message.sent` on successful send

Does not own:
- route decisions
- backend invocation
- projection truth

### Append-only ledger boundary
Owns:
- durable append of canonical facts
- append idempotency enforcement at the ledger write boundary
- replay query inputs
- audit explanation inputs

Does not own:
- transport-native raw payload storage policy beyond references
- mutable UI state

### Replay / audit query boundary
Owns:
- replay by conversation for the first path
- timeline reconstruction from appended canonical facts
- explanation of why a route and send occurred from causally linked ledger entries

Does not own:
- mutable workflow state as a source of truth

## First Happy Path

The first happy path is fixed as the following sequence:

1. A user submits one plain-text message from the first-party web chat UI.
2. The web chat adapter receives the inbound request.
3. The adapter performs source validation for the web chat path.
4. The adapter derives a stable dedupe/idempotency key from the inbound message delivery context.
5. The adapter canonicalizes the input into one `message.received` event.
6. The event passes canonical validation: base envelope first, then event-specific specialized validation.
7. Middleware performs the minimum context enrichment required for tenant, workspace, conversation, session, and trace continuity.
8. Governance performs one pre-route allow check and emits `policy.decision.made` with `decision = allow`.
9. Routing selects the single configured generic backend and emits `route.decision.made`.
10. Middleware emits `agent.invocation.requested` for that backend.
11. The generic backend adapter issues one request to the backend.
12. The backend returns one completed plain-text response.
13. The backend adapter maps that response into `agent.response.completed`.
14. Delivery orchestration emits `message.send.requested`.
15. The web chat outbound adapter sends one plain-text outbound message.
16. On successful send, the system emits `message.sent`.
17. The full event chain is durably appended as canonical facts to the relational ledger.
18. Replay by conversation can reconstruct the path, and audit explanation can show why this exact response was sent.

## First Canonical Event Chain

The first executable path fixes the canonical event chain as:

1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

`message.send.requested` is explicitly part of the first chain.

It is not optional in this planning slice because it preserves the boundary between:
- backend completion
- outbound delivery orchestration
- channel send execution

That separation is required for replay clarity, auditability, and future delivery retry/terminal-state evolution.

## Event-by-Event Contract Table

| Event | Producer | Primary consumer | Why it exists | Required IDs / causation | Required payload narrowness | Schema validation path | Ledger append expectation |
|---|---|---|---|---|---|---|---|
| `message.received` | web chat adapter | middleware / governance / routing | Records canonical inbound user intent after source validation and dedupe derivation | MUST include `event_id`, `conversation_id`, `session_id`, `correlation_id`; first chain event so no `causation_id` required | plain-text only for first path; must carry inbound text; provider-native ingress details stay in `provider_extensions` if needed | base envelope + `message-received.schema.json` | MUST append durably as the first fact in the chain |
| `policy.decision.made` | middleware governance stage | router, audit, replay | Makes the allow outcome explicit and auditable before route selection | MUST include `causation_id = event_id(message.received)` and preserve same `correlation_id` | narrow to one policy reference and `decision = allow`; optional labels/reason metadata MAY be added | base envelope + `policy-decision-made.schema.json` | MUST append durably |
| `route.decision.made` | routing stage | backend invocation stage, audit, replay | Records why the backend target was chosen | MUST include `causation_id = event_id(policy.decision.made)` and preserve same `correlation_id` | narrow to one route identifier and one reason string for this slice | base envelope + `route-decision-made.schema.json` | MUST append durably |
| `agent.invocation.requested` | middleware execution boundary | generic backend adapter | Freezes the exact backend invocation request as a canonical fact | MUST include `causation_id = event_id(route.decision.made)` and preserve same `correlation_id`; SHOULD carry input event reference in payload | narrow to one backend target and one input-event reference for first path | base envelope + `agent-invocation-requested.schema.json` | MUST append durably before or as part of dispatch responsibility |
| `agent.response.completed` | generic backend adapter | delivery orchestration, audit, replay | Records the completed backend response in canonical form before delivery translation | MUST include `causation_id = event_id(agent.invocation.requested)` and preserve same `correlation_id`; backend request id MAY live in `provider_extensions` | plain-text only for first path; one completed response only | base envelope + `agent-response-completed.schema.json` | MUST append durably |
| `message.send.requested` | delivery orchestration | outbound web chat adapter | Separates backend completion from outbound send intent and establishes delivery boundary causally | MUST include `causation_id = event_id(agent.response.completed)` and preserve same `correlation_id` | plain-text outbound payload only; no rich content, attachments, or edits | base envelope + `message-send-requested.schema.json` | MUST append durably |
| `message.sent` | outbound web chat adapter | replay, audit, delivery views | Records successful outbound delivery execution | MUST include `causation_id = event_id(message.send.requested)` and preserve same `correlation_id` | minimum result must include provider/web message identifier or equivalent send result identifier | base envelope + `message-sent.schema.json` | MUST append durably as the terminal fact of the first happy path |

## Validation Model for the First Path

The validation model for this slice is fixed as follows.

### 1. Base envelope validation is mandatory
Every canonical event in the first path MUST first validate against:
- `docs/schemas/canonical-model/canonical-event-envelope.schema.json`

This is the common contract boundary for:
- identifiers
- correlation and causation fields
- actor and actor type shape
- shared envelope shape
- `provider_extensions`
- shared trace metadata

### 2. Specialized validation is mandatory where a schema exists
For the first chain, the following specialized schemas exist and should be used:
- `message.received` -> `docs/schemas/canonical-model/events/messaging/message-received.schema.json`
- `policy.decision.made` -> `docs/schemas/canonical-model/events/routing/policy-decision-made.schema.json`
- `route.decision.made` -> `docs/schemas/canonical-model/events/routing/route-decision-made.schema.json`
- `agent.invocation.requested` -> `docs/schemas/canonical-model/events/agent/agent-invocation-requested.schema.json`
- `agent.response.completed` -> `docs/schemas/canonical-model/events/agent/agent-response-completed.schema.json`
- `message.send.requested` -> `docs/schemas/canonical-model/events/messaging/message-send-requested.schema.json`
- `message.sent` -> `docs/schemas/canonical-model/events/messaging/message-sent.schema.json`

### 3. `message.send.requested` specialized validation is now part of the first chain
The first path now has specialized schema coverage for `message.send.requested` as part of the seven-event chain.

Its current specialization intentionally stays narrow:
- plain-text outbound payload only
- no attachments
- no rich content
- no edit/delete semantics

### 4. Validation implementation alignment
The implementation-alignment path remains:
- JSON Schema as the primary machine-readable contract layer
- Ajv as the default TypeScript-side runtime validation path
- TypeScript types and helpers aligned to schemas rather than replacing them

### 5. Validation failure handling
For the first slice, validation failure rules are:
- an inbound payload that cannot be safely canonicalized into a valid `message.received` MUST NOT proceed into the happy path
- a canonical event that fails envelope or specialized validation MUST be treated as a contract-boundary failure
- validation failures MUST be explicit and auditable rather than silently coerced
- validation failures are out of the happy path, but the implementation should reserve explicit recording behavior through blocked/error handling rather than silent drops

This slice does not require the full invalid-event terminal-path design to be completed before the happy path is planned, but it does require the rule that invalid canonical events do not continue downstream.

## Persistence and Replay Assumptions

### Ledger role
The relational append-only ledger remains the source of truth for:
- replay
- audit history
- state reconstruction inputs
- explanation of routing and delivery outcomes

### Facts that MUST be durably appended
For the first happy path, all seven canonical events MUST be appended durably:
1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

The first path is not complete if any of these facts exist only in transient logs, backend-private state, or UI memory.

### Append idempotency assumptions
The minimum append idempotency rules for this slice are:
- ingress processing MUST derive a stable dedupe/idempotency key before duplicate canonical append decisions
- duplicate inbound deliveries MUST NOT produce multiple canonical happy-path chains for the same logical ingress
- append decisions for duplicate ingress should occur within the same serialized processing scope used for idempotent processing decisions
- canonical events themselves SHOULD have stable `event_id` values and the ledger MUST reject or safely handle duplicate append attempts for the same canonical fact
- CAP continues to assume at-least-once internal processing with idempotent consumers, not exactly-once semantics

### Replay target
The first required replay target is:
- replay by `conversation_id`

That replay must be sufficient to reconstruct:
- inbound message arrival
- allow decision
- selected route
- backend invocation
- completed backend response
- outbound send request
- final send result

### Audit explanation target
The first path must support explanation such as:
- why this inbound message was allowed
- why this backend was selected
- why this outbound message was sent
- which prior event caused each later event

That explanation must be derivable from the appended causal chain, not from hidden mutable state.

### Provider-native and trace boundaries
For this first path:
- canonical core should only keep the cross-provider facts needed for replay and audit
- provider-native request or browser-specific metadata should stay in `provider_extensions` when needed for local interpretation
- raw or highly detailed trace material remains a separate trace concern and must not be allowed to reshape canonical core fields

## Backend Binding Shape for the First Path

The first backend binding is a narrow generic HTTP / streaming contract, but this slice intentionally uses only the completed-response path.

### Minimum request shape
The backend request for the first path should be derived from `agent.invocation.requested` and must carry enough information to preserve boundary discipline:
- canonical invocation event identity
- `tenant_id`
- `workspace_id`
- `conversation_id`
- platform `session_id`
- `correlation_id`
- `trace_context` when present
- the inbound message text or referenced input event needed to answer
- backend target identifier

The request may additionally carry:
- backend-session mapping handle if one exists
- adapter request id
- narrow route or policy context that is required for execution

### Minimum accepted response shape
For the first slice, the backend may return exactly one completed plain-text response shape sufficient to map into `agent.response.completed`.

The accepted minimum is:
- completed textual output
- backend request or run identifier if available
- optional backend session handle or resume token if needed for mapping

### Trace, correlation, and session propagation
The backend adapter MUST preserve across the boundary:
- `correlation_id`
- `causation_id`
- `trace_context`
- separation between platform `conversation_id` / `session_id` and backend-private session handles

### Structured error boundary
Even though the happy path does not trigger it, the minimum structured error boundary for this slice should already be fixed as including:
- `code`
- `message`
- `retryable`
- `category`
- `correlation_id`
- optional `causation_id`
- optional `details`

At minimum, the first backend path must reserve clean mapping for categories such as:
- `invalid_request`
- `timeout`
- `dependency_failure`
- `backend_unavailable`

## Explicit Deferrals

The following items are explicitly outside the first executable path.

### Channel-side deferrals
- Slack
- receipts
- reactions
- templates
- cards
- quick replies
- attachments
- audio
- video
- rich text
- typing indicators
- message update
- message delete
- advanced browser session behavior or websocket richness beyond first-path needs

### Backend-side deferrals
- framework-specific backend adapter
- tool execution events
- real handoff flow
- advanced streaming delta semantics
- cancellation
- deep checkpoint/resume behavior
- async callback mode beyond the first-path assumption

### Middleware and governance deferrals
- advanced policy DSL
- quota enforcement
- rate-limit enforcement
- deep redaction workflow
- multi-route selection
- operator queue projection logic

### Ledger and infrastructure deferrals
- sharding
- partitioning strategy beyond minimal relational fit
- companion stores
- secure trace store implementation
- search-oriented read models
- analytics read models
- brokered fan-out
- exactly-once semantics

### Schema and tooling deferrals
- full protocol coverage for all event types
- code generation pipeline details
- OpenAPI transport descriptions
- full TypeScript type-generation strategy beyond alignment rules
- full invalid-event terminal-path schema coverage

## Current Review-Gate Status

The follow-on design artifacts from this frozen slice now exist:

1. `docs/decisions/first-executable-path-sequence-diagram.md`
2. `docs/decisions/first-executable-path-event-contract-matrix.md`
3. `docs/decisions/first-executable-path-ledger-shape-note.md`
4. `docs/decisions/first-executable-path-backend-http-example.md`
5. `docs/schemas/fixtures/first-executable-path/`

The repository also now contains narrow code evidence for the review gate:
- `packages/contract-harness` proves schema loading, deterministic `event_type` dispatch, envelope-first validation, specialized validation, and chain assertions against the frozen fixture corpus
- `packages/event-ledger` proves only a bounded in-memory prototype for append, duplicate handling, replay helpers, and audit explanation over already-canonical events

These facts do not approve runtime implementation automatically. They establish the review-gate baseline for deciding later narrow slices.

## Verification Criteria

This planning output is complete only if all of the following are true.

### 1. Scope clarity
The document defines one and only one first executable scenario:
- one inbound web chat text message
- one allow policy outcome
- one route decision
- one generic backend invocation
- one completed backend response
- one outbound web chat send
- one replayable ledger chain

### 2. Event-chain completeness
The document fixes the event chain as:
1. `message.received`
2. `policy.decision.made`
3. `route.decision.made`
4. `agent.invocation.requested`
5. `agent.response.completed`
6. `message.send.requested`
7. `message.sent`

### 3. Validation clarity
The document makes clear:
- base envelope validation boundary
- specialized event validation boundary
- `message.send.requested` is included in specialized validation as a schema-backed event
- validation failure as an explicit contract-boundary failure
- JSON Schema + Ajv remain the implementation alignment path

### 4. Boundary discipline
The document preserves the ownership model:
- channel adapter translates
- middleware decides / enforces / records
- backend adapter invokes and maps runtime output
- ledger remains source of truth
- projections remain disposable follow-ons

### 5. Persistence and replay clarity
The document makes clear:
- which facts must append to the ledger
- minimum append idempotency rules
- replay by conversation as the first replay target
- audit explanation derives from the ledger chain

### 6. Explicit deferral discipline
The document clearly excludes at least:
- Slack
- framework-specific backend integration
- tools and handoff
- rich media and rich content
- advanced streaming
- companion stores, broker, and analytics read models

### 7. Review-gate readiness
The document is review-gate ready only if a later implementer can directly derive from it:
- the first runtime event chain
- the validation path
- the ledger assumptions
- the backend boundary
- which already-completed docs and narrow prototypes exist before any new slice is approved
