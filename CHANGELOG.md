# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

There has been no formal versioned release yet. The following summarizes work on the main development line.

### Changed

- **Configuration model** — Replaced environment-variable configuration with a CLI + interface-driven config store. `ConfigStore` interface with `SqliteConfigStore` default (pluggable for PostgreSQL etc.). Hot-pluggable channel and agent registration at runtime; multi-agent routing via stored route rules. Pipeline now accepts `resolveAgent` and `routeFn` instead of a single backend instance.
- Added `@chat-agent-relay/config-store` (16th package): `ConfigStore` interface, `SqliteConfigStore` implementation, `RouteEngine`, AES-256-GCM encrypted credential storage.
- Removed the starter template in favor of the CLI-first onboarding flow.

### Added

#### AgentAdapter architecture (A2A-aligned agent runtime integration)

- `AgentAdapter` interface — A2A-aligned agent runtime abstraction with structured events, HITL, and artifacts.
- `@chat-agent-relay/backend-a2a` — A2A (Agent-to-Agent protocol) native adapter with streaming, HITL signaling, and session management.
- `@chat-agent-relay/backend-langgraph` — LangGraph Platform adapter with streaming, thread-based sessions, and interrupt/resume.
- `@chat-agent-relay/backend-acp` — Agent Client Protocol (ACP) adapter for coding agents (Claude Code, Gemini CLI).
- Internal architecture decision document.
- 3 new canonical event types: `agent.status.changed`, `agent.input.requested`, `agent.input.provided`.
- Multi-backend server config — `AGENT_TYPE` env var selects between `openai`, `http`, `a2a`, `langgraph`, `acp`.
- `asAgentAdapter()` convenience method on `GenericHttpBackend` and `OpenAIBackend`.
- Agent adapter conformance test suite (`testAgentAdapter`).

### Changed

- Pipeline uses `AgentAdapter` internally.
- Server supports 4 backend types instead of hardcoded OpenAI.
- Canonical event envelope now has 15 event types (was 12).
- Test suite expanded from 356 tests (32 files) to 526 tests (40 files).
- Package count: 12 to 15 (added `backend-a2a`, `backend-langgraph`, `backend-acp`).

### Added

#### Discord channel adapter (Phase 2)

- New `packages/channel-discord` package with Gateway WebSocket connection, ingress canonicalization, REST API message delivery, slash command handling, rich message output (Embeds), access control, and typing indicator.
- Discord conformance tests pass alongside Slack and WebChat adapters.

#### Slack production hardening (Phase 1)

- Ack reaction pipeline: configurable emoji feedback on message receive/complete/error.
- Text chunking: auto-split messages exceeding 3900 characters at natural break points.
- Mention gating: channel messages only processed when bot is @mentioned.
- DM/Channel access policy: open, allowlist, or disabled modes with env var configuration.
- `describeCapabilities()` static method for adapter capability declaration.

#### Extended canonical event model (Phase 3)

- Four new canonical event types with JSON Schema: `message.updated`, `message.deleted`, `reaction.received`, `command.received`.
- Slack: canonicalization for `message_changed`, `message_deleted` subtypes, `reaction_added`/`reaction_removed` events, and `app_mention` events.
- Discord: canonicalization for `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `MESSAGE_REACTION_ADD` gateway events.
- Pipeline integration: ack reaction lifecycle, Discord typing indicator.

#### Slash commands and rich output (Phase 4)

- Slack slash command handling via Socket Mode with `command.received` canonicalization.
- Discord slash command handling via `INTERACTION_CREATE` gateway events.
- Discord command registration utility (`registerGlobalCommands`).
- Rich message abstraction: `RichMessage` type with Block Kit (Slack) and Embed (Discord) converters.
- `sendRichMessage()` on both `SlackSender` and `DiscordSender`.

### Changed

- Test suite expanded from 222 tests (17 files) to 356 tests (32 files).
- Package count: 11 to 12 (added `channel-discord`).
- Canonical event type count: 8 to 12 (added 4 extended messaging events).
- Server supports optional Discord Gateway alongside Slack Socket Mode.
- Adapter conformance suite now tests 3 channel adapters (WebChat, Slack, Discord) and 2 backend adapters.

### Added

#### Configurable HTTP backend

- `GenericHttpBackend` now supports custom `headers`, `buildRequestBody`, and `responseTextField` configuration, allowing any HTTP agent to be connected without adapting to CAR's native request/response format.
- New `extractField` utility for dot-path based field extraction from arbitrary JSON responses.
- 12 new tests covering custom headers, request body builders, response field extraction, and default format handling.

### Changed

#### Dependency upgrades

- Bump `typescript` from 5.8.2 to 6.0.2 across all packages.
- Bump `actions/checkout` from v4 to v6 in CI, Release, and Pages workflows.
- Bump `docker/build-push-action` from v6 to v7.
- Bump `docker/login-action` from v3 to v4.
- Bump `actions/upload-pages-artifact` from v3 to v4.
- Bump `actions/deploy-pages` from v4 to v5.

### Added

#### Core platform and packages

- Eleven packages: `contract-harness`, `event-ledger`, `channel-web-chat`, `channel-slack`, `middleware`, `backend-http`, `backend-openai`, `delivery`, `pipeline`, `server`, and `adapter-conformance`.
- Canonical seven-event model with JSON Schema validation at boundaries.
- Test suite: 222 tests across 17 files.

#### Channels and backends

- Slack ingress via Socket Mode; OpenAI Chat Completions backend integration.
- WebChat HTTP transport with CORS support.
- Streaming path: OpenAI Server-Sent Events mapped to progressive Slack updates.

#### Policy, delivery, and persistence

- Configurable keyword and regex policy engine in middleware.
- Delivery with retry, exponential backoff, and dead-letter queue (DLQ).
- SQLite-backed durable persistence via the event ledger.

#### APIs, observability, and operations

- Replay and query HTTP API: `/api/health`, `/api/conversations`, `/api/correlations`, `/api/events`, and `/api/audit`.
- Deep health check endpoint for dependency and readiness probing.
- Structured JSONL logging.
- Graceful shutdown with in-flight request drain.
- Configuration validation with user-facing error messages.

#### Quality, CI, and documentation

- Conformance test suite for channel and backend adapters (`adapter-conformance`).
- GitHub Actions continuous integration.
- Getting Started guide for new contributors and operators.
- Adapter interface specifications in RFC form under `docs/rfcs/`.
