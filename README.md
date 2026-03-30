<p align="center">
  <b>Chat Agent Relay</b><br>
  <i>Your agent is ready. Now let users talk to it — from any chat platform, with governance and audit built in.</i>
</p>

<p align="center">
  <a href="https://github.com/ChatAgentRelay/ChatAgentRelay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ChatAgentRelay/ChatAgentRelay/ci.yml?branch=main&label=tests" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
</p>

---

You built an agent. It works. Now your PM says "put it in Slack." Then legal says "we need audit logs." Then another team wants it in Teams. Then someone asks "can we try a different model?" — and suddenly you're not building your product anymore. You're building plumbing.

**Chat Agent Relay (CAR) is that plumbing, done once, so you never build it again.**

```
                   Chat Agent Relay
Slack  ─┐                                    ┌─ Your internal agent
Teams  ─┤→ [Governance] → [Route] → [Invoke] →├─ LangChain / CrewAI agent
Discord ─┤      ↓                              ├─ Self-hosted model
Web    ─┘  [Audit Ledger]                     └─ OpenAI / Claude / any HTTP
```

## The Problem

Every team connecting a chat platform to an agent writes the same undifferentiated code: webhook parsing, message formatting, retry logic, error handling, audit logging. Then they write it again for the next platform. And again for the next agent.

This is not your product. This is overhead. And it multiplies every time requirements change.

## Why CAR

| Pain | Without CAR | With CAR |
|------|------------|----------|
| New chat platform needed | Weeks of integration work | Implement one interface, done |
| Switch agent backends | Rewrite integration logic | Add or select another agent in the config DB; route rules pick the handler |
| Compliance asks for audit logs | Build a logging system from scratch | Already there — every message is a 7-event chain in an append-only ledger |
| Agent call fails | Hope your try/catch was good enough | Automatic retry with exponential backoff + dead-letter queue |
| "What happened to that message?" | Dig through scattered logs | `curl localhost:3000/api/conversations/{id}/audit` |

## Get Started in 2 Minutes

**Slack + your agent:**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install
cd packages/server
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # encrypts tokens and API keys at rest
car channel add my-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
car agent add my-bot --type=a2a --endpoint=http://...
car route add --default --agent=my-bot
car start
```

For day-to-day operation you typically set `CAR_ENCRYPTION_KEY` (so secrets in the DB are encrypted) and optionally `CAR_DB_PATH` (defaults to `./car.db`).

**Just explore (no tokens needed):**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install && bun test --recursive    # ~542 tests across 43 files
```

## How It Works

Every message produces an immutable event chain — no exceptions, no hidden state:

```
message.received           → user's message, canonicalized from any platform
  policy.decision.made     → allow or deny (configurable rules)
  route.decision.made      → which agent handles this
  agent.invocation.requested → dispatch to your agent
  agent.response.completed → agent's reply captured
  message.send.requested   → queued for delivery with retry
  message.sent             → delivered to user's chat platform
```

If anything fails, `event.blocked` records what went wrong, at which stage, and why. The ledger is your single source of truth.

## Connect Your Agent

CAR doesn't care what your agent is — an A2A-compatible agent, a LangGraph pipeline, a self-hosted model, or a commercial API. The `AgentAdapter` interface connects to any agent runtime with structured events, HITL support, and session management.

```typescript
const adapter: AgentAdapter = {
  describeCapabilities() { return { streaming: true, hitl: true, cancel: false, artifacts: false }; },
  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    // call YOUR agent runtime — any protocol, any framework
  }
};
```

Built-in agent backends:
- **A2A protocol** — connect to any A2A-compatible agent with native streaming and HITL
- **ACP (Agent Client Protocol)** — connect to coding agents (e.g. Claude Code, Gemini CLI) via stdin/stdout subprocess
- **LangGraph Platform** — connect to LangGraph agents with thread-based sessions
- **OpenAI Chat Completions** — with SSE streaming (legacy adapter, auto-bridged)
- **Configurable generic HTTP** — custom headers, request body builders, and response field extraction (legacy adapter, auto-bridged)

The conformance test suite validates your adapter automatically: run `testAgentAdapter()` and you know it's correct.

## Connect Your Chat Platform

Same story on the chat side. Slack, Discord, and WebChat are built-in. Need Teams? Telegram? One interface:

```typescript
const ingress: ChannelIngress = {
  canonicalize(raw: unknown): CanonicalizationResult {
    // validate platform payload → map to canonical event → return
  }
};
```

