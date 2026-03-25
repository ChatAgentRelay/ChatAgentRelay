# RFC: CAP Channel Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Channel adapter implementers |
| **Version** | v0.2 |
| **Last Updated** | 2026-03-25 |
| **Companion** | `channel-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document formalizes the TypeScript interface contracts that all CAP channel adapters MUST implement. It complements the high-level channel adapter contract RFC with precise type-level requirements.

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. ChannelIngress Interface

A conforming channel ingress adapter MUST implement the following interface:

```typescript
interface ChannelIngress {
  canonicalize(raw: unknown): CanonicalizationResult;
}
```

### 3.1 Input Contract

- `raw` MUST accept `unknown` — adapters MUST NOT require callers to pre-validate input.
- Adapters MUST perform their own type narrowing and validation internally.
- Adapters MUST NOT throw exceptions from `canonicalize()`; all failures MUST be returned as error results.

### 3.2 CanonicalizationResult

```typescript
type CanonicalizationResult =
  | { ok: true; event: CanonicalEvent; idempotencyKey: string }
  | { ok: false; error: { code: string; message: string } };
```

#### Success Path

When canonicalization succeeds:

- `event` MUST be a fully-formed `CanonicalEvent` that passes both envelope and specialized schema validation.
- `event.event_type` MUST be `"message.received"`.
- `idempotencyKey` MUST be a deterministic, stable key derived from provider-specific identifiers. The same provider delivery MUST always produce the same key.

#### Failure Path

When canonicalization fails:

- `error.code` MUST be a machine-readable identifier (e.g., `"unsupported_subtype"`, `"empty_text"`, `"invalid_input"`).
- `error.message` SHOULD be a human-readable description suitable for logging.

### 3.3 Required Event Fields

The produced `CanonicalEvent` MUST include:

| Field | Requirement |
|---|---|
| `event_id` | MUST be globally unique (UUID recommended) |
| `schema_version` | MUST be `"v1alpha1"` |
| `event_type` | MUST be `"message.received"` |
| `tenant_id` | MUST be set from adapter configuration |
| `workspace_id` | MUST be set from adapter configuration |
| `channel` | MUST identify the channel type (e.g., `"slack"`, `"webchat"`) |
| `channel_instance_id` | SHOULD identify the specific channel instance |
| `conversation_id` | MUST be derived from provider context (e.g., thread_ts for Slack) |
| `session_id` | MUST be set; MAY be derived or generated |
| `correlation_id` | MUST be set; generated fresh for new conversations |
| `occurred_at` | MUST be ISO 8601 timestamp |
| `actor_type` | MUST be `"end_user"` for user messages |
| `payload` | MUST contain at least `{ text: string }` |

### 3.4 Provider Extensions

Adapters SHOULD preserve provider-native metadata in `provider_extensions`, namespaced by channel type:

```json
{
  "provider_extensions": {
    "slack": { "channel_id": "C123", "ts": "1710.11", "team_id": "T123" }
  }
}
```

## 4. SendFn Interface

A conforming channel delivery function MUST implement:

```typescript
type SendFn = (text: string) => Promise<{ providerMessageId: string }>;
```

### 4.1 Behavior Requirements

- `SendFn` MUST deliver the text to the target channel and return the provider's message identifier.
- `SendFn` MUST throw an `Error` on delivery failure. The error message SHOULD describe the failure.
- `providerMessageId` MUST be the provider-assigned identifier for the sent message (e.g., Slack `ts`).

## 5. Message Update (Optional)

Adapters that support message editing SHOULD implement:

```typescript
interface ChannelUpdater {
  update(channelId: string, messageTs: string, text: string): Promise<void>;
}
```

This is used for streaming progressive updates. Adapters MUST NOT expose `update` if the underlying provider does not support message editing.

## 6. Bot Self-Message Filtering

Adapters MUST reject messages originating from the bot itself to prevent feedback loops. This SHOULD be implemented at the canonicalization layer by checking provider-specific bot identifiers (e.g., `bot_id` for Slack).

## 7. Idempotency

- The `idempotencyKey` returned on successful canonicalization MUST be stable across retries.
- It MUST be derived from provider-specific fields that uniquely identify a single delivery.
- For Slack: `{tenant_id}:{channel}:{ts}`.
- For WebChat: `{tenant_id}:{channel_instance_id}:{client_message_id}`.

## 8. Error Taxonomy

Adapters SHOULD use the following error codes:

| Code | Meaning |
|---|---|
| `invalid_input` | Input is null, not an object, or missing required fields |
| `empty_text` | Message text is empty or whitespace-only |
| `unsupported_subtype` | Message has a subtype the adapter does not handle |
| `bot_message` | Message originates from a bot |
| `unsupported_type` | Event type is not `message` |

## 9. Conformance Checklist

A conforming `ChannelIngress` implementation MUST:

- [ ] Accept `unknown` input without throwing
- [ ] Return `CanonicalizationResult` (never throw)
- [ ] Produce schema-valid `message.received` events on success
- [ ] Return stable `idempotencyKey` on success
- [ ] Reject empty/invalid input with structured error codes
- [ ] Filter bot self-messages
- [ ] Preserve provider metadata in `provider_extensions`
- [ ] Set all required canonical event fields

## 10. Existing Implementations

| Adapter | Package | Channel |
|---|---|---|
| `WebChatIngress` | `@cap/channel-web-chat` | `webchat` |
| `SlackIngress` | `@cap/channel-slack` | `slack` |
