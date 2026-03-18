# CAP First Backend Binding Evaluation

This decision is intentionally separated from the language/runtime decision.

The RFCs no longer mandate a specific first backend binding shape. This document exists so backend-binding choice does not silently get decided by whichever integration style is easiest in TypeScript.

## Decision Scope

Choose the first real backend binding path used to validate:
- invocation boundary clarity
- session mapping
- streaming semantics
- tool-event mapping
- structured errors
- trace/correlation propagation
- handoff signaling

## Relevant RFC Constraints

This decision is primarily constrained by:
- `docs/rfcs/adapters/backend-agent-adapter-contract.md`
- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`

The strongest constraints from those RFCs are:
- the minimum kernel must include one real backend adapter path without collapsing backend concerns into the middleware core
- platform-owned conversation identity, routing, governance, audit, and replay must remain outside backend-private state
- the first backend path must still prove session mapping, structured errors, and trace/correlation propagation
- streaming, tool events, and handoff signaling should be designed into the boundary even if some depth is phased in later
- framework-private objects must not leak across the public contract

## Candidate Options

- `generic HTTP / streaming binding`
- one framework-specific binding
- both generic and framework-specific bindings in the first phase

## Required Capabilities by Stage

### Day-one capabilities for the first executable path
The first real backend binding must support:
- one explicit canonical invocation boundary
- create-or-resume session mapping that preserves platform-owned conversation identity boundaries
- one completed response path, plus a streaming-compatible response shape for the minimum kernel
- structured error mapping with retryability and correlation information
- trace and correlation propagation across the boundary
- enough tool-event and handoff signaling shape to keep the contract forward-compatible
- fixture-driven contract tests for invocation, completed response, structured error, and streaming cases

For this first path:
- these capabilities are core and must exist on day one
- much of the contract surface is CAP-owned and should remain neutral rather than framework-derived
- third-party runtime SDK maturity matters, but mainly after the neutral contract is proven and a framework-specific portability pressure-test becomes worth the added cost

### Deferred capabilities for later backend pressure-tests
The first backend binding does not need to prove every runtime style immediately.

These can be deferred until after the neutral contract is stable:
- richer framework lifecycle mapping
- more extensive tool execution models
- deeper cancellation and checkpoint/resume semantics
- stronger proof that one contract survives multiple framework-specific adapters unchanged

Those deferred capabilities are the right reason to add a framework-specific adapter later, not a reason to make one the first binding.

## Evaluation Summary

`generic HTTP / streaming` is the best first backend binding for CAP's first executable path.

It provides the cleanest way to validate the backend-facing contract as a neutral public boundary before any single runtime ecosystem is allowed to shape it. That makes it the strongest option for preserving portability, keeping session and identity ownership explicit, and writing reusable contract tests against a stable invocation surface.

Adding a framework-specific binding in the first phase would create useful pressure, but it would also force an earlier runtime choice than the repository is ready to make and would increase the chance that one framework's private lifecycle or object model leaks into the supposed neutral boundary.

## Third-Party Library Notes

For the first backend binding decision, ecosystem maturity should matter primarily where the capability is expensive or subtle to reproduce.

- Basic HTTP request/response handling and streaming transport mechanics are generally replaceable and should not dominate the architectural choice.
- Framework SDKs can become highly valuable later when validating richer runtime semantics, but they are not required to define the neutral contract itself.
- The first binding should therefore optimize for portability and contract clarity, not for whichever framework integration is easiest to wire first.

## v0 Recommendation

Use `generic HTTP / streaming` as the narrowest acceptable backend binding for the first executable prototype.

Even at prototype stage, the boundary should still prove session mapping, structured errors, and trace propagation rather than reducing the backend contract to an opaque callback.

## v1 Recommendation

Use `generic HTTP / streaming` as the first real backend binding for the CAP minimum kernel.

After that neutral path is stable, add one framework-specific adapter as the first runtime portability pressure-test. That follow-up should confirm that the public contract survives real framework lifecycle pressure without letting the initial v1 path become framework-defined too early.

## Deferred Risks and Revisit Points

- Revisit if the generic binding proves too abstract to model real tool, session, or streaming semantics cleanly.
- Revisit once implementation language/runtime selection identifies a likely framework family worth testing directly.
- Revisit if early adopters need stronger proof of framework portability before a neutral binding alone is credible.
- Revisit if backend RFC requirements around streaming, tool events, or handoff signaling become more prescriptive before runtime work begins.

## Decision Outcome

CAP should use `generic HTTP / streaming` as the first real backend binding because it best validates the runtime-side contract as a neutral boundary while preserving portability, boundary discipline, and reusable contract testing. A framework-specific binding should follow as a pressure-test after the minimum-kernel path is already stable.
