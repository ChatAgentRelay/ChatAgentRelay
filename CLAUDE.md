# Chat Agent Relay Repository Working Agreement

## Repo Purpose

Chat Agent Relay (CAR) is a chat-platform <-> agent middleware framework with:
- channel adapters
- a canonical event model
- governance and routing middleware
- backend agent adapters
- an append-only ledger with replay and auditability

The repository uses a docs-first approach where RFCs govern architecture and the implementation follows approved narrow slices.

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
- Do not mix runtime code into `docs/rfcs/`.
- Do not treat UI state, temporary notes, or research comparisons as system truth.

## Current Implementation Status

The repository has a complete first executable path and hardened feature set:

### Approved Package Set (11 packages)

- `packages/contract-harness` — contract validation baseline (8 event types including `event.blocked`)
- `packages/event-ledger` — in-memory and SQLite-backed durable append via `LedgerStore` interface, with `getByConversationId` and `getByCorrelationId`
- `packages/channel-web-chat` — web chat ingress canonicalization + HTTP transport with CORS
- `packages/channel-slack` — Slack Socket Mode ingress, `chat.postMessage` delivery, `chat.update` for streaming
- `packages/middleware` — policy (allow/deny via `policyFn`), configurable keyword/regex policy engine, routing, dispatch
- `packages/backend-http` — generic HTTP backend invocation and response mapping
- `packages/backend-openai` — OpenAI Chat Completions + SSE streaming via `invokeStreaming()`
- `packages/delivery` — delivery orchestration with retry (exponential backoff) and `DeliveryExhaustedError`
- `packages/pipeline` — end-to-end orchestration with error paths (`event.blocked`), deny path, conversation context, streaming
- `packages/server` — runtime entry point with Slack + OpenAI + HTTP API + SQLite + structured logging + config validation + graceful shutdown
- `packages/adapter-conformance` — reusable conformance test suite for channel and backend adapters

### Test Coverage

200 tests across 16 test files verify:
- contract compliance and schema validation
- causal linkage and correlation propagation
- error path (`event.blocked` on backend/delivery failure)
- deny path (governance short-circuit)
- multi-turn conversation context
- delivery retry and exhaustion
- streaming delta handling
- replay/query HTTP API
- adapter conformance (all 4 adapters pass)
- configurable policy engine (keyword/regex rules)
- config validation with actionable error messages
- WebChat HTTP transport with CORS
- audit explanation API

## Implementation Structure

Implementation structure preserves these boundaries:
- canonical event model remains central
- channel adapters remain transport-side boundaries
- backend adapters remain runtime-side boundaries
- ledger, replay, audit, and governance remain first-class concerns

## Commit Workflow

Claude should:
- keep each feature commit narrowly scoped
- avoid combining unrelated changes into a single commit
- keep commit granularity aligned to the currently approved slice

This workflow rule does not change the docs-first source-of-truth hierarchy.
