# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

There has been no formal versioned release yet. The following summarizes work on the main development line.

### Added

#### Configurable HTTP backend

- `GenericHttpBackend` now supports custom `headers`, `buildRequestBody`, and `responseTextField` configuration, allowing any HTTP agent to be connected without adapting to CAR's native request/response format.
- New `extractField` utility for dot-path based field extraction from arbitrary JSON responses.
- 12 new tests covering custom headers, request body builders, response field extraction, and backward compatibility.

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
