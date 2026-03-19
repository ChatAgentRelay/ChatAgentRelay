# CAP Repository Working Agreement

## Repo Purpose

This repository is currently a docs-first, RFC-first project for CAP.

CAP is being defined as a chat-platform <-> agent middleware with:
- channel adapters
- a canonical event model
- governance and routing middleware
- backend agent adapters
- an append-only ledger with replay and auditability

At this stage, the repository exists to clarify architecture, contracts, and decision boundaries before significant implementation work begins.

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

Do not begin broad implementation work until all of the following are true:
- the minimum kernel is defined tightly enough to execute
- v0/v1 blocking open questions are centralized and visible
- a technology selection framework exists for major subsystems
- repository governance files are in place
- git has been initialized for clean baseline tracking

Small exploratory prototypes may exist later, but they must not replace unresolved RFC work.

Current narrow implementation status does not remove this gate. The repository currently allows only:
- the frozen seven-event fixture baseline as a machine-readable contract corpus
- `packages/contract-harness` as the completed validation-harness milestone
- `packages/event-ledger` as a bounded in-memory prototype for append, replay, and audit helpers over already-canonical events

This does not approve channel runtime, backend runtime, durable persistence, replay/query APIs, projections, brokers, or orchestration services.

## Future Repository Shape Guidance

Language and framework choices are intentionally not fixed yet.

When code is introduced later:
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
- docs-first
- no committed implementation baseline yet
- technology stack not selected yet
- core RFC set drafted but still open in places

Treat the repository as a specification workspace first, not as an implementation repo with docs attached.
