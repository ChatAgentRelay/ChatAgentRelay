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
    └── backend-http/
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

This repository is docs-first with a narrow implementation baseline committed.

Current maturity:
- core RFC set drafted
- cross-cutting open questions centralized
- technology selection framework established
- implementation bootstrap baseline: Bun runtime, TypeScript strict mode
- frozen seven-event fixture corpus as machine-readable contract baseline
- `packages/contract-harness` completed as validation-harness milestone
- `packages/event-ledger` with in-memory and SQLite-backed durable append
- `packages/channel-web-chat` as web chat ingress canonicalization boundary
- `packages/backend-http` as generic HTTP backend invocation boundary
- repository-level roadmap inventory in place

## Near-Term Workflow

The repository is at the review gate defined in `docs/decisions/repository-next-approved-slices.md`.

Recommended next steps:
1. review the candidate direction menu in the roadmap inventory
2. approve narrow runtime slices one at a time
3. implement each approved slice with one feature per commit
4. keep governing docs aligned before or alongside runtime changes
