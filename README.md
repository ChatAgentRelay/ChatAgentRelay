# CAP

[![CI](https://github.com/anthropics/cap/actions/workflows/ci.yml/badge.svg)](https://github.com/anthropics/cap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-210%20pass-brightgreen)](packages/)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)

CAP is an open-source framework for the layer between chat platforms and agents.

As projects like Open SWE show, bringing agent workflows into tools like Slack is a natural starting point: users are already there, collaboration is already there, and lightweight remote agent interaction fits naturally into existing messaging environments.

But Slack-first is a starting point, not an end state. The common workaround today is to build a point-to-point integration around a single chat platform, coupling message ingress, identity mapping, permissions, status updates, and agent invocation logic directly into one channel-specific path. That can validate demand quickly, but it creates upstream cost: each new messaging platform requires repeated integration work, platform-specific semantics leak into product logic, and monitoring, routing, governance, auditability, and migration become harder to standardize over time.

CAP exists to make that layer explicit and reusable. It provides a canonical event model and pluggable adapter contracts that absorb channel differences, so developers can start with one messaging platform without locking themselves into one forever.

## What CAP Provides

- **Canonical event model** — a frozen seven-event chain that every message traverses: `message.received` → `policy.decision.made` → `route.decision.made` → `agent.invocation.requested` → `agent.response.completed` → `message.send.requested` → `message.sent`, plus `event.blocked` for error/deny paths
- **Pluggable channel adapters** — Slack Socket Mode and WebChat ingress today; the `ChannelIngress` interface lets you add any chat platform
- **Pluggable backend adapters** — OpenAI Chat Completions and generic HTTP today; the `BackendAdapter` interface lets you add any agent runtime
- **Governance middleware** — configurable policy evaluation with allow/deny decisions before agent invocation
- **Multi-turn conversation memory** — automatic context replay from the event ledger
- **Streaming responses** — OpenAI SSE streaming with progressive Slack message updates
- **Delivery retry with DLQ** — exponential backoff on send failure, `DeliveryExhaustedError` for exhausted retries
- **Append-only event ledger** — in-memory and SQLite-backed durable persistence with replay and audit
- **Replay/Query HTTP API** — REST endpoints for conversations, correlations, and individual events
- **Structured JSON logging** — JSONL output with correlation IDs, durations, and context
- **Conformance test suite** — reusable adapter validation for channel and backend implementations

## Repository Structure

```text
.
├── docs/
│   ├── rfcs/           # normative architecture specs
│   ├── schemas/        # JSON Schema contract layer
│   ├── decisions/      # open questions and ADRs
│   └── research/       # background research
└── packages/
    ├── contract-harness/       # schema loading and validation
    ├── event-ledger/           # append, replay, audit (in-memory + SQLite)
    ├── channel-web-chat/       # web chat ingress canonicalization
    ├── channel-slack/          # Slack Socket Mode + chat.postMessage
    ├── middleware/              # policy, routing, dispatch
    ├── backend-http/           # generic HTTP backend
    ├── backend-openai/         # OpenAI Chat Completions + streaming
    ├── delivery/               # delivery orchestration + retry
    ├── pipeline/               # end-to-end orchestration
    ├── server/                 # runtime: Slack + OpenAI + API + SQLite
    └── adapter-conformance/    # reusable adapter test suite
```

## Package Overview

| Package | Role |
|---------|------|
| `@cap/contract-harness` | Schema loading and contract validation (8 event types) |
| `@cap/event-ledger` | Append, replay, audit with in-memory and SQLite backends |
| `@cap/channel-web-chat` | Web chat ingress canonicalization |
| `@cap/channel-slack` | Slack Socket Mode ingress + delivery + streaming updates |
| `@cap/middleware` | Policy (allow/deny), routing, and dispatch |
| `@cap/backend-http` | Generic HTTP backend invocation |
| `@cap/backend-openai` | OpenAI Chat Completions + SSE streaming |
| `@cap/delivery` | Delivery orchestration with retry and DLQ |
| `@cap/pipeline` | End-to-end pipeline with error paths and streaming |
| `@cap/server` | Runtime entry point with HTTP API |
| `@cap/adapter-conformance` | Reusable conformance tests for adapters |

## Quick Start

```bash
# Install dependencies
bun install

# Run all tests (210 tests across 12 packages)
bun test --recursive

# Run the Slack + OpenAI server
cd packages/server
cp .env.example .env   # edit with your API tokens
bun run start
```

The server exposes a replay/query API on port 3000 (configurable via `CAP_API_PORT`):

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/conversations/<id>/events
curl http://localhost:3000/api/correlations/<id>/events
curl http://localhost:3000/api/events/<id>
```

## Current Maturity

210 tests across 12 packages verify contract compliance, causal linkage, error paths, and end-to-end behavior:

- frozen seven-event fixture corpus as machine-readable contract baseline
- complete happy path + error path (`event.blocked`) + deny path (governance short-circuit)
- multi-turn conversation context with automatic ledger replay
- streaming delta support (OpenAI SSE → Slack progressive updates)
- delivery retry with exponential backoff and dead-letter handling
- replay/query HTTP API for external consumers
- conformance test suite validating all 4 adapters
- structured JSONL logging with correlation tracking

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Setup guide for Slack + OpenAI |
| [Architecture Overview](docs/architecture.md) | Diagrams and system design |
| [API Reference](docs/api-reference.md) | All HTTP endpoints |
| [Reference Architecture RFC](docs/rfcs/architecture/reference-architecture.md) | Normative architecture spec |
| [Channel Adapter Spec](docs/rfcs/adapters/channel-adapter-interface-spec.md) | ChannelIngress interface |
| [Backend Adapter Spec](docs/rfcs/adapters/backend-adapter-interface-spec.md) | BackendAdapter interface |

## Examples

- [Custom Channel Adapter](examples/custom-channel-adapter/) — Skeleton Discord adapter showing the `ChannelIngress` pattern with conformance tests

## Docker

```bash
# Build and run with Docker Compose
docker compose up -d

# Or build the image directly
docker build -t cap-server .
docker run --env-file packages/server/.env -p 3000:3000 cap-server
```

## CLI

```bash
cap-server --help          # Show usage
cap-server --version       # Show version
cap-server --check-config  # Validate config and exit
cap-server --dry-run       # Check connectivity and exit
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
