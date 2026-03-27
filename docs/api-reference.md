# Chat Agent Relay HTTP API reference

This document describes the HTTP surfaces implemented in the Chat Agent Relay (CAR) codebase. There are **two** Bun `serve` handlers with overlapping path names but different purposes:

| Surface | Package / entry | Role |
|--------|------------------|------|
| **Ledger API** | `packages/server` → `startApiServer` in `packages/server/src/api.ts` | Read-only ledger queries, deep health tied to `LedgerStore` |
| **WebChat transport** | `packages/channel-web-chat` → `startWebChatServer` in `packages/channel-web-chat/src/http-transport.ts` | Browser-oriented chat ingress (`POST /api/chat`), CORS, liveness |

If both are run, they must use **different ports**. Path collisions (`/api/health`) are intentional only in name; behavior differs as documented below.

---

## Authentication

Neither surface implements authentication, API keys, or session cookies. All described routes are **unauthenticated**. Treat deployments as **trusted-network or private** unless you add a reverse proxy or gateway with auth.

---

## Error response formats

### Ledger API (`packages/server`)

Errors use JSON with a single string field:

```json
{ "error": "<human-readable message>" }
```

Used for **404** responses (unknown route, missing event, empty conversation for audit) with appropriate HTTP status codes.

### WebChat HTTP transport

Client-facing errors use the `WebChatResponse` shape with `ok: false`:

```json
{
  "ok": false,
  "error": "<message>"
}
```

Success responses set `ok: true` and include `conversation_id`, `correlation_id`, and `reply` when the pipeline completes.

---

## Endpoint summary

| Method | Path | Server | Description |
|--------|------|--------|-------------|
| `GET` | `/api/health` | Ledger API | Deep health: ledger status, event count, backend, uptime |
| `GET` | `/api/conversations/:id/events` | Ledger API | List canonical events for a conversation |
| `GET` | `/api/conversations/:id/audit` | Ledger API | Per-turn audit summary derived from ledger events |
| `GET` | `/api/correlations/:id/events` | Ledger API | List canonical events for a correlation ID |
| `GET` | `/api/events/:id` | Ledger API | Fetch one stored event by `event_id` |
| `GET` | `/api/health` | WebChat | Simple liveness: `{ "status": "ok" }` |
| `POST` | `/api/chat` | WebChat | Submit a web chat message; runs ingress + pipeline |
| `OPTIONS` | `/api/chat` (or any path) | WebChat | CORS preflight; handler matches any `OPTIONS` request |

---

## Ledger API

Base URL is whatever host/port you pass to `startApiServer` (e.g. `http://localhost:<port>`). All successful JSON responses set `Content-Type: application/json`.

### GET `/api/health`

Deep health check. Delegates to `ledgerStore.healthCheck()`.

**Response (200)** — ledger is healthy:

```json
{
  "status": "ok",
  "timestamp": "2025-03-25T12:00:00.000Z",
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
  "timestamp": "2025-03-25T12:00:00.000Z",
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

## WebChat HTTP transport

Base URL is the host/port passed to `startWebChatServer`. Responses include CORS headers on the JSON responses:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

### GET `/api/health`

Lightweight liveness for load balancers or browsers.

**Response (200)**:

```json
{ "status": "ok" }
```

---

### POST `/api/chat`

Accepts a JSON body, validates required fields, canonicalizes to a `message.received` event via `WebChatIngress`, then invokes the configured `pipelineFn`.

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
  "reply": "Hello from the agent!"
}
```

**Response (400)** — invalid JSON:

```json
{
  "ok": false,
  "error": "Invalid JSON body"
}
```

**Response (400)** — validation or contract failure after JSON parse (message text varies):

```json
{
  "ok": false,
  "error": "client_message_id is required and must be a non-empty string"
}
```

**Response (500)** — uncaught error in `pipelineFn`:

```json
{
  "ok": false,
  "error": "<Error.message or \"Pipeline failed\">"
}
```

---

### OPTIONS `/api/chat` (CORS preflight)

Browsers usually send `OPTIONS` to the same URL as `POST` (e.g. `/api/chat`). The implementation responds to **any** `OPTIONS` request with **204 No Content**, the same CORS headers as other WebChat responses, and a JSON body of `null` (the handler uses the shared JSON helper).

---

### WebChat — unknown methods / paths

Non-matching routes return **404** with:

```json
{
  "ok": false,
  "error": "Not found"
}
```

---

## Stored event shape

Events returned from the ledger API are **`StoredCanonicalEvent`**: the contract harness **`CanonicalEvent`** envelope plus normalized storage fields. Typical fields include:

- `event_id`, `schema_version`, `event_type`, `tenant_id`, `workspace_id`, `channel`, `conversation_id`, `session_id`, `correlation_id`, `occurred_at`, `actor_type`, `payload`
- Optional: `causation_id`, `channel_instance_id`, `provider_extensions`, `trace_context`, and others as produced by the pipeline

`payload` and `provider_extensions` are typed as generic objects in storage; exact keys depend on `event_type` and the producing component. Refer to the contract harness schemas and RFCs for normative event definitions.
