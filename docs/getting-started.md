# Getting Started with Chat Agent Relay

This guide walks you through running Chat Agent Relay (CAR) with Slack and an agent backend, then shows how to connect your own agent and chat platform.

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- A Slack workspace where you can create apps
- An OpenAI API key (or any OpenAI-compatible endpoint)

## 1. Clone and Install

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git
cd ChatAgentRelay
bun install
```

Verify everything works:

```bash
bun test --recursive
# Expected: 222 pass, 0 fail
```

## 2. Set Up a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Name it (e.g., "CAR Bot") and select your workspace
3. Under **Socket Mode**, enable it and generate an **App-Level Token** with `connections:write` scope — this is your `SLACK_APP_TOKEN` (starts with `xapp-`)
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write` — send messages
   - `channels:history` — read channel messages
   - `groups:history` — read private channel messages
   - `im:history` — read DM messages
5. Install the app to your workspace. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`)
6. Under **Event Subscriptions**, enable events and subscribe to `message.channels`, `message.groups`, `message.im`

## 3. Configure Environment

```bash
cd packages/server
cp .env.example .env
```

Edit `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4o-mini

# Optional: use any OpenAI-compatible endpoint
# OPENAI_BASE_URL=http://localhost:8317

# Optional: customize behavior
# OPENAI_SYSTEM_PROMPT=You are a helpful assistant.
# CAR_STREAMING=true
# CAR_API_PORT=3000
```

## 4. Start the Server

```bash
bun run start
```

You should see structured JSON log output:

```json
{"ts":"...","level":"info","msg":"Starting server","tenant_id":"default_tenant",...}
{"ts":"...","level":"info","msg":"API server started","port":3000}
{"ts":"...","level":"info","msg":"Connected, listening for messages"}
```

## 5. Test It

1. Invite the bot to a Slack channel: `/invite @CAR Bot`
2. Send a message in that channel
3. The bot should respond via OpenAI

Check the event ledger:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","timestamp":"..."}

# After sending a message, find conversations:
curl http://localhost:3000/api/conversations/<conversation_id>/events
```

## 6. Understanding the Event Chain

Every message produces a seven-event chain in the ledger:

```
message.received          — user's message canonicalized from Slack
  → policy.decision.made  — governance decision (allow/deny)
  → route.decision.made   — backend selection
  → agent.invocation.requested — dispatch to backend
  → agent.response.completed  — agent's reply
  → message.send.requested    — outbound delivery queued
  → message.sent              — delivered to Slack
```

If something fails, an `event.blocked` event is appended instead, recording the failure stage and reason.

## 7. Writing a Custom Channel Adapter

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

## 8. Writing a Custom Backend Adapter

A backend adapter implements the `BackendAdapter` interface:

```typescript
import type { InvocationContext, InvocationResult } from "@chat-agent-relay/backend-http";

interface BackendAdapter {
  invoke(context: InvocationContext): Promise<InvocationResult>;
  invokeStreaming?(context: InvocationContext): AsyncGenerator<string, InvocationResult>;
}
```

Key rules:
- Never throw from `invoke()` — return `{ ok: false, error: {...} }` on failure
- Produce a valid `agent.response.completed` event on success
- Preserve `correlation_id` and `causation_id` from the invocation event
- Set `error.retryable` accurately

See the [Backend Adapter Interface Spec](rfcs/adapters/backend-adapter-interface-spec.md) for full requirements.

## 9. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | — | Slack Bot User OAuth Token |
| `SLACK_APP_TOKEN` | Yes | — | Slack App-Level Token (Socket Mode) |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model name |
| `OPENAI_SYSTEM_PROMPT` | No | `You are a helpful assistant.` | System prompt |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Custom OpenAI-compatible endpoint |
| `CAR_TENANT_ID` | No | `default_tenant` | Tenant identifier |
| `CAR_WORKSPACE_ID` | No | `default_workspace` | Workspace identifier |
| `CAR_ROUTE_ID` | No | `openai_agent` | Route identifier |
| `CAR_SQLITE_PATH` | No | `./car-ledger.db` | SQLite database path |
| `CAR_STREAMING` | No | `true` | Enable streaming responses |
| `CAR_STREAMING_INTERVAL_MS` | No | `800` | Streaming update interval |
| `CAR_API_PORT` | No | `3000` | HTTP API port |
