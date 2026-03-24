# CAP Repository Next Approved Slices

This document is the repository-level inventory for CAP after the current review-gate baseline.

It exists to make the overall direction, current position, and later approval menu easier to read without introducing a parallel master document.

It remains a planning aid for later approval discussions only.
It is not a new normative source.
It is not an execution order guarantee.
It is not a runtime start signal.
Listing a slice here does not approve implementation.
Nothing in this document approves broader runtime work by itself.

## What This Inventory Is For

Use this document as a repository-wide roadmap navigation entry for later approval discussion.

Its job is to make the following easier to see in one place:
- what minimum system boundary CAP is currently converging toward
- what narrow baseline and closure work is already complete
- why the repository is still at a review gate
- what candidate directions are available for later exact-slice approval discussion
- how those candidate directions relate to each other without implying default sequencing

Repository roadmap mechanics in this file work as follows:
- the roadmap is a candidate-direction menu, not an automatic queue
- a listed slice is a discussion input, not an approved next step
- no candidate entry implies default execution order
- later approval remains exact-slice approval, not category-level approval
- if a later slice changes boundary meaning, the relevant RFCs and decision docs still need to be aligned first where applicable

## Current Repository Direction

CAP remains a docs-first repository that is converging on a minimum executable system boundary for a chat-platform <-> agent middleware.

That minimum direction is still centered on:
- a canonical event model as the shared contract boundary
- channel-side boundaries that produce canonical events
- backend-side boundaries that consume canonical events
- governance and routing semantics that stay source-aligned to RFCs and decisions
- ledger, replay, and audit concerns that remain first-class but not broadly approved as runtime surfaces yet

This inventory does not replace the source-of-truth hierarchy.
When documents disagree, `docs/rfcs/` remain normative over `docs/decisions/`, and this file remains repository-level planning inventory rather than protocol authority.

## Current Position: Still At The Review Gate

The repository is still docs-first and still at the current review gate.

That remains true because the completed work so far establishes a machine-consumable baseline and narrow prototype evidence, but it does not by itself approve broader runtime expansion.

The current repository state is:
- the frozen seven-event fixture baseline is complete
- `packages/contract-harness` is the completed validation-harness milestone and remains the contract-consumption boundary
- `packages/event-ledger` exists only as a bounded in-memory prototype for append, replay, and audit helpers over already-canonical events
- review-gate alignment and implementation-evidence linking are complete as docs-only closure work
- runtime work remains deferred unless a later exact slice is explicitly approved

One approved feature per commit remains workflow discipline only.
It does not approve scope by itself.

## Completed Narrow Baseline Slices

The repository now has the following completed narrow slices.

### 1. Frozen first executable path fixture baseline
Completed facts:
- the seven-event happy-path fixture corpus is frozen under `docs/schemas/fixtures/first-executable-path/`
- the chain order, shared identifiers, causal linkage, and event timing assumptions are machine-readable
- `message.send.requested` is part of the frozen chain and has specialized schema coverage

Primary evidence:
- `docs/schemas/fixtures/first-executable-path/`
- `docs/decisions/first-executable-path-plan.md`
- `docs/decisions/first-executable-path-event-contract-matrix.md`

### 2. Validation-harness milestone
Completed facts:
- `packages/contract-harness` loads the base envelope schema
- `packages/contract-harness` loads the seven specialized schemas for the frozen chain
- `packages/contract-harness` resolves `event_type` deterministically
- `packages/contract-harness` performs envelope-first validation and specialized validation
- `packages/contract-harness` asserts chain-level invariants against the frozen fixture corpus

Primary evidence:
- `packages/contract-harness/src/constants.ts`
- `packages/contract-harness/src/schema-loader.ts`
- `packages/contract-harness/src/fixtures.ts`
- `packages/contract-harness/src/validators.ts`
- `packages/contract-harness/src/chain-assertions.ts`
- `docs/decisions/first-executable-path-validation-harness-scope.md`

