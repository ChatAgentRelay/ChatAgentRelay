# RFC: Chat Agent Relay Channel Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Channel adapter implementers |
| **Version** | v0.5 |
| **Last Updated** | 2026-04-02 |
| **Companion** | `channel-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document defines the interface-level contract that Chat Agent Relay (CAR) channel adapters MUST implement.

CAR is a standard relay layer between chat platforms and agents. On the channel side, adapters provide the provider-facing boundary for canonicalization of inbound traffic and translation of canonical outbound intent into provider-native delivery behavior.

This document explicitly separates:
- **Core** — normative interface semantics required for conformance
- **Extension** — optional but aligned interface capabilities
- **Future Considerations** — non-normative directions that are not current conformance requirements

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. Purpose

This RFC defines the stable type-level contract for CAR's channel-side boundary.

## 4. Product Boundary

For this RFC, the channel adapter interface specification is responsible for:
- defining the adapter-facing canonicalization contract
- defining the sender contract for outbound delivery
- defining the capability contract used by the relay path
- defining structured success and failure shapes at the interface boundary

For this RFC, the channel adapter interface specification is not:
- a routing or policy decision model
- a queue or operator workflow model
- a complete provider operations lifecycle system
- a replacement for CAR's canonical event or middleware RFCs

## 5. Layering Model

### 5.1 Core

Core semantics define the minimum channel-side interface that a conforming CAR implementation MUST preserve.

### 5.2 Extension

Extension semantics define optional capabilities that fit CAR's relay model without redefining it.

### 5.3 Future Considerations

Future considerations preserve direction for later exploration, but MUST NOT be interpreted as current interface requirements.

## 6. Core ChannelAdapter Interface

A conforming channel adapter MUST implement the following interface:

```typescript
interface ChannelAdapter {
  readonly channelType: string;
  describeCapabilities(): ChannelCapabilities;
  canonicalize(raw: unknown): CanonicalizationResult;
  createSender(event: CanonicalEvent): ChannelSender;
}
```

This interface unifies:
- inbound canonicalization of provider-native traffic
- outbound sender creation for provider-native delivery

## 7. Core Interface Semantics

### 7.1 channelType

- `channelType` MUST be a stable read-only string identifying the channel platform
- it MUST match the `channel` field in canonical events produced by the adapter

Illustrative values include:
- `"slack"`
- `"discord"`
- `"webchat"`
- `"telegram"`

### 7.2 describeCapabilities()

```typescript
type ChannelCapabilities = {
  channel: string;
  messaging: { text: boolean; attachments: boolean; reactions: boolean; threads: boolean };
  streaming: { progressiveUpdate: boolean; nativeStreaming: boolean };
  interactive: { buttons: boolean; menus: boolean; commands: boolean };
  delivery: { retry: boolean; chunking: boolean; edit: boolean };
};
```

Core requirements:
- `describeCapabilities()` MUST return a `ChannelCapabilities` object
- `channel` MUST equal the adapter's `channelType`
- capability fields MUST accurately reflect relay-relevant behavior supported by the provider path

The exact capability shape MAY evolve, but a conforming implementation MUST preserve truthful channel capability declaration at the interface boundary.

### 7.3 canonicalize(raw)

#### Input contract

- `raw` MUST accept `unknown`
- adapters MUST perform their own type narrowing and validation internally
- adapters MUST return structured failure results rather than throwing framework-specific exceptions across the boundary

#### CanonicalizationResult

```typescript
type CanonicalizationResult =
  | { ok: true; event: CanonicalEvent; idempotencyKey: string }
  | { ok: false; error: { code: string; message: string } };
