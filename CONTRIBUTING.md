# Contributing to Chat Agent Relay

Thank you for your interest in contributing to Chat Agent Relay (CAR).

## Development Setup

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git
cd ChatAgentRelay
bun install
```

## Running Tests

```bash
# All tests
bun test --recursive

# Single package
bun test packages/pipeline

# With watch mode
bun test --watch packages/middleware
```

## Type Checking

```bash
# All packages
cd packages/<name> && bunx tsc --noEmit

# Or from root
bun run typecheck
```

## Project Structure

- `docs/rfcs/` — normative architecture specifications (source of truth)
- `docs/schemas/` — JSON Schema contract layer (frozen fixture baseline)
- `packages/` — implementation packages

## Contribution Guidelines

### Code

- TypeScript strict mode is enforced across all packages
- All canonical events must validate against the frozen schema layer
- New adapters should pass the `@chat-agent-relay/adapter-conformance` test suite
- Avoid comments that merely narrate what code does — only explain non-obvious intent
- Each PR should have a clear, narrow scope

### Documentation

- RFCs use RFC 2119 keywords (MUST, SHOULD, MAY) precisely
- New architectural changes must be reflected in RFCs before or alongside implementation
- English is the primary language for all normative documents

### Commits

- Keep each commit narrowly scoped to a single feature or fix
- Write commit messages that explain "why" rather than "what"
- Run `bun test --recursive` before committing

### Adding a New Adapter

1. Create a new package under `packages/`
2. Implement the `ChannelIngress` or `BackendAdapter` interface
3. Add conformance tests using `@chat-agent-relay/adapter-conformance`
4. Add unit tests for adapter-specific behavior
5. Update the relevant public RFCs and architecture docs if adding a new package changes public architecture or interfaces

### Pull Requests

- All PRs run CI automatically (test + typecheck)
- PRs should include tests for new functionality
- PRs that change architecture should reference or update the relevant RFC

## Architecture Resources

- [Reference Architecture](docs/rfcs/architecture/reference-architecture.md)
- [Channel Adapter Interface Spec](docs/rfcs/adapters/channel-adapter-interface-spec.md)
- [Backend Adapter Interface Spec](docs/rfcs/adapters/backend-adapter-interface-spec.md)
- [Getting Started Guide](docs/getting-started.md)
