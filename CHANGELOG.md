# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

There has been no formal versioned release yet. The following summarizes work on the main development line.

### Tenant isolation

#### Added

- **Tenant isolation** — ledger queries scoped by `X-Tenant-ID` header when `tenant.isolation` setting is enabled. Composite indexes on `(tenant_id, conversation_id)` and `(tenant_id, correlation_id)`.

### WhatsApp Business and YAML policy (v0.6)

#### Added

- **`channel-whatsapp`** — WhatsApp Business Cloud API adapter with HMAC-SHA256 webhook verification, 24-hour session window tracking via `WhatsAppSessionTracker`.
- **YAML policy configuration** — external policy files via `CAR_POLICY_FILE` / `CAR_OUTBOUND_POLICY_FILE` with standard `yaml` parser. File watch hot-reload in server runtime.

### Microsoft Teams, webhook verification, idempotency (v0.5)

#### Added

- **`channel-teams`** — Microsoft Teams Bot Connector adapter with JWT verification (Azure AD), Adaptive Cards, threaded conversations, activity update streaming.
- **Webhook verification** — Slack HMAC, Teams JWT, Telegram secret token, WhatsApp HMAC-SHA256, Lark encrypt key, DingTalk HMAC-SHA256.
- **Idempotency framework** — per-channel deduplication with configurable TTL.

### HITL pipeline and structured governance (v0.4)

#### Added

- **Structured policy conditions** — `PolicyCondition` type with `sender`, `channel`, `content_length`, `time_window`, `keyword`, `regex` fields; `and`/`or`/`not` composition; mandatory deny.
- **HITL pipeline** — agent `input-required` relay: `agent.input.requested` event, user reply canonicalized, `agent.input.provided`, agent resumes.

### Security and outbound governance (v0.3)

#### Added

- **API authentication** — Bearer token via `CAR_API_KEY`; public endpoints exempt.
- **Outbound governance** — `outboundPolicyFn` filters agent responses before delivery.
- **Rate limiting** — sliding window per sender/conversation/tenant.
- **Sender access control** — allowlist/blocklist per channel.

### Reliability fixes (v0.2)

#### Fixed

- CLI / API contract mismatch (`car agent list` / `car channel list` expected wrapped objects, API returned raw arrays).
- Graceful shutdown throws on missing Slack adapter.
- Audit endpoint `/api/conversations/:id/audit` returned 500 instead of explanation objects.
- `--check-config` error messages now include actionable remediation hints.

### Agent adapter protocol alignment

#### Removed

- **`backend-http`** — Generic HTTP backend adapter. CAR now exclusively integrates with agents via the A2A standard protocol. Users with custom HTTP agents should expose them as A2A servers.
- **`backend-openai`** — Direct OpenAI Chat Completions adapter. CAR connects to agent runtimes, not raw model APIs. OpenAI models should be accessed through agent frameworks (LangChain, CrewAI, etc.) that expose A2A endpoints.
- **`backend-langgraph`** — LangGraph Platform-specific adapter. LangGraph agents should be accessed via A2A protocol, which LangGraph natively supports.
- **`backend-acp`** — ACP subprocess agent adapter. CAR is middleware, not an editor; subprocess lifecycle management is outside its scope. Coding agents should be accessed via A2A protocol through community bridges (e.g., `a2a-opencode`, `coder/agentapi`).
- **`AgentType`** — Simplified from `"a2a" | "langgraph" | "acp" | "http" | "openai"` to `"a2a"`. Only the A2A standard protocol type remains.

#### Changed

- **Pipeline tests** — Integration tests rewritten to use mock `AgentAdapter` instead of specific backend implementations. Test names changed from `*-openai-integration` to `*-integration`.
- **Conformance tests** — Agent adapter conformance now validates the A2A adapter only.
- **CLI** — `car agent add` registers agents with A2A endpoint only (single protocol).

### Server runtime, validators, and HTTP/OpenAI adapters

#### Added

- **Server CLI** — `car channel add` supports `telegram`, `lark`, and `dingtalk` with platform-specific flags.
- **Factories** — `createTelegramFactory()`, `createLarkFactory()`, `createDingTalkFactory()` in `channel-factories.ts`. `main.ts` registers all channel types.
- **Config store** — `ChannelType` includes `telegram`, `lark`, and `dingtalk`. `SENSITIVE_FIELDS` extended for Telegram (`botToken`), Lark (`appId`, `appSecret`), DingTalk (`appKey`, `appSecret`).

#### Changed