```

#### Success path

When canonicalization succeeds:
- `event` MUST be a schema-valid canonical event
- `event.event_type` MUST be `"message.received"`
- `idempotencyKey` MUST be deterministic and stable for the provider delivery represented

#### Failure path

When canonicalization fails:
- `error.code` MUST be machine-readable
- `error.message` SHOULD be human-readable
- failures SHOULD preserve enough structure for explainability and logging

### 7.4 createSender(event)

```typescript
interface ChannelSender {
  send(text: string): Promise<{ providerMessageId: string }>;
  edit?(providerMessageId: string, text: string): Promise<void>;
}
```

Core requirements:
- `createSender()` MUST accept a canonical event and return a `ChannelSender` scoped to the delivery target implied by that event
- adapters MUST derive provider-specific routing context themselves rather than requiring callers to manually extract provider-native identifiers
- `send()` MUST attempt delivery and return the provider-assigned message identifier on success
- if message editing is supported, `edit()` MAY be present

The interface boundary defines the sender contract; it does not require every provider to support every outbound operation.

## 8. Core Canonical Event Requirements

On successful canonicalization, the produced `CanonicalEvent` MUST include support for the required relay-relevant fields.

Required concerns include:
- stable event identity
- `schema_version`
- `event_type = "message.received"`
- tenant and workspace scope
- channel and channel instance context where applicable
- conversation and session continuity
- correlation identity
- occurrence time
- actor context for the inbound user message
- canonical payload content

Illustrative required fields:

| Field | Requirement |
|---|---|
| `event_id` | MUST be globally unique |
| `schema_version` | MUST be `"v1alpha1"` |
| `event_type` | MUST be `"message.received"` |
| `tenant_id` | MUST be set from channel-side context |
| `workspace_id` | MUST be set from channel-side context |
| `channel` | MUST identify the channel type |
| `conversation_id` | MUST preserve conversation continuity relevant to the relay path |
| `session_id` | MUST be set |
| `correlation_id` | MUST be set |
| `occurred_at` | MUST be an ISO 8601 timestamp |
| `actor_type` | MUST reflect the inbound actor |
| `payload` | MUST contain the canonical inbound content |

## 9. Core Provider Extensions Rule

Adapters SHOULD preserve provider-native metadata in `provider_extensions`, namespaced by channel type.

Illustrative example:

```json
{
  "provider_extensions": {
    "slack": {
      "channel_id": "C123",
      "ts": "1710.11",
      "team_id": "T123"
    }
  }
}
```

Rules:
- the adapter MUST preserve enough provider-native metadata to support outbound delivery where needed
- provider extensions MUST remain optional to canonical core semantics
- provider extensions MUST NOT become the core source of truth for relay behavior

## 10. Core Inbound Rules

### 10.1 Bot Self-Message Filtering

Adapters SHOULD reject messages originating from the bot itself when the provider exposes sufficient identity information to detect that case.

This helps prevent feedback loops at the channel boundary.

### 10.2 Idempotency

The `idempotencyKey` returned on successful canonicalization MUST be stable across retries or duplicate provider delivery of the same message.

The exact derivation is implementation-specific, but it SHOULD be based on provider-native identifiers that uniquely identify a delivery.

### 10.3 Error Taxonomy

Illustrative error codes include:
- `invalid_input`
- `empty_text`
- `unsupported_subtype`
- `bot_message`
- `unsupported_type`

The exact vocabulary MAY vary by implementation as long as failures remain structured and explainable.

## 11. Extension Semantics

The following capabilities are aligned with CAR but are not required for all conforming implementations.

### 11.1 Richer Capability Shapes

Implementations MAY expose richer capability declarations covering:
- richer interaction support
- command support
- menus and buttons
- native streaming signals
- chunking or edit support details

### 11.2 Progressive Update Support

If the provider supports message editing or progressive updates, adapters MAY expose sender editing behavior to support streaming-oriented delivery.

### 11.3 Optional Lifecycle Contracts

Implementations MAY also implement optional teardown or connection lifecycle contracts such as:
- `Shutdownable`
- `Disconnectable`

These may be useful operationally, but they are not required to define the channel-side relay boundary.

### 11.4 Contract Testing Guidance

Adapters SHOULD be covered by contract tests that exercise:
- representative inbound payloads
- expected canonical event outputs
- structured failure paths
- duplicate ingress scenarios
- sender delivery behavior

### 11.5 Existing Implementations

Illustrative built-in implementations include:

| Adapter | Package | Channel |
|---|---|---|
| `WebChatAdapter` | `@chat-agent-relay/channel-web-chat` | `webchat` |
| `SlackAdapter` | `@chat-agent-relay/channel-slack` | `slack` |
| `DiscordAdapter` | `@chat-agent-relay/channel-discord` | `discord` |
| `TelegramAdapter` | `@chat-agent-relay/channel-telegram` | `telegram` |
| `LarkAdapter` | `@chat-agent-relay/channel-lark` | `lark` |
| `DingTalkAdapter` | `@chat-agent-relay/channel-dingtalk` | `dingtalk` |

## 12. Future Considerations

The following directions are intentionally non-normative in this RFC.

### 12.1 Broader Operational Lifecycle Systems

Examples:
- pause or drain control planes
- health administration surfaces
- larger registry-management models becoming part of adapter conformance

These are outside the current relay-centered interface core.

### 12.2 Queue and Operator Surface Concerns

Examples:
- operator work queues
- assignment models
- inbox workflow semantics

These are not part of the channel adapter interface contract.

### 12.3 Broad Provider-Specific Expansion

Examples:
- turning provider-specific feature taxonomies into the primary architectural center
- making adapter conformance depend on a large matrix of non-core provider features

Current CAR direction is to keep the channel-side boundary narrow and relay-centered.

## 13. Conformance

A conforming `ChannelAdapter` implementation MUST:
- expose a stable `channelType`
- return accurate capability declarations from `describeCapabilities()`
- accept `unknown` input to `canonicalize()`
- return structured canonicalization success or failure results
- produce schema-valid `message.received` events on success
- return stable idempotency information on successful canonicalization
- preserve provider-native detail through namespaced optional extensions
- return a sender that can translate canonical outbound intent into provider-native delivery behavior

A conforming implementation is NOT required to implement every extension or future consideration in this RFC.

## 14. Security Considerations

Implementations SHOULD:
- treat provider-native input as untrusted until verified
- minimize raw provider payload exposure in canonical records
- preserve a clear boundary between provider-native detail and canonical relay semantics
- reject or structure invalid inbound inputs rather than allowing ambiguous failure behavior
- isolate provider credentials appropriately in deployment-specific configuration

## 15. Open Questions

- Which capability fields should remain implementation-specific versus standardized more strongly?
- Which sender behaviors should be standardized more strongly across adapters?
- Which optional lifecycle contracts deserve a separate operational RFC rather than expansion of this interface specification?
