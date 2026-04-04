<p align="center">
  <b>Chat Agent Relay</b><br>
  <i>A standard relay layer between chat platforms and agents, with governance, routing, delivery reliability, and auditability on the message path.</i>
</p>

<p align="center">
  <a href="https://github.com/ChatAgentRelay/ChatAgentRelay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ChatAgentRelay/ChatAgentRelay/ci.yml?branch=main&label=tests" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
</p>

---

You built an agent. It works. Then one team wants it in Slack. Another wants it in Teams. Compliance asks for audit logs. Someone else asks how routing, retry, and policy are enforced. Suddenly you're not building your product anymore — you're rebuilding the same chat-to-agent plumbing over and over.

**Chat Agent Relay (CAR) provides that relay layer once, so you don't have to keep rebuilding it.**

```text
                         Chat Agent Relay
Slack       ─┐
Teams       ─┤
Discord     ─┤   [Canonical Events] → [Govern] → [Route]
Telegram    ─┤                           ↓
WhatsApp    ─┤                      [Invoke via A2A]
Lark        ─┤                           ↓
DingTalk    ─┤                    [Deliver + Retry]
Web Chat    ─┤                           ↓
More chats  ─┘                 [Replay / Audit Ledger]
```

## What CAR Is

CAR is a **standard relay layer between chat platforms and agents**.

Its core responsibilities are:
- normalize inbound chat traffic into canonical events
- apply governance on the message path
- make route decisions
- invoke agents through the standard agent-side boundary
- translate agent output into outbound delivery
- preserve replayable, auditable outcomes in an append-only ledger

CAR is not:
- an agent runtime or orchestration framework
- an agent-internal governance platform
- an inbox, CRM, or SaaS workspace product

## Why CAR

| Problem | Without CAR | With CAR |
|---|---|---|
| Add another chat platform | Rebuild webhook, auth, formatting, and delivery logic | Implement or configure a channel adapter against the same relay model |
| Connect another agent | Rework integration and routing logic | Register another agent and route to it through the same message path |
| Explain what happened to a message | Stitch together logs from multiple systems | Reconstruct the path from canonical events in the ledger |
| Enforce policy before delivery | Add custom checks in every integration | Apply inbound and outbound governance in one relay path |
| Handle delivery failure | Ad hoc retries and opaque errors | Structured delivery behavior with auditable blocked or failed outcomes |

## How It Works

CAR is centered on a canonical message path:

```text
message.received
  → policy.decision.made
  → route.decision.made
  → agent.invocation.requested
  → agent.response.completed
  → message.send.requested
  → message.sent
```

If a path is denied, blocked, or fails terminally, CAR records `event.blocked` rather than silently dropping the outcome.

This canonical event model is what makes governance, replay, and audit consistent across channels and agents.

## Agent-Side Boundary

CAR connects to agents through **A2A (Agent-to-Agent)** as the standard agent-side protocol boundary.

That means CAR stays focused on the relay path while the remote agent runtime keeps ownership of:
- its internal execution model
- its private memory or checkpoint system
- its internal tool usage and runtime-private state

Add an agent:

```bash
car agent add my-bot --endpoint=https://agent.example.com
```

The built-in A2A adapter supports capabilities such as streaming, multi-turn context, resumable interaction, HITL signaling, cancellation, and artifacts when the remote agent supports them.

## Channel-Side Boundary

On the channel side, CAR uses channel adapters to:
- receive provider-native traffic
- verify source authenticity where applicable
- canonicalize inbound messages into CAR events
- translate canonical outbound intent into provider-native delivery behavior

Built-in channels currently include:
- Slack
- Discord
- Telegram
- Lark / 飞书
- DingTalk / 钉钉
- Microsoft Teams
- WhatsApp Business
- WebChat

Need another channel? Implement the `ChannelAdapter` contract and validate it with the conformance suite.

## Get Started

**Explore the repository:**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install
bun test --recursive
```

**Run the server with a configured channel and agent:**

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install
cd packages/server
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"
car channel add my-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
car agent add my-bot --endpoint=https://agent.example.com
car route add --default --agent=my-bot
car start
```

For production, also set `CAR_API_KEY` to secure the management API. See [docs/deployment-guide.md](docs/deployment-guide.md) for deployment details.

## What You Get

### Core relay capabilities
- canonical event normalization
- inbound and outbound governance on the message path
- routing and agent invocation
- append-only ledger for replay and audit
- delivery orchestration with retry behavior
- structured blocked and failure outcomes

### Channel and agent integration capabilities
- built-in channel adapters for major chat platforms
- built-in A2A agent adapter
- multi-agent routing
- multi-turn conversation context
- streaming support where channel and agent capabilities allow it
- resumable interaction / HITL support where agent capabilities allow it

### Operational capabilities
- CLI-based configuration
- SQLite-backed default config and ledger stores
- encrypted credentials at rest with `CAR_ENCRYPTION_KEY`
- management API authentication with `CAR_API_KEY`
- conformance testing for channel and agent adapters

## Documentation

| | |
|---|---|
| **[Getting Started](docs/getting-started.md)** | Setup and first run |
| **[Architecture](docs/architecture.md)** | System design and package boundaries |
| **[API Reference](docs/api-reference.md)** | HTTP API surface |
| **[Deployment Guide](docs/deployment-guide.md)** | Production deployment and security |
| **[RFCs](docs/rfcs/README.md)** | Normative architecture and layering rules |

## CLI

```bash
car --help
car --version
car --check-config
car channel add|list|remove
car agent add|list|remove
car route add|list|remove
car config set|get
car start
```

## Current Built-In Coverage

### Channels
- Slack
- Discord
- Telegram
- Lark / 飞书
- DingTalk / 钉钉
- Microsoft Teams
- WhatsApp Business
- WebChat

### Agent protocol
- A2A

## Built With

- **[Bun](https://bun.sh)** — runtime, package manager, and test runner
- **TypeScript** — strict typing across packages
- **SQLite** — default storage for config and ledger implementations
- **JSON Schema** — canonical event and contract validation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

We especially welcome:
- new channel adapters
- compatibility and conformance fixes
- bug reports tied to relay-path behavior
- production feedback on governance, delivery, replay, and audit needs

## License

[MIT](LICENSE)
