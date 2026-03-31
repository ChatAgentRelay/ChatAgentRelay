# AI Agent Guide for Chat Agent Relay (CAR)

This file helps AI coding assistants understand and work with the CAR codebase.

## Quick Start
- Runtime: Bun (not Node.js)
- Language: TypeScript (strict mode)
- Test: `bun test --recursive`
- Typecheck: per-package `bunx tsc --noEmit`
- Lint: `bun run lint`
- Configuration: SQLite database (default `./car.db` via `CAR_DB_PATH`); set `CAR_ENCRYPTION_KEY` to encrypt tokens and API keys at rest
- From `packages/server`, register channels, agents, and routes with the `car` CLI, then run `car start` (see `docs/getting-started.md`). Runtime changes to channels and agents apply without restart where supported

## Architecture
Chat Agent Relay (CAR) is a middleware framework between chat platforms and AI agent runtimes. Every message flows through a 7-event pipeline chain in an append-only ledger. The `AgentAdapter` interface (A2A-aligned) is the primary agent-side boundary, supporting structured events, HITL, and artifacts. Additional canonical event types capture supplementary interactions and agent lifecycle signals.

## Package Map
| Package | Purpose | Key Interface |
|---------|---------|--------------|
| contract-harness | Schema validation + AgentAdapter types | ContractHarnessValidators, AgentAdapter |
| config-store | Config storage (ConfigStore interface) | ConfigStore, SqliteConfigStore, RouteEngine |
| event-ledger | Event storage | LedgerStore |
| channel-web-chat | WebChat adapter | ChannelIngress |
| channel-slack | Slack adapter | ChannelIngress |
| channel-discord | Discord adapter | ChannelIngress |
| middleware | Policy + routing | MiddlewarePipeline |
| backend-http | Configurable HTTP backend | AgentAdapter (via asAgentAdapter()) |
| backend-openai | OpenAI backend | AgentAdapter (via asAgentAdapter()) |
| backend-a2a | A2A protocol adapter | AgentAdapter (native) |
| backend-langgraph | LangGraph Platform adapter | AgentAdapter (native) |
| backend-acp | ACP coding agent adapter | AgentAdapter |
| delivery | Message delivery | DeliveryOrchestrator |
| pipeline | Orchestration | FirstExecutablePathPipeline |
| server | Runtime (multi-agent via route rules; hot-pluggable channels/agents) | `car` CLI + HTTP API |
| adapter-conformance | Test suite | testChannelIngress, testAgentAdapter |

## Key Patterns
- Adapters never throw - return Result types
- Events are immutable and append-only
- correlation_id links all events in a request
- causation_id links parent -> child events
- provider_extensions preserves platform-specific data

## When Adding New Code
1. Check docs/rfcs/ for relevant specifications
2. Ensure new events validate against JSON Schema
3. Run conformance tests for new adapters
4. Update CHANGELOG.md for user-facing changes
