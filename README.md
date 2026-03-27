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
| Switch agent backends | Rewrite integration logic | Change one config |
| Compliance asks for audit logs | Build a logging system from scratch | Already there — every message is a 7-event chain in an append-only ledger |
| Agent call fails | Hope your try/catch was good enough | Automatic retry with exponential backoff + dead-letter queue |
| "What happened to that message?" | Dig through scattered logs | `curl localhost:3000/api/conversations/{id}/audit` |

## Get Started in 2 Minutes

**Slack + your agent:**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install
cd packages/server
cp .env.example .env    # add your chat platform + agent credentials
bun run start
```

**Just explore (no tokens needed):**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install && bun test --recursive    # 210 tests, ~5 seconds
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

CAR doesn't care what your agent is — an internal tool, a LangChain pipeline, a self-hosted model, or a commercial API. If it can receive an HTTP request and return a response, CAR can talk to it.

```typescript
const backend: BackendAdapter = {
  async invoke(context: InvocationContext): Promise<InvocationResult> {
    // call YOUR agent — any HTTP endpoint, any framework, any model
    // map the response to a canonical event
  }
};
```

Built-in backends: **OpenAI Chat Completions** (with SSE streaming) and **generic HTTP** (works with any REST agent). The conformance test suite validates your adapter automatically: run `testBackendAdapter()` and you know it's correct.

## Connect Your Chat Platform

Same story on the chat side. Slack and WebChat are built-in. Need Discord? Teams? Telegram? One interface:

```typescript
const ingress: ChannelIngress = {
  canonicalize(raw: unknown): CanonicalizationResult {
    // validate platform payload → map to canonical event → return
  }
};
```

Run `testChannelIngress()` to validate. See the [example Discord adapter](examples/custom-channel-adapter/) for a walkthrough.

## What You Get Out of the Box

- **Governance** — keyword/regex policy engine blocks messages before they reach your agent
- **Full audit trail** — every message is a 7-event chain in an append-only ledger, queryable via REST
- **Streaming** — SSE responses stream directly to chat with progressive message updates
- **Delivery retry** — exponential backoff + dead-letter queue, no lost messages
- **Multi-turn context** — automatic conversation history replay from the ledger
- **Conformance testing** — validate any adapter with a single function call

## Roadmap

We're building the connective layer between chat and agents. Here's what's already shipped and where we're headed next:

**Chat platforms** — expanding where users can reach their agents:
- [x] Slack
- [x] Web chat
- [ ] Microsoft Teams
- [ ] Discord
- [ ] Telegram
- [ ] WhatsApp Business
- [ ] LINE
- [ ] Custom web widget SDK

**Agent backends** — connecting to any agent, regardless of how it's built:
- [x] OpenAI Chat Completions
- [x] Generic HTTP backend
- [ ] Any SSE-streaming agent (generic SSE adapter)
- [ ] Webhook / async callback agents
- [ ] MCP (Model Context Protocol) compatible agents
- [ ] Multi-agent routing (fan-out to multiple agents per message)

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
car-server --help            # usage
car-server --version         # version
car-server --check-config    # validate config
car-server --dry-run         # test connectivity
```

## Built With

- **[Bun](https://bun.sh)** — runtime, package manager, test runner, bundler
- **TypeScript** — strict mode everywhere
- **SQLite** — durable event ledger (via `bun:sqlite`)
- **JSON Schema** — contract validation for all events

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All adapter contributions get free conformance testing.

We especially welcome:
- **New channel adapters** — connect the chat platforms your team actually uses
- **New backend adapters** — connect the agents your company actually builds
- **Bug reports and use cases** — tell us how you're using CAR and what's missing

## License

[MIT](LICENSE) — use it for anything.
