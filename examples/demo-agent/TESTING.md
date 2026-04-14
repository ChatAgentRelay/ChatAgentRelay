# Demo Agent Manual Testing Guide

This guide walks through manually testing every feature the demo agent supports, both directly against the agent and through the full CAR pipeline.

---

## Prerequisites

1. Set one LLM API key:
   ```bash
   export OPENAI_API_KEY="sk-..."
   # or: export ANTHROPIC_API_KEY="sk-ant-..."
   # or: export GEMINI_API_KEY="AI..."
   ```

2. Start the demo agent:
   ```bash
   cd examples/demo-agent
   bun run agent.ts
   ```
   Expected output:
   ```
   Demo agent (openai) listening on http://localhost:9100
   Agent card: http://localhost:9100/.well-known/agent.json
   Features: streaming, multi-turn, HITL, commands, artifacts
   ```

3. (For pipeline tests) In another terminal, set up CAR:
   ```bash
   cd packages/server
   export CAR_ENCRYPTION_KEY="any_32_char_key_for_testing_pad0"
   bun run src/cli.ts channel add web --type=webchat
   bun run src/cli.ts agent add demo --endpoint=http://localhost:9100
   bun run src/cli.ts route add --agent=demo --default
   bun run src/cli.ts start
   ```

---

## Part A: Direct Agent Testing (Port 9100)

### A1. Agent Card

```bash
curl -s http://localhost:9100/.well-known/agent.json | jq .
```

Expected:
- `name`: "CAR Demo Agent"
- `version`: "2.0.0"
- `capabilities.streaming`: true
- `skills`: 5 entries (chat, commands, streaming, hitl, artifacts)

### A2. Text Chat (message/send)

```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "msg_001",
        "role": "user",
        "parts": [{"kind": "text", "text": "What is Chat Agent Relay?"}]
      }
    }
  }' | jq .
```

Expected:
- `result.status.state`: "completed"
- `result.status.message.parts[0].text`: Non-empty LLM response
- `result.contextId`: Present

### A3. Multi-turn Conversation

Send two messages with the same `contextId`:

```bash
# Turn 1
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "2", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_002", "role": "user",
      "parts": [{"kind": "text", "text": "My name is Alice"}],
      "contextId": "ctx_multiturn_test"
    }}
  }' | jq .result.status.message.parts[0].text
```

```bash
# Turn 2 — same contextId
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "3", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_003", "role": "user",
      "parts": [{"kind": "text", "text": "What is my name?"}],
      "contextId": "ctx_multiturn_test"
    }}
  }' | jq .result.status.message.parts[0].text
```

Expected: The second response should reference "Alice" (LLM has conversation history).

### A4. Commands

#### /help
```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "4", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_004", "role": "user",
      "parts": [{"kind": "text", "text": "/help"}]
    }}
  }' | jq .result.status.message.parts[0].text
```

Expected: Help text listing all commands and triggers.

#### /echo
```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "5", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_005", "role": "user",
      "parts": [{"kind": "text", "text": "/echo Hello World!"}]
    }}
  }' | jq .result.status.message.parts[0].text
```

Expected: "Hello World!"

#### /status
```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "6", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_006", "role": "user",
      "parts": [{"kind": "text", "text": "/status"}]
    }}
  }' | jq .result.status.message.parts[0].text
```

Expected: Agent status with provider name, port, capabilities, conversation count.

### A5. Streaming (message/stream)

```bash
curl -s -N -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": "7", "method": "message/stream",
    "params": { "message": {
      "kind": "message", "messageId": "msg_007", "role": "user",
      "parts": [{"kind": "text", "text": "stream Tell me about TypeScript"}]
    }}
  }'
```

Expected: SSE event stream containing:
1. `status-update` with state "working"
2. Multiple `message` events with `role: "agent"` and text parts (word-by-word)
3. `status-update` with state "completed" and full text
4. `[DONE]`

### A6. HITL (Human-in-the-Loop)

#### Step 1: Trigger approval
```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "8", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_008", "role": "user",
      "parts": [{"kind": "text", "text": "approve deploy to production"}],
      "contextId": "ctx_hitl_test"
    }}
  }' | jq .
```

Expected:
- `result.status.state`: "input-required"
- `result.status.message.parts[0].text`: Contains "confirm" and "deploy to production"

