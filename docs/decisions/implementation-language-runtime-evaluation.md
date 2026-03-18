# CAP Implementation Language and Runtime Evaluation

This document evaluates the initial implementation language/runtime choice for CAP's first real middleware implementation and records the current project decision.

It follows `docs/decisions/technology-selection-framework.md` and assumes the current repository state is:
- storage-neutral at the RFC level
- channel-neutral at the RFC level
- backend-binding-neutral at the RFC level
- still focused on a middleware-core, contract-heavy, replay/audit-oriented architecture

## Decision Status

Decision made: **TypeScript on Node.js**.

This decision is not presented as a mathematically neutral winner in every category. The evidence-backed comparison showed that Go remained a strong fit for the current CAP kernel shape, while TypeScript/Node.js remained the strongest alternative.

The project owner has now chosen **TypeScript** as the implementation direction. This document therefore records:
- the evidence gathered
- the reasons TypeScript remained a credible choice
- the tradeoffs that must be managed consciously

## Decision Scope

Choose the primary language/runtime for the CAP middleware core for v0/v1.

This decision covers the likely home for:
- ingress and egress adapters
- middleware/governance pipeline
- routing
- backend adapter bindings
- event append path
- replay and audit support APIs

It does not force all future tools, SDKs, or sidecars to use the same language.

## Relevant RFC Constraints

### Architecture
From `docs/rfcs/architecture/reference-architecture.md`:
- minimum kernel must remain a coherent end-to-end loop
- channel adapters and backend adapters must stay distinct
- storage technology is not fixed at the RFC level
- no mandatory broker in v1

### Canonical model
From `docs/rfcs/canonical-model/canonical-event-schema.md`:
- canonical event semantics are central
- at-least-once plus idempotency is expected
- blocked and denied outcomes must remain auditable

### Channel adapter
From `docs/rfcs/adapters/channel-adapter-contract.md`:
- ingress/egress translation must be explicit
- capability declaration and deterministic fallback matter
- provider errors and duplicate delivery must be testable

### Backend adapter
From `docs/rfcs/adapters/backend-agent-adapter-contract.md`:
- runtime neutrality matters
- streaming, structured errors, and trace propagation matter
- session mapping must preserve platform-owned identity boundaries

### Middleware and governance
From `docs/rfcs/middleware/routing-middleware-governance.md`:
- policy and routing must remain explainable and auditable
- replay must reconstruct blocked, denied, retried, and handoff paths
- tenant-scoped governance must remain first-class

## Candidate Options Considered

- Go
- TypeScript on Node.js
- Python

## Evidence Summary by Capability

### HTTP server and routing
- Go: `chi`, Echo, `net/http`
- TypeScript/Node: Fastify
- Python: FastAPI, Starlette

Result:
- all three ecosystems are viable
- this category did not decide the outcome

### SSE / streaming responses
- Go: Echo SSE docs, Gin SSE example
- TypeScript/Node: official Fastify ecosystem entry plus `@fastify/sse`
- Python: Starlette streaming plus `sse-starlette`

Result:
- Go and TypeScript/Node are both strong
- Python is viable but relies more on an adjacent SSE package
- TypeScript/Node has enough evidence-backed streaming support for CAP's current needs

### Durable primary-store access
- Go: `pgx`
- TypeScript/Node: `node-postgres`, Postgres.js, Prisma, Drizzle
- Python: SQLAlchemy PostgreSQL dialect evidence gathered

Result:
- all three ecosystems have mature evidence for strong durable relational-store access
- TypeScript/Node has especially broad ecosystem breadth
- storage is no longer fixed at the RFC level, so this category should inform but not dominate the decision

### Migration / schema evolution tooling
- Go: `golang-migrate`
- TypeScript/Node: Prisma Migrate, Drizzle Kit, `node-pg-migrate`
- Python: Alembic

Result:
- all three ecosystems are credible
- TypeScript/Node has several mature options, though it requires more deliberate stack selection to avoid unnecessary coupling

### Schema validation / serialization
- Go: `validator`
- TypeScript/Node: Zod, Ajv
- Python: Pydantic

