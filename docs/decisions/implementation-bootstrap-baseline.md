# CAP Implementation Bootstrap Baseline

This document records the minimum repository bootstrap baseline that is allowed for CAP's first code-facing step.

It does not authorize broad runtime implementation.
It exists to make implementation readiness explicit while preserving the repository's docs-first contract hierarchy.

## Decision Status

Decision made: **the first implementation-ready repository baseline uses Bun for runtime, package management, and test execution; TypeScript strict mode for code; and a monorepo `packages/` layout for code-bearing workspaces**.

This decision refines the earlier TypeScript runtime direction into a concrete repository bootstrap for the first narrow executable slice.

## Scope

This baseline applies only to:
- repository bootstrap and local developer tooling
- the completed contract-consuming validation-harness package
- the bounded in-memory event-ledger prototype package

It does not authorize:
- web runtime work
- backend runtime work
- durable ledger persistence work
- replay/query API work
- broader package proliferation

## Baseline Decisions

### 1. Runtime and package manager
The repository baseline is:
- **Bun** as the runtime
- **Bun** as the package manager
- **Bun test** as the initial test runner

This choice is intentionally narrow.
It establishes one concrete execution environment for the first code slice without expanding the CAP runtime surface.

### 2. TypeScript baseline
The code baseline is:
- **TypeScript**
- **strict mode enabled at the root baseline**

TypeScript implementation artifacts remain subordinate to the established contract hierarchy.
TypeScript ergonomics must not become a competing contract source.

### 3. Repository code layout baseline
The initial code layout baseline is:
- a root workspace
- code packages under `packages/`

The purpose of this layout is to create a clean boundary for future code introduction without reshaping the normative docs directories.

### 4. Contract authority remains upstream of code
The repository contract hierarchy for implementation work is:
1. `docs/rfcs/`
2. `docs/decisions/`
3. `docs/schemas/` for machine-readable contract shape
4. implementation code under `packages/`

For machine-readable validation work:
- schemas under `docs/schemas/` remain authoritative
- implementation code consumes those schemas
- implementation code must not replace or silently fork the schema layer

### 5. Schema authority remains under `docs/schemas/`
The canonical envelope schema and specialized event schemas remain authoritative under `docs/schemas/`.

That means:
- validators should load schemas from `docs/schemas/`
- test fixtures should consume the schema layer as input
- code-local schema rewrites or shadow copies should be avoided

### 6. Initial implementation shape remains contract-consumer first
The first code-bearing step remains a contract consumer plus one bounded in-memory prototype, not a runtime subsystem.

The approved baseline now proves only that:
- schemas are loadable
- `event_type` dispatch is deterministic for the frozen chain
- fixture-driven envelope-first validation works
- chain-level invariants can be asserted from the frozen corpus
- append, replay, and audit helpers can be exercised only inside a bounded in-memory prototype over already-canonical events

## Why This Baseline Exists

This repository has completed the current docs-first convergence for the frozen first executable happy path and now has a narrow implemented baseline to support review.

The next safe step is not broad runtime work.
The next safe step is to preserve a reproducible bootstrap for:
- repository governance and tracking
- local execution tooling
- the completed contract-harness package
- the bounded in-memory event-ledger prototype

This preserves the docs-first working agreement while keeping the approved code baseline mechanical and reproducible.

## Guardrails

The bootstrap baseline MUST NOT be interpreted as approval to begin:
- channel adapter runtime implementation
- backend adapter invocation implementation
- durable ledger storage or migrations
- replay/read-model APIs
- projections, brokers, or orchestration services
- broad package decomposition

The presence of Bun, TypeScript, `packages/`, and the current lockfile is repository readiness only.
It is not runtime scope expansion.

## Immediate Consequence

After this baseline is in place, the only allowed current code packages are the narrow package set described in:
- `docs/decisions/first-executable-path-next-implementation-step.md`
- `docs/decisions/first-executable-path-validation-harness-scope.md`
- `docs/decisions/initial-package-boundaries.md`

That means:
- `packages/contract-harness` remains the completed validation-harness milestone
- `packages/event-ledger` remains a bounded in-memory prototype only
