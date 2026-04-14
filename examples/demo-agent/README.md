# CAR Demo Agent

A feature-showcase A2A agent that demonstrates all major Chat Agent Relay capabilities. Backed by an LLM (OpenAI, Anthropic, or Gemini).

## Features

| Feature | Trigger | Description |
|---------|---------|-------------|
| **Text Chat** | Any text | Single-turn LLM conversation |
| **Multi-turn** | Same `contextId` | Maintains conversation history across turns |
| **Streaming** | `stream <text>` | Real SSE streaming with word-by-word text deltas |
| **Commands** | `/help`, `/echo`, `/status` | Built-in command handling |
| **HITL** | `approve <action>` | Human-in-the-loop approval flow (`input-required` state) |
| **Artifacts** | `artifact` | Returns file and data artifacts |

## Architecture

```
User (Slack / Discord / WebChat / ...)
  │
  ▼
CAR Server (canonical events, governance, routing)
  │
  ▼  A2A protocol (JSON-RPC 2.0 + SSE)
  │
Demo Agent (this)
  │
  ▼  HTTP API call
  │
LLM Provider (OpenAI / Anthropic / Gemini)
```

## Quick Start

### 1. Set an LLM API key

```bash
export OPENAI_API_KEY="sk-..."
# or: export ANTHROPIC_API_KEY="sk-ant-..."
# or: export GEMINI_API_KEY="AI..."
```

| Provider | Model | Approx. cost |
|----------|-------|-------------|
| OpenAI | gpt-4o-mini | ~$0.15/1M input tokens |
| Anthropic | claude-3-5-haiku-latest | ~$0.25/1M input tokens |
| Google | gemini-2.0-flash | Free tier available |

### 2. Start the agent

```bash
cd examples/demo-agent
bun run agent.ts
```

The agent listens on `http://localhost:9100` (override with `DEMO_AGENT_PORT`).

### 3. Test directly

```bash
# Agent card
curl -s http://localhost:9100/.well-known/agent.json | jq .

# Text chat
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "m1", "role": "user",
      "parts": [{"kind": "text", "text": "Hello!"}]
    }}
  }' | jq .result.status.message.parts[0].text
```

### 4. Run with CAR (WebChat)

In a second terminal:

```bash
cd packages/server
export CAR_ENCRYPTION_KEY="any_32_char_key_for_testing_pad0"

bun run src/cli.ts channel add web --type=webchat
bun run src/cli.ts agent add demo --endpoint=http://localhost:9100
bun run src/cli.ts route add --agent=demo --default
bun run src/cli.ts start
```

Then test through the full pipeline:

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello through CAR!",
    "user_id": "test-user",
    "client_message_id": "msg_001",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq .
```

## Feature Examples

### Streaming

Request progressive text output:

```bash
curl -s -N -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/stream",
    "params": { "message": {
      "kind": "message", "messageId": "m1", "role": "user",
      "parts": [{"kind": "text", "text": "stream Tell me about TypeScript"}]
    }}
  }'
```

Output: SSE events with `status-update` (working), `message` (text deltas), `status-update` (completed).

### Commands

```bash
# /help — list all commands and triggers
# /echo Hello — echoes "Hello"
# /status — shows agent runtime info
```

### HITL (Human-in-the-Loop)

Two-step approval flow:

```bash
# Step 1: Trigger (returns input-required state)
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "m1", "role": "user",
      "parts": [{"kind": "text", "text": "approve deploy to production"}],
      "contextId": "ctx_approval"
    }}
  }' | jq .result.status.state
# Output: "input-required"

# Step 2: Confirm (same contextId)
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "2", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "m2", "role": "user",
      "parts": [{"kind": "text", "text": "yes"}],
      "contextId": "ctx_approval"
    }}
  }' | jq .result.status.message.parts[0].text
# Output: "Approved! Action "deploy to production" has been executed."
```

### Artifacts

```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "m1", "role": "user",
      "parts": [{"kind": "text", "text": "artifact"}]
    }}
  }' | jq '.result.artifacts[] | {name, partKinds: [.parts[].kind]}'
```

Output: Two artifacts — `greeting.ts` (file) and `sample-data.json` (data).

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `OPENAI_API_KEY` | — | OpenAI API key (uses gpt-4o-mini) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (uses claude-3-5-haiku-latest) |
| `GEMINI_API_KEY` | — | Google Gemini API key (uses gemini-2.0-flash) |
| `DEMO_AGENT_PORT` | 9100 | HTTP listen port |
| `DEMO_AGENT_TIMEOUT_MS` | 15000 | LLM call timeout in ms |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override OpenAI endpoint |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override Anthropic endpoint |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | Override Gemini endpoint |

## Testing

```bash
# Unit tests (agent-level, no CAR server needed)
bun test agent.test.ts

# E2E tests (full pipeline with CAR server, uses mock LLM)
bun test e2e.test.ts
```

See [TESTING.md](TESTING.md) for detailed manual testing instructions with curl examples.

## A2A Protocol

The agent implements the [A2A (Agent-to-Agent) protocol](https://github.com/google/a2a-spec):

- `GET /.well-known/agent.json` — Agent card with capabilities
- `POST` with `message/send` — Synchronous text response
- `POST` with `message/stream` — SSE streaming response
- Task states: `completed`, `input-required`, `failed`
- Artifact support via `result.artifacts` array
