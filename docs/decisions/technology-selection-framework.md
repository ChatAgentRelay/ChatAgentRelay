# CAP Technology Selection Framework

This document defines how CAP technology choices should be evaluated after the repository governance baseline is in place.

It does not select a stack yet. It defines the scope, constraints, criteria, and output format for subsystem-level decisions.

## Decision Scope

Technology selection should be performed by subsystem, not as one repo-wide stack decision.

Initial subsystem scopes:
- implementation language and runtime
- API and gateway framework
- Postgres ledger model and migration tool
- backend adapter streaming interface
- test strategy
- observability baseline
- deployment shape

## Constraints from Existing RFCs

Any candidate technology should be evaluated against the existing RFC set first.

### Architectural constraints
From `docs/rfcs/architecture/reference-architecture.md`:
- the minimum kernel must remain implementable as one coherent loop
- channel adapters and backend adapters must remain distinct boundaries
- append-only ledger and replay remain core architectural requirements
- Postgres-first is the current storage baseline
- v1 should not require a mandatory broker

### Canonical model constraints
From `docs/rfcs/canonical-model/canonical-event-schema.md`:
- canonical event semantics remain the center of gravity
- at-least-once plus idempotency is the expected delivery model
- provider-specific details must remain outside the canonical core
- blocked and denied outcomes must remain auditable

### Channel adapter constraints
From `docs/rfcs/adapters/channel-adapter-contract.md`:
- ingress and egress translation must stay explicit
- capability declaration and deterministic fallback matter
- duplicate delivery and provider failures must be testable

### Backend adapter constraints
From `docs/rfcs/adapters/backend-agent-adapter-contract.md`:
- runtime portability matters
- session mapping must preserve platform-owned identity boundaries
- streaming, structured errors, and trace propagation are important evaluation points

### Middleware and governance constraints
From `docs/rfcs/middleware/routing-middleware-governance.md`:
- policy and routing must remain explainable and auditable
- replay must reconstruct blocked, denied, retried, and handoff paths
- tenant-scoped governance and observability must remain first-class

## Evaluation Criteria

Each subsystem decision should score options against at least these criteria:

### 1. Ledger and replay fitness
- Does the option work well with an append-only ledger?
- Does it support replay and auditable state reconstruction cleanly?
- Does it encourage durable event semantics instead of hidden mutable state?

### 2. Postgres-first fit
- Does the option integrate cleanly with Postgres as the first durable store?
- Does it support reliable migrations and schema discipline?
- Does it avoid forcing an early broker or distributed system dependency?

### 3. Boundary discipline
- Does it help preserve the separation between channel adapters, middleware core, and backend adapters?
- Does it avoid leaking framework-private objects across boundaries?

### 4. Streaming and contract support
- Does it support streaming and structured request/response contracts well?
- Can it model trace, correlation, cancellation, and errors explicitly?

### 5. Testability and conformance
- Does it make contract tests, fixtures, replay tests, and golden-event verification straightforward?
- Can failures be simulated cleanly?

### 6. Multi-tenant governance and audit
- Does it fit tenant-scoped policy, auditability, and observability requirements?
- Does it support explicit enforcement points rather than implicit side effects?

### 7. v0/v1 delivery simplicity
- Can it support a narrow first implementation without overcommitting the architecture?
- Does it keep the codebase understandable while the protocol is still settling?

### 8. Operational maturity
- Is deployment straightforward for a self-hosted, enterprise-oriented system?
- Are observability, health checks, and failure handling mature enough for the target shape?

## Evaluation Template

Use the following structure for each subsystem decision.

## Subsystem
Name of the subsystem being evaluated.

## Decision Scope
What exact choice is being made.

## Relevant RFC Constraints
Which RFC sections most strongly constrain the choice.

## Candidate Options
A short list of realistic options.

## Evaluation Matrix
For each option, assess:
- ledger and replay fitness
- Postgres-first fit
- boundary discipline
- streaming and contract support
- testability and conformance
- multi-tenant governance and audit
- v0/v1 delivery simplicity
- operational maturity

## v0 Recommendation
What is the narrowest acceptable prototype choice, if different from v1.

## v1 Recommendation
What should be used for the first real implementation.

## Deferred Risks and Revisit Points
What to watch for and when to reconsider the decision.

## Initial Recommendation for Process

Recommended sequencing:
1. decide the first real channel target
2. decide the first backend adapter target
3. decide the implementation language and runtime
4. decide the API and gateway framework
5. decide the Postgres migration and schema tooling
6. decide the observability baseline
7. decide the deployment shape

This order keeps earlier decisions tied to the real v1 kernel path instead of making abstract stack choices first.

## Expected Outputs

A completed technology decision should produce:
- a subsystem-scoped evaluation using this framework
- a clear v0 recommendation if needed
- a clear v1 recommendation
- explicit deferred risks
- updates to relevant RFCs or decision records when the choice changes repository guidance
