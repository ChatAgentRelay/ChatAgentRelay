# Chat Feature Matrix — Implementation Plan

| | |
|---|---|
| **Status** | Active |
| **Created** | 2026-04-13 |

---

## Gap Analysis

From `docs/chat-feature-matrix.md` Section 7 (Roadmap):

### Already Implemented (docs outdated)
- **P1 Command pipeline processing**: `pipeline.ts` already accepts `command.received` (line 182). Tests exist in `pipeline.test.ts` (lines 484-601). Docs need updating only.

### Not Implemented — To Build

| # | Feature | Priority | Key Changes |
|---|---------|----------|-------------|
| 1 | Typing indicator (egress) | P3 | Extend `ChannelSender` with optional `sendTyping()`. Pipeline calls it before agent invocation. Implement in Discord (already has it), Slack, Telegram. |
| 2 | Reaction egress in pipeline | P3 | Extend `ChannelSender` with optional `addReaction()`. Pipeline/delivery supports reaction-type agent hints. Slack & Discord senders already have the low-level methods. |
| 3 | Rich messages for more channels | P3 | Add `sendRichMessage()` to `ChannelSender`. Extend delivery to detect rich payloads. Implement for Telegram (MarkdownV2), Teams (Adaptive Cards), Lark (Interactive Cards). |
| 4 | Attachment ingress normalization | P2 | Extend channel canonicalizers to populate `attachments[]` on `CanonicalEvent`. Pipeline populates `AgentInvocationContext.parts` from attachments. Implement for Slack, Discord, Telegram, Teams, WhatsApp. |
| 5 | Attachment egress delivery | P2 | Extend `ChannelSender` with optional `sendAttachment()`. Delivery reads `artifacts[]` from agent response. Implement sending in each channel adapter. |
| 6 | Interactive messages (buttons) | P2 | Define `ButtonAction` type in contract. Extend `ChannelSender` with `sendButtons()`. Implement for Slack (Block Kit), Discord (Components), Telegram (inline keyboards), Teams (Adaptive Cards). |
| 7 | Streaming for DingTalk/WhatsApp | P3 | Research: DingTalk session webhook likely doesn't support edits. WhatsApp Cloud API doesn't support message edits. Document findings and update capabilities. |

---

## Execution Order

Dependencies dictate the following order:

### Phase 1: Contract Layer Extensions
Extend `ChannelSender` with optional methods. This is the foundation for all features.

New optional methods on `ChannelSender`:
- `sendTyping?(): Promise<void>`
- `addReaction?(messageId: string, emoji: string): Promise<void>`
- `sendRichMessage?(message: RichMessage): Promise<{ providerMessageId: string }>`
- `sendAttachment?(attachment: OutboundAttachment): Promise<{ providerMessageId: string }>`
- `sendButtons?(text: string, buttons: ButtonAction[]): Promise<{ providerMessageId: string }>`

New shared types in `contract-harness`:
- `RichBlock`, `RichMessage` (unified from Slack/Discord local types)
- `InboundAttachment` (for canonical event attachments)
- `OutboundAttachment` (for delivery)
- `ButtonAction` (for interactive messages)

### Phase 2: Typing Indicator (P3) — lowest risk
- Add `sendTyping()` to contract + adapters
- Pipeline calls it before agent invocation
- Tests: verify typing called, verify skip when not supported

### Phase 3: Reaction Egress (P3) — low risk
- Add `addReaction()` to contract + Slack/Discord senders
- Pipeline checks agent response `provider_extensions` for reaction hint
- Tests: verify reaction sent on hint

### Phase 4: Rich Messages (P3) — moderate
- Move `RichMessage` to contract-harness as shared type
- Add `sendRichMessage()` to `ChannelSender`
- Delivery detects `rich_blocks` in agent response payload
- Implement Telegram MarkdownV2, Teams Adaptive Cards, Lark Cards
- Tests: per-channel rich message formatting + delivery integration

### Phase 5: Attachment Ingress (P2) — moderate
- Extend canonicalizers to populate `attachments[]` field
- Pipeline populates `AgentInvocationContext.parts` from attachments
- Tests: canonicalization with files, pipeline passes parts to agent

### Phase 6: Attachment Egress (P2) — moderate
- Add `sendAttachment()` to `ChannelSender`
- Delivery reads `artifacts[]` from agent response
- Implement file sending per channel
- Tests: delivery with artifacts, per-channel send

### Phase 7: Buttons (P2) — moderate
- Define `ButtonAction` type
- Add `sendButtons()` to `ChannelSender`
- Delivery detects buttons in agent response
- Implement per channel (Slack Block Kit, Discord Components, Telegram inline keyboards, Teams Adaptive Cards)
- Tests: per-channel button rendering + delivery

### Phase 8: Streaming Investigation (P3)
- DingTalk: research session webhook edit support → likely document as unsupported
- WhatsApp: confirm no message edit API → document as unsupported
- Update capabilities declarations

### Phase 9: Documentation
- Update `docs/chat-feature-matrix.md` with all changes
- Update Section 5 (command.received gap is closed)
- Update Section 7 (move completed items out of roadmap)
- Update CLAUDE.md / AGENTS.md if needed

---

## Testing Strategy

Each feature must have:
1. **Unit tests** in the relevant package's `tests/` directory
2. **Contract validation** — all events pass `ContractHarnessValidators`
3. **Pipeline integration** — end-to-end test showing the feature works through the pipeline
4. **Conformance** — existing adapter conformance tests must continue passing

Run `bun test --recursive` after each phase to ensure no regressions.
