**Chat Agent Relay**  
*Stop rebuilding Slack / Discord / Telegram / Teams / WhatsApp plumbing for every agent.*

---

Chat Agent Relay (CAR) is an open-source relay layer that sits between chat platforms and agents. It normalizes inbound messages into canonical events, applies governance and routing, invokes agents via [A2A](https://google.github.io/A2A/), and handles delivery, retry, replay, and audit — so you wire each agent to CAR once instead of rebuilding the message path for every platform.

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

## Best For

- Connecting one agent to multiple chat platforms without per-platform plumbing
- Adding governance, policy, and audit to the chat-to-agent message path
- Routing messages to different agents behind a unified relay layer
- Teams that need replayable, auditable delivery outcomes

## Not For

- Building the agent itself — CAR relays messages; your agent runtime is yours
- Replacing workflow tools like n8n or Zapier — CAR is infrastructure, not a visual builder
- End-user chat products — CAR is the layer underneath, not the inbox

## Use Cases

### One agent, every chat platform

Your agent works. Now Slack, Teams, Discord, and Telegram each need it. Instead of rebuilding webhook verification, auth, message formatting, and delivery logic per platform, register channel adapters with CAR and let the relay handle normalization and delivery. [Learn more →](https://ChatAgentRelay.github.io/ChatAgentRelay/use-cases/multi-channel/)

### Governed and auditable agent messaging

Compliance asks what happened to a message. Product wants to block certain content before it reaches the agent. CAR records every step as a canonical event in an append-only ledger and applies inbound and outbound policy on the message path. [Learn more →](https://ChatAgentRelay.github.io/ChatAgentRelay/use-cases/governance-audit/)

### Route chat messages to the right agent

Multiple agents serve different functions — support, ops, code review. CAR routes inbound messages to the right agent based on configurable rules, so each agent only sees what it should handle. [Learn more →](https://ChatAgentRelay.github.io/ChatAgentRelay/use-cases/multi-agent/)

## Get Started

No agent endpoint? No problem — CAR ships a demo agent that calls OpenAI/Anthropic/Google with a single API key.

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay && cd ChatAgentRelay
bun install

# Start the demo agent (Terminal 1)
cd examples/demo-agent
export OPENAI_API_KEY="sk-..."   # or ANTHROPIC_API_KEY or GEMINI_API_KEY
bun run agent.ts

# Configure and start CAR (Terminal 2)
cd packages/server
bun link
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # must stay the same across commands
car channel add web --type=webchat
car agent add demo --endpoint=http://localhost:9100
car route add --default --agent=demo
car start

# Send a message (Terminal 3)
curl -s http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello!","user_id":"me","client_message_id":"1","tenant_id":"demo","workspace_id":"default","channel_instance_id":"web"}' | jq .
```

Have your own A2A agent? Replace `--endpoint=http://localhost:9100` with your endpoint and add any channel (Slack, Discord, Telegram, Teams, WhatsApp, Lark, DingTalk).

For step-by-step setup including Slack app creation, see **[Getting Started](docs/getting-started.md)**. For production deployment, see **[Deployment Guide](docs/deployment-guide.md)**.

## How It Works

Every message flows through a canonical 7-event chain:

```text
message.received → policy.decision.made → route.decision.made
  → agent.invocation.requested → agent.response.completed
  → message.send.requested → message.sent
```

If a path is denied or fails, CAR records `event.blocked` rather than silently dropping the outcome. This canonical event model is what makes governance, replay, and audit consistent across channels and agents.

## Why Not Just...


| Approach                                | What you get                                                                    | What you miss                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Write your own bot glue code**        | Full control, no dependencies                                                   | Rebuilt per platform; no governance, audit, or retry; maintenance burden grows with each channel  |
| **Use a workflow tool** (n8n, Zapier)   | Visual builder, many integrations                                               | Not built for the agent message path; no canonical events, ledger replay, or message-level policy |
| **Use a single-platform bot framework** | Deep platform integration                                                       | Locked to one channel; adding another means starting over                                         |
| **CAR**                                 | Canonical events, governance, routing, audit, retry, replay across all channels | You need an A2A-compatible agent endpoint                                                         |


## Channels and Agent Protocol

### Built-in channels

Slack · Discord · Telegram · Lark / 飞书 · DingTalk / 钉钉 · Microsoft Teams · WhatsApp Business · WebChat

Each adapter is validated by the built-in conformance test suite.

### Agent-side boundary

CAR connects to agents through **A2A (Agent-to-Agent)** as the standard protocol boundary. The built-in A2A adapter supports streaming, multi-turn context, HITL signaling, cancellation, and artifacts when the remote agent supports them. Your agent keeps ownership of its runtime, memory, and tools.

```bash
car agent add my-bot --endpoint=https://agent.example.com
```

## Documentation


|                                                  |                                           |
| ------------------------------------------------ | ----------------------------------------- |
| **[Getting Started](docs/getting-started.md)**   | Setup and first run                       |
| **[Architecture](docs/architecture.md)**         | System design and package boundaries      |
| **[API Reference](docs/api-reference.md)**       | HTTP API surface                          |
| **[Deployment Guide](docs/deployment-guide.md)** | Production deployment and security        |
| **[RFCs](docs/rfcs/README.md)**                  | Normative architecture and layering rules |


## CLI

```bash
car channel add|list|remove     # manage chat platform connections
car agent add|list|remove       # manage agent endpoints
car route add|list|remove       # manage routing rules
car config set|get              # runtime configuration
car start                       # start the relay
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

We especially welcome:

- new channel adapters
- compatibility and conformance fixes
- bug reports tied to relay-path behavior
- production feedback on governance, delivery, replay, and audit needs

## License

[MIT](LICENSE)