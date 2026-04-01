# Chat Agent Relay HTTP API reference

This document describes the HTTP API exposed by **`startApiServer`** in `packages/server/src/api.ts` (the default when you run `car start`). A single Bun `serve` listener provides:

| Area | Role |
|------|------|
| **Management** | CRUD for agents, channels, route rules, and config settings |
| **Ledger / audit** | Read-only queries over stored canonical events |
| **Webhooks** | Inbound HTTP for Slack, Teams, Telegram, Lark, DingTalk, and WhatsApp |
| **WebChat** | Browser-oriented chat (`POST /api/chat`, streaming, resume, session lookup), CORS |

The `packages/channel-web-chat` package still exports **`startWebChatServer`** for standalone or test use; behavior mirrors the WebChat routes documented here.

---

## Authentication

When `CAR_API_KEY` or the `api.key` config setting is set, every endpoint **except** those listed below as excluded requires a Bearer token:

```
Authorization: Bearer <your-api-key>
```

**Excluded from auth:**
- `GET /api/health` — always public
- `OPTIONS /api/chat*` — CORS preflight always public
- `/api/chat*` — configurable via `api.chat.public` setting (default: public)

When no API key is configured, all endpoints are open (backward compatible).

---

## Tenant Isolation

When the `tenant.isolation` config setting is `"true"`, ledger query endpoints respect the `X-Tenant-ID` request header. Events are filtered by `tenant_id` so that each tenant only sees their own data.

| Header | Required | Description |
|--------|----------|-------------|
| `X-Tenant-ID` | No | When present and tenant isolation is enabled, scopes all ledger queries to this tenant |

Affected endpoints: `/api/conversations/*/events`, `/api/correlations/*/events`, `/api/events/*`, `/api/conversations/*/audit`.

When the header is absent, queries return all events (unscoped). When tenant isolation is disabled (default), the header is ignored.

---

## Error response formats

### Management and ledger APIs (`packages/server`)

Errors use JSON with a single string field:

```json
{ "error": "<human-readable message>" }
```

Used for **4xx/5xx** JSON errors (unknown route, missing resources, validation failures, **401 Unauthorized** when an API key is configured but the `Authorization` header is missing or wrong, and similar).

### WebChat (`/api/chat*`)

When using **`startApiServer`**, most failures return the same `{ "error": "<message>" }` shape as the management API (including invalid JSON, missing WebChat setup, and pipeline errors).

The standalone **`startWebChatServer`** helper in `packages/channel-web-chat` uses the `WebChatResponse` shape with `ok: false` for many client errors:

```json
{
  "ok": false,
  "error": "<message>"
}
```

Successful JSON responses set `ok: true` and include `conversation_id`, `correlation_id`, `reply`, and when applicable `session_handle`, `hitl_pending`, and `hitl_prompt`.

---

## Endpoint summary

| Method | Path | Area | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | Management | Deep health: ledger status, event count, backend, uptime |
| `GET` | `/api/agents` | Management | List registered agents |
| `POST` | `/api/agents` | Management | Create an agent |
| `PUT` | `/api/agents/:name` | Management | Update agent config / enabled flag |
| `DELETE` | `/api/agents/:name` | Management | Remove an agent |
| `POST` | `/api/agents/:name/enable` | Management | Enable an agent |
| `POST` | `/api/agents/:name/disable` | Management | Disable an agent |
| `GET` | `/api/channels` | Management | List channel connections |
| `POST` | `/api/channels` | Management | Register a channel |
| `PUT` | `/api/channels/:name` | Management | Update channel config / enabled flag |
| `DELETE` | `/api/channels/:name` | Management | Remove a channel |
| `POST` | `/api/channels/:name/enable` | Management | Enable a channel |
| `POST` | `/api/channels/:name/disable` | Management | Disable a channel |
| `GET` | `/api/routes` | Management | List routing rules |
| `POST` | `/api/routes` | Management | Add a routing rule |
| `DELETE` | `/api/routes/:id` | Management | Remove a routing rule by numeric id |
| `POST` | `/api/routes/:id/enable` | Management | Enable a route |
| `POST` | `/api/routes/:id/disable` | Management | Disable a route |
| `GET` | `/api/config` | Management | List config key/value settings |
| `PUT` | `/api/config/:key` | Management | Set a config value |
| `DELETE` | `/api/config/:key` | Management | Delete a config key |
| `GET` | `/api/conversations/:id/events` | Ledger | List canonical events for a conversation |
| `GET` | `/api/conversations/:id/audit` | Ledger | Per-turn audit summary derived from ledger events |
| `GET` | `/api/correlations/:id/events` | Ledger | List canonical events for a correlation ID |
| `GET` | `/api/events/:id` | Ledger | Fetch one stored event by `event_id` |
| `POST` | `/api/slack/events` | Webhook | Slack Events API |
| `POST` | `/api/slack/commands` | Webhook | Slack slash commands (form-encoded or JSON) |
| `POST` | `/api/teams/messages` | Webhook | Microsoft Teams activity |
| `POST` | `/api/telegram/webhook` | Webhook | Telegram Bot API updates |
| `POST` | `/api/lark/webhook` | Webhook | Lark/Feishu events |
| `POST` | `/api/dingtalk/webhook` | Webhook | DingTalk chatbot callbacks |
| `GET` | `/api/whatsapp/webhook` | Webhook | WhatsApp Cloud API verification (`hub.*` query params) |
| `POST` | `/api/whatsapp/webhook` | Webhook | WhatsApp Cloud API notifications |
| `POST` | `/api/chat` | WebChat | Submit a web chat message; runs ingress + pipeline |
| `POST` | `/api/chat/stream` | WebChat | Same as `/api/chat` with SSE token stream |
| `POST` | `/api/chat/resume` | WebChat | Continue after HITL with `session_handle` + `text` |
| `POST` | `/api/chat/resume/stream` | WebChat | Resume with SSE |
| `GET` | `/api/chat/sessions/:id` | WebChat | Look up session handle by `conversation_id` |
| `OPTIONS` | `/api/chat*` | WebChat | CORS preflight for WebChat paths |