`packages/contract-harness` remains the completed validation-harness milestone.
It does not approve broader runtime work.

### 3. Bounded in-memory ledger prototype
Completed facts:
- `packages/event-ledger` can append already-canonical events in memory
- it enforces duplicate/idempotency behavior only at the bounded in-memory prototype boundary
- it provides replay helpers over in-memory stored facts
- it provides audit explanation helpers over the frozen seven-event chain

Primary evidence:
- `packages/event-ledger/src/append.ts`
- `packages/event-ledger/src/ledger-store.ts`
- `packages/event-ledger/src/replay.ts`
- `packages/event-ledger/src/audit.ts`
- `docs/decisions/initial-package-boundaries.md`

This package remains a bounded in-memory prototype.
It is not durable runtime infrastructure.

### 4. Governance baseline
Completed facts:
- repository governance files are now present
- the docs-first source-of-truth hierarchy is restated consistently
- the current review gate is aligned to the actual repository state
- one approved feature per commit is recorded as repository workflow discipline

Primary evidence:
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `SECURITY.md`
- `CLAUDE.md`
- `docs/decisions/implementation-bootstrap-baseline.md`

## Completed Docs-Only Review-Gate Record

The following docs-only closure work is now complete:
- review-gate alignment for `docs/decisions/first-executable-path-next-implementation-step.md`
- review-gate alignment for `docs/decisions/first-executable-path-implementation-checklist.md`
- implementation-evidence linking from review docs to the narrow implemented files in `packages/contract-harness` and `packages/event-ledger`
- clarification that those evidence links remain review inputs only

Primary evidence:
- `docs/decisions/first-executable-path-next-implementation-step.md`
- `docs/decisions/first-executable-path-implementation-checklist.md`
- `docs/decisions/first-executable-path-validation-harness-scope.md`

This completed record remains a review-gate record, not a runtime start signal.
It does not approve broader runtime work.
Evidence links remain review inputs only and do not change approval state.

## Roadmap Mechanics At This Review Gate

The repository-wide roadmap now operates under the following rules:
- listing a slice here does not approve implementation
- candidate slices are discussion inputs, not automatic queue items
- no candidate entry implies a default next step
- no relationship described here should be read as a sequencing guarantee
- exact later approval is still required before any candidate becomes active work
- one approved feature per commit governs commit shape after approval, not scope before approval
- boundary-changing work still requires RFC / decision / schema alignment first where applicable

This means the repository can show a clearer direction menu without turning the inventory into a parallel controlling document.

## Remaining Docs-First Work: Candidate-Slice Curation

The remaining repository-level docs-first work is narrower than runtime planning.

It is limited to candidate-slice curation for later approval discussions:
- tightening repository-level roadmap wording
- making candidate slice boundaries easier to compare
- making entry conditions explicit per slice
- making verification expectations mechanical per slice
- making commit-shape expectations explicit per slice
- reducing the chance that deferred runtime areas are misread as already approved

This category is still docs-only.
It does not approve runtime work.
It does not guarantee the order in which any later slice will be proposed or approved.

## Deferred Runtime-Adjacent Work

The following work remains deferred unless a later narrow slice is explicitly approved:
- web chat ingress runtime
- middleware / policy / route runtime
- backend HTTP runtime
- durable append-only ledger persistence
- replay/query API surfaces
- duplicate-ingress runtime handling
- structured runtime error handling beyond the current prototype boundary
- deny-path runtime handling
- retry, dead-letter, or delivery recovery flows
- projections or read models
- brokers, queues, or orchestration services
- streaming delta support
- tool or handoff event support
- attachments, rich text, or rich media support

Nothing in this document should be read as approval to begin those surfaces now.

## Candidate Direction Menu For Later Approval Discussions

Later work should be approved, if at all, as separate narrow slices.

Each candidate below is a menu item for later approval discussion only.
Each item is intentionally narrower than a broad runtime phase.
Listing a candidate here does not approve implementation.
No candidate below should be read as the default next step.

