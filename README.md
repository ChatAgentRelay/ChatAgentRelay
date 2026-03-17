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
└── docs/
    ├── rfcs/
    │   ├── architecture/
    │   ├── canonical-model/
    │   ├── adapters/
    │   └── middleware/
    ├── research/
    └── decisions/
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

## Current Maturity

This repository is not yet an implementation repository.

Current maturity:
- core RFC set drafted
- cross-cutting open questions centralized
- technology selection framework established
- runtime stack intentionally undecided

## Near-Term Workflow

Recommended next steps:
1. resolve or narrow the blocking questions in `docs/decisions/open-questions.md`
2. evaluate implementation options using `docs/decisions/technology-selection-framework.md`
3. record subsystem-level technology decisions
4. only then enter v0/v1 implementation planning
