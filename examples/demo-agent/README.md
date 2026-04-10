# CAR Demo Agent

A minimal [A2A](https://google.github.io/A2A/)-compatible agent that forwards messages to an LLM. Use it to try CAR without deploying your own agent.

## Supported Providers

| Provider  | Env Variable       | Model              | ~Cost        |
| --------- | ------------------ | ------------------ | ------------ |
| OpenAI    | `OPENAI_API_KEY`   | gpt-4o-mini        | ~$0.15/1M in |
| Anthropic | `ANTHROPIC_API_KEY`| claude-3-5-haiku   | ~$0.25/1M in |
| Google    | `GEMINI_API_KEY`   | gemini-2.0-flash   | Free tier    |

Set **one** of the three env vars. The agent auto-detects which provider to use.

## Quick Start

```bash
# From the repo root
cd examples/demo-agent
export OPENAI_API_KEY="sk-..."   # or ANTHROPIC_API_KEY or GEMINI_API_KEY
bun run agent.ts
```

The agent listens on `http://localhost:9100` (override with `DEMO_AGENT_PORT`).

## With CAR (end-to-end)

```bash
# Terminal 1 — start the demo agent
cd examples/demo-agent
export OPENAI_API_KEY="sk-..."
bun run agent.ts

# Terminal 2 — configure and start CAR
cd packages/server
bun link
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"
car channel add web --type=webchat
car agent add demo --endpoint=http://localhost:9100
car route add --default --agent=demo
car start

# Terminal 3 — send a test message
curl -s http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Hello!",
    "user_id": "test-user",
    "client_message_id": "msg-001",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq .
```

## API Base URL Override

For testing or proxying, override the LLM API base:

| Variable             | Default                                        |
| -------------------- | ---------------------------------------------- |
| `OPENAI_BASE_URL`    | `https://api.openai.com/v1`                    |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com`                    |
| `GEMINI_BASE_URL`    | `https://generativelanguage.googleapis.com`    |
