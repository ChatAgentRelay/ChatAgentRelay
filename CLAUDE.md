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
2. `docs/schemas/`
3. `README.md`

Interpretation rules:
- `docs/rfcs/` are normative and define the intended system behavior and boundaries.
- `docs/schemas/` are authoritative for machine-readable contract shape and MUST align with the RFCs.
- `README.md` is an entry point and project overview, not a detailed protocol spec.

## Document Classes

### `docs/rfcs/`
Use this for normative specifications and architecture contracts.

These documents SHOULD:
- define required boundaries and semantics
- use RFC 2119 language where appropriate
- describe what implementations MUST, SHOULD, and MAY do
- be updated before code when architecture meaning changes

### `docs/schemas/`
Use this for machine-readable contract artifacts that implement the public RFC semantics.

These documents SHOULD:
- encode public validation shape for canonical events and related artifacts
- stay aligned with the RFC semantics
- avoid introducing behavior that is not described by the RFCs

## Authoring Rules

- Normative documents SHOULD use RFC 2119 keywords precisely.
- Research documents SHOULD avoid sounding like implementation mandates.
- Major architectural changes MUST be reflected in RFCs before or alongside implementation changes.
- Do not mix runtime code into `docs/rfcs/`.
- Do not treat UI state, temporary notes, or research comparisons as system truth.

## Current Implementation Status

The repository has a complete first executable path and hardened feature set:

### Approved Package Set (17 packages)

- `packages/contract-harness` — contract validation baseline (15 event types including `event.blocked`, `message.updated`, `message.deleted`, `reaction.received`, `command.received`, `agent.status.changed`, `agent.input.requested`, `agent.input.provided`), `ChannelAdapter` and `AgentAdapter` definitions, optional lifecycle contracts (`Shutdownable`, `Disconnectable`, `isShutdownable()`, `isDisconnectable()` in `lifecycle.ts`), and `AgentCapabilities` including `streaming`, `multiTurn`, `resume`, HITL, cancel, and artifacts; **`ContractHarnessValidators.getShared()`** caches the validator singleton for reuse across the process (avoids per-request schema compile)
- `packages/event-ledger` — in-memory and SQLite-backed durable append via `LedgerStore` interface (`getByConversationId`, `getByCorrelationId`, `close()`)
- `packages/channel-web-chat` — web chat ingress canonicalization + HTTP transport with CORS; `buildWebChatStreaming()` exported from the package for progressive WebChat updates
- `packages/channel-slack` — Slack Socket Mode ingress, `chat.postMessage` delivery, `chat.update` for streaming, ack reaction, text chunking, mention gating, access policy, app_mention, edit/delete/reaction events, slash commands, Block Kit output
- `packages/channel-discord` — Discord Gateway ingress, REST API delivery, slash commands, embeds, access control
- `packages/channel-telegram` — Telegram Bot API webhook ingress, bot commands, progressive streaming via editMessageText; optional `apiBase` for non-default API roots
- `packages/channel-lark` — Lark/飞书 event subscription ingress, auto token management, message editing for streaming; optional `apiBase` for regional or custom endpoints
- `packages/channel-dingtalk` — DingTalk/钉钉 robot webhook callback ingress, session-based webhook reply
- `packages/channel-teams` — Microsoft Teams ingress + sender, JWT webhook verification
- `packages/channel-whatsapp` — WhatsApp Business Cloud API ingress + sender, HMAC-SHA256 verification, 24h session tracking
- `packages/middleware` — policy (allow/deny via `policyFn`), configurable keyword/regex policy engine, routing, dispatch
- `packages/backend-a2a` — A2A (Agent-to-Agent protocol) native AgentAdapter with streaming, HITL, and session management
- `packages/delivery` — delivery orchestration with retry (exponential backoff) and `DeliveryExhaustedError`; `deliver(event, sender: ChannelSender)` (no public `SendFn`)
- `packages/pipeline` — end-to-end orchestration with error paths (`event.blocked`), deny path, conversation context, and streaming; uses `AgentCapabilities.multiTurn` to gate ledger-backed conversation history and `AgentCapabilities.streaming` to gate streaming invocation; resolves agents via `resolveAgent` and routes via `routeFn` (multi-agent)
- `packages/config-store` — `ConfigStore` interface with `SqliteConfigStore` default implementation, AES-256-GCM encryption for sensitive fields (tokens, API keys), `RouteEngine` for dynamic routing; interface-driven so users can swap in PostgreSQL or other backends
- `packages/server` — runtime entry point: CLI (`car`) + HTTP API; SQLite config/ledger; **eight built-in channel types** (Slack, Discord, WebChat, Telegram, Lark, DingTalk, Teams, WhatsApp) and **one standard agent protocol** (A2A) are wired via `channel-factories.ts` / `agent-factories.ts` and `registerFactory(type, factory)` (no adapter-specific imports inside the registry modules); teardown calls `disconnect()` / `shutdown()` when adapters implement `Disconnectable` / `Shutdownable`; multi-agent routing from stored route rules; structured logging + graceful shutdown
- `packages/adapter-conformance` — reusable conformance test suite for channel adapters (`testChannelAdapter`), backend adapters, and agent adapters (`testAgentAdapter`)