Run `testChannelIngress()` to validate. See `packages/channel-discord` for a full adapter example.

## What You Get Out of the Box

- **Governance** — keyword/regex policy engine blocks messages before they reach your agent
- **Access control** — DM/channel policies, guild allowlists, mention gating
- **Full audit trail** — every message is a 7-event chain in an append-only ledger, queryable via REST
- **Streaming** — SSE responses stream directly to chat with progressive message updates
- **Delivery retry** — exponential backoff + dead-letter queue, no lost messages
- **Multi-turn context** — automatic conversation history replay from the ledger
- **Ack reactions** — configurable emoji feedback on message receive/complete/error
- **Slash commands** — native slash command handling for Slack and Discord
- **Multi-agent routing** — register several agents at once; route rules decide which handles each message (hot-pluggable at runtime)
- **CLI-first configuration** — channels, agents, routes, and settings live in SQLite; no wall of environment variables
- **Encrypted credentials** — AES-256-GCM for tokens and API keys via `config-store`
- **Human-in-the-loop (HITL)** — agents can request human input mid-execution and resume after
- **Conformance testing** — validate any adapter with a single function call

## Roadmap

We're building the connective layer between chat and agents. Here's what's already shipped and where we're headed next:

**Chat platforms** — expanding where users can reach their agents:
- [x] Slack
- [x] Web chat
- [ ] Microsoft Teams
- [x] Discord
- [ ] Telegram
- [ ] WhatsApp Business
- [ ] LINE
- [ ] Custom web widget SDK

**Agent backends** — connecting to any agent runtime, regardless of how it's built:
- [x] A2A protocol (Agent-to-Agent)
- [x] ACP (Agent Client Protocol) for coding-agent CLIs
- [x] LangGraph Platform
- [x] OpenAI Chat Completions
- [x] Generic HTTP backend
- [ ] Any SSE-streaming agent (generic SSE adapter)
- [ ] Webhook / async callback agents
- [ ] MCP (Model Context Protocol) compatible agents
- [x] Multi-agent routing (multiple registered agents; route rules per channel or pattern)

**Platform capabilities:**
- [x] Governance / policy engine
- [x] Append-only audit ledger with replay and audit API
- [x] Streaming responses
- [x] Delivery retry with exponential backoff
- [x] Multi-turn conversation context
- [x] Adapter conformance testing
- [ ] RBAC and multi-tenant routing
- [ ] Usage metering and analytics dashboard
- [ ] Plugin system for custom middleware stages
- [ ] Admin UI for policy and routing management

**Tell us what matters to you.** Which chat platform do your users live in? What kind of agent do you want to connect? [Open an issue](https://github.com/ChatAgentRelay/ChatAgentRelay/issues) or [start a discussion](https://github.com/ChatAgentRelay/ChatAgentRelay/discussions) — your use case shapes the roadmap.

## Documentation

| | |
|---|---|
| **[Getting Started](docs/getting-started.md)** | Setup in 5 minutes |
| **[Architecture](docs/architecture.md)** | System design with diagrams |
| **[API Reference](docs/api-reference.md)** | All HTTP endpoints |
| **[Writing Adapters](docs/rfcs/adapters/channel-adapter-interface-spec.md)** | Channel & backend interface specs |

## CLI

```bash
car --help                   # usage (also: car channel|agent|route|config subcommands)
car --version                # version
car --check-config           # open config DB and print summary
car channel add|list|remove  # manage chat channels (Slack, Discord, WebChat, …)
car agent add|list|remove    # register agent backends (A2A, LangGraph, HTTP, …)
car route add|list|remove    # routing rules (default, channel match, pattern)
car config set|get           # arbitrary settings key/value store
car start                    # run the relay (same entry as `car` with no subcommand, per install)
```

## Built With

- **[Bun](https://bun.sh)** — runtime, package manager, test runner, bundler
- **TypeScript** — strict mode everywhere
- **SQLite** — durable event ledger and configuration database (via `bun:sqlite`)
- **JSON Schema** — contract validation for all events

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All adapter contributions get free conformance testing.

We especially welcome:
- **New channel adapters** — connect the chat platforms your team actually uses
- **New backend adapters** — connect the agents your company actually builds
- **Bug reports and use cases** — tell us how you're using CAR and what's missing

## License

[MIT](LICENSE) — use it for anything.
