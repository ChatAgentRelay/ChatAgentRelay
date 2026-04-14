# Chat Feature Support Matrix

| | |
|---|---|
| **Status** | Active |
| **Last Updated** | 2026-04-13 |

---

## 1. Overview

This document provides a cross-channel matrix of chat feature support in CAR, covering ingress (user -> CAR), egress (CAR -> user), and pipeline processing behavior. It serves as the authoritative reference for what chat-level capabilities each channel adapter implements.

For infrastructure-level features (governance, routing, security, etc.), see `docs/decisions/positioning-and-roadmap.md`.

---

## 2. Ingress Feature Matrix (User -> CAR)

What users can send and how CAR processes it.

| Feature | Slack | Discord | WebChat | Telegram | Lark | DingTalk | Teams | WhatsApp |
|---------|:-----:|:-------:|:-------:|:--------:|:----:|:--------:|:-----:|:--------:|
| Text messages | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Message edits | Yes | Yes | — | — | — | — | — | — |
| Message deletes | Yes | Yes | — | — | — | — | — | — |
| Reactions (add) | Yes | Yes | — | — | — | — | — | — |
| Reactions (remove) | Yes | — | — | — | — | — | — | — |
| Slash commands | Yes | Yes | Built-in | Yes | — | — | — | — |
| Thread context | Yes | Metadata | — | — | — | — | — | — |
| @mention / bot trigger | `app_mention` | Bot filter | N/A | Bot entity | Pass-through | — | Strip markup | — |
| File / image attachments | Yes | Yes | — | Yes | — | — | — | — |
| Typing indicator | — | — | — | — | — | — | — | — |
| Read receipts | — | — | — | — | — | — | — | — |

### Legend

- **Yes** — Fully implemented; ingress events are canonicalized.
- **Metadata** — Platform data preserved in `provider_extensions` but not used for routing or agent context.
- **Built-in** — WebChat handles `/help`, `/status`, `/clear` locally in the HTTP layer, not as canonical `command.received` events.
- **Pass-through** — Data present in `provider_extensions` but not interpreted.
- **Strip markup** — Teams `<at>...</at>` tags are stripped from text before canonicalization.
- **—** — Not implemented.

---

## 3. Egress Feature Matrix (CAR -> User)

What CAR can send back to users via channel adapters.

| Feature | Slack | Discord | WebChat | Telegram | Lark | DingTalk | Teams | WhatsApp |
|---------|:-----:|:-------:|:-------:|:--------:|:----:|:--------:|:-----:|:--------:|
| Text reply | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Streaming (progressive) | `chat.update` | PATCH edit | SSE | `editMessageText` | PATCH edit | — | Activity update | — |
| Rich messages | Block Kit | Embeds | — | MarkdownV2 | Interactive Card | — | Adaptive Card | — |
| Thread / reply context | In-thread | First chunk ref | — | — | — | — | — | — |
| Long text chunking | Yes | Yes | — | — | — | — | — | — |
| Reactions (outbound) | Yes | Yes | — | — | — | — | — | — |
| Typing indicator | — | Yes | — | Yes | — | — | — | — |
| Buttons / menus | Block Kit | Components | — | Inline keyboard | — | — | Adaptive Card | — |
| File / attachment send | URL link | URL link | — | URL link | — | — | — | — |

### Notes

- **Streaming**: Adapters with streaming support use an initial `send()` followed by repeated `edit()` calls with accumulated text. WebChat uses native SSE via `buildWebChatStreaming()`.
- **Rich messages**: All five channels with rich message support use the shared `RichMessage` type from `contract-harness`. The `sendRichMessage()` method on `ChannelSender` is wired through the `DeliveryOrchestrator` when `rich_blocks` is present in the agent response payload.
- **Reactions outbound**: `addReaction()` on `ChannelSender` is invoked by the delivery pipeline when the agent response contains `provider_extensions.reaction` with `emoji` and `target_message_id`.
- **Typing**: `sendTyping()` on `ChannelSender` is called by the pipeline before agent invocation. It is best-effort (failures are ignored). Discord and Telegram adapters wire it; Slack lacks a public typing indicator API.
- **Buttons**: When the agent response payload contains a `buttons` array (each with `id`, `label`, optional `style`/`value`), the delivery orchestrator uses `sendButtons()` on the sender instead of plain `send()`. Slack renders as Block Kit action buttons, Discord as message components, Telegram as inline keyboards, Teams as Adaptive Card actions.
- **Attachment send**: When the agent returns `artifacts` with `FilePart` entries, the delivery orchestrator calls `sendAttachment()` on the sender. Current implementation sends the file URL as a text message; native binary upload is not yet supported.

---

## 4. Declared Capabilities (`describeCapabilities()`)

Each adapter's self-declared capability flags.

| Capability | Slack | Discord | WebChat | Telegram | Lark | DingTalk | Teams | WhatsApp |
|------------|:-----:|:-------:|:-------:|:--------:|:----:|:--------:|:-----:|:--------:|
| **messaging.text** | true | true | true | true | true | true | true | true |
| **messaging.attachments** | true | true | false | true | false | false | false | false |
| **messaging.reactions** | true | true | false | false | false | false | false | false |
| **messaging.threads** | true | true | false | false | false | false | true | false |
| **streaming.progressiveUpdate** | true | true | false | true | true | false | true | false |
| **streaming.nativeStreaming** | false | false | true | false | false | false | false | false |
| **interactive.buttons** | true | true | false | true | false | false | true | false |
| **interactive.menus** | false | false | false | false | false | false | false | false |
| **interactive.commands** | true | true | true | true | false | false | false | false |
| **delivery.retry** | true | true | true | true | true | true | true | true |
| **delivery.chunking** | true | true | false | false | false | false | false | false |
| **delivery.edit** | true | true | false | true | true | false | true | false |

