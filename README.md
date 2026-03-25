# CAP

CAP is an open-source framework foundation for the layer between chat platforms and agents.

As projects like Open SWE show, bringing agent workflows into tools like Slack is a natural starting point: users are already there, collaboration is already there, and lightweight remote agent interaction fits naturally into existing messaging environments.

But Slack-first is a starting point, not an end state. The common workaround today is to build a point-to-point integration around a single chat platform, coupling message ingress, identity mapping, permissions, status updates, and agent invocation logic directly into one channel-specific path. That can validate demand quickly, but it creates upstream cost: each new messaging platform requires repeated integration work, platform-specific semantics leak into product logic, and monitoring, routing, governance, auditability, and migration become harder to standardize over time.

CAP exists to make that layer explicit and reusable. It provides a docs-first, specs-first architecture for absorbing channel differences behind a canonical event model and pluggable adapter contracts, so developers can start with one messaging platform without locking themselves into one forever.

This project is open source first. The immediate goal is not commercialization; it is to define the abstraction clearly, build a solid reusable framework, and make this layer legible and useful to more developers, projects, and future integrations.

The project currently includes:
- normative RFCs for architecture and protocol boundaries
- a complete first executable path implementation across 10 packages
- real Slack + OpenAI integration with a working end-to-end pipeline
- decision documents that concentrate open questions and technology evaluation work

## Repository Structure

```text
.
├── CLAUDE.md
├── README.md
├── .gitignore
├── package.json
├── tsconfig.base.json
├── docs/
│   ├── rfcs/
│   │   ├── architecture/
│   │   ├── canonical-model/
│   │   ├── adapters/
│   │   └── middleware/
│   ├── schemas/
│   │   ├── canonical-model/
│   │   └── fixtures/
│   ├── research/
│   └── decisions/
└── packages/
    ├── contract-harness/
    ├── event-ledger/
    ├── channel-web-chat/
    ├── channel-slack/
    ├── middleware/
    ├── backend-http/
    ├── backend-openai/
    ├── delivery/
    ├── pipeline/
    └── server/
```

## Document Roles

- `docs/rfcs/`: normative source of truth
- `docs/decisions/`: open questions, selection frameworks, and later decision records
- `docs/research/`: background research and comparison material

## Current RFC Entry Points

- `docs/rfcs/architecture/reference-architecture.md`
- `docs/rfcs/canonical-model/canonical-event-schema.md`
- `docs/rfcs/adapters/channel-adapter-contract.md`
- `docs/rfcs/adapters/backend-agent-adapter-contract.md`
- `docs/rfcs/middleware/routing-middleware-governance.md`

## Current Decision Docs

- `docs/decisions/open-questions.md`
- `docs/decisions/technology-selection-framework.md`
- `docs/decisions/repository-next-approved-slices.md`

## Current Maturity

This repository is docs-first with a complete first executable path and real Slack + OpenAI integration.

Current maturity:
- core RFC set drafted
- cross-cutting open questions centralized
- technology selection framework established
- implementation bootstrap baseline: Bun runtime, TypeScript strict mode
- frozen seven-event fixture corpus as machine-readable contract baseline
- complete seven-event happy path with pluggable channel and backend adapters
- Slack Socket Mode channel adapter and OpenAI Chat Completions backend
- 110 tests across 10 packages verify contract compliance and end-to-end behavior

## Package Overview

| Package | Role |
|---------|------|
| `@cap/contract-harness` | Schema loading and contract validation |
| `@cap/event-ledger` | Append, replay, audit with in-memory and SQLite backends |
| `@cap/channel-web-chat` | Web chat ingress canonicalization |
| `@cap/channel-slack` | Slack Socket Mode ingress + chat.postMessage delivery |
| `@cap/middleware` | Policy, routing, and dispatch |
| `@cap/backend-http` | Generic HTTP backend invocation |
| `@cap/backend-openai` | OpenAI Chat Completions API integration |
| `@cap/delivery` | Delivery orchestration (send request + send completion) |
| `@cap/pipeline` | End-to-end pipeline with pluggable adapters |
| `@cap/server` | Runtime entry point: Slack + OpenAI + Pipeline + SQLite |

## Quick Start

```bash
# Install dependencies
bun install

# Run all tests
bun run test

# Run the Slack + OpenAI server (requires .env configuration)
cd packages/server
cp .env.example .env  # edit with your tokens
bun run start
```

## Near-Term Workflow

The first executable path with real integration is complete. Recommended next steps:
1. extend coverage for error paths, deny decisions, and retries
2. add streaming delta support for backend adapters
3. add additional channel adapters (Discord, Teams, etc.)
4. expose replay/query API surfaces for external consumers
5. keep governing docs aligned before or alongside runtime changes
