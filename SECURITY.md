# Security Policy

## Current repository state

This repository currently contains:
- architecture and decision documents
- machine-readable schema artifacts
- completed validation-harness code for contract consumption
- a bounded in-memory event-ledger prototype for append, replay, and audit helpers

It does not yet include the broader CAP runtime surfaces such as production channel adapters, backend integrations, durable ledger persistence, replay/query APIs, or orchestration services.

## Scope of current security review

At this stage, security concerns are most likely to involve:
- schema correctness and validation behavior
- fixture and contract integrity
- repository governance and contribution flow
- early local tooling and package configuration
- bounded prototype behavior around append, replay, audit, and duplicate handling

Security-sensitive provider integrations and production runtime operations are not yet in scope for this repository phase.

## Reporting a vulnerability or security concern

If you discover a vulnerability or security concern, please report it privately to the project maintainers instead of opening a public issue with exploit details.

If a private reporting channel is added later, update this file to point to it explicitly.
Until then, use the repository maintainer contact path and provide:
- a description of the issue
- affected files or package paths
- impact assessment
- reproduction steps if relevant

## Disclosure guidance

Please avoid public disclosure of sensitive details until maintainers have had a chance to review and respond.

## Future updates

This policy should be expanded once CAP begins to include real runtime code, external integrations, or deployable services.
