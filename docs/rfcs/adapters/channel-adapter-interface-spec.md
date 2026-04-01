# RFC: Chat Agent Relay Channel Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Channel adapter implementers |
| **Version** | v0.4 |
| **Last Updated** | 2026-03-31 |
| **Companion** | `channel-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document formalizes the TypeScript interface contracts that all Chat Agent Relay (CAR) channel adapters MUST implement. It complements the high-level channel adapter contract RFC with precise type-level requirements.

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. ChannelAdapter Interface

A conforming channel adapter MUST implement the following interface:

```typescript
interface ChannelAdapter {
  readonly channelType: string;
  describeCapabilities(): ChannelCapabilities;
  canonicalize(raw: unknown): CanonicalizationResult;
  createSender(event: CanonicalEvent): ChannelSender;
}
```

The `ChannelAdapter` interface unifies ingress (canonicalization of inbound messages) and egress (sender creation for outbound delivery) in a single boundary. This replaces the previous `ChannelIngress` (ingress-only) and separate `SendFn` / `ChannelUpdater` patterns.

### 3.1 channelType

- `channelType` MUST be a read-only string property identifying the channel platform (e.g., `"slack"`, `"discord"`, `"webchat"`).
- The value MUST be stable across the adapter's lifetime.
- It MUST match the `channel` field in canonical events produced by this adapter.

### 3.2 describeCapabilities()

```typescript
type ChannelCapabilities = {
  channel: string;
  messaging: { text: boolean; attachments: boolean; reactions: boolean; threads: boolean };
  streaming: { progressiveUpdate: boolean; nativeStreaming: boolean };
  interactive: { buttons: boolean; menus: boolean; commands: boolean };
  delivery: { retry: boolean; chunking: boolean; edit: boolean };
};
```

- `describeCapabilities()` MUST return a `ChannelCapabilities` object describing what the channel supports.
- `channel` MUST equal the adapter's `channelType`.
- Each boolean field MUST accurately reflect the channel's capabilities.
- The pipeline and server use this information to determine available features (e.g., whether to attempt streaming via progressive updates, whether editing is available).

### 3.3 canonicalize(raw)

#### Input Contract

- `raw` MUST accept `unknown` — adapters MUST NOT require callers to pre-validate input.
- Adapters MUST perform their own type narrowing and validation internally.
- Adapters MUST NOT throw exceptions from `canonicalize()`; all failures MUST be returned as error results.

#### CanonicalizationResult

```typescript
type CanonicalizationResult =
  | { ok: true; event: CanonicalEvent; idempotencyKey: string }
  | { ok: false; error: { code: string; message: string } };
