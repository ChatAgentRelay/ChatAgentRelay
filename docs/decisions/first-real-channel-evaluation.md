# CAP First Real Channel Evaluation

This decision is intentionally separated from the language/runtime decision.

The RFCs no longer mandate a specific first channel. This document exists so the first real transport path can be chosen based on implementation pressure and validation value, not because it was baked into the architecture docs.

## Decision Scope

Choose the first real channel path used to validate:
- ingress auth and idempotency
- canonicalization
- routing and governance insertion points
- outbound delivery
- delivery-state mapping
- replay and audit behavior

## Relevant RFC Constraints

This decision is primarily constrained by:
- `docs/rfcs/adapters/channel-adapter-contract.md`
- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`

The strongest constraints from those RFCs are:
- the minimum kernel must remain one coherent loop with one real inbound path and one real outbound path
- channel adapters must normalize provider-native traffic into canonical events without taking over routing or policy ownership
- ingress authenticity, idempotent ingress, auditable failure mapping, and capability declaration matter from day one
- provider-specific behavior must remain outside the canonical core except through explicit capability metadata and `provider_extensions`
- blocked, denied, retry, and delivery outcomes must remain replayable and auditable

## Candidate Options

- `web chat`
- `Slack`
- another provider-backed messaging channel

## Required Capabilities by Stage

### Day-one capabilities for the first executable path
The first real channel must support:
- inbound authenticity verification or equivalent source validation
- idempotent ingress and stable dedupe behavior
- canonical event normalization for message ingress
- one concrete outbound send path
- delivery-state mapping when responses or callbacks are available
- auditable fallback behavior when canonical payload capabilities exceed channel support
- fixture-driven contract tests for golden canonical events and duplicate-delivery cases

For this first path:
- these capabilities are core and must exist on day one
- the core logic is mostly CAP-owned and relatively cheap to implement in-house once the boundary is fixed
- third-party SDK maturity matters mainly for source verification, callback handling, and operational bootstrap rather than for defining CAP semantics

### Deferred capabilities for later channel pressure-tests
The first real channel does not need to prove every transport feature immediately.

These can be deferred to the next channel pressure-test:
- richer provider callback semantics
- stronger capability pressure from threading, receipts, templates, or interactive elements
- broader provider extension coverage
- more complex webhook and credential lifecycle management

Those deferred capabilities are exactly where a provider-backed channel such as Slack becomes valuable after the minimum-kernel path is stable.

## Evaluation Summary

`web chat` is the best first real channel for CAP's first executable path.

It is the strongest fit for proving canonical ingress, outbound delivery, replay, audit, routing, and governance without letting one external provider shape the architecture prematurely. It also keeps contract-test fixtures, deterministic payload examples, and delivery-path debugging simpler while the canonical event layer and decision chain are still settling.

`Slack` remains a strong follow-up pressure-test because it introduces richer callback, metadata, idempotency, delivery-state, and capability-fallback pressure. That makes it the right next channel once the minimum-kernel path is already stable, but not the best first channel for establishing the kernel itself.

## Third-Party Library Notes

For the first channel decision, ecosystem comparison should matter less than boundary clarity.

- Web chat usually relies on simpler HTTP and browser-facing plumbing, much of which is replaceable and should not dominate the decision.
- Provider-backed channels often have mature SDKs, but those SDKs primarily reduce integration labor rather than answer CAP's architectural questions.
- The first channel should therefore be chosen based on validation value, not on which SDK is easiest to install.

## v0 Recommendation

Use `web chat` as the narrowest acceptable real channel path for the first executable prototype.

This keeps the initial implementation focused on validating canonical event shape, replayability, auditability, and outbound delivery behavior with the lowest provider-specific distortion.

## v1 Recommendation

Use `web chat` as the first real channel for the CAP minimum kernel.

After that path is stable, add `Slack` as the first external provider pressure-test channel. That follow-up should validate richer provider callback behavior, capability fallback pressure, and more realistic enterprise transport semantics without making those concerns the first constraint on the architecture.

## Deferred Risks and Revisit Points

- Revisit if near-term user, demo, or customer pressure requires proving a third-party provider before a web chat path is useful.
- Revisit if `web chat` fails to surface enough pressure on capability fallback, callback handling, or delivery-state semantics.
- Revisit once the minimum kernel path is stable and the next most valuable proof target becomes external-provider realism rather than kernel clarity.
- Revisit if the channel adapter RFC is later tightened in a way that makes a provider-backed path mandatory earlier.

## Decision Outcome

CAP should use `web chat` as the first real minimum-kernel channel because it best validates the canonical event loop, boundary discipline, replay, and audit model with the least architectural distortion. `Slack` should follow immediately after as the first external pressure-test channel, not as the first kernel-establishing dependency.
