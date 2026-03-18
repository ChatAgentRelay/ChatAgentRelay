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

## Candidate Directions to Compare Later

- generic HTTP / streaming binding
- one framework-specific binding
- both generic and framework-specific bindings in the first phase

## Required Evaluation Criteria

For each candidate, evaluate:
- boundary clarity
- portability proof strength
- runtime lock-in risk
- contract-testability
- streaming realism
- tool and session semantics realism
- implementation complexity for v0/v1

## Important Guardrail

The first backend binding should not be chosen implicitly through:
- whichever runtime SDK is easiest to wire first
- whichever framework has the best marketing examples
- whichever binding style is most familiar to the implementer

It must remain an explicit contract-validation decision.

## Current Status

No final first-backend-binding decision is recorded in this document yet.