---

## Ledger API

Base URL is whatever host/port you pass to `startApiServer` (e.g. `http://localhost:<port>`). All successful JSON responses set `Content-Type: application/json`.

### GET `/api/health`

Deep health check. Delegates to `ledgerStore.healthCheck()`.

**Response (200)** — ledger is healthy:

```json
{
  "status": "ok",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "ledger": {
    "healthy": true,
    "event_count": 42,
    "backend": "in-memory"
  },
  "uptime_seconds": 3600
}
```

`ledger.backend` is implementation-specific (e.g. `"in-memory"` or `"sqlite"`). When the SQLite store’s health check fails, `ledger` may include an `error` string.

**Response (503)** — ledger unhealthy (`ledger.healthy === false`):

```json
{
  "status": "degraded",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "ledger": {
    "healthy": false,
    "event_count": 0,
    "backend": "sqlite",
    "error": "<driver or query error message>"
  },
  "uptime_seconds": 3600
}
```

---

### GET `/api/conversations/:id/events`

Returns every stored event for the given `conversation_id`, ordered by the ledger store (append / query order as implemented).

**Parameters**

- `id` (path) — conversation identifier (URL segment, not encoded twice).

**Response (200)** — always returned; `events` may be empty:

```json
{
  "conversation_id": "conv_abc",
  "events": [],
  "count": 0
}
```

