# Chat Agent Relay Open Questions

This document centralizes cross-cutting questions that matter for v0/v1 planning so future implementation and technology selection work does not require re-reading every RFC.

## How to Use This Document

- Use this file as the first stop for v0/v1 blockers.
- Keep the questions here cross-cutting and decision-oriented.
- When a question is resolved, update the relevant RFCs and convert the outcome into a recorded decision.
- This file is an index of unresolved decisions, not a replacement for the RFCs themselves.

## Repository Governance Questions

### 1. RFC naming and numbering [RESOLVED]
- Question: Should `docs/rfcs/` remain path-based only, or adopt formal numbering such as `RFC-0001`?
- Resolution: Keep path-based layout. The current RFC set is small enough that path-based references are clear and sufficient. Formal numbering adds overhead without benefit at this stage. Revisit when the RFC count exceeds ~20.

### 2. Normative document language policy [RESOLVED]
- Question: Should normative docs standardize on English-first, or continue allowing mixed English and Chinese text?
- Resolution: English-first for all normative documents (`docs/rfcs/`). Internal comments and research may use any language. Existing documents will be normalized to English as part of the Beta milestone.

### 3. Claude local settings versioning [RESOLVED]
- Question: Should `.claude/settings.local.json` remain fully local and untracked?
- Resolution: Remain local-only and untracked. `.gitignore` already excludes it. Shared Claude configuration is not needed.

## v1 Scope Boundary Questions

### 4. First real channel for v1 [RESOLVED]
- Question: Should the first production-grade channel target be `web chat` or `Slack`?
- Resolution: Both are implemented. `packages/channel-web-chat` provides web chat ingress canonicalization; `packages/channel-slack` provides Slack Socket Mode ingress and `chat.postMessage` delivery, including `chat.update` for streaming. Slack is the first channel with a working end-to-end integration. Additional channel adapters (Discord, Teams, etc.) are deferred to post-v1.

### 5. First real backend adapter set [RESOLVED]
- Question: Should v1 implement only a generic HTTP/streaming backend adapter, or also include one framework-specific adapter?
- Resolution: Both are implemented. `packages/backend-http` provides generic HTTP backend invocation; `packages/backend-openai` provides OpenAI Chat Completions API integration with SSE streaming via `invokeStreaming()`. This proves runtime portability via the `BackendAdapter` interface. Tool/function calling and additional provider adapters are deferred to post-v1.

### 6. Handoff depth in v1 [RESOLVED]
- Question: Should v1 handoff stop at canonical events plus projections, or include a deeper operator model?
- Resolution: v1 stops at canonical events. The audit explanation API (`/api/conversations/:id/audit`) provides structured per-turn explanations from the event ledger. A deeper operator model (assignment queues, escalation flows) is deferred to v2.

## Protocol Detail Questions

### 7. Conversation-local sequencing [RESOLVED]
- Question: Should conversation-local sequence numbers become normative in v1 or remain projection-only?
- Resolution: Projection-only for v1. The `LedgerStore` provides ordering via `occurred_at` + insertion order. Explicit sequence numbers add complexity without clear benefit for the current adapter set. Can be promoted to normative in v2 if multi-writer scenarios emerge.

### 8. Identity resolution depth for v1 [RESOLVED]
- Question: Which identity resolution outcomes must be first-class and mandatory in v1?
- Resolution: v1 identity is channel-provided only. `actor_type` (`end_user` | `agent` | `system`) and channel-level user IDs (e.g., Slack user ID) are sufficient. Cross-channel identity mapping, identity enrichment, and verified identity are deferred to v2.

### 9. Protocol trace standardization [RESOLVED]
- Question: Does protocol trace linkage need a companion RFC before implementation begins?
- Resolution: No separate RFC needed for v1. The existing `correlation_id` + `causation_id` chain provides adequate trace linkage. The structured logger outputs `correlation_id` on every log entry. A dedicated observability RFC with OpenTelemetry integration guidance is recommended for v2.

### 10. Governance stages mandatory in v1 [RESOLVED]
- Question: Which governance stages are required for a conforming v1 implementation versus recommended later?
- Resolution: v1 requires exactly one governance stage: the policy decision (`policy.decision.made`). This supports allow/deny with configurable keyword/regex rules via `PolicyFn`. Additional stages (rate limiting, content classification, multi-stage approval) are optional extensions. The `event.blocked` path handles denied requests.

### 11. Adapter fallback standardization [RESOLVED]
- Question: Which channel fallback and transcoding rules should be normative versus implementation-defined?
- Resolution: Implementation-defined for v1. Each channel adapter is responsible for its own error handling and must return `CanonicalizationResult` (never throw). The conformance test suite (`/adapter-conformance`) validates this contract. Normative fallback rules (e.g., rich-to-plain-text transcoding) are deferred.

### 12. Backend streaming and async envelope shape [RESOLVED]
- Question: Should async callback mode and streaming mode share one normative envelope or remain separate bindings?
- Resolution: Separate bindings for v1. `invoke()` returns `Promise<InvocationResult>`; `invokeStreaming()` returns `AsyncGenerator<string, InvocationResult>`. Both produce the same `agent.response.completed` canonical event as their final result. Async callback mode is not yet implemented and will be evaluated in v2.

## Deferred to v2

These questions are important but do not block v1:
- When execution isolation becomes a first-class architectural component
- How much checkpoint/resume behavior should be mandatory
- How much queue and assignment semantics belong in core RFCs versus extension RFCs
- Which enterprise features must be normative before CAR is considered production-ready
- Cross-channel identity resolution and mapping
- OpenTelemetry trace integration
- Multi-stage governance pipelines
