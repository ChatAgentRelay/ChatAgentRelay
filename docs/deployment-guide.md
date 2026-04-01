# Deployment Guide

> Production deployment guide for Chat Agent Relay (CAR).

## 1. Prerequisites

- [Bun](https://bun.sh/) v1.2+
- A reverse proxy (nginx, Caddy, etc.) for TLS termination
- One or more A2A-compatible agent endpoints
- One or more chat platform bot accounts (Slack, Teams, Discord, etc.)

## 2. Installation

```bash
git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git
cd ChatAgentRelay
bun install
```

Verify:

```bash
bun test --recursive
# Expected: ~692 tests pass across 51 files
```

## 3. Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CAR_DB_PATH` | No | `./car.db` | SQLite database path (config + ledger) |
| `CAR_ENCRYPTION_KEY` | Yes (prod) | — | AES-256-GCM key for credential encryption. Generate: `openssl rand -hex 32` |
| `CAR_API_KEY` | Yes (prod) | — | Bearer token for management API authentication |
| `CAR_API_PORT` | No | `3000` | HTTP API listen port |
| `CAR_POLICY_FILE` | No | — | Path to YAML inbound policy file |
| `CAR_OUTBOUND_POLICY_FILE` | No | — | Path to YAML outbound policy file |

### Database Settings

Settings are stored in SQLite and managed via `car config set <key> <value>` or `PUT /api/config/:key`.

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `api.key` | string | — | Alternative to `CAR_API_KEY` env var |
| `api.port` | number | `3000` | Alternative to `CAR_API_PORT` env var |
| `api.chat.public` | `true`/`false` | `true` | Whether `/api/chat*` endpoints skip API auth |
| `tenant.isolation` | `true`/`false` | `false` | Scope ledger queries by `X-Tenant-ID` header |
| `rate_limit.max_per_minute` | number | — | Max messages per minute per scope |
| `rate_limit.scope` | `sender`/`conversation`/`tenant` | `sender` | Rate limit grouping dimension |
| `access_control.mode` | `allowlist`/`blocklist` | — | Sender access control mode |
| `access_control.senders` | JSON array | — | Sender IDs, e.g. `["user1","user2"]` |
| `idempotency.ttl_ms` | number | `300000` | Deduplication window in milliseconds |
| `streaming.interval_ms` | number | `300` | Progressive update interval |

Priority: environment variables override database settings.

## 4. Setup and Start

```bash
cd packages/server

# Set production secrets
export CAR_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export CAR_API_KEY="$(openssl rand -hex 16)"

# Register a channel
car channel add prod-slack \
  --type=slack \
  --bot-token=xoxb-... \
  --app-token=xapp-... \
  --signing-secret=...

# Register an agent
car agent add prod-agent --endpoint=https://agent.example.com

# Set up routing
car route add --default --agent=prod-agent

# Configure governance
car config set rate_limit.max_per_minute 30
car config set rate_limit.scope sender

# Start the server
car start
```

### Channel-Specific Setup

**Slack**: Requires Socket Mode. Set `--bot-token` (xoxb-) and `--app-token` (xapp-). Optional `--signing-secret` for webhook verification.

**Teams**: Requires Azure AD Bot registration. Set `--app-id`, `--app-secret`, `--tenant-id`. Configure messaging endpoint as `https://your-domain/api/teams/messages`.

**Discord**: Requires Gateway Intents (MESSAGE CONTENT). Set `--bot-token`.

**Telegram**: Set `--bot-token`. Configure webhook to `https://your-domain/api/telegram/webhook`. Optional `--secret-token` for verification.

**WhatsApp**: Requires Meta Business account. Set `--phone-number-id`, `--access-token`, `--verify-token`, `--app-secret`. Configure webhook to `https://your-domain/api/whatsapp/webhook`.

**Lark**: Set `--app-id`, `--app-secret`. Optional `--encrypt-key` for verification. Configure webhook to `https://your-domain/api/lark/webhook`.

**DingTalk**: Set `--robot-code`, `--app-secret`. Optional `--secret` for verification. Configure webhook to `https://your-domain/api/dingtalk/webhook`.

**WebChat**: No external setup needed. Uses `/api/chat` and `/api/chat/stream` endpoints.

## 5. Reverse Proxy (nginx)

CAR does not terminate TLS. Use a reverse proxy in front.

```nginx
upstream car_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name car.example.com;

    ssl_certificate     /etc/ssl/certs/car.example.com.pem;
    ssl_certificate_key /etc/ssl/private/car.example.com.key;

    location / {
        proxy_pass http://car_backend;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;

        # Long timeout for agent invocations
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

If using multi-tenant isolation, the reverse proxy can inject `X-Tenant-ID` from JWT claims or session data.

## 6. Policy Configuration (YAML)

Create `policy.yaml` for inbound rules and `outbound-policy.yaml` for outbound rules.

### Inbound Policy

```yaml
rules:
  # Mandatory deny: cannot be overridden by lower-priority rules
  - action: deny
    mandatory: true
    condition:
      content_length:
        max: 10000
    reason: "Message exceeds maximum length"

  # Block sensitive patterns
  - action: deny
    condition:
      or:
        - regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
        - regex: "\\b\\d{16}\\b"
    reason: "Potential PII detected"

  # Time-based restriction
  - action: deny
    condition:
      time_window:
        after: "22:00"
        before: "06:00"
        timezone: "America/New_York"
    reason: "Outside business hours"

  # Default allow
  - action: allow
```

### Outbound Policy

```yaml
rules:
  - action: deny
    mandatory: true
    condition:
      keyword: ["INTERNAL_ONLY", "CONFIDENTIAL"]
    reason: "Agent response contains restricted content"

  - action: allow
```

### Activating Policies

```bash
export CAR_POLICY_FILE=./policy.yaml
export CAR_OUTBOUND_POLICY_FILE=./outbound-policy.yaml
car start
```

Policy files are watched for changes and hot-reloaded without restart. If a reload fails (invalid YAML), the previous policy remains active.

## 7. Monitoring

### Health Check

```bash
curl https://car.example.com/api/health
```

Returns `200` when healthy, `503` when the ledger is degraded:

```json
{
  "status": "ok",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "ledger": {
    "healthy": true,
    "event_count": 1234,
    "backend": "sqlite"
  },
  "uptime_seconds": 86400
}
```

### Logging

CAR outputs structured JSON logs to stdout. Pipe to your log aggregator:

```bash
car start 2>&1 | tee /var/log/car/car.log
```

### Audit

Query the ledger via the API:

```bash
# Events for a conversation
curl -H "Authorization: Bearer $CAR_API_KEY" \
  https://car.example.com/api/conversations/conv_123/events

# Audit summary with per-turn breakdown
curl -H "Authorization: Bearer $CAR_API_KEY" \
  https://car.example.com/api/conversations/conv_123/audit
```

## 8. Security Checklist

Before going live, verify:

- [ ] `CAR_ENCRYPTION_KEY` set (credentials encrypted at rest)
- [ ] `CAR_API_KEY` set (management API protected)
- [ ] TLS termination via reverse proxy
- [ ] Webhook signature verification configured for each channel
- [ ] Inbound policy rules configured and tested
- [ ] Outbound policy rules configured and tested
- [ ] Rate limiting enabled (`rate_limit.max_per_minute`)
- [ ] Access control configured if needed (`access_control.mode`)
- [ ] `tenant.isolation` enabled if serving multiple tenants
- [ ] `api.chat.public` set appropriately (default: `true`)
- [ ] Database file permissions restricted (`chmod 600 car.db`)
- [ ] Log output captured and retained

## 9. Graceful Shutdown

CAR handles `SIGINT` and `SIGTERM` gracefully:

1. Stops accepting new connections
2. Waits up to 30 seconds for in-flight requests to complete
3. Disconnects WebSocket channels (Slack Socket Mode, Discord Gateway)
4. Closes the database

In container environments, ensure `stop_grace_period` (Docker) or `terminationGracePeriodSeconds` (Kubernetes) is at least 35 seconds.
