# CAP Repository Working Agreement

## Repo Purpose

This repository is currently a docs-first, RFC-first project for CAP.

CAP is being defined as a chat-platform <-> agent middleware with:
- channel adapters
- a canonical event model
- governance and routing middleware
- backend agent adapters
- an append-only ledger with replay and auditability

The repository uses a docs-first approach where RFCs govern architecture and the implementation follows approved narrow slices. The complete first executable path (seven-event happy path) is now implemented.

## Source-of-Truth Hierarchy

When documents disagree, use this precedence order:

1. `docs/rfcs/`
2. `docs/decisions/`
3. `README.md`
4. `docs/research/`

Interpretation rules:
- `docs/rfcs/` are normative and define the intended system behavior and boundaries.
- `docs/decisions/` capture cross-cutting open questions, evaluation frameworks, and eventually chosen implementation decisions.
- `README.md` is an entry point and project overview, not a detailed protocol spec.
- `docs/research/` is explanatory background only. It can justify or inspire decisions, but it does not constrain implementation by itself.

## Document Classes

### `docs/rfcs/`
Use this for normative specifications and architecture contracts.

These documents SHOULD:
- define required boundaries and semantics
- use RFC 2119 language where appropriate
- describe what implementations MUST, SHOULD, and MAY do
- be updated before code when architecture meaning changes

### `docs/decisions/`
Use this for:
- open questions that block v0/v1 planning
- technology selection frameworks
- future ADR-like decision records if needed

These documents SHOULD connect implementation choices back to RFC constraints.

### `docs/research/`
Use this for:
- competitor research
- comparative notes
- external inspiration
- tradeoff exploration

Research documents MUST NOT be treated as normative requirements unless their conclusions are promoted into `docs/rfcs/` or `docs/decisions/`.

## Authoring Rules

- Normative documents SHOULD use RFC 2119 keywords precisely.
- Research documents SHOULD avoid sounding like implementation mandates.
- Major architectural changes MUST be reflected in RFCs before or alongside implementation changes.
- The repository should remain docs-first until the minimum kernel and its boundaries are sufficiently stable.
- Do not mix runtime code into `docs/rfcs/`.
- Do not treat UI state, temporary notes, or research comparisons as system truth.

## Implementation Gate

The initial implementation gate has been satisfied:
- the minimum kernel is defined (seven-event first executable path)
- blocking open questions are centralized in `docs/decisions/`
- a technology selection framework exists for major subsystems
- repository governance files are in place
- Bun runtime, TypeScript strict mode, monorepo layout established

The repository has moved past the initial review gate and now has a complete first executable path implementation.

The current approved package set is:
- `packages/contract-harness` as the contract validation baseline
- `packages/event-ledger` with in-memory and SQLite-backed durable append via `LedgerStore` interface
- `packages/channel-web-chat` for web chat ingress canonicalization to `message.received`
- `packages/middleware` for policy, routing, and dispatch (produces `policy.decision.made`, `route.decision.made`, `agent.invocation.requested`)
- `packages/backend-http` for generic HTTP backend invocation and response mapping
- `packages/delivery` for delivery orchestration (produces `message.send.requested`, `message.sent`)
- `packages/pipeline` for end-to-end first executable path orchestration

This does not approve replay/query API surfaces for external consumers, projections, brokers, or orchestration services beyond the first happy path.

## Future Repository Shape Guidance

The bootstrap baseline uses Bun runtime and TypeScript strict mode. Framework choices for higher-level concerns (HTTP server, deployment) are not yet fixed.

When extending the codebase:
- create code directories separately from RFC directories
- keep normative specifications under `docs/rfcs/`
- ensure code layout follows the core CAP constraints rather than reshaping the protocol to fit a framework

Implementation structure should preserve these boundaries:
- canonical event model remains central
- channel adapters remain transport-side boundaries
- backend adapters remain runtime-side boundaries
- ledger, replay, audit, and governance remain first-class concerns

## Expected Workflow

Recommended order of work:
1. refine RFCs
2. centralize blocking questions in `docs/decisions/`
3. evaluate technologies by subsystem
4. record decisions
5. plan implementation
6. implement against the approved contracts

## Commit Workflow

After the next commit, Claude should automatically create one commit per approved feature.

That means Claude should:
- keep each feature commit narrowly scoped
- avoid combining unrelated changes into a single commit
- keep commit granularity aligned to the currently approved slice
- not treat the commit workflow rule as permission to exceed the currently approved implementation boundary

This workflow rule does not change the docs-first source-of-truth hierarchy and does not approve broader runtime work on its own.

## Current Status

Current repository status:
- docs-first with a complete first executable path implementation
- core RFC set drafted but still open in places
- implementation bootstrap baseline: Bun runtime, TypeScript strict mode, monorepo `packages/` layout
- seven packages implement the complete happy-path pipeline: ingress, middleware, backend, delivery, ledger, and end-to-end orchestration
- frozen seven-event fixture corpus remains the machine-readable contract baseline
- all canonical events are validated against the frozen schema layer at each boundary
- 79 tests across 7 packages verify contract compliance, causal linkage, and end-to-end behavior

The repository remains docs-first in its source-of-truth hierarchy. RFCs govern; implementation follows.
