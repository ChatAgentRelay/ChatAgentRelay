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

## Candidate Directions to Compare Later

- web chat
- Slack
- another provider-backed messaging channel

## Required Evaluation Criteria

For each candidate, evaluate:
- adapter complexity
- callback/webhook complexity
- capability pressure
- delivery-state richness
- how well it pressure-tests canonical event design
- how much provider-specific behavior may distort the early architecture
- contract-testability
- operational setup burden

## Important Guardrail

The first channel decision should not be made implicitly through:
- whichever SDK is easiest to install
- whichever demo looks best first
- whichever framework example happens to exist in the chosen language

It must remain an explicit validation-scope decision.

## Current Status

No final first-channel decision is recorded in this document yet.
