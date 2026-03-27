# Chat Agent Relay First Executable Path Event Contract Matrix

This document condenses the seven-event happy path from `docs/decisions/first-executable-path-plan.md` into a compact implementation-facing matrix.

It is a planning/design artifact for review-gate convergence, not an approval to implement the listed runtime producers and consumers.

## Purpose

Provide one compact contract view for the first executable path so implementers can see, at a glance:
- event order
- producer and consumer
- causal linkage
- minimum payload responsibility
- validation boundary
- ledger expectation

## Event Contract Matrix

| Order | Event | Producer | Primary consumer | Causation role | Minimum payload responsibility | Validation path | Ledger expectation |
|---|---|---|---|---|---|---|---|
| 1 | `message.received` | web chat adapter | middleware / governance | chain root for the happy path | inbound plain-text content; only the canonical facts needed for downstream decision-making | base envelope + `message-received.schema.json` | append as first durable fact |
| 2 | `policy.decision.made` | middleware / governance | routing | caused by `message.received`; records allow result before routing | one policy reference and `decision = allow` | base envelope + `policy-decision-made.schema.json` | append durably |
| 3 | `route.decision.made` | routing | middleware execution / backend dispatch | caused by `policy.decision.made`; records why the backend was selected | one route identifier and one route reason | base envelope + `route-decision-made.schema.json` | append durably |
| 4 | `agent.invocation.requested` | middleware execution boundary | generic backend adapter | caused by `route.decision.made`; freezes the backend call boundary | one backend target and one input-event reference | base envelope + `agent-invocation-requested.schema.json` | append durably before or with dispatch |
| 5 | `agent.response.completed` | generic backend adapter | delivery orchestration | caused by `agent.invocation.requested`; records completed runtime output before delivery | one completed plain-text response | base envelope + `agent-response-completed.schema.json` | append durably |
| 6 | `message.send.requested` | delivery orchestration | outbound web chat adapter | caused by `agent.response.completed`; freezes outbound send intent | one outbound plain-text send payload | base envelope + `message-send-requested.schema.json` | append durably |
| 7 | `message.sent` | outbound web chat adapter | replay / audit / delivery views | caused by `message.send.requested`; records successful send completion | minimum send result identifier such as provider/web message id | base envelope + `message-sent.schema.json` | append durably as terminal happy-path fact |

## Shared Identifier Rules

Every event in the chain MUST preserve:
- `tenant_id`
- `workspace_id`
- `conversation_id`
- `session_id`
- `correlation_id`

Every event after the first MUST additionally preserve a causal chain through:
- `causation_id`

The first chain event:
- `message.received`
- does not require a prior `causation_id`

## Actor-Type Expectations

| Event | Expected actor_type |
|---|---|
| `message.received` | `end_user` |
| `policy.decision.made` | `system` |
| `route.decision.made` | `system` |
| `agent.invocation.requested` | `system` |
| `agent.response.completed` | `agent` |
| `message.send.requested` | `system` |
| `message.sent` | `channel_adapter` |

## Minimal Payload Narrowness Rules

### Inbound side
- `message.received` is text-only for this slice
- no attachments
- no rich text
- no edits or deletes

### Decision side
- `policy.decision.made` is narrowed to one allow result
- `route.decision.made` is narrowed to one selected backend target

### Backend side
- `agent.invocation.requested` carries only the minimum execution reference set
- `agent.response.completed` carries one completed plain-text response
- no deltas
- no tools
- no handoff metadata in the first path

### Delivery side
- `message.send.requested` carries one outbound plain-text payload
- `message.sent` carries one minimum send result identifier
- no advanced callback or receipt semantics

## Validation Notes

The contract matrix assumes the repository validation model already chosen:
- envelope validation first
- specialized event validation second where schema artifacts exist
- JSON Schema remains the machine-readable contract layer
- Ajv remains the default TypeScript-side alignment path

`message.send.requested` is part of the frozen seven-event baseline and now has specialized schema coverage.

## Review-Gate Use

This matrix is sufficient to support the current review gate by making it explicit that:
- the seven-event order is frozen as the machine-readable baseline
- the fixture corpus and schema coverage can already be consumed by `packages/contract-harness`
- any ledger behavior currently proven is limited to the bounded in-memory prototype in `packages/event-ledger`
- later runtime producers and consumers still require a separately approved narrow slice
