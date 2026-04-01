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
Slack     ─┐                                              ┌─ Your A2A agent
Teams     ─┤                                              ├─ CrewAI / LangGraph
Discord   ─┤→ [Access Control] → [Policy] → [Route]       ├─ Google ADK
Telegram  ─┤      ↓                ↓          ↓           ├─ AutoGen / Mastra
WhatsApp  ─┤  [Rate Limit]   [Outbound Gov]  [Invoke] ───→└─ Any A2A-compatible
Lark      ─┤                                                  agent runtime
DingTalk  ─┤
WebChat   ─┘  [7-Event Audit Ledger]
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
| Agent call fails | Hope your try/catch was good enough | Automatic retry with exponential backoff, structured error events |
| "What happened to that message?" | Dig through scattered logs | `curl localhost:3000/api/conversations/{id}/audit` |

## Get Started in 2 Minutes

**Slack + your agent:**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install
cd packages/server
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # encrypts tokens and API keys at rest
car channel add my-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
car agent add my-bot --endpoint=https://agent.example.com
car route add --default --agent=my-bot
car start
```

For production, also set `CAR_API_KEY` (secures the management API) and optionally `CAR_DB_PATH` (defaults to `./car.db`). See the [Deployment Guide](docs/deployment-guide.md) for the full checklist.

**Just explore (no tokens needed):**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install && bun test --recursive    # ~692 tests across 51 files
```

## How It Works

Every message produces an immutable event chain — no exceptions, no hidden state:

```
message.received             → user's message, canonicalized from any platform
  policy.decision.made       → allow or deny (configurable rules)
  route.decision.made        → which agent handles this
  agent.invocation.requested → dispatch to your agent
  agent.response.completed   → agent's reply captured
  message.send.requested     → queued for delivery with retry
  message.sent               → delivered to user's chat platform
```

If anything fails, `event.blocked` records what went wrong, at which stage, and why. The ledger is your single source of truth.

## Connect Your Agent

CAR connects to agents via the **A2A (Agent-to-Agent) protocol** — the open standard supported by 150+ organizations including Google, Salesforce, SAP, and all major agent frameworks (CrewAI, LangGraph, Google ADK, AutoGen, Mastra, etc.).

Your agent stays independent. CAR calls it over HTTP. No SDK, no lock-in, no subprocess management.

```bash
car agent add my-bot --endpoint=https://agent.example.com
```

The built-in `A2AAgentAdapter` supports streaming, multi-turn context, HITL (`input-required` relay), artifacts, cancel, and session management — all through the standard A2A protocol.

For non-standard agents, implement the `AgentAdapter` interface and validate with `testAgentAdapter()` from the conformance suite.

## Connect Your Chat Platform

8 chat platforms are built-in. Need another? Implement one interface (`ChannelAdapter`), run `testChannelAdapter()` to validate, and register it.

| Channel | Streaming | Webhook Verification |
|---------|-----------|---------------------|
| Slack | Progressive update | HMAC signing secret |
| Microsoft Teams | Activity update | JWT (Azure AD) |
| Discord | Progressive update | Gateway (built-in) |
| Telegram | Edit message | Secret token header |
| WhatsApp Business | — | HMAC-SHA256 |
| Lark / 飞书 | Edit message | Encrypt key |
| DingTalk / 钉钉 | — | HMAC-SHA256 |
| WebChat | SSE native | — |

See `packages/channel-discord` for a full adapter example.

## What You Get Out of the Box

**Security & Governance**
- **API authentication** — Bearer token for the management API (`CAR_API_KEY`)
- **Inbound policy** — structured conditions (sender, channel, time window, content length, keyword, regex), mandatory deny rules, and/or/not composition
- **Outbound policy** — content filtering on agent responses before delivery (defense-in-depth)
- **Access control** — sender allowlist/blocklist
- **Rate limiting** — sliding window per sender, conversation, or tenant
- **Webhook verification** — per-channel signature validation (Slack HMAC, Teams JWT, Telegram secret, WhatsApp HMAC-SHA256, Lark encrypt key, DingTalk HMAC)
- **Tenant isolation** — `X-Tenant-ID` header scopes ledger queries when enabled
- **Encrypted credentials** — AES-256-GCM for tokens and API keys at rest