### How To Read The Path Groups

The groups below are for navigation only:
- repository-level curation slices refine the roadmap and approval mechanics without adding runtime surface
- channel-side slices concern inbound transport-to-canonical boundaries
- backend-side slices concern canonical-to-backend invocation boundaries
- ledger-side slices concern append, replay, and audit boundaries around already-canonical events

Grouping indicates relationship, not obligation.
Two slices in different groups may be independently discussable.
Two adjacent slices in the same group may still require separate approval and may never be approved in the listed order.

### Repository-level curation

#### Candidate 1 — tighten repository-level roadmap inventory
Relationship to current baseline:
- repository-level curation
- directly adjacent to the current review-gate baseline because it only improves how the repository-wide inventory is read
- independent from runtime approval and does not unlock runtime work by itself

Purpose:
- keep the repository-level inventory mechanical enough that later approval discussions can evaluate one narrow slice at a time without treating the menu itself as approval
- make the overall direction, current stage, and candidate-path relationships easier to read in one document

In scope:
- update `docs/decisions/repository-next-approved-slices.md`
- clarify overall direction, current review-gate position, and roadmap mechanics
- clarify completed vs candidate vs deferred sections
- organize candidate paths so repository-level, channel-side, backend-side, and ledger-side relationships are easier to read
- tighten candidate slice fields so each item states purpose, in-scope boundary, out-of-scope boundary, entry condition, verification, and commit shape
- restate that the menu is a planning aid for later approval discussions only

Must not include:
- runtime code
- schema changes
- governance rewrites beyond the minimum wording needed for consistency
- new runtime design detail that starts to function like an approved implementation spec
- any wording that turns the candidate menu into an execution order guarantee

Entry condition:
- explicit approval for this exact docs-only slice

Verification:
- the document makes the overall direction and current review-gate position easier to see in one pass
- completed baseline slices, completed docs-only review-gate record, candidate-slice curation, and deferred runtime-adjacent work are clearly separated
- the document explicitly says it is a planning aid for later approval discussions only
- the document explicitly says it is not an execution order guarantee and not a runtime start signal
- the document explicitly says that listing a slice does not approve implementation and does not create an automatic next step
- grouped candidate paths read as relationship navigation rather than promised sequencing

Commit shape:
- one approved feature per commit
- one docs-only commit for this slice only

### Channel-side candidate paths

#### Candidate 2 — web chat ingress canonicalization runtime
Relationship to current baseline:
- channel-side
- adjacent to the current baseline because it would consume the existing canonical event contracts and stop at `message.received`
- independent from backend-side and ledger-side runtime approval except where later docs explicitly connect them

Purpose:
- implement only the inbound web chat boundary up to canonical `message.received`

In scope:
- a narrow channel-side runtime boundary that accepts inbound web chat input and produces canonical `message.received`
- only the minimum contract and decision doc updates required to describe that exact boundary
- tests for ingress validation and canonicalization only

Must not include:
- backend invocation
- durable persistence
- replay/query APIs
- delivery execution beyond the inbound canonicalization boundary
- projection, broker, queue, or orchestration work
- broader runtime sequencing outside this exact ingress slice

Entry condition:
- explicit approval for this exact slice
- governing docs updated first if the approved boundary requires doc changes

Verification:
- `bun run typecheck`
- `bun run test`
- boundary review confirms the slice stops at canonical `message.received`
- boundary review confirms no broader runtime surface was added implicitly

Commit shape:
- one approved feature per commit
- one feature commit for this slice only

### Backend-side candidate paths

#### Candidate 3 — generic backend HTTP invocation runtime
Relationship to current baseline:
- backend-side
- adjacent to the current baseline because it would operate around `agent.invocation.requested` and `agent.response.completed`
- potentially combinable in discussion with channel-side or ledger-side work later, but not implicitly coupled here

Purpose:
- implement only the backend invocation boundary around `agent.invocation.requested` and `agent.response.completed`