---

## 5. Pipeline Processing Behavior

How different canonical event types are handled by the CAR pipeline and server.

| Event Type | Pipeline Behavior | Channel Sources |
|------------|-------------------|-----------------|
| `message.received` | Full FEP 7-event chain (policy -> route -> agent -> deliver) | All 8 channels |
| `command.received` | Full FEP 7-event chain (same as `message.received`; text synthesized as `/{command} {args}`) | Slack, Discord, Telegram |
| `message.updated` | Appended to ledger only; no agent invocation | Slack, Discord |
| `message.deleted` | Appended to ledger only; no agent invocation | Slack, Discord |
| `reaction.received` | Appended to ledger only; no agent invocation | Slack, Discord |
| `agent.status.changed` | WhatsApp delivery status mapping; appended to ledger | WhatsApp |

### Key Observations

1. **Both `message.received` and `command.received` trigger the full agent pipeline.** The pipeline accepts both event types and routes them through governance, routing, and agent invocation.
2. **Command text is synthesized**: For `command.received` events, the pipeline constructs the message text as `/{command_name} {text}` before routing and agent invocation.
3. **Edit/delete/reaction events are audit-only.** They provide a complete conversation record in the ledger but do not affect agent behavior or trigger any processing beyond storage.
4. **Typing indicator**: The pipeline calls `sendTyping()` on the sender (if supported) after creating the `agent.invocation.requested` event and before invoking the agent.
5. **Delivery extensions**: After the primary text/button delivery, the delivery orchestrator performs best-effort rich message delivery (`rich_blocks`), attachment delivery (`artifacts`), and reaction egress (`provider_extensions.reaction`).

---

## 6. Features NOT Planned (Out of Scope)

These features are too platform-specific or fall outside CAR's relay identity. They will NOT be implemented.

| Feature | Reason |
|---------|--------|
| Voice / video calls | Outside text relay scope; requires entirely different transport and media handling. |
| Telegram polls / payments | Platform-specific business logic unrelated to message relay. |
| Discord forums / stage channels | Non-message-path platform constructs. |
| Slack Workflow Builder integration | Platform-internal automation; CAR is an external relay. |
| Slack / Teams modal dialogs | Platform-specific UI; cannot be normalized across channels. |
| Stickers / GIF messages | Low-value unstructured content; no meaningful relay semantics. |
| Read receipts (outbound) | Platform API restrictions vary widely; poor ROI for relay middleware. |
| Scheduled / delayed messages | Outside relay scope; scheduling is a product-layer concern. |
| Message pinning | Platform-specific organization feature; not a relay concern. |
| User presence / online status | Platform-specific social feature; not related to message relay. |
| Streaming for DingTalk | DingTalk session webhook does not support message edits; progressive update is not feasible. |
| Streaming for WhatsApp | WhatsApp Cloud API does not support message edits; progressive update is not feasible. |

---

## 7. Features Completed (Shipped)

Previously planned features that have been implemented.

| Feature | Description | Shipped |
|---------|-------------|---------|
| Command pipeline processing (P1) | `command.received` triggers full agent invocation with synthesized `/{command} {args}` text. | 2026-04-13 |
| Attachment ingress normalization (P2) | File/image uploads from Slack, Discord, and Telegram are canonicalized into `payload.attachments[]` and passed as `FilePart[]` in `AgentInvocationContext.parts`. | 2026-04-13 |
| Attachment egress delivery (P2) | Agent artifacts with `FilePart` entries are delivered via `sendAttachment()` on the channel sender. Current implementation sends file URLs as text. | 2026-04-13 |
| Interactive messages — buttons (P2) | Buttons in agent response `payload.buttons[]` are rendered via `sendButtons()`. Supported on Slack (Block Kit), Discord (Components), Telegram (Inline Keyboard), and Teams (Adaptive Card). | 2026-04-13 |
| Typing indicator egress (P3) | Pipeline calls `sendTyping()` before agent invocation. Supported on Discord and Telegram. | 2026-04-13 |
| Rich messages for more channels (P3) | `sendRichMessage()` using shared `RichMessage` type. Telegram (MarkdownV2), Teams (Adaptive Cards), Lark (Interactive Cards) join Slack and Discord. | 2026-04-13 |
| Reaction egress in pipeline (P3) | Delivery orchestrator applies `addReaction()` when agent response contains `provider_extensions.reaction`. Supported on Slack and Discord. | 2026-04-13 |

---

## 8. Feature Coverage by Use Case

How well CAR supports common enterprise chat-agent interaction patterns.

| Use Case | Support Level | Notes |
|----------|:------------:|-------|
| Simple text Q&A | Full | All 8 channels |
| Streaming agent responses | Good | 6/8 channels (DingTalk, WhatsApp lack streaming) |
| Multi-turn conversations | Full | Pipeline builds conversation history from ledger |
| Slash command dispatch | Full | Commands trigger full agent pipeline with synthesized text |
| Human-in-the-loop (HITL) | Full | A2A `input-required` -> user prompt -> `resume()` pipeline |
| File sharing | Good | Ingress: Slack, Discord, Telegram. Egress: all channels via URL. |
| Interactive approvals (buttons) | Good | Slack, Discord, Telegram, Teams support buttons |
| Audit trail | Full | All event types (including edits/deletes/reactions) recorded in ledger |
| Rich formatted responses | Good | Slack, Discord, Telegram, Teams, Lark |
| Cross-channel consistency | Good | Canonical event model normalizes platform differences |