- **`ContractHarnessValidators.getShared()`** — shared cached validator instance; call sites use `getShared()` instead of `create()` to avoid redundant JSON Schema load and Ajv compilation per request.
- **Server logging and config** — `agent-registry`, `channel-registry`, and `channel-factories` use structured JSON `logger` instead of `console.log`. `pickString`, `pickNumber`, `pickHeaders`, and `pickStringArray` live in shared `config-helpers.ts`.

### Added

- **Lifecycle contracts (`contract-harness`)** — `Shutdownable` (`shutdown(): Promise<void>`), `Disconnectable` (`disconnect(): void`), and type guards `isShutdownable()` / `isDisconnectable()` in `packages/contract-harness/src/lifecycle.ts`.
- **`AgentCapabilities`** — `multiTurn` and `resume` boolean fields; built-in agent adapters declare them; the pipeline uses `multiTurn` to decide whether to build conversation history from the ledger and `streaming` to decide whether to use streaming invocation.
- **`LedgerStore.close()`** — required on the ledger interface; `InMemoryEventLedgerStore` implements it.

### Changed

- **Server registries** — `ChannelRegistry` and `AgentRegistry` register implementations via `registerFactory(type, factory)` instead of adapter-specific `switch` statements. Built-in wiring lives in `packages/server/src/channel-factories.ts` and `agent-factories.ts`. Teardown uses `isDisconnectable()` / `isShutdownable()` when present.
- **Delivery** — `DeliveryOrchestrator.deliver()` takes a `ChannelSender` instance; the pipeline passes the sender from `createSender()` directly. `SendFn` is no longer part of the public delivery API.
- **WebChat streaming** — `buildWebChatStreaming()` is implemented and exported from `@chat-agent-relay/channel-web-chat` (not the server entrypoint).
- **Telegram and Lark senders** — optional `apiBase` overrides the default API root (DingTalk continues to use dynamic webhook URLs).
- **ChannelAdapter interface** — Replaced the ingress-only `ChannelIngress` interface with the unified `ChannelAdapter` interface. `ChannelAdapter` combines ingress (`canonicalize`) and egress (`createSender`) in a single boundary, declares channel capabilities via `describeCapabilities()`, and exposes `channelType` as a read-only property. The pipeline no longer requires external `sendFn` or `channelName` — it derives everything from the adapter. `testChannelIngress` is now `testChannelAdapter` and validates `channelType`, `describeCapabilities()`, and `createSender()` in addition to `canonicalize()`. Server message handling uses a unified `handleMessage(channelName, adapter, rawEvent)` flow instead of `instanceof` type switches.
- **Configuration model** — Replaced environment-variable configuration with a CLI + interface-driven config store. `ConfigStore` interface with `SqliteConfigStore` default (pluggable for PostgreSQL etc.). Hot-pluggable channel and agent registration at runtime; multi-agent routing via stored route rules. Pipeline now accepts `resolveAgent` and `routeFn` instead of a single backend instance.
- **Architecture** — Promoted `CanonicalizationResult`, `IngressError`, and `ChannelAdapter` types from `channel-web-chat` to `contract-harness` for clean cross-package reuse.
- Added `@chat-agent-relay/config-store` (16th package): `ConfigStore` interface, `SqliteConfigStore` implementation, `RouteEngine`, AES-256-GCM encrypted credential storage.
- Removed the starter template in favor of the CLI-first onboarding flow.

### Added

#### New channel adapters (global + China market)

- `@chat-agent-relay/channel-telegram` — Telegram Bot API webhook adapter with bot commands, progressive streaming, group/private chat.
- `@chat-agent-relay/channel-lark` — Lark/飞书 adapter covering both international and China platforms. Event subscription, auto token management, streaming via message editing.
- `@chat-agent-relay/channel-dingtalk` — DingTalk/钉钉 robot webhook adapter with session-based reply, staff identity mapping, group/private chat.

#### AgentAdapter architecture (A2A-aligned agent runtime integration)

- `AgentAdapter` interface — A2A-aligned agent runtime abstraction with structured events, HITL, and artifacts.
- `@chat-agent-relay/backend-a2a` — A2A (Agent-to-Agent protocol) native adapter with streaming, HITL signaling, and session management.
- 3 new canonical event types: `agent.status.changed`, `agent.input.requested`, `agent.input.provided`.
- Agent adapter conformance test suite (`testAgentAdapter`).

### Changed

- Pipeline uses `AgentAdapter` internally.
- Canonical event envelope now has 15 event types (was 12).
- Test suite expanded from 356 tests (32 files) to 692 tests (51 files).

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
- Delivery with retry and exponential backoff.
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
