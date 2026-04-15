---
layout: post
title: "One Protocol to Connect Them All: Why CAR Chose A2A"
date: 2026-03-31
description: "How Chat Agent Relay simplified its agent-side boundary around A2A. A2A is the standard protocol CAR uses on the agent side while CAR remains a relay layer between chat platforms and agents."
keywords: "Chat Agent Relay, CAR, A2A, Agent-to-Agent, Google A2A, agent protocol, agent interoperability, middleware, 2026, CrewAI, LangGraph, AutoGen, Google ADK, Mastra"
og_type: article
og_title: "One Protocol to Connect Them All: Why CAR Chose A2A"
og_description: "From five agent adapters to one agent-side protocol boundary. How CAR standardized on A2A while staying a relay between chat platforms and agents."
twitter_title: "One Protocol to Connect Them All: Why CAR Chose A2A"
twitter_description: "From five agent adapters to one agent-side protocol boundary. How CAR standardized on A2A without changing its role as a relay layer."
read_time: "10 min read"
category_label: "Architecture decision"
card_title: "One Protocol to Connect Them All: Why CAR Chose A2A"
card_description: "How Chat Agent Relay simplified its agent-side boundary around A2A while staying focused on chat-to-agent relay responsibilities"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/agents/"
cta_primary_text: "Agent Documentation"
cta_primary_track: "blog_a2a_docs"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay"
cta_secondary_text: "View on GitHub"
cta_secondary_track: "blog_a2a_github"
extra_head: |
  <style>
    .coverage-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 1.5rem 0; }
    .coverage-table th, .coverage-table td { padding: 0.5rem 0.65rem; border: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
    .coverage-table th { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
    .coverage-table td:first-child { font-weight: 600; }
    .coverage-table tr:hover { background: #fafafa; }
    .coverage-table code { font-size: 0.82rem; }
    .yes { color: #16a34a; font-weight: 600; }
    .bridge { color: #d97706; font-weight: 500; }
    .timeline { margin: 1.5rem 0; padding: 0; list-style: none; }
    .timeline li { position: relative; padding: 0 0 1.5rem 2rem; }
    .timeline li::before { content: ''; position: absolute; left: 0.5rem; top: 0.5rem; bottom: 0; width: 2px; background: #e0e0e0; }
    .timeline li:last-child::before { display: none; }
    .timeline li::after { content: ''; position: absolute; left: 0.15rem; top: 0.35rem; width: 12px; height: 12px; border-radius: 50%; background: var(--primary, #2563eb); border: 2px solid #fff; }
    .timeline .date { font-weight: 600; font-size: 0.85rem; color: var(--primary, #2563eb); }
    .insight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1.5rem 0; }
    .insight-card { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.25rem; }
    .insight-card h4 { margin: 0 0 0.5rem; font-size: 1rem; }
    .insight-card p { margin: 0; font-size: 0.9rem; color: #555; }
    @media (max-width: 768px) { .insight-grid { grid-template-columns: 1fr; } }
  </style>
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "One Protocol to Connect Them All: Why CAR Chose A2A"
  description: "How Chat Agent Relay simplified its agent-side boundary around A2A while staying a relay layer between chat platforms and agents."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/one-protocol-a2a/"
  datePublished: "2026-03-31"
  dateModified: "2026-03-31"
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

Today we're shipping a major simplification to Chat Agent Relay: **one agent-side protocol boundary instead of five framework-specific paths**. The `backend-a2a` package is now the standard boundary between CAR and deployed agents. This post explains why standardizing on an A2A-native path keeps the relay simpler while improving interoperability.

## The journey: five adapters to one {#journey}

When CAR started, the agent landscape was fragmented. Every framework spoke its own protocol, and connecting relay traffic into them required bespoke integration code. We shipped five agent-side adapters to cover the ground:

<ul class="timeline">
  <li>
    <span class="date">backend-http</span>
    Generic HTTP adapter for any REST endpoint. Request/response plus optional SSE streaming. Maximum flexibility, minimum features.
  </li>
  <li>
    <span class="date">backend-openai</span>
    Direct OpenAI Chat Completions wrapper. Useful for prototyping with raw LLM access, but stateless&mdash;no sessions, no HITL.
  </li>
  <li>
    <span class="date">backend-langgraph</span>
    Native adapter for LangGraph Platform&rsquo;s Thread/Run API. Full streaming, HITL via <code>interrupt()</code>, thread-based sessions.
  </li>
  <li>
    <span class="date">backend-acp</span>
    Agent Client Protocol for coding agents (Claude Code, Gemini CLI) via subprocess and JSON-RPC over stdin/stdout.
  </li>
  <li>
    <span class="date">backend-a2a</span>
    Google&rsquo;s Agent-to-Agent protocol. The richest adapter: streaming, HITL, sessions, resume, cancel, and artifacts.
  </li>
</ul>

Five adapters, eight capabilities, full ecosystem coverage. It worked. But we kept asking: *is this the right long-term architecture?*

## The agent framework landscape in 2026 {#landscape}

The answer came from the ecosystem itself. Google's **A2A (Agent-to-Agent) protocol** has become the de facto standard for agent interoperability. The numbers tell the story:

- **150+ organizations** have adopted or committed to A2A support
- Every major agent framework either speaks A2A natively or has A2A bridges available
- The protocol covers every feature CAR needs: streaming (SSE), HITL (`input-required` state), sessions (`contextId`), resume, cancel (`task/cancel`), and artifacts

When we analyzed 16 major agent frameworks and runtimes, we found that **every single one** is reachable via A2A — either natively or through a thin wrapper. That means CAR can keep its product identity as a relay layer while standardizing its agent-side integration on the protocol the ecosystem is already converging around.

## Coverage analysis: 16 frameworks, one protocol {#coverage}

The table below maps every significant agent framework to its A2A connectivity path. "Native" means the framework exposes an A2A endpoint directly. "Bridge" means an open-source adapter or wrapper makes the framework A2A-accessible.

<div style="overflow-x:auto">
<table class="coverage-table">
  <thead>
    <tr>
      <th>Framework</th>
      <th>A2A Path</th>
      <th>Streaming</th>
      <th>HITL</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Google ADK</td>
      <td class="yes">Native</td>
      <td class="yes">SSE</td>
      <td class="yes">input-required</td>
      <td><code>to_a2a()</code> wraps any ADK agent in one line</td>
    </tr>
    <tr>
      <td>AG2 / AutoGen</td>
      <td class="yes">Native</td>
      <td class="yes">SSE</td>
      <td class="yes">input-required</td>
      <td><code>A2aAgentServer</code> is the reference implementation</td>
    </tr>
    <tr>
      <td>CrewAI</td>
      <td class="yes">Native</td>
      <td class="yes">SSE</td>
      <td class="yes">input-required</td>
      <td>A2A support shipped in CrewAI Enterprise</td>
    </tr>
    <tr>
      <td>Mastra</td>
      <td class="yes">Native</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>Built-in A2A server mode</td>
    </tr>
    <tr>
      <td>LangGraph</td>
      <td class="yes">Native</td>
      <td class="yes">SSE</td>
      <td class="yes">input-required</td>
      <td>LangGraph Platform exposes A2A alongside Thread/Run API</td>
    </tr>
    <tr>
      <td>LlamaIndex</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>A2A wrapper around WorkflowServer</td>
    </tr>
    <tr>
      <td>Semantic Kernel</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>Microsoft A2A SDK integration</td>
    </tr>
    <tr>
      <td>OpenAI Agents SDK</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>Deploy behind any A2A-compatible server wrapper</td>
    </tr>
    <tr>
      <td>Anthropic Agent SDK</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>Deploy behind A2A server; or use a2a-opencode for CLI agents</td>
    </tr>
    <tr>
      <td>n8n</td>
      <td class="bridge">Bridge</td>
      <td>&mdash;</td>
      <td>&mdash;</td>
      <td>Webhook &rarr; A2A wrapper</td>
    </tr>
    <tr>
      <td>Dify</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>REST API &rarr; A2A wrapper</td>
    </tr>
    <tr>
      <td>Flowise</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>REST API &rarr; A2A wrapper</td>
    </tr>
    <tr>
      <td>Cohere Agent API</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td>&mdash;</td>
      <td>HTTP API &rarr; A2A wrapper</td>
    </tr>
    <tr>
      <td>Claude Code / Gemini CLI</td>
      <td class="bridge">Bridge</td>
      <td class="yes">SSE</td>
      <td class="yes">input-required</td>
      <td>Via a2a-opencode, a2a-copilot, or coder/agentapi</td>
    </tr>
    <tr>
      <td>Activepieces</td>
      <td class="bridge">Bridge</td>
      <td>&mdash;</td>
      <td>&mdash;</td>
      <td>Webhook &rarr; A2A wrapper</td>
    </tr>
    <tr>
      <td>Make.com / Zapier</td>
      <td class="bridge">Bridge</td>
      <td>&mdash;</td>
      <td>&mdash;</td>
      <td>Webhook &rarr; A2A wrapper</td>
    </tr>
  </tbody>
</table>
</div>

**16 frameworks. 16 accessible via A2A.** The native/bridge split is roughly 50/50 today, and the bridges are getting thinner as frameworks add native support.

## Why not framework-specific adapters? {#anti-pattern}

The conventional wisdom is: more adapters = more coverage. But for middleware like CAR, framework-specific adapters create what we call the **"simplest component pollution" anti-pattern**.

Here's the problem. CAR is a thin relay layer. Its job is to normalize chat platforms on one side and agent protocols on the other. Every framework-specific adapter adds:

- **A dependency** on the framework's API surface, which changes independently of CAR
- **A maintenance burden** — API updates, breaking changes, version compatibility matrices
- **A testing surface** — each adapter needs conformance tests against the live framework
- **A conceptual cost** — users have to choose between five adapter types and understand each one's limitations

When a single protocol covers all frameworks, the calculus flips. One adapter, one test suite, one set of capabilities, one CLI flag. The *simplest* component in the system — the agent adapter — stays simple.

<div class="insight-grid">
  <div class="insight-card">
    <h4>Before: 5 adapters</h4>
    <p>5 adapter packages, 5 test suites, 5 sets of configuration options, a decision tree for users, N&times;M compatibility matrix with chat channels.</p>
  </div>
  <div class="insight-card">
    <h4>After: 1 adapter</h4>
    <p>1 adapter package, 1 test suite, 1 configuration shape, zero decision overhead. <code>car agent add name --endpoint=url</code>. Done.</p>
  </div>
</div>

## Why not ACP? {#why-not-acp}

The **Agent Client Protocol (ACP)** is a well-designed protocol for a specific use case: connecting an *editor* to a *coding agent* via subprocess. It models tool permissions, file operations, and shell access. These are the right abstractions for VS Code talking to Claude Code.

But CAR isn't an editor. It's middleware. CAR doesn't run agents as subprocesses — it connects to deployed agent servers over the network. The subprocess model doesn't fit a relay that might run on a different machine (or container, or cloud) from the agents it connects to.

More importantly, the ACP use case is already covered: open-source bridges like **a2a-opencode**, **a2a-copilot**, and **coder/agentapi** wrap CLI-based coding agents in A2A-compatible servers. CAR connects to those servers via `backend-a2a` and gets streaming, HITL, and session management for free.

## The ecosystem of bridges {#bridges}

One reason we're confident in this decision is the thriving ecosystem of A2A bridges. These are open-source projects that wrap non-A2A agents in A2A-compatible servers:

- **a2a-opencode** — Wraps OpenCode, Claude Code, and other CLI agents in an A2A server. Streaming, HITL, session persistence.
- **a2a-copilot** — Exposes GitHub Copilot agents via A2A. Useful for connecting editor-native agents to chat platforms.
- **coder/agentapi** — Coder's Universal Agent Translator. Wraps any subprocess agent (Claude Code, Codex, Aider, Goose) in an A2A server with a single command.
- **Framework-native wrappers** — Google ADK's `to_a2a()`, AG2's `A2aAgentServer`, and LangGraph Platform's A2A mode are one-line integrations.

The bridge ecosystem means that even frameworks without native A2A support are just one wrapper away. And as native support grows, the bridges become unnecessary — you just point CAR directly at the framework's A2A endpoint.

## The result: maximum coverage, minimum surface area {#result}

With a single adapter, CAR's agent-side architecture becomes trivially simple:

```
car agent add my-agent --endpoint=http://localhost:9000
car route add --default --agent=my-agent
car start
```

That's it. No `--type` flag, no adapter selection decision tree, no capability comparison table. If your agent speaks A2A, CAR connects to it. If it doesn't speak A2A yet, wrap it with one of the bridges above.

The numbers improved across the board:

- **Unified adapter packages:** 1 agent-side package instead of 5 (`backend-a2a` is now the single boundary)
- **Adapter code simplified:** ~3,000 lines consolidated into the A2A path
- **Test surface simplified:** 8 framework-specific test files no longer need separate maintenance
- **Framework coverage:** unchanged (16/16 accessible via A2A)
- **Feature coverage:** improved (every agent gets the full A2A capability surface)

## Conclusion {#conclusion}

The agent interoperability problem is increasingly being solved by the ecosystem converging on A2A. Our job as middleware is to ride that convergence, not redefine ourselves around it. CAR still exists to relay between chat platforms and deployed agents; A2A is the standard protocol boundary we use on the agent side. That's the simplest architecture that covers the 2026 agent landscape without expanding CAR beyond its relay role.

If you're modernizing an existing CAR setup, the migration path is straightforward: deploy your agent behind an A2A server (most frameworks support this natively now) and update your CAR config to point at the A2A endpoint. See our [A2A documentation](/ChatAgentRelay/docs/agents/a2a/) for details.
