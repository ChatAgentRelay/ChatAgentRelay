# RFC: CAP Channel Adapter Contract

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Channel adapter implementers |
| **Version** | v0.1 |
| **Last Updated** | 2026-03-17 |

## 1. Abstract

This RFC defines the contract between provider-native chat transports and the CAP canonical event model.

## 2. Purpose

定义聊天平台适配器如何将 provider-native ingress / egress 绑定到 canonical event schema。

## 3. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 4. Minimum Kernel Scope

The minimum CAP kernel requires only a thin but strict adapter contract:
- one inbound path
- one outbound path
- capability declaration
- idempotent ingress
- auditable failure mapping

Adapters MAY support richer features later, but MUST preserve canonical semantics from day one.

## 5. Responsibilities

Channel adapter 负责：
- 接收入站 webhook / polling / socket 事件
- 校验签名、token 或来源
- 幂等去重
- 将 provider-native payload 转换为 canonical event
- 发送出站消息 / 更新 / 删除（若 provider 支持）
- 回传 delivery status / failure reason
- 维护 provider-native extension 到 `provider_extensions`

Adapter **不负责**：
- route decision
- policy decision
- tenant-level business governance
- canonical conversation identity 的最终归属

## Lifecycle

Required lifecycle operations:
- `register(config)`
- `describeCapabilities()`
- `healthCheck()`
- `pause()`
- `resume()`
- `drain()`
- `shutdown()`

## Capability Model

平台应显式区分：
- **channel type**：如 `slack`、`whatsapp`、`webchat`
- **provider**：如官方 API、BSP、第三方 SDK、bridge service
- **channel instance**：某租户下的一组 credentials + config + provider binding

`describeCapabilities()` should declare support for:
- `text`
- `attachments`
- `reactions`
- `typing`
- `threading`
- `receipts`
- `templates`
- `streaming`
- `message_update`
- `message_delete`
- `rich_text`
- `buttons`
- `cards`
- `quick_replies`
- `audio`
- `video`
- `location`

Each capability should include:
- `supported: boolean`
- optional constraints
- optional provider notes
- optional `max_length`
- optional `supported_media_types`
- optional fallback behavior

## Ingress Contract

### Inputs
Supported ingress modes:
- webhook
- polling
- websocket / socket

### Required ingress behavior
1. verify source authenticity
2. derive provider idempotency key if available
3. classify payload type
4. normalize to one or more canonical events
5. attach provider-native metadata in `provider_extensions`
6. emit normalized events into middleware pipeline

### Idempotency
Adapter must:
- detect duplicate delivery when provider identifiers allow it
- surface a stable dedupe key
- avoid generating multiple canonical events for the same provider delivery unless the provider semantics require it

## Egress Contract

Required egress operations:
- `sendMessage(request)`
- `updateMessage(request)` if supported
- `deleteMessage(request)` if supported

Egress must:
- accept canonical payloads
- translate into provider-native requests
- return normalized result metadata
- emit delivery state transitions as canonical events when callbacks or responses are available

## Capability Fallback and Transcoding

当目标渠道不支持 canonical payload 中的某类能力时，adapter 或 delivery layer 必须执行明确的 fallback / transcoding。

Recommended defaults:
- rich text -> plain text
- media -> caption / filename text fallback
- template -> channel-supported fallback body
- edit/delete -> explanatory text fallback when native support absent
- unsupported interactive elements -> degrade to plain text choices

Rules:
- fallback strategy must be deterministic and auditable
- fallback outcome should be derivable from capability metadata
- fallback failures should emit `error.occurred` or `event.blocked`, not silent drops

## Error Taxonomy

Every adapter error should classify:
- `retryable`
- `non_retryable`
- `auth_failure`
- `quota_exceeded`
- `rate_limited`
- `invalid_payload`
- `provider_unavailable`

Errors should include:
- code
- message
- provider code if present
- retry hint if present

## Provider Extensions

Rules for `provider_extensions`:
- provider-native fields must be namespaced
- canonical core must not depend on their presence
- extensions may be consumed by channel-specific delivery logic or specialized policies

Example:
```json
{
  "provider_extensions": {
    "slack": {
      "team_id": "T123",
      "event_ts": "1710.11"
    }
  }
}
```

## Multi-Instance Isolation

Adapter instances must support:
- tenant-scoped configuration
- isolated credentials per `channel_instance_id`
- isolated quotas / rate limits per instance
- clear naming and configuration conventions

Recommended instance naming:
`<channel>_<tenant-or-workspace>_<environment>`

Examples:
- `slack_acme_prod`
- `whatsapp_support_eu`

## Retry / Dead-Letter / Poison Message

Adapters should:
- mark retryable provider failures explicitly
- surface non-retryable payload errors explicitly
- support middleware-managed retry orchestration
- avoid infinite local retry loops
- preserve enough metadata for dead-letter analysis

Poison message handling should result in:
- `error.occurred`
- optional `message.delivery.updated` with `dead_lettered`

## Contract Testing Requirements

Each adapter must provide:
- fixture payloads for supported inbound event classes
- expected golden canonical events
- outbound translation examples
- auth failure tests
- duplicate delivery tests
- provider outage tests
- unsupported capability tests

## Ownership Boundary

- **adapter** 负责 `translate`
- **middleware core** 负责 `decide / enforce / record`
- **delivery orchestration** 负责 retry / dead-letter policy

## 6. Versioning and Phases

### Phase 0 / Prototype
- one web chat adapter
- one webhook-first adapter shape
- text-only delivery path

### Phase 1 / Minimum Kernel
- Slack-class transport
- capability declaration
- deterministic fallback / transcoding
- delivery state mapping
- duplicate webhook handling

### Phase 2 / Enterprise
- richer content types
- stronger delivery callbacks
- per-instance policy and quota hooks
- secure raw payload references and trace retention

### Phase 3 / Rich / Realtime
- streaming-rich transports
- media-heavy channels
- optional voice / realtime extensions

## 7. Initial v1 Guidance

建议 v1 先支持：
- one web chat adapter
- one Slack adapter
- one async / webhook-first adapter shape

v1 adapter 目标不是覆盖全部 provider feature，而是验证：
- canonical ingress/egress shape
- idempotency
- capability declaration
- delivery state mapping

## 8. Conformance

A conforming channel adapter MUST:
- declare capabilities
- normalize inbound provider events into canonical events
- preserve provider-native metadata via namespaced extensions or secure references
- implement auditable failure mapping
- avoid silent fallback failures

## 9. Security Considerations

Adapters SHOULD:
- verify source authenticity whenever provider support exists
- isolate tenant credentials by channel instance
- minimize raw payload retention in canonical records
- surface provider auth failures distinctly from payload failures

## 10. Open Questions

- Which fallback / transcoding rules should become normative versus implementation-defined?
- Should delivery callback mapping be standardized more strongly across webhook-driven providers?
- When should protocol traces be adapter-owned versus emitted by a shared delivery subsystem?