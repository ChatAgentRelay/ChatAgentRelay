# CAP Primary Ledger Storage Evaluation

This decision is intentionally separated from the language/runtime decision.

The RFCs no longer mandate a specific storage engine. This document exists to keep storage choice independent from the TypeScript decision and to prevent storage assumptions from silently reshaping the architecture.

## Decision Scope

Choose the primary durable store strategy for:
- append-only event ledger
- replay
- audit history
- state reconstruction inputs
- blocked / denied / retry / dead-letter retention

## Why This Is Separate

The primary implementation language is now TypeScript, but storage must not be chosen merely because it is convenient in the chosen language.

Storage must be evaluated by CAP requirements first:
- append-only durability
- replayability
- auditability
- explainability
- tenant isolation
- operational simplicity for v0/v1
- no mandatory broker in v1

## Relevant RFC Constraints

This decision is primarily constrained by:
- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`

The strongest constraints from those RFCs are:
- the event ledger remains the source of truth for replay, audit, and state reconstruction inputs
- the ledger must preserve blocked, denied, retry, dead-letter, and other terminal path outcomes as durable facts
- projections remain disposable and rebuildable from durable ledger records
- v1 should not require a mandatory broker or distributed log dependency
- storage choice must support explainable, tenant-scoped governance and observability rather than hide important facts behind mutable state

## Candidate Options

- relational durable store
- log-oriented or event-store-style design
- document or KV-backed design with append discipline layered on top
- hybrid approaches with projections and companion stores

## Required Capabilities by Stage

### Day-one capabilities for the first executable path
The primary ledger store must support:
- append-only event writes with immutable event history
- idempotent append handling where duplicate ingress or retry paths occur
- replay by conversation and by time range
- durable retention of blocked, denied, retry, failed, and dead-letter outcomes
- projection rebuild inputs from canonical events without requiring hidden mutable state
- indexes or equivalent access patterns for audit explanation and state reconstruction
- disciplined schema evolution or migration handling appropriate for a small v0/v1 team

For this first path:
- these capabilities are core and must exist on day one
- most ledger semantics are CAP-owned and should not be outsourced to a storage product's opinionated workflow model
- ecosystem maturity matters most for durability, migrations, indexing, operations, and backup/restore rather than for defining CAP event semantics

### Deferred capabilities for later storage evolution
The first storage decision does not need to settle every future data concern.

These can be deferred until the first executable path is proven:
- large-scale partitioning or shard strategy
- brokered fan-out or distributed-log-first designs
- separate projection stores for specialized read patterns
- secure trace store specialization
- analytics and search-oriented companion stores

Those concerns may justify a hybrid design later, but they should not prevent selecting a simple durable primary ledger direction now.

## Evaluation Summary

A relational durable store is the best primary ledger direction for CAP's first executable path.

It is the strongest fit for append-only event recording, replay queries, audit visibility, migration discipline, and small-team operational simplicity without forcing CAP into a broker-first or event-database-specialized architecture too early. It also matches the repository's current need: prove one replayable, auditable first executable path before optimizing for larger-scale fan-out or multi-store complexity.

Within that family, a Postgres-class primary store is the clearest v1 direction. It is operationally familiar, works well for immutable ledger tables plus replay indexes, and keeps projections, trace retention, and future companion stores as separate decisions rather than collapsing all persistence concerns into one premature platform bet.

## Third-Party Library Notes

For the primary ledger decision, ecosystem maturity matters more than it does for the first channel or backend binding.

- Migration, schema evolution, backup/restore, and operational tooling are not trivial to rebuild and should weigh heavily in the storage choice.
- ORM preference alone should not drive the decision, because the core requirement is durable append-only event history, not convenience for CRUD modeling.
- Specialized event-store products may offer attractive semantics, but CAP should not adopt them as the default unless they clearly improve replay, audit, and operational fit more than a relational store does for v1.

## v0 Recommendation

Use a relational durable store with append-only ledger discipline as the narrowest acceptable storage direction for the first executable prototype.

The prototype should still preserve immutable event history, replayability, and audit retention rather than treating storage as a disposable local convenience.

## v1 Recommendation

Use a relational durable primary store with append-only ledger discipline as the CAP v1 primary ledger direction.

For practical v1 planning, this should be treated as a Postgres-class baseline unless later evidence shows that replay, audit, tenant isolation, or operational simplicity are materially better served by another relational option. Projections, secure trace retention, and future companion stores should remain separate follow-on decisions.

## Deferred Risks and Revisit Points

- Revisit if replay volume, retention scale, or ordering guarantees make a single relational primary store a poor fit.
- Revisit if secure trace retention, specialized projections, or search requirements become important enough to require companion stores earlier.
- Revisit if no mandatory broker in v1 stops being a repository constraint.
- Revisit if later execution patterns show that a log-oriented or hybrid design would materially improve correctness or operational simplicity.

## Decision Outcome

CAP should use a relational durable primary store with append-only ledger discipline as its v1 ledger baseline, with a Postgres-class implementation as the default planning assumption. This best supports replay, audit, explainability, and small-team operational simplicity while keeping projections and future multi-store evolution as separate decisions.