### Test Coverage

692 tests across 51 test files verify:
- contract compliance and schema validation
- causal linkage and correlation propagation
- error path (`event.blocked` on backend/delivery failure)
- deny path (governance short-circuit)
- multi-turn conversation context
- delivery retry and exhaustion
- streaming delta handling
- replay/query HTTP API
- adapter conformance (built-in channel adapters and A2A)
- tenant isolation enforcement
- webhook signature verification (Slack, Teams, Telegram, Lark, DingTalk, WhatsApp)
- idempotency framework
- HITL pipeline flow
- structured policy conditions
- config hot-reload
- rate limiting and access control
- outbound governance
- API authentication
- configurable policy engine (keyword/regex rules)
- WebChat HTTP transport with CORS
- audit explanation API
- Discord adapter conformance and Gateway integration
- extended event canonicalization (edit/delete/reaction/command)
- slash command handling (Slack and Discord)
- rich message output (Block Kit and Embeds)
- ack reaction pipeline
- mention gating
- access policy (DM/channel modes)
- AgentAdapter interface and conformance tests
- A2A agent adapter conformance
- HITL signaling (agent.input.requested / agent.input.provided)
- CLI + SQLite configuration (`ConfigStore` interface, `SqliteConfigStore` default, AES-256-GCM for secrets) replacing environment-variable-based config
- multi-agent routing (several agents registered; route rules select the handler per message)

## Implementation Structure

Implementation structure preserves these boundaries:
- canonical event model remains central
- channel adapters remain transport-side boundaries
- `AgentAdapter` (A2A-aligned) is the primary agent-side interface; all agents connect via the A2A protocol
- ledger, replay, audit, and governance remain first-class concerns
- runtime configuration lives in SQLite (`CAR_DB_PATH`, default `./car.db`); optional `CAR_ENCRYPTION_KEY` enables AES-256-GCM for sensitive fields
- channels and agents are registered dynamically (`ChannelRegistry`, `AgentRegistry`) via factory registration; route rules determine which agent handles each message; pipeline accepts `resolveAgent` and `routeFn` instead of a single fixed backend
- operators use the `car` CLI for config and process management, for example: `car channel add|list|remove`, `car agent add|list|remove`, `car route add|list|remove`, `car config set|get`, and `car start` (see `docs/getting-started.md`)

## Commit Workflow

Claude should:
- keep each feature commit narrowly scoped
- avoid combining unrelated changes into a single commit
- keep commit granularity aligned to the currently approved slice

This workflow rule does not change the docs-first source-of-truth hierarchy.