Each element of `events` is a **stored canonical event** (see [Stored event shape](#stored-event-shape)).

---

### GET `/api/conversations/:id/audit`

Builds a human-oriented audit view by grouping ledger events by `correlation_id` and extracting fields from known `event_type` values (`message.received`, `policy.decision.made`, `route.decision.made`, `agent.response.completed`, `event.blocked`).

**Response (200)**:

```json
{
  "conversation_id": "conv_abc",
  "total_events": 8,
  "turns": [
    {
      "correlation_id": "corr_xyz",
      "user_message": "Hello",
      "policy_decision": "allow",
      "route": "default",
      "agent_response": "Hi there!",
      "blocked": false,
      "events": []
    }
  ]
}
```

- `turns[].events` — full `StoredCanonicalEvent[]` for that correlation (non-empty in real data; shown empty in the skeleton above).
- If a turn was blocked, `blocked` is `true` and `block_reason` / `block_stage` are present when available on the `event.blocked` payload.

**Response (404)** — no events for that conversation:

```json
{ "error": "No events found for conversation" }
```

---

### GET `/api/correlations/:id/events`

Returns all stored events sharing the given `correlation_id`.

**Response (200)**:

```json
{
  "correlation_id": "corr_xyz",
  "events": [],
  "count": 0
}
```

---

### GET `/api/events/:id`

Returns a single event by `event_id` (`id` path segment).

**Response (200)** — the full stored event object (JSON object, not wrapped).

**Response (404)**:

```json
{ "error": "Event not found" }
```

---

### Ledger API — unknown routes

**Response (404)**:

```json
{ "error": "Not found" }
```

---

## Management API

Same base URL as the ledger API. Sensitive fields in agent and channel configs are **masked** in JSON responses (see `SENSITIVE_FIELDS` in `packages/config-store`).

### Agents

**`GET /api/agents`** — list agents (masked config).

```json
[
  {
    "name": "my-agent",
    "type": "a2a",
    "config": { "endpoint": "http://localhost:9000" },
    "enabled": true,
    "created_at": "2026-04-01T12:00:00.000Z",
    "updated_at": "2026-04-01T12:00:00.000Z"
  }
]
```

**`POST /api/agents`** — create (201 on success).

```json
{
  "name": "my-agent",
  "type": "a2a",
  "config": { "endpoint": "http://localhost:9000" }
}
```

**`PUT /api/agents/:name`** — body may include `config` and/or `enabled`.

**`DELETE /api/agents/:name`** — `{ "ok": true }`.

**`POST /api/agents/:name/enable`** / **`disable`** — returns updated agent record.

### Channels

**`GET /api/channels`** — list channels (masked config).

**`POST /api/channels`** — create (201). `type` must be one of: `slack`, `discord`, `webchat`, `telegram`, `lark`, `dingtalk`, `teams`, `whatsapp`.

```json
{
  "name": "slack-main",
  "type": "slack",
  "config": { "botToken": "xoxb-...", "appToken": "xapp-..." }
}
```

**`PUT /api/channels/:name`** — `config` and/or `enabled`. **`DELETE`**, **`enable`**, **`disable`** — same pattern as agents.

### Routes

**`GET /api/routes`** — list route rules.

```json
[
  {
    "id": 1,
    "priority": 0,
    "match_type": "default",
    "match_value": null,
    "agent_name": "my-agent",
    "enabled": true,
    "created_at": "2026-04-01T12:00:00.000Z"
  }
]
```

**`POST /api/routes`** — create (201). `match_type` is `channel`, `pattern`, or `default`; `match_value` may be null (e.g. for `default`).

```json
{
  "match_type": "pattern",
  "match_value": "^#support",
  "agent_name": "my-agent",
  "priority": 10
}
```

**`DELETE /api/routes/:id`**, **`POST /api/routes/:id/enable`**, **`POST /api/routes/:id/disable`** — numeric `id`.

### Config

**`GET /api/config`** — all settings.

```json
[
  { "key": "some.key", "value": "some-value", "updated_at": "2026-04-01T12:00:00.000Z" }
]
```

**`PUT /api/config/:key`**:

```json
{ "value": "new-value" }
```

Response: `{ "key": "...", "value": "..." }`. **`DELETE /api/config/:key`** — `{ "ok": true }` or 404.

---

## Webhook Endpoints

Inbound URLs are fixed paths on the same server. Each handler resolves the corresponding channel type from the registry; if no enabled channel of that type exists, the server returns **404**. When the channel config includes signing secrets (or equivalent), requests are verified; failed verification returns **401** with `{ "error": "Unauthorized webhook request" }`.

| Channel | Method | Path | Notes |
|---------|--------|------|--------|
| Slack | `POST` | `/api/slack/events` | JSON body; optional `SlackWebhookVerifier` when `signingSecret` is set |
| Slack | `POST` | `/api/slack/commands` | `application/x-www-form-urlencoded` or JSON |
| Teams | `POST` | `/api/teams/messages` | JSON; `TeamsWebhookVerifier` when `appId` is configured |
| Telegram | `POST` | `/api/telegram/webhook` | JSON; `X-Telegram-Bot-Api-Secret-Token` when `secretToken` is set |
| Lark | `POST` | `/api/lark/webhook` | JSON; verifier when `encryptKey` is set |
| DingTalk | `POST` | `/api/dingtalk/webhook` | JSON; verifier when `secret` is set |
| WhatsApp | `GET` | `/api/whatsapp/webhook` | Meta verification: `hub.mode`, `hub.verify_token`, `hub.challenge` |
| WhatsApp | `POST` | `/api/whatsapp/webhook` | JSON; signature verification when `appSecret` is set |

Successful handling returns `{ "ok": true }` (except WhatsApp GET verification, which returns the challenge string as plain text).

**Discord** does not use these HTTP webhooks in the default stack (Gateway / Socket Mode). **WebChat** uses `/api/chat*` as documented below.

---

## WebChat HTTP transport

Served by `startApiServer` when WebChat pipeline hooks are configured (`runWebChatPipeline` / `resumeWebChat`). JSON responses include CORS headers:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, GET, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

SSE endpoints (`/api/chat/stream`, `/api/chat/resume/stream`) use `Content-Type: text/event-stream` with the same CORS headers.

### POST `/api/chat`

Accepts a JSON body, validates required fields, canonicalizes to a `message.received` event via `WebChatIngress`, then invokes the configured **`runWebChatPipeline`** hook. Built-in text commands (`/help`, `/status`, `/clear`) short-circuit without running the pipeline.

**Request headers**

- `Content-Type: application/json` (recommended; body is parsed as JSON).

**Body — required fields**

| Field | Type | Constraints |
|-------|------|-------------|
| `client_message_id` | string | Non-empty |
| `text` | string | Non-empty; max length 32,000 characters |
| `user_id` | string | Non-empty |
| `tenant_id` | string | Non-empty |
| `workspace_id` | string | Non-empty |
| `channel_instance_id` | string | Non-empty |

**Body — optional fields**

| Field | Type |
|-------|------|
| `display_name` | string (non-empty if present) |
| `conversation_id` | string (non-empty if present; otherwise server generates one) |
| `session_id` | string (non-empty if present; otherwise server generates one) |
| `trace_id` | string (non-empty if present) |
| `span_id` | string (non-empty if present) |
| `parent_span_id` | string (non-empty if present) |

**Example request**

```json
{
  "client_message_id": "msg_001",
  "text": "Hello, world!",
  "user_id": "user_1",
  "display_name": "Test User",
  "tenant_id": "t1",
  "workspace_id": "ws1",
  "channel_instance_id": "web_ch_1"
}
```

**Response (200)** — pipeline succeeded:

```json
{
  "ok": true,
  "conversation_id": "conv_123",
  "correlation_id": "corr_456",
  "reply": "Hello from the agent!",
  "session_handle": "sess_abc",
  "hitl_pending": false,
  "hitl_prompt": null
}
```

`session_handle` / HITL fields appear when the agent adapter uses interactive flows.

**Response (400)** — invalid JSON (`startApiServer`):

```json
{ "error": "Invalid JSON body" }
```

**Response (404)** — no enabled `webchat` channel: `{ "error": "No enabled webchat channel" }`.

**Response (501)** — WebChat pipeline not wired: `{ "error": "WebChat not configured" }`.

**Response (500)** — pipeline error: `{ "error": "<message>" }`.

Validation failures after a successful JSON parse may use `{ "error": "..." }` (unified server) or `{ "ok": false, "error": "..." }` (standalone `startWebChatServer`), depending on which entrypoint you use.

---

### POST `/api/chat/stream`

Same request body and validation as **`POST /api/chat`**. Returns **SSE** (`text/event-stream`): `data: {...}\n\n` lines with streaming deltas, then a final `type: "done"` event including `conversation_id`, `correlation_id`, `reply`, `session_handle`, and `hitl_pending`. Errors send `type: "error"` with a `message` field before the stream closes.

---

### POST `/api/chat/resume` and POST `/api/chat/resume/stream`

Resume after HITL when **`resumeWebChat`** is configured.

**Body (JSON):**

| Field | Required | Description |
|-------|----------|-------------|
| `session_handle` | Yes | Handle returned from a prior chat response |
| `text` | Yes | User input to continue the session |

**`POST /api/chat/resume`** — JSON success shape matches **`POST /api/chat`** (without `hitl_prompt` unless returned by the adapter). **`POST /api/chat/resume/stream`** — SSE, analogous to `/api/chat/stream`.

**Response (501)** — `{ "error": "Resume not configured" }` when the resume hook is missing.

---

### GET `/api/chat/sessions/:id`

`:id` is the **`conversation_id`** (URL-encoded as needed). Returns session metadata from the in-memory WebChat session store:

```json
{
  "ok": true,
  "conversation_id": "conv_123",
  "session_handle": "sess_abc",
  "last_active": "2026-04-01T12:00:00.000Z"
}
```

**Response (404)** — `{ "error": "Session not found" }`.

---

### OPTIONS `/api/chat*` (CORS preflight)

Any **`OPTIONS`** request whose path starts with **`/api/chat`** receives **204 No Content** with CORS headers and an empty body.

---

### WebChat — unknown methods / paths

**`startApiServer`** returns **404** with `{ "error": "Not found" }`. Standalone **`startWebChatServer`** returns `{ "ok": false, "error": "Not found" }`.

---

## Stored event shape

Events returned from the ledger API are **`StoredCanonicalEvent`**: the contract harness **`CanonicalEvent`** envelope plus normalized storage fields. Typical fields include:

- `event_id`, `schema_version`, `event_type`, `tenant_id`, `workspace_id`, `channel`, `conversation_id`, `session_id`, `correlation_id`, `occurred_at`, `actor_type`, `payload`
- Optional: `causation_id`, `channel_instance_id`, `provider_extensions`, `trace_context`, and others as produced by the pipeline

`payload` and `provider_extensions` are typed as generic objects in storage; exact keys depend on `event_type` and the producing component. Refer to the contract harness schemas and RFCs for normative event definitions.
