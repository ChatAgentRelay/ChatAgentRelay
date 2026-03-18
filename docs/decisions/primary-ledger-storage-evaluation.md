# CAP Primary Ledger Storage Evaluation

This decision is intentionally separated from the language/runtime decision.

The RFCs no longer mandate a specific storage engine. This document exists to keep storage choice independent from the TypeScript decision and to prevent storage assumptions from silently reshaping the architecture.

## Decision Scope

Choose the primary durable store strategy for:
- append-only event ledger
- replay
- audit history
- state reconstruction inputs
- blocked / denied / retry / dead-letter retention

## Why This Is Separate

The primary implementation language is now TypeScript, but storage must not be chosen merely because it is convenient in the chosen language.

Storage must be evaluated by CAP requirements first:
- append-only durability
- replayability
- auditability
- explainability
- tenant isolation
- operational simplicity for v0/v1
- no mandatory broker in v1

## Candidate Families to Compare Later

- relational durable store
- log-oriented/event-store-style design
- document or KV-backed design with append discipline layered on top
- hybrid approaches with projections and companion stores

## Required Capabilities

Any serious candidate must be evaluated for:
- append performance under conversation-scoped ordering needs
- replay by conversation and by time range
- audit explanation support
- idempotent append handling
- projection rebuild support
- blocked / denied / failed path retention
- migration or schema evolution discipline where applicable
- operational complexity in a small v0/v1 team

## Important Guardrail

The storage decision should not be made implicitly through:
- ORM preference
n- migration-tool familiarity
- one framework's examples
- convenience for local prototyping

It must remain a first-class architectural decision.

## Current Status

No storage engine decision is recorded yet.
