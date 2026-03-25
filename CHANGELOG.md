# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

There has been no formal versioned release yet. The following summarizes work on the main development line.

### Added

#### Core platform and packages

- Eleven packages: `contract-harness`, `event-ledger`, `channel-web-chat`, `channel-slack`, `middleware`, `backend-http`, `backend-openai`, `delivery`, `pipeline`, `server`, and `adapter-conformance`.
- Canonical seven-event model with JSON Schema validation at boundaries.
- Test suite: 200 tests across 16 files.

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