In scope:
- a narrow backend adapter boundary for the already-defined happy path
- only the minimum contract and decision doc updates required to describe that exact boundary
- tests for request construction, response normalization, and approved happy-path behavior only

Must not include:
- channel ingress runtime
- durable ledger storage
- replay/query APIs
- orchestration systems beyond the exact approved backend invocation boundary
- broader runtime recovery, retry, or queue behavior unless explicitly approved as part of this exact slice

Entry condition:
- explicit approval for this exact slice
- backend boundary docs remain source-aligned before code lands

Verification:
- `bun run typecheck`
- `bun run test`
- boundary review confirms the slice remains limited to the approved backend invocation boundary
- boundary review confirms the slice remains plain-text happy-path only if that is the approved boundary

Commit shape:
- one approved feature per commit
- one feature commit for this slice only

### Ledger-side candidate paths

#### Candidate 4 — durable append-only ledger persistence boundary
Relationship to current baseline:
- ledger-side
- adjacent to the existing bounded in-memory prototype, but not implied by that prototype
- potentially adjacent to replay/query discussions later, but not a promise that those topics move together or next

Purpose:
- add only a narrow durable append boundary for already-canonical events without expanding into broader query or orchestration surfaces

In scope:
- durable append behavior for already-canonical events
- only the minimum decision updates required to define durable append semantics for the approved slice
- tests for append correctness and approved persistence-boundary behavior only

Must not include:
- replay/query API surfaces unless explicitly bundled and approved as the exact slice
- projections or analytics read models
- broker, queue, or orchestration services
- any wording that treats the existing package as already-approved durable runtime infrastructure

Entry condition:
- explicit approval for this exact slice
- ledger decision docs updated first if durable semantics need refinement

Verification:
- `bun run typecheck`
- `bun run test`
- boundary review confirms persistence work stays at the append boundary only
- boundary review confirms the bounded in-memory prototype is not being retroactively described as already sufficient durable runtime infrastructure

Commit shape:
- one approved feature per commit
- one feature commit for this slice only

## Boundary Rules For Any Later Approval

Any later approved slice must preserve all of the following:
- the completed validation-harness milestone remains the contract-consumption boundary already recorded in `packages/contract-harness`
- `packages/event-ledger` remains described as a bounded in-memory prototype unless a later exact slice explicitly approves a narrower durable change
- review-gate docs remain records of current state, not runtime start signals
- one approved feature per commit remains workflow discipline, not scope approval
- candidate-path grouping and adjacency remain navigation aids, not sequencing commitments

## Non-Approval Reminder

This inventory does not approve:
- web ingress runtime
- backend HTTP runtime
- durable persistence
- replay/query APIs
- projections or read models
- brokers, queues, or orchestration services

Those areas remain deferred until an exact later slice is explicitly approved.

## Slice Discipline Rules

Every later slice should satisfy all of the following:
- one approved feature per commit
- no bundling of governance, bootstrap, docs alignment, and runtime expansion into one commit
- governing docs updated first when architecture meaning or boundary meaning changes
- contract and schema authority remain upstream of code
- no review-gate document may be treated as implicit approval for a runtime surface
- no candidate-direction menu should be treated as an execution order guarantee
- no category heading should be treated as approval for every slice in that category

## Completion Definition For This Inventory

This remaining-work inventory is complete only if all of the following are true:
- the repository-level direction is visible without introducing a parallel master document
- the current review-gate position is stated explicitly
- the completed narrow baseline slices are named explicitly
- the completed docs-only review-gate record is named explicitly
- the remaining docs-first candidate-slice curation work is named explicitly
- deferred runtime-adjacent work is listed explicitly
- each candidate slice is narrow and individually approvable
- each candidate slice includes relationship-to-baseline context, purpose, in-scope boundary, must-not-include boundary, entry condition, verification, and commit-shape guidance
- the document explicitly preserves the non-approval boundary for broader runtime work
- commit discipline remains explicit
