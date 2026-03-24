# CAP

CAP is a docs-first, specs-first repository for defining a chat-platform <-> agent middleware architecture.

The project is currently focused on:
- normative RFCs for architecture and protocol boundaries
- research inputs that inform, but do not define, the system
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
    ├── middleware/
    ├── backend-http/
    ├── delivery/
    └── pipeline/
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

This repository is docs-first with a complete first executable path implementation.

Current maturity:
- core RFC set drafted
- cross-cutting open questions centralized
- technology selection framework established
- implementation bootstrap baseline: Bun runtime, TypeScript strict mode
- frozen seven-event fixture corpus as machine-readable contract baseline
- complete seven-event happy path implemented across seven packages
- 79 tests verify contract compliance, causal linkage, and end-to-end behavior

## Package Overview

| Package | Role |
|---------|------|
| `@cap/contract-harness` | Schema loading and contract validation |
| `@cap/event-ledger` | Append, replay, audit with in-memory and SQLite backends |
| `@cap/channel-web-chat` | Web chat ingress canonicalization |
| `@cap/middleware` | Policy, routing, and dispatch |
| `@cap/backend-http` | Generic HTTP backend invocation |
| `@cap/delivery` | Delivery orchestration (send request + send completion) |
| `@cap/pipeline` | End-to-end first executable path orchestration |

## Near-Term Workflow

The first executable path is complete. Recommended next steps:
1. extend coverage for error paths, deny decisions, and retries
2. add streaming delta support for backend adapters
3. add additional channel adapters beyond web chat
4. expose replay/query API surfaces for external consumers
5. keep governing docs aligned before or alongside runtime changes