**Core Platform**
- **Full audit trail** — every message is a 7-event chain in an append-only ledger, queryable via REST
- **Streaming** — progressive chat updates (Slack, Teams, Discord, Telegram, Lark) and SSE (WebChat)
- **HITL relay** — agent returns `input-required` → CAR delivers prompt to user → user replies → CAR resumes agent
- **Delivery retry** — exponential backoff with structured error events
- **Multi-turn context** — conversation history from the ledger
- **Multi-agent routing** — register several agents; route rules decide which handles each message (hot-pluggable)
- **Idempotency** — per-channel deduplication with configurable TTL
- **Config hot-reload** — policy and route changes take effect without restart

**Developer Experience**
- **CLI-first configuration** — `car channel|agent|route|config` commands; no wall of env vars
- **YAML policy files** — declarative, version-controlled governance rules
- **Conformance testing** — validate any adapter with `testChannelAdapter()` or `testAgentAdapter()`
- **Slash commands** — native handling for Slack and Discord

## Roadmap

**Chat platforms (8/8 built-in):**
- [x] Slack (Socket Mode + streaming)
- [x] Microsoft Teams (Bot Connector + JWT verification)
- [x] Discord (Gateway + slash commands)
- [x] Telegram (Bot API + webhook verification)
- [x] WhatsApp Business (Cloud API + 24h session tracking)
- [x] Lark / 飞书 (Event Subscription + streaming)
- [x] DingTalk / 钉钉 (Robot callback)
- [x] WebChat (HTTP + SSE streaming)

**Agent protocol:**
- [x] A2A protocol (covers CrewAI, LangGraph, Google ADK, AutoGen, Mastra, and all A2A-compatible agents)
- [x] Multi-agent routing with hot-pluggable rules

**Governance & Security:**
- [x] Inbound policy (structured conditions, mandatory deny)
- [x] Outbound policy (pre-send content filtering)
- [x] API authentication (Bearer token)
- [x] Webhook signature verification (all channels)
- [x] Rate limiting and access control
- [x] Tenant isolation
- [x] YAML policy configuration with hot-reload
- [x] Encrypted credentials (AES-256-GCM)

**Coming next:**
- [ ] Rich message unified abstraction (cards, buttons across channels)
- [ ] Dead letter queue for failed deliveries
- [ ] Audit retention policy (TTL / archive)
- [ ] Cross-channel identity resolution
- [ ] Admin UI
- [ ] Usage metering

**Tell us what matters to you.** [Open an issue](https://github.com/ChatAgentRelay/ChatAgentRelay/issues) or [start a discussion](https://github.com/ChatAgentRelay/ChatAgentRelay/discussions) — your use case shapes the roadmap.

## Documentation

| | |
|---|---|
| **[Getting Started](docs/getting-started.md)** | Setup in 5 minutes |
| **[Architecture](docs/architecture.md)** | System design with diagrams |
| **[API Reference](docs/api-reference.md)** | All HTTP endpoints |
| **[Deployment Guide](docs/deployment-guide.md)** | Production deployment, security, nginx |
| **[Writing Adapters](docs/rfcs/adapters/channel-adapter-interface-spec.md)** | Channel & agent adapter interface specs |

## CLI

```bash
car --help                   # usage (also: car channel|agent|route|config subcommands)
car --version                # version
car --check-config           # open config DB and print summary
car channel add|list|remove  # manage chat channels (Slack, Teams, Discord, Telegram, WhatsApp, Lark, DingTalk, WebChat)
car agent add|list|remove    # register A2A agent backends
car route add|list|remove    # routing rules (default, channel match, pattern)
car config set|get           # arbitrary settings key/value store
car start                    # run the relay (same entry as `car` with no subcommand, per install)
```

## Built With

- **[Bun](https://bun.sh)** — runtime, package manager, test runner, bundler
- **TypeScript** — strict mode everywhere
- **SQLite** — default storage for event ledger (`LedgerStore`) and configuration (`ConfigStore`); both interfaces are pluggable
- **JSON Schema** — contract validation for all events

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All adapter contributions get free conformance testing.

We especially welcome:
- **New channel adapters** — connect the chat platforms your team actually uses
- **Bug reports and use cases** — tell us how you're using CAR and what's missing

## License

[MIT](LICENSE) — use it for anything.
