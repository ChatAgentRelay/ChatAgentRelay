# AI Agent Guide for Chat Agent Relay (CAR)

This file helps AI coding assistants understand and work with the CAR codebase.

## Quick Start
- Runtime: Bun (not Node.js)
- Language: TypeScript (strict mode)
- Test: `bun test --recursive`
- Typecheck: per-package `bunx tsc --noEmit`
- Lint: `bun run lint`

## Architecture
Chat Agent Relay (CAR) is a middleware framework between chat platforms and AI agents. Every message produces a 7-event chain in an append-only ledger.

## Package Map
| Package | Purpose | Key Interface |
|---------|---------|--------------|
| contract-harness | Schema validation | ContractHarnessValidators |
| event-ledger | Event storage | LedgerStore |
| channel-web-chat | WebChat adapter | ChannelIngress |
| channel-slack | Slack adapter | ChannelIngress |
| middleware | Policy + routing | MiddlewarePipeline |
| backend-http | Configurable HTTP backend | BackendAdapter |
| backend-openai | OpenAI backend | BackendAdapter |
| delivery | Message delivery | DeliveryOrchestrator |
| pipeline | Orchestration | FirstExecutablePathPipeline |
| server | Runtime | CLI + HTTP API |
| adapter-conformance | Test suite | testChannelIngress, testBackendAdapter |

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
