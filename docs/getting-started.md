# Getting Started with Chat Agent Relay

This guide walks you through running Chat Agent Relay (CAR) with Slack and an agent backend, then shows how to connect your own agent and chat platform.

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- A Slack workspace where you can create apps
- An agent endpoint (A2A protocol)

## 1. Clone and Install

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git
cd ChatAgentRelay
bun install
```

Verify everything works:

```bash
bun test --recursive
# Expected: all tests pass (~692 tests across 51 files)
```

## 2. Environment (minimal)

CAR keeps **channels, agents, routes, and settings** in a pluggable config store (SQLite by default) — not in environment variables. The `ConfigStore` interface can be swapped for PostgreSQL or other backends.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CAR_DB_PATH` | No | `./car.db` | Path to the SQLite config + ledger database |
| `CAR_ENCRYPTION_KEY` | Recommended | — | Key for AES-256-GCM encryption of tokens and API keys at rest |
| `CAR_API_KEY` | Recommended | — | Bearer token for management API authentication |
| `CAR_API_PORT` | No | `3000` | HTTP API listen port |
| `CAR_POLICY_FILE` | No | — | Path to YAML policy configuration file |
| `CAR_OUTBOUND_POLICY_FILE` | No | — | Path to YAML outbound policy file |

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
car agent add my-bot --endpoint=https://...
car route add --default --agent=my-bot
car start
```

- **`car channel add|list|remove`** — `slack`, `discord`, `webchat`, `telegram`, `lark`, `dingtalk`, `teams`, `whatsapp`
- **`car agent add|list|remove`** — A2A only; pass `--endpoint=URL` (and optional `--timeout-ms`)
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

## 6. Microsoft Teams (Optional)

1. Register an **Azure AD** bot application (Microsoft Entra ID) for Teams and collect the application (client) ID, client secret, and tenant ID.
2. Register the channel:

```bash
car channel add my-teams --type=teams --app-id=... --app-secret=... --tenant-id=...
```

3. Set the bot **Messaging endpoint** to `https://your-domain/api/teams/messages`.

## 7. WhatsApp (Optional)

1. Set up **WhatsApp Business** via [Meta for Developers](https://developers.facebook.com/) and obtain your phone number ID, access token, webhook verify token, and app secret.
2. Register the channel:

```bash
car channel add my-whatsapp --type=whatsapp --phone-number-id=... --access-token=... --verify-token=... --app-secret=...
```

3. Set the webhook URL to `https://your-domain/api/whatsapp/webhook`.

## 8. Security Setup

- **API key:** `car config set api.key <key>` or `export CAR_API_KEY=<key>` so the management API requires a bearer token.
- **Policy file:** create a `policy.yaml` with allow/deny rules and set `CAR_POLICY_FILE` (or use `CAR_OUTBOUND_POLICY_FILE` for outbound policy).
- **Tenant isolation:** `car config set tenant.isolation true`.

## 9. Start the Server

If you did not use `car start` above:

```bash
cd packages/server
car
# or: bun run start
```

You should see structured JSON log output indicating channels, agents, and the API port.

## 10. Test It

1. Invite the Slack bot to a channel: `/invite @CAR Bot`
2. Send a message (or @mention if your route/policy requires it)
3. Confirm the agent responds

Check health and the ledger:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/conversations/<conversation_id>/events
```

## 11. Understanding the Event Chain

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

## 12. Writing a Custom Channel Adapter

A channel adapter implements the `ChannelAdapter` interface, which unifies ingress (canonicalization) and egress (sender creation) in one boundary:

```typescript
import type { CanonicalEvent, ChannelAdapter, ChannelSender } from "@chat-agent-relay/contract-harness";

interface ChannelAdapter {
  readonly channelType: string;
  describeCapabilities(): ChannelCapabilities;
  canonicalize(raw: unknown): CanonicalizationResult;
  createSender(event: CanonicalEvent): ChannelSender;
}
```

Key rules:
- `channelType` identifies the platform (e.g. `"slack"`, `"discord"`)
- `describeCapabilities()` declares what the channel supports (streaming, editing, commands, etc.)
- `canonicalize()` accepts `unknown` input, never throws — returns error results
- `createSender(event)` derives the delivery target from the event's `provider_extensions` and returns a `ChannelSender` with `send()` and optional `edit()` methods
- Produce a valid `message.received` canonical event on successful canonicalization
- Return a stable `idempotencyKey` for deduplication
- Preserve provider metadata in `provider_extensions`

See the [Channel Adapter Interface Spec](rfcs/adapters/channel-adapter-interface-spec.md) for full requirements.

Validate your adapter with the conformance suite:

```typescript
import { testChannelAdapter } from "@chat-agent-relay/adapter-conformance";

testChannelAdapter({
  name: "MyAdapter",
  adapter: myAdapter,
  expectedChannel: "my_platform",
  validInput: { /* your platform's message format */ },
  invalidInputs: [
    { label: "empty message", input: { text: "" }, expectedCode: "empty_text" },
  ],
});
```

## 13. Connecting to Agent Runtimes

Register agents with **`car agent add`** (or `POST /api/agents`) using the appropriate `type` and config:

| Type | Typical config keys |
|------|---------------------|
| `a2a` | `endpoint`, optional `headers` |

## 14. Writing a Custom Agent Adapter

New agent adapters should implement the `AgentAdapter` interface:

```typescript
import type { AgentAdapter, AgentInvocationContext, AgentResult } from "@chat-agent-relay/contract-harness";

const adapter: AgentAdapter = {
  describeCapabilities() {
    return {
      streaming: false,
      multiTurn: false,
      resume: false,
      hitl: false,
      cancel: false,
      artifacts: false,
    };
  },
  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    // call your agent runtime and map the response to a canonical event
  }
};
```

Key rules:
- `describeCapabilities()` MUST include `streaming`, `multiTurn`, `resume`, `hitl`, `cancel`, and `artifacts`; the pipeline uses `multiTurn` for ledger conversation history and `streaming` for streaming invocation paths
- Never throw from `invoke()` — return `{ ok: false, error: {...} }` on failure
- Produce a valid `agent.response.completed` event on success
- Preserve `correlation_id` and `causation_id` from the invocation event
- Set `error.retryable` accurately
- Return `sessionHandle` if your runtime supports sessions

The built-in `a2a` adapter implements `AgentAdapter` for use with the pipeline.

See the [Backend Adapter Interface Spec](rfcs/adapters/backend-adapter-interface-spec.md) for full requirements.
