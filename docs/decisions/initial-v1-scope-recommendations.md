# CAP Initial v1 Scope Recommendations

This document applies the repository's technology selection framework to the first two high-leverage v1 scope choices:
- first real channel
- first real backend adapter shape

It records a recommended starting path for the minimum kernel without locking later phases prematurely.

## Decision 1: First Real Channel

### Decision Scope
Choose the first real channel implementation used to validate the CAP minimum kernel.

### Relevant RFC Constraints
- `docs/rfcs/adapters/channel-adapter-contract.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/architecture/reference-architecture.md`

### Candidate Options
- `web chat`
- `Slack`

### Evaluation Matrix

#### Option A: `web chat`

| Criterion | Assessment |
|---|---|
| Ledger and replay fitness | Strong. Easier to validate the minimum canonical event chain without provider noise. |
| Primary ledger storage fit | Strong. Keeps the first event and projection model simpler while validating storage assumptions. |
| Boundary discipline | Strong. Easier to keep transport concerns from leaking into the middleware core. |
| Streaming and contract support | Good enough for early validation of message, response, and handoff flows. |
| Testability and conformance | Strong. Fixtures and deterministic contract tests are easier to control. |
| Multi-tenant governance and audit | Strong. Governance logic can be validated without provider-specific complexity dominating the design. |
| v0/v1 delivery simplicity | Very strong. Lowest-risk way to prove the minimum kernel loop. |
| Operational maturity | Good. Less provider setup overhead and fewer external moving parts. |

Strengths:
- best fit for proving the minimum kernel first
- easiest way to validate canonical event shape, audit, replay, and handoff projections
- minimizes provider-specific callback and capability complexity early

Weaknesses:
- puts less pressure on provider-native metadata and callback mapping
- is a weaker proof of external ecosystem integration than Slack

#### Option B: `Slack`

| Criterion | Assessment |
|---|---|
| Ledger and replay fitness | Strong, but mixed with more provider-specific behavior. |
| Primary ledger storage fit | Strong. Still compatible with the event-ledger model. |
| Boundary discipline | Good, but more likely to expose pressure from provider-specific semantics. |
| Streaming and contract support | Strong. Better pressure test for richer transport semantics. |
| Testability and conformance | Good, but harder than web chat because webhook/auth/callback behavior is more complex. |
| Multi-tenant governance and audit | Strong. Real provider flows create realistic audit and policy cases. |
| v0/v1 delivery simplicity | Moderate. Higher early implementation burden. |
| Operational maturity | Strong for real-world validation, but heavier to bootstrap. |

Strengths:
- better proof that the channel adapter contract can survive a real provider
- stronger validation of idempotency, provider extensions, threading, and delivery semantics
- more enterprise-realistic than web chat

Weaknesses:
- increases early implementation complexity significantly
- can pull attention away from CAP core boundaries into provider details
- risks letting a single provider shape the initial model prematurely

### v0 Recommendation
Use `web chat` as the first executable real channel.

### v1 Recommendation
Start with `web chat` for the first real minimum-kernel implementation.

Add `Slack` immediately after the minimum kernel path is stable as the first external pressure-test channel.

### Deferred Risks and Revisit Points
- Revisit if investor/demo/customer pressure requires a third-party channel first.
- Revisit once the canonical event model and delivery semantics are validated against the first real path.
- Revisit if web chat under-tests capability fallback or provider callback semantics.

## Decision 2: First Real Backend Adapter Shape

### Decision Scope
Choose the initial backend adapter strategy used to validate CAP's runtime-side boundary.

### Relevant RFC Constraints
- `docs/rfcs/adapters/backend-agent-adapter-contract.md`
- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`

### Candidate Options
- `generic HTTP/streaming only`
- `generic HTTP/streaming + one framework-specific adapter`

### Evaluation Matrix

#### Option A: `generic HTTP/streaming only`

| Criterion | Assessment |
|---|---|
| Ledger and replay fitness | Strong. Keeps backend outputs focused on canonical event mapping. |
| Primary ledger storage fit | Strong. No extra infrastructure assumptions are required. |
| Boundary discipline | Very strong. Best option for preserving runtime neutrality early. |
| Streaming and contract support | Strong enough to validate sync, streaming, error, and trace propagation. |
| Testability and conformance | Strong. Easier to write reusable contract tests against a neutral adapter surface. |
| Multi-tenant governance and audit | Strong. Keeps governance and audit centered on platform semantics instead of framework details. |
| v0/v1 delivery simplicity | Very strong. Lowest complexity path to a stable contract. |
| Operational maturity | Strong. Works well for a self-hosted middleware-first baseline. |

Strengths:
- best option for proving a stable public backend contract first
- minimizes framework lock-in while the RFC set is still settling
- keeps the implementation aligned with the docs-first state of the repository

Weaknesses:
- does not fully prove runtime portability against a real framework integration
- may hide framework-specific pressure until later

#### Option B: `generic HTTP/streaming + one framework-specific adapter`

| Criterion | Assessment |
|---|---|
| Ledger and replay fitness | Strong, but more coupled to runtime-specific event mapping details. |
| Primary ledger storage fit | Strong. Still compatible with the current storage direction. |
| Boundary discipline | Moderate to strong. Better real-world pressure test, but easier to leak framework concepts into the contract. |
| Streaming and contract support | Very strong. More likely to expose real session, tool, and streaming edge cases. |
| Testability and conformance | Good, but more expensive because two adapter surfaces must stay aligned. |
| Multi-tenant governance and audit | Strong, though runtime-specific behavior may complicate explanations early. |
| v0/v1 delivery simplicity | Moderate. Raises the bar before the core contract is proven. |
| Operational maturity | Good, but requires an earlier framework choice than the repo is ready for. |

Strengths:
- better early proof that the adapter contract works across real runtime styles
- more realistic pressure test for session mapping, streaming, and tool events
- can reveal missing fields or lifecycle operations sooner

Weaknesses:
- forces an early framework choice before broader stack selection is settled
- risks letting one runtime shape the supposedly neutral boundary
- increases implementation and testing scope at the wrong stage

### v0 Recommendation
Use `generic HTTP/streaming only`.

### v1 Recommendation
Use `generic HTTP/streaming only` for the first real backend adapter.

Add one framework-specific adapter after the neutral contract is validated by the first minimum-kernel path.

### Deferred Risks and Revisit Points
- Revisit if the generic binding proves too abstract to cover real tool/session semantics.
- Revisit once a likely framework family emerges from implementation language/runtime selection.
- Revisit if portability claims need stronger validation before external adoption.

## Combined Recommendation

Recommended initial v1 path:
- first real channel: `web chat`
- first real backend adapter: `generic HTTP/streaming only`

Recommended immediate follow-up after the first minimum-kernel path is stable:
- add `Slack` as the first external pressure-test channel
- add one framework-specific backend adapter as the first runtime portability pressure test

## Rationale

This sequence fits the current repository state:
- RFC-first
- docs-first
- repository governance baseline just established
- technology stack not yet selected
- objective is to prove the minimum kernel before broad implementation expansion

It separates two kinds of validation:
1. prove the CAP core loop cleanly
2. then pressure-test it against real providers and real runtimes
