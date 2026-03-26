<p align="center">
  <b>CAP</b><br>
  <i>Connect any chat platform to any AI agent — with governance, audit, and zero lock-in.</i>
</p>

<p align="center">
  <a href="https://github.com/anthropics/cap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/anthropics/cap/ci.yml?branch=main&label=tests" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
</p>

---

Your users are in Slack. Your AI agent speaks OpenAI. Tomorrow it's Teams and Claude. Next quarter it's Discord and a custom model.

**CAP is the middleware that makes this work** — one integration, every channel, every agent, full audit trail.

```bash
bun install && cd packages/server
cp .env.example .env    # add your Slack + OpenAI tokens
bun run start            # that's it — your bot is live
```

## Why CAP?

**Without CAP**, you build point-to-point: Slack webhook → your code → OpenAI → Slack API. Works fast. Then your PM asks for Teams support. Then compliance wants an audit log. Then the CEO wants to switch to Claude. Each change is a rewrite.

**With CAP**, every message flows through a canonical event chain with pluggable adapters on both sides:

```
Slack ─┐                              ┌─ OpenAI
Teams ─┤→ [Canonical Events] → [Policy + Route] →├─ Claude
Web   ─┘     ↓                        └─ Custom
          [Audit Ledger]
```

You swap channels and agents without touching business logic. Every decision is auditable. Every failure is traceable.

## What You Get

- **Plug in any chat platform** — Slack and WebChat built-in, add yours with one interface (`ChannelIngress`)
- **Plug in any AI agent** — OpenAI and generic HTTP built-in, add yours with one interface (`BackendAdapter`)
- **Governance out of the box** — keyword/regex policy engine blocks messages before they reach your agent
- **Full audit trail** — every message produces a 7-event chain in an append-only ledger, queryable via REST API
- **Streaming responses** — OpenAI SSE streams directly to Slack with progressive message updates
- **Delivery retry** — exponential backoff + dead-letter queue, no lost messages
- **Multi-turn context** — automatic conversation history replay from the ledger

## Get Started in 2 Minutes

**Option A: Slack + OpenAI** (production-ready)

```bash
git clone https://github.com/anthropics/cap && cd cap
bun install
cd packages/server
cp .env.example .env    # add SLACK_BOT_TOKEN, SLACK_APP_TOKEN, OPENAI_API_KEY
bun run start
```

**Option B: WebChat HTTP** (no tokens needed for local dev)

```bash
git clone https://github.com/anthropics/cap && cd cap
bun install && bun test --recursive    # 210 tests, ~5 seconds
```

**Option C: Docker**

```bash
docker compose up -d
```

## How It Works

Every message produces this event chain — no exceptions, no shortcuts:

```
message.received           → user's message, canonicalized
  policy.decision.made     → allow or deny (configurable rules)
  route.decision.made      → which agent handles this
  agent.invocation.requested → dispatch to backend
  agent.response.completed → agent's reply
  message.send.requested   → queued for delivery
  message.sent             → delivered to chat platform
```

If anything fails, `event.blocked` captures what went wrong and why. The ledger is your single source of truth.

## Add Your Own Adapter

**Custom channel** (e.g., Discord):

```typescript
const ingress: ChannelIngress = {
  canonicalize(raw: unknown): CanonicalizationResult {
    // validate → map to canonical event → return
  }
};
```

**Custom backend** (e.g., Anthropic):

```typescript
const backend: BackendAdapter = {
  async invoke(context: InvocationContext): Promise<InvocationResult> {
    // call your agent → map response to canonical event → return
  }
};
```

Both have conformance test suites — run `testChannelIngress()` or `testBackendAdapter()` and you'll know if your adapter is correct.

→ See the [example Discord adapter](examples/custom-channel-adapter/) for a complete walkthrough.

## Who Is This For?

| You are... | CAP helps you... |
|-----------|-----------------|
| Building a Slack bot with an LLM | Add governance, audit, and retry from day one |
| Supporting multiple chat platforms | Write adapter once, reuse the rest |
| Needing compliance / audit logs | Every decision is an immutable event |
| Evaluating different AI providers | Swap backends without changing anything else |
| Building an agent framework | Use CAP as your chat-to-agent transport layer |

## Query the Audit Ledger

```bash
# Health check
curl localhost:3000/api/health

# Full conversation audit trail
curl localhost:3000/api/conversations/{id}/audit

# Events by correlation
curl localhost:3000/api/correlations/{id}/events
```

## Documentation

| | |
|---|---|
| **[Getting Started](docs/getting-started.md)** | Slack + OpenAI setup in 5 minutes |
| **[Architecture](docs/architecture.md)** | System design with diagrams |
| **[API Reference](docs/api-reference.md)** | All HTTP endpoints |
| **[Writing Adapters](docs/rfcs/adapters/channel-adapter-interface-spec.md)** | Channel & backend interface specs |

## CLI

```bash
cap-server --help            # usage
cap-server --version         # version
cap-server --check-config    # validate config
cap-server --dry-run         # test connectivity
```

## Built With

- **[Bun](https://bun.sh)** — runtime, package manager, test runner, bundler
- **TypeScript** — strict mode everywhere
- **SQLite** — durable event ledger (via `bun:sqlite`)
- **JSON Schema** — contract validation for all events

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All adapter contributions get free conformance testing.

## Share This Project

If CAP solves your problem, tell someone:

- [Star on GitHub](https://github.com/anthropics/cap) — helps others find it
- [Share on X](https://twitter.com/intent/tweet?text=CAP%20%E2%80%94%20connect%20any%20chat%20platform%20to%20any%20AI%20agent%20with%20governance%20and%20audit.%20Open%20source.%20https%3A%2F%2Fgithub.com%2Fanthropic%2Fcap) — spread the word
- [Open an issue](https://github.com/anthropics/cap/issues) — tell us what you need

## License

[MIT](LICENSE) — use it for anything.
