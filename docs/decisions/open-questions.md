# CAP Open Questions

This document centralizes cross-cutting questions that matter for v0/v1 planning so future implementation and technology selection work does not require re-reading every RFC.

## How to Use This Document

- Use this file as the first stop for v0/v1 blockers.
- Keep the questions here cross-cutting and decision-oriented.
- When a question is resolved, update the relevant RFCs and convert the outcome into a recorded decision.
- This file is an index of unresolved decisions, not a replacement for the RFCs themselves.

## Repository Governance Questions

### 1. RFC naming and numbering
- Question: Should `docs/rfcs/` remain path-based only, or adopt formal numbering such as `RFC-0001`?
- Why it matters: Numbering affects citation style, future change management, and how stable references are shared across implementation work.
- Current guidance: Keep the current path-based layout for now, but revisit before the RFC set grows substantially.
- Affected areas:
  - `docs/rfcs/architecture/reference-architecture.md`
  - all future RFC cross-references

### 2. Normative document language policy
- Question: Should normative docs standardize on English-first, or continue allowing mixed English and Chinese text?
- Why it matters: This affects external readability, contributor expectations, and future implementation precision.
- Current guidance: Existing mixed-language content is acceptable for now, but a repository-wide policy should be chosen before broader collaboration.
- Affected areas:
  - all documents under `docs/rfcs/`
  - `CLAUDE.md`

### 3. Claude local settings versioning
- Question: Should `.claude/settings.local.json` remain fully local and untracked?
- Why it matters: Local tool permissions are usually workstation-specific and should not silently become shared governance.
- Current guidance: Treat it as local-only unless there is a deliberate decision to introduce shared Claude configuration later.
- Affected areas:
  - `.gitignore`
  - future shared Claude configuration choices

## v1 Scope Boundary Questions

### 4. First real channel for v1
- Question: Should the first production-grade channel target be `web chat` or `Slack`?
- Why it matters: This choice shapes ingress/egress complexity, capability needs, delivery callbacks, and the first contract test surface.
- Relevant RFC constraints:
  - `docs/rfcs/adapters/channel-adapter-contract.md`
  - `docs/rfcs/middleware/routing-middleware-governance.md`
  - `docs/rfcs/architecture/reference-architecture.md`

### 5. First real backend adapter set
- Question: Should v1 implement only a generic HTTP/streaming backend adapter, or also include one framework-specific adapter?
- Why it matters: This determines how strongly v1 proves runtime portability versus keeping the first implementation narrower.
- Relevant RFC constraints:
  - `docs/rfcs/adapters/backend-agent-adapter-contract.md`
  - `docs/rfcs/architecture/reference-architecture.md`

### 6. Handoff depth in v1
- Question: Should v1 handoff stop at canonical events plus projections, or include a deeper operator model?
- Why it matters: This affects scope, projection design, audit semantics, and whether operator-facing concepts are part of the early implementation surface.
- Relevant RFC constraints:
  - `docs/rfcs/middleware/routing-middleware-governance.md`
  - `docs/rfcs/canonical-model/canonical-event-schema.md`

## Protocol Detail Questions

### 7. Conversation-local sequencing
- Question: Should conversation-local sequence numbers become normative in v1 or remain projection-only?
- Why it matters: This impacts ordering semantics, replay expectations, and storage/index design.
- RFC origin:
  - `docs/rfcs/canonical-model/canonical-event-schema.md`

### 8. Identity resolution depth for v1
- Question: Which identity resolution outcomes must be first-class and mandatory in v1?
- Why it matters: This affects canonical event families, projection shape, and policy/governance complexity.
- RFC origin:
  - `docs/rfcs/canonical-model/canonical-event-schema.md`
  - `docs/rfcs/middleware/routing-middleware-governance.md`

### 9. Protocol trace standardization
- Question: Does protocol trace linkage need a companion RFC before implementation begins?
- Why it matters: Trace retention, raw payload references, and observability boundaries appear in several RFCs and may deserve a dedicated normative document.
- RFC origin:
  - `docs/rfcs/canonical-model/canonical-event-schema.md`
  - `docs/rfcs/middleware/routing-middleware-governance.md`
  - `docs/rfcs/architecture/reference-architecture.md`
  - `docs/rfcs/adapters/channel-adapter-contract.md`

### 10. Governance stages mandatory in v1
- Question: Which governance stages are required for a conforming v1 implementation versus recommended later?
- Why it matters: This defines the minimum kernel execution path more precisely and affects middleware composition.
- RFC origin:
  - `docs/rfcs/middleware/routing-middleware-governance.md`

### 11. Adapter fallback standardization
- Question: Which channel fallback and transcoding rules should be normative versus implementation-defined?
- Why it matters: This affects interoperability, testability, and what counts as conformance for channel adapters.
- RFC origin:
  - `docs/rfcs/adapters/channel-adapter-contract.md`

### 12. Backend streaming and async envelope shape
- Question: Should async callback mode and streaming mode share one normative envelope or remain separate bindings?
- Why it matters: This directly affects backend adapter API shape and future portability guarantees.
- RFC origin:
  - `docs/rfcs/adapters/backend-agent-adapter-contract.md`

## Deferred but Important

These questions matter, but do not need to block repository governance work:
- When execution isolation becomes a first-class architectural component
- How much checkpoint/resume behavior should be mandatory before v2
- How much queue and assignment semantics belong in core RFCs versus extension RFCs
- Which v2 enterprise features must be normative before CAP is considered production-ready
