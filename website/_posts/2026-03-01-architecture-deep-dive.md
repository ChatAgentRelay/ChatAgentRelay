---
layout: post
title: "The Canonical Event Chain — Why Every Message Produces 7 Events"
heading: "The Canonical Event Chain &mdash; Why Every Message Produces 7 Events"
date: 2026-03-01
description: "How Chat Agent Relay models chat-to-agent flows as a declarative chain of seven canonical events plus failure capture — auditable and replayable."
keywords: "Chat Agent Relay, CAR, event-driven architecture, canonical events, message.received, audit ledger, JSON Schema, middleware, AI agents"
og_type: article
og_title: "The Canonical Event Chain — Why Messages Produce 7 Events"
og_description: "Declarative chat-to-agent integration: seven events from ingress to delivery, plus first-class failure events."
twitter_title: "The Canonical Event Chain — Chat Agent Relay"
twitter_description: "Why Chat Agent Relay records policy, routing, invocation, response, and delivery as explicit events — not hidden control flow."
category_label: "Technical deep dive"
card_title: "Architecture Deep Dive"
card_description: "The canonical event chain and why every message produces 7 events"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/"
cta_primary_text: "Try Chat Agent Relay"
cta_primary_track: "blog_arch_try"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay/tree/main/docs/rfcs"
cta_secondary_text: "Read the specs"
cta_secondary_track: "blog_arch_specs"
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "The Canonical Event Chain — Why Every Message Produces 7 Events"
  description: "Technical overview of Chat Agent Relay's seven-event pipeline and event.blocked for failures."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/architecture-deep-dive/"
  datePublished: "2026-03-01"
  dateModified: "2026-03-01"
  author:
    "@type": "Organization"
    name: "Chat Agent Relay"
  publisher:
    "@type": "Organization"
    name: "Chat Agent Relay"
    url: "https://ChatAgentRelay.github.io/ChatAgentRelay/"
  isPartOf:
    "@type": "Blog"
    name: "Chat Agent Relay Blog"
    url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/"
---

## Integration styles {#intro}

Most chat-agent integrations are **imperative**: receive a payload, branch on errors, call an API, hope the logs are enough when something breaks.
Chat Agent Relay is **declarative** at the protocol layer: every user message is expected to advance through the same ordered chain of event types.
Adapters translate platform-specific wire formats in and out; the middleware never needs to know Slack's payload shape to reason about policy or audit.

## The seven-event chain {#seven-events}

Each step is a durable, schema-validated fact in the ledger:

1. **`message.received`** — The channel adapter canonicalizes the inbound message (text, thread, user, workspace identifiers) into the shared envelope.
   Nothing downstream should parse raw Slack or HTTP bodies.

2. **`policy.decision.made`** — The policy engine evaluates rules (keywords, regex, and future richer logic) and records allow or deny *before* any agent call.
   Blocked traffic never touches the model; the decision is still auditable.

3. **`route.decision.made`** — Routing selects which backend adapter handles this conversation (model, tenant-specific endpoint, A/B experiment, etc.).

4. **`agent.invocation.requested`** — Dispatch includes conversation context and correlation metadata so backends stay stateless where possible and traces stay coherent.

5. **`agent.response.completed`** — The agent's reply (or structured failure from the backend) is captured as an event, not only as a return value on the stack.

6. **`message.send.requested`** — Outbound delivery is queued with retry policy; the user-visible "send" is separate from the agent finishing.

7. **`message.sent`** — The channel confirms delivery (or terminal failure after retries), closing the happy path for that turn.

### `event.blocked` {#blocked}

When anything fails policy, routing, invocation, or delivery, Chat Agent Relay emits **`event.blocked`**: a first-class failure record with **reason** and **stage**.
Failures are not only exceptions in logs; they are queryable events with the same envelope as the rest of the system, so dashboards and compliance tools can treat them uniformly.

## Why this matters {#why}

- **Every decision is auditable** — Allow/deny, route choice, and delivery outcomes are explicit events with timestamps and correlation IDs.
- **Failures are first-class** — `event.blocked` preserves why something stopped without inferring from stack traces.
- **Replay from the ledger** — Replaying stored events reconstructs conversation timelines for debugging and compliance.
- **Adapters stay thin** — New channels and backends only need to produce and consume canonical events; they do not reimplement policy or audit.

## The event envelope {#envelope}

Events conform to a shared **JSON Schema** contract. The envelope carries cross-cutting fields so traces survive across services and storage backends, for example:

- `event_id` — unique identifier for the event instance
- `event_type` — such as `message.received` or `policy.decision.made`
- `correlation_id` — ties one user turn together across all seven steps
- `causation_id` — links an event to the specific prior event that triggered it
- `tenant_id`, `workspace_id` — isolation and scoping for multi-tenant deployments
- `timestamp` — when the event was recorded
- `payload` — type-specific body validated against the schema for that `event_type`

Normative detail lives in the project's RFCs and schema artifacts; implementations validate at boundaries so bad data never poisons the ledger silently.

## Adapters as boundary translators {#adapters}

Chat Agent Relay splits the world at two interfaces. **Channel adapters** implement **ChannelAdapter**: turn vendor webhooks or sockets into `message.received` via `canonicalize()`, and create senders for outbound delivery via `createSender()`. The adapter also declares its capabilities — streaming, editing, commands — so the pipeline can adapt its behavior.
**Agent adapters** implement **AgentAdapter**: consume invocation events, call agent runtimes or HTTP services, and emit `agent.response.completed`.
Both sides speak only canonical events plus the envelope — the glue that used to sprawl across your codebase becomes replaceable modules.

## Try it and read the specs {#cta}

Run Chat Agent Relay locally from the [documentation](/ChatAgentRelay/docs/), then read the RFCs in the repository for the full contract. The seven-event story is the spine that keeps channels, agents, and audit aligned.