Result:
- TypeScript/Node was the strongest category leader here
- this mattered because CAP is contract-heavy and schema-sensitive
- this was one of the most important reasons TypeScript remained a serious option throughout the comparison

### Observability
- Go: OpenTelemetry Go
- TypeScript/Node: OpenTelemetry JS/Node
- Python: OpenTelemetry Python

Result:
- all three ecosystems are viable
- no clear winner

### Testing
- Go: stdlib testing + Testify
- TypeScript/Node: Vitest
- Python: pytest

Result:
- all three ecosystems are viable
- no clear winner

### Config management
- Go: Viper
- TypeScript/Node: Envalid, Convict
- Python: pydantic-settings, Dynaconf

Result:
- all three ecosystems are viable
- not a deciding category

## What Actually Drove the Final Choice?

The final project decision to use TypeScript should be understood as a deliberate tradeoff, not as an accidental drift.

### The strongest reasons in favor of TypeScript

1. **Schema and contract ergonomics**
   - TypeScript/Node had the strongest evidence-backed position for schema-heavy contract work through Zod and Ajv.
   - CAP is not just a message relay; it is a canonical-event and contract-driven middleware. That makes contract ergonomics strategically important.

2. **Broad ecosystem flexibility**
   - The Node ecosystem offered multiple credible paths for storage clients, schema tooling, migrations, HTTP serving, and streaming.
   - This increases choice complexity, but it also gives the project room to adapt as adjacent decisions are made.

3. **Owner preference and expected working style**
   - The project owner explicitly prefers TypeScript.
   - Since implementation discipline and long-term maintenance depend heavily on the primary maintainer's fluency and judgment, that preference is materially relevant.
   - In a close comparison, this is a legitimate deciding factor.

4. **Future upside if CAP becomes more tooling- and schema-driven**
   - If CAP grows into a strongly contract-oriented platform with admin surfaces, SDKs, validation-heavy tooling, or developer-facing integration UX, TypeScript's advantages become more valuable.

### What must be managed carefully because TypeScript was chosen

TypeScript was not selected because it naturally enforces the cleanest boundaries by default. Therefore the project must actively guard against:
- loose architectural boundaries
- framework-driven sprawl
- accidental coupling to ORM/toolkit assumptions
- overusing convenience abstractions where explicit middleware boundaries are preferable

In other words:
- TypeScript is the chosen language
- explicit architecture discipline must compensate for what the language/runtime will not enforce automatically

## Final Ranking from the Evidence Review

The evidence review, before owner preference was applied, was approximately:
1. Go
2. TypeScript/Node.js
3. Python

That ranking is still useful context, because it explains the main risk of the chosen direction:
- TypeScript is highly capable
- but it requires more conscious boundary discipline than the leading Go path would have

## Final Project Decision

### v0 Recommendation
Use **TypeScript on Node.js** for the first executable middleware prototype.

### v1 Recommendation
Use **TypeScript on Node.js** as the primary implementation language/runtime for the CAP middleware core.

## Decision Guidance for Follow-up Work

Because TypeScript is now selected, subsequent stack choices should optimize for:
- explicit contracts over framework magic
- minimal but robust HTTP/service infrastructure
- schema/validation discipline
- controlled migration and storage-tool coupling
- streaming support that stays easy to reason about

This means the next decisions should focus on:
1. API/gateway framework
2. primary ledger storage path
3. migration/schema evolution tooling
4. schema authoring strategy
5. observability baseline

## Risks to Revisit Later

Revisit this decision if one or more of the following happen:
- the implementation starts drifting into framework-led architecture rather than CAP-led architecture
- schema/tooling advantages do not materialize enough to justify the extra stack complexity
- runtime/operational requirements make a leaner service-core language materially more attractive
- the core team composition changes significantly

## Current Decision Statement

The repository now records **TypeScript on Node.js** as the chosen implementation direction for CAP v0/v1.

This choice is compatible with the collected evidence, but it comes with a clear requirement: the project must keep architecture and contract discipline explicit, rather than relying on the language ecosystem to enforce it automatically.
