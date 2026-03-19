# Contributing to CAP

Thanks for contributing.

CAP is currently a docs-first, RFC-first repository moving into a narrowly scoped implementation-readiness phase.

## Source of truth

When artifacts disagree, use this precedence order:
1. `docs/rfcs/`
2. `docs/decisions/`
3. `README.md`
4. `docs/research/`

For machine-readable contract work:
- `docs/schemas/` is the authoritative schema layer
- implementation code must consume that layer rather than replace it

## Current repository stage

The repository is not open for broad runtime implementation yet.

The current implementation-readiness baseline is limited to:
- the frozen seven-event fixture baseline under `docs/schemas/fixtures/first-executable-path/`
- the completed validation harness described in `docs/decisions/first-executable-path-validation-harness-scope.md`
- the bounded in-memory ledger prototype described in `docs/decisions/initial-package-boundaries.md`

The governing decision documents for this phase are:
- `docs/decisions/implementation-bootstrap-baseline.md`
- `docs/decisions/first-executable-path-validation-harness-scope.md`
- `docs/decisions/initial-package-boundaries.md`
- `docs/decisions/first-executable-path-next-implementation-step.md`
- `docs/decisions/first-executable-path-implementation-checklist.md`

That means the allowed current code packages are:
- `packages/contract-harness`
- `packages/event-ledger`

## Before changing code

If a proposed change affects architecture meaning, contract shape, or implementation boundaries:
- update the relevant RFCs and/or decision documents first
- update schema artifacts under `docs/schemas/` when machine-readable contract shape changes
- then update dependent code

Code should follow the docs and schema layer.
Code should not become a competing source of truth.

## Scope discipline

In the current phase, contributors should avoid starting:
- channel runtime implementation
- backend runtime implementation
- ledger persistence or migrations
- replay/query APIs
- projections or read models
- brokers, queues, or orchestration services
- additional runtime packages beyond the approved current package boundary

If a change appears to require any of the above, stop at the review gate and update the governing docs before proceeding.

## Development baseline

The current implementation-readiness baseline uses:
- Bun for runtime, package management, and tests
- strict TypeScript configuration at the repository root
- a monorepo `packages/` layout

Keep new tooling lightweight unless the repository decisions explicitly require more.

## Pull request guidance

When submitting a change:
- explain which governing docs it follows
- call out any RFC, decision, or schema updates included
- keep changes narrowly scoped to the currently approved slice

## Post-harness review gate

After the validation-harness milestone is complete, work must stop at the review gate defined in `docs/decisions/first-executable-path-validation-harness-scope.md`.

That review must confirm:
- the schema layer is consumable as code-facing input
- the frozen seven-event chain works as a machine-readable baseline
- `packages/contract-harness` satisfies the validation-harness milestone
- `packages/event-ledger` remains only a bounded in-memory prototype for append, replay, and audit helpers over already-canonical events
- no RFC, decision, or schema corrections are required before any runtime slice is discussed

Passing this review gate does not itself approve channel runtime work, backend runtime work, ledger persistence, replay APIs, projections, brokers, orchestration services, or broader package expansion.

## Commit workflow after the next commit

After the next commit, each future approved feature should land as its own commit.

That means contributors should:
- keep each feature commit narrowly scoped
- avoid bundling unrelated work into the same commit
- keep commit granularity aligned to the currently approved slice
- treat this workflow rule as a repository-governance rule, not as approval for broader runtime implementation

This commit workflow does not change the docs-first source-of-truth hierarchy. RFCs, decisions, schemas, and approved scope boundaries still govern what work is allowed.

## Questions and proposals

If you want to broaden scope, start by proposing the change in the appropriate decision or RFC document rather than introducing the runtime surface first.
