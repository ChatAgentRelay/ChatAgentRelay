---
layout: post
title: "Introducing Chat Agent Relay — Open-Source Chat-to-Agent Middleware"
heading: "Introducing Chat Agent Relay &mdash; Open-Source Chat-to-Agent Middleware"
date: 2026-03-01
description: "Chat Agent Relay makes the chat-to-agent layer explicit: canonical events, pluggable adapters, governance, and an append-only audit ledger."
keywords: "Chat Agent Relay, CAR, open source, middleware, Slack, OpenAI, chat bot, AI agent, TypeScript, Bun, governance, audit"
og_type: article
og_title: "Introducing Chat Agent Relay — Chat-to-Agent Middleware"
og_description: "Why we built explicit middleware between chat platforms and AI agents — and what you can use today."
twitter_title: "Introducing Chat Agent Relay — Chat-to-Agent Middleware"
twitter_description: "Canonical events, channel adapters, A2A agent boundary, governance, ledger, streaming, and delivery you do not have to rebuild."
category_label: "Launch post"
card_title: "Introducing Chat Agent Relay"
card_description: "Why we built an open-source middleware for chat-to-agent integration"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/"
cta_primary_text: "Try Chat Agent Relay"
cta_primary_track: "blog_intro_try"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay"
cta_secondary_text: "Star on GitHub"
cta_secondary_track: "blog_intro_github"
show_share: true
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "Introducing Chat Agent Relay — Open-Source Chat-to-Agent Middleware"
  description: "Why we built open-source middleware for chat-to-agent integration with canonical events and pluggable adapters."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/introducing-chat-agent-relay/"
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

<div style="background:#d1ecf1;border:1px solid #bee5eb;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0">
  <strong>Update (April 2026):</strong> Since this launch post, CAR has grown significantly: 8 channel adapters (including Teams and WhatsApp), a unified A2A agent protocol, enterprise governance (structured policies, rate limiting, outbound filtering), API authentication, tenant isolation, and 692 tests. See <a href="/ChatAgentRelay/blog/v1-road-to-production/" style="font-weight:600">From Prototype to Production</a> for the full journey.
</div>

## The problem {#problem}

Teams ship chat-to-agent flows as point-to-point integrations: a Slack webhook into custom code, then OpenAI, then the Slack API.
For a demo, that is enough. Then the scope grows: Microsoft Teams, audit logs for compliance, a different LLM, retries when delivery fails.
Each new requirement tends to mean another bespoke path through the codebase. What started as a thin glue layer becomes a rewrite every time the platform or vendor changes.

## Our approach {#approach}

**Make the chat-to-agent layer explicit.** Instead of ad hoc calls between transports and models, Chat Agent Relay centers a **canonical event model**:
the same sequence of events for every message, no matter which channel or backend you use.
**Pluggable adapters** sit on both sides — channels normalize into canonical events; backends consume them and return structured outcomes.
**Governance and audit** are part of the pipeline, not an afterthought: policy runs before the agent, and an append-only ledger records what happened.

## What Chat Agent Relay provides today {#today}

- **Channel adapters:** Slack (Socket Mode), Discord, and WebChat (HTTP)
- **Backend adapters:** OpenAI Chat Completions and configurable generic HTTP (custom headers, request/response mapping)
- **Policy engine:** configurable keyword and regex rules
- **Event ledger:** append-only store with in-memory and SQLite backends
- **Streaming:** OpenAI SSE mapped to progressive Slack updates
- **Delivery:** retry with exponential backoff and a dead-letter queue (DLQ)
- **REST API** for audit-oriented queries
- **Conformance test suite** for adapter validation
- **12 packages, 494 tests,** TypeScript strict mode

## Getting started {#quickstart}

From zero to a running server in three commands (fill in `.env` with your keys as described in [the docs](/ChatAgentRelay/docs/)):

<div class="terminal" style="max-width:100%;margin-bottom:16px">
  <div class="terminal-header">
    <span class="terminal-dot red"></span>
    <span class="terminal-dot yellow"></span>
    <span class="terminal-dot green"></span>
    <span class="terminal-title">quickstart</span>
  </div>
  <div class="terminal-body"><pre><span class="prompt-char">$</span> <span class="cmd">git clone https://github.com/ChatAgentRelay/ChatAgentRelay.git &amp;&amp; cd ChatAgentRelay</span>
<span class="prompt-char">$</span> <span class="cmd">bun install</span>
<span class="output">installed dependencies</span>
<span class="prompt-char">$</span> <span class="cmd">cd packages/server &amp;&amp; cp .env.example .env &amp;&amp; bun run start</span></pre></div>
</div>

## What's next {#next}

We are focused on widening the adapter surface and hardening the core:

- More channel and backend adapters (Teams, Telegram, Claude, and others)
- A richer policy engine for routing and safety
- Multi-tenant routing and isolation patterns
- Community contributions: issues, adapters, and specs welcome on [GitHub](https://github.com/ChatAgentRelay/ChatAgentRelay)

## Try it {#cta}

Chat Agent Relay is MIT licensed. Star the repo if it is useful, run through [Getting Started](/ChatAgentRelay/docs/), and share the project with your team.
