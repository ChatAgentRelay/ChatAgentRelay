# Getting Started with Chat Agent Relay

This guide walks you through running Chat Agent Relay (CAR) with Slack and an agent backend, then shows how to connect your own agent and chat platform.

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- A Slack workspace where you can create apps
- An agent endpoint (for example A2A) or another supported backend type

## 1. Clone and Install

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git
cd ChatAgentRelay
bun install
```

Verify everything works:

```bash
bun test --recursive
# Expected: all tests pass (~542 tests across 43 files)
```

## 2. Environment (minimal)

CAR keeps **channels, agents, routes, and settings** in a pluggable config store (SQLite by default) — not in environment variables. The `ConfigStore` interface can be swapped for PostgreSQL or other backends.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CAR_DB_PATH` | No | `./car.db` | Path to the SQLite config + ledger database |
| `CAR_ENCRYPTION_KEY` | Recommended | — | Key for **AES-256-GCM** encryption of tokens and API keys at rest |

Generate a key for local use:

```bash
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

## 3. Set Up a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Name it (e.g., "CAR Bot") and select your workspace
3. Under **Socket Mode**, enable it and generate an **App-Level Token** with `connections:write` scope — this is your app token (starts with `xapp-`)
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write` — send messages
   - `channels:history` — read channel messages
   - `groups:history` — read private channel messages
   - `im:history` — read DM messages
   - `reactions:write` — add/remove ack reactions
5. Install the app to your workspace. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
6. Under **Event Subscriptions**, enable events and subscribe to `message.channels`, `message.groups`, `message.im`, and `app_mention`

## 4. Register Channels, Agents, and Routes (CLI)

From `packages/server`, use the `car` CLI so configuration is written to the database (encrypted where applicable):

```bash
cd packages/server
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # if not already set

car channel add my-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
car agent add my-bot --type=a2a --endpoint=http://...
car route add --default --agent=my-bot
car start
```

- **`car channel add|list|remove`** — Slack, Discord, WebChat, etc.
- **`car agent add|list|remove`** — backend types such as `a2a`, `langgraph`, `http`, `acp`
- **`car route add|list|remove`** — which agent handles traffic (default route, channel match, or pattern)
- **`car config set|get`** — arbitrary settings in the config store

Channels and agents can be **added or updated at runtime** without restarting the process (where the adapter supports it).

Equivalent operations are exposed over the HTTP API (`/api/channels`, `/api/agents`, `/api/routes`, `/api/config`) if you prefer automation or a UI.

## 5. Discord (Optional)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application and bot; copy the bot token
2. Enable **MESSAGE CONTENT INTENT** under **Bot** → **Privileged Gateway Intents**
3. Invite the bot with the permissions you need (`Send Messages`, `Add Reactions`, `Use Slash Commands`, etc.)
4. Register the channel with the CLI, for example:

```bash
car channel add my-discord --type=discord --bot-token=...
```

## 6. Start the Server

If you did not use `car start` above:

```bash
cd packages/server
car
# or: bun run start
```

You should see structured JSON log output indicating channels, agents, and the API port.

## 7. Test It

1. Invite the Slack bot to a channel: `/invite @CAR Bot`
2. Send a message (or @mention if your route/policy requires it)
3. Confirm the agent responds

Check health and the ledger:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/conversations/<conversation_id>/events
```

## 8. Understanding the Event Chain

Every message produces a seven-event chain in the ledger:

```
message.received          — user's message canonicalized from Slack
  → policy.decision.made  — governance decision (allow/deny)
  → route.decision.made   — which agent handles this (multi-agent routing)
  → agent.invocation.requested — dispatch to backend
  → agent.response.completed  — agent's reply
  → message.send.requested    — outbound delivery queued
  → message.sent              — delivered to Slack
```

If something fails, an `event.blocked` event is appended instead, recording the failure stage and reason.

## 9. Writing a Custom Channel Adapter

A channel adapter implements the `ChannelIngress` interface:

```typescript
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";

type CanonicalizationResult =
  | { ok: true; event: CanonicalEvent; idempotencyKey: string }
  | { ok: false; error: { code: string; message: string } };

interface ChannelIngress {
  canonicalize(raw: unknown): CanonicalizationResult;
}
```

Key rules:
- Accept `unknown` input, never throw — return error results
- Produce a valid `message.received` canonical event
- Return a stable `idempotencyKey` for deduplication
- Preserve provider metadata in `provider_extensions`

See the [Channel Adapter Interface Spec](rfcs/adapters/channel-adapter-interface-spec.md) for full requirements.

Validate your adapter with the conformance suite:

```typescript
import { testChannelIngress } from "@chat-agent-relay/adapter-conformance";

testChannelIngress({
  name: "MyAdapter",
  ingress: myAdapter,
  expectedChannel: "my_platform",
  validInput: { /* your platform's message format */ },
  invalidInputs: [
    { label: "empty message", input: { text: "" }, expectedCode: "empty_text" },
  ],
});
```

## 10. Connecting to Agent Runtimes

Register agents with **`car agent add`** (or `POST /api/agents`) using the appropriate `type` and config:

| Type | Typical config keys |
|------|---------------------|
| `a2a` | `endpoint`, optional `headers` |
| `langgraph` | `endpoint`, `apiKey`, assistant IDs |
| `http` | `endpoint`, headers, body/response mapping |
| `acp` | command, args, working directory |

OpenAI-style chat can be reached via the generic **`http`** adapter pointed at an OpenAI-compatible URL. Legacy `BackendAdapter` implementations are wrapped with `legacyBridge()` inside the pipeline.

## 11. Writing a Custom Agent Adapter

New agent adapters should implement the `AgentAdapter` interface:

```typescript
import type { AgentAdapter, AgentInvocationContext, AgentResult } from "@chat-agent-relay/contract-harness";

const adapter: AgentAdapter = {
  describeCapabilities() {
    return { streaming: false, hitl: false, cancel: false, artifacts: false };
  },
  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    // call your agent runtime and map the response to a canonical event
  }
};
```

Key rules:
- Never throw from `invoke()` — return `{ ok: false, error: {...} }` on failure
- Produce a valid `agent.response.completed` event on success
- Preserve `correlation_id` and `causation_id` from the invocation event
- Set `error.retryable` accurately
- Return `sessionHandle` if your runtime supports sessions

Legacy `BackendAdapter` implementations still work — wrap them with `legacyBridge()`:

```typescript
import { legacyBridge } from "@chat-agent-relay/pipeline";
const agentAdapter = legacyBridge(myBackendAdapter);
```

See the [Backend Adapter Interface Spec](rfcs/adapters/backend-adapter-interface-spec.md) for full requirements.