```

##### Success Path

When canonicalization succeeds:

- `event` MUST be a fully-formed `CanonicalEvent` that passes both envelope and specialized schema validation.
- `event.event_type` MUST be `"message.received"`.
- `idempotencyKey` MUST be a deterministic, stable key derived from provider-specific identifiers. The same provider delivery MUST always produce the same key.

##### Failure Path

When canonicalization fails:

- `error.code` MUST be a machine-readable identifier (e.g., `"unsupported_subtype"`, `"empty_text"`, `"invalid_input"`).
- `error.message` SHOULD be a human-readable description suitable for logging.

### 3.4 createSender(event)

```typescript
interface ChannelSender {
  send(text: string): Promise<{ providerMessageId: string }>;
  edit?(providerMessageId: string, text: string): Promise<void>;
}
```

- `createSender()` MUST accept a `CanonicalEvent` and return a `ChannelSender` scoped to the delivery target derived from the event's `provider_extensions`.
- Adapters MUST NOT require callers to manually extract channel IDs, thread IDs, or other platform-specific routing information — the sender derives these from the event.
- `send()` MUST deliver the text to the target channel and return the provider's message identifier.
- `send()` MUST throw an `Error` on delivery failure. The error message SHOULD describe the failure.
- `providerMessageId` MUST be the provider-assigned identifier for the sent message (e.g., Slack `ts`).
- `edit()` is OPTIONAL. Adapters SHOULD implement `edit()` if the underlying provider supports message editing (used for streaming progressive updates).
- `edit()` MUST NOT be present if the provider does not support message editing.
- When `edit()` is present, it MUST update the identified message with the new text.

### 3.5 Required Event Fields

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

### 3.6 Provider Extensions

Adapters SHOULD preserve provider-native metadata in `provider_extensions`, namespaced by channel type:

```json
{
  "provider_extensions": {
    "slack": { "channel_id": "C123", "ts": "1710.11", "team_id": "T123" }
  }
}
```

The `createSender()` method uses these extensions to derive the delivery target, so adapters MUST include sufficient information for outbound delivery in `provider_extensions`.

## 4. Bot Self-Message Filtering

Adapters MUST reject messages originating from the bot itself to prevent feedback loops. This SHOULD be implemented at the canonicalization layer by checking provider-specific bot identifiers (e.g., `bot_id` for Slack).

## 5. Idempotency

- The `idempotencyKey` returned on successful canonicalization MUST be stable across retries.
- It MUST be derived from provider-specific fields that uniquely identify a single delivery.
- For Slack: `{tenant_id}:{channel}:{ts}`.
- For WebChat: `{tenant_id}:{channel_instance_id}:{client_message_id}`.

## 6. Error Taxonomy

Adapters SHOULD use the following error codes:

| Code | Meaning |
|---|---|
| `invalid_input` | Input is null, not an object, or missing required fields |
| `empty_text` | Message text is empty or whitespace-only |
| `unsupported_subtype` | Message has a subtype the adapter does not handle |
| `bot_message` | Message originates from a bot |
| `unsupported_type` | Event type is not `message` |

## 7. Conformance Checklist

A conforming `ChannelAdapter` implementation MUST:

- [ ] Expose a stable `channelType` string property
- [ ] Return accurate `ChannelCapabilities` from `describeCapabilities()`
- [ ] Accept `unknown` input to `canonicalize()` without throwing
- [ ] Return `CanonicalizationResult` (never throw)
- [ ] Produce schema-valid `message.received` events on success
- [ ] Return stable `idempotencyKey` on success
- [ ] Reject empty/invalid input with structured error codes
- [ ] Filter bot self-messages
- [ ] Preserve provider metadata in `provider_extensions`
- [ ] Set all required canonical event fields
- [ ] Return a `ChannelSender` from `createSender(event)` that can deliver messages
- [ ] Include `edit()` on the sender only if the platform supports message editing

## 8. Existing Implementations

| Adapter | Package | Channel |
|---|---|---|
| `WebChatAdapter` | `@chat-agent-relay/channel-web-chat` | `webchat` |
| `SlackAdapter` | `@chat-agent-relay/channel-slack` | `slack` |
| `DiscordAdapter` | `@chat-agent-relay/channel-discord` | `discord` |
| `TelegramAdapter` | `@chat-agent-relay/channel-telegram` | `telegram` |
| `LarkAdapter` | `@chat-agent-relay/channel-lark` | `lark` |
| `DingTalkAdapter` | `@chat-agent-relay/channel-dingtalk` | `dingtalk` |

## 9. Optional lifecycle contracts (`contract-harness`)

The `@chat-agent-relay/contract-harness` package defines optional teardown interfaces for long-lived adapter instances:

- **`Shutdownable`** — `shutdown(): Promise<void>`
- **`Disconnectable`** — `disconnect(): void`

Type guards `isShutdownable()` and `isDisconnectable()` allow callers to detect support without narrowing manually. Channel or agent implementations MAY implement these when they hold connections, timers, or subprocesses that need cooperative cleanup. The server runtime uses these guards when stopping registered channels and agents.

## 10. Server factory registration (informative)

In the reference server, channel and agent construction is not hardcoded inside `ChannelRegistry` / `AgentRegistry` via per-type `switch` statements. Instead, each registry exposes `registerFactory(type, factory)`, and built-in types are wired in `channel-factories.ts` and `agent-factories.ts`. Third-party or forked deployments SHOULD register additional `type` strings through the same factory API so registry core code stays free of adapter-specific imports.