#### Step 2: Confirm
```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "9", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_009", "role": "user",
      "parts": [{"kind": "text", "text": "yes"}],
      "contextId": "ctx_hitl_test"
    }}
  }' | jq .result.status.message.parts[0].text
```

Expected: "Approved! Action \"deploy to production\" has been executed."

#### Step 2 (alt): Cancel
Use `"text": "no"` with the same contextId to see cancellation.

### A7. Artifacts

```bash
curl -s -X POST http://localhost:9100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "10", "method": "message/send",
    "params": { "message": {
      "kind": "message", "messageId": "msg_010", "role": "user",
      "parts": [{"kind": "text", "text": "artifact"}]
    }}
  }' | jq .
```

Expected:
- `result.status.state`: "completed"
- `result.artifacts`: Array with 2 items
  - `greeting.ts` (file part with base64 bytes)
  - `sample-data.json` (data part with JSON object)

---

## Part B: Pipeline Testing (CAR Server on Port 3000)

Requires CAR server running (see Prerequisites step 3).

### B1. Text Chat via WebChat

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello through CAR!",
    "user_id": "test-user",
    "client_message_id": "manual_001",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq .
```

Expected:
- `ok`: true
- `reply`: Non-empty agent response
- `conversation_id`: UUID string
- `correlation_id`: UUID string

### B2. Streaming via WebChat

```bash
curl -s -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Tell me about CAR",
    "user_id": "test-user",
    "client_message_id": "manual_002",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }'
```

Expected: SSE stream with progressive text deltas, ending with a `done` event containing `reply` and `conversation_id`.

### B3. Multi-turn via WebChat

```bash
# Turn 1
CONV_ID=$(curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Remember: the secret code is 42",
    "user_id": "test-user",
    "client_message_id": "manual_003a",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq -r .conversation_id)

echo "Conversation ID: $CONV_ID"

# Turn 2
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"text\": \"What is the secret code?\",
    \"user_id\": \"test-user\",
    \"client_message_id\": \"manual_003b\",
    \"tenant_id\": \"demo\",
    \"workspace_id\": \"default\",
    \"channel_instance_id\": \"web\",
    \"conversation_id\": \"$CONV_ID\"
  }" | jq .reply
```

Expected: The second reply should reference "42".

### B4. WebChat Built-in Commands

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "/help",
    "user_id": "test-user",
    "client_message_id": "manual_004",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq .
```

Expected: Help response (handled by WebChat HTTP layer, not the agent).

### B5. HITL via WebChat

```bash
# Trigger
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "approve delete all logs",
    "user_id": "test-user",
    "client_message_id": "manual_005",
    "tenant_id": "demo",
    "workspace_id": "default",
    "channel_instance_id": "web"
  }' | jq .
```

Expected: Response with `hitl_pending: true` and `session_handle` (if HITL pipeline is active).

---

## Part C: Channel-Specific Testing

### C1. Slack

1. Set up a Slack app with Socket Mode enabled
2. Add channel: `car channel add myslack --type=slack --token=xapp-... --bot-token=xoxb-...`
3. Add route: `car route add --agent=demo --default`
4. Start CAR: `car start`
5. In Slack, mention the bot or DM it:
   - Send: "Hello" -> Expect text reply
   - Send: "stream Tell me a joke" -> Expect progressive message update
   - Send: "/echo test" (if slash command configured) -> Expect "test"
   - Send: "approve restart server" -> Expect approval prompt
   - Reply "yes" -> Expect confirmation

### C2. Discord

1. Create a Discord bot with Gateway intents (MESSAGE_CONTENT, GUILDS, GUILD_MESSAGES)
2. Add channel: `car channel add mydiscord --type=discord --token=Bot_TOKEN`
3. In Discord, send messages in a channel the bot can see:
   - Text messages -> Expect replies
   - Streaming trigger -> Expect message edits (progressive update)

### C3. Telegram

1. Create a bot via @BotFather
2. Add channel: `car channel add mytelegram --type=telegram --token=BOT_TOKEN`
3. In Telegram, send messages to the bot:
   - Text -> Expect reply
   - `/help` -> Expect bot command response
   - Streaming -> Expect message edits via editMessageText

---

## Automated Tests

Run all demo-agent tests:

```bash
cd examples/demo-agent

# Unit tests (agent-level, no CAR server needed)
bun test agent.test.ts

# E2E tests (full pipeline with CAR server)
bun test e2e.test.ts
```
