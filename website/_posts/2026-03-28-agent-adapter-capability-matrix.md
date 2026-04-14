---
layout: post
title: "Agent Adapter Capability Matrix — What Each Protocol Can and Cannot Do"
date: 2026-03-28
description: "Historical capability matrix for Chat Agent Relay's earlier multi-adapter design, showing how protocol constraints shaped the transition to A2A as the standard agent-side boundary."
keywords: "Chat Agent Relay, CAR, agent adapter, A2A, LangGraph, ACP, Agent Client Protocol, HTTP adapter, OpenAI, streaming, HITL, human-in-the-loop, capability matrix, 2026"
og_type: article
og_title: "Agent Adapter Capability Matrix — What Each Protocol Can and Cannot Do"
og_description: "Capability matrix for CAR's earlier multi-adapter design. CAR now uses A2A as the sole agent protocol."
twitter_title: "Agent Adapter Capability Matrix — Chat Agent Relay"
twitter_description: "Capability matrix for CAR's earlier multi-adapter design. CAR now uses A2A as the sole agent protocol."
read_time: "8 min read"
category_label: "Technical deep dive"
card_title: "Agent Adapter Capability Matrix"
card_description: "Comparison of CAR's earlier five-adapter design, with links to the current A2A-only architecture"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/agents/"
cta_primary_text: "Adapter Documentation"
cta_primary_track: "blog_matrix_docs"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay"
cta_secondary_text: "View on GitHub"
cta_secondary_track: "blog_matrix_github"
extra_head: |
  <style>
    .cap-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 1.5rem 0; }
    .cap-table th, .cap-table td { padding: 0.5rem 0.65rem; border: 1px solid #e0e0e0; text-align: center; vertical-align: top; }
    .cap-table th { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
    .cap-table td:first-child { text-align: left; font-weight: 600; }
    .cap-table tr:hover { background: #fafafa; }
    .yes { color: #16a34a; font-weight: 600; }
    .no { color: #dc2626; }
    .cond { color: #d97706; font-weight: 500; }
    .limit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1.5rem 0; }
    .limit-card { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.25rem; }
    .limit-card h4 { margin: 0 0 0.5rem; font-size: 1rem; }
    .limit-card p { margin: 0; font-size: 0.9rem; color: #555; }
    @media (max-width: 768px) { .limit-grid { grid-template-columns: 1fr; } }
  </style>
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "Agent Adapter Capability Matrix — What Each Protocol Can and Cannot Do"
  description: "Historical capability matrix for Chat Agent Relay's earlier multi-adapter design and the protocol constraints that informed the move to A2A as the standard agent-side boundary."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/agent-adapter-capability-matrix/"
  datePublished: "2026-03-28"
  dateModified: "2026-03-28"
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

<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0">
  <strong>Update (March 31, 2026):</strong> This article compares an earlier multi-adapter design. CAR now uses <strong>A2A as the sole agent protocol</strong>. See <a href="/ChatAgentRelay/blog/one-protocol-a2a/" style="font-weight:600">One Protocol to Connect Them All: Why CAR Chose A2A</a> for the rationale.
</div>

This article captures an earlier phase when Chat Agent Relay compared five agent adapters across the 2026 landscape. Not every adapter could do everything — and that was partly a protocol reality, partly a scope choice. This post maps that historical capability matrix and explains *why* each cell looked the way it did.

## The AgentAdapter Interface {#the-interface}

Every adapter implements the same TypeScript interface, aligned with A2A protocol semantics:

```
interface AgentAdapter {
  describeCapabilities(): AgentCapabilities;
  invoke(context): Promise<AgentResult>;
  stream?(context): AsyncGenerator<AgentEvent, AgentResult>;
  resume?(sessionHandle, input): Promise<AgentResult>;
  resumeStream?(sessionHandle, input): AsyncGenerator<AgentEvent, AgentResult>;
  cancel?(sessionHandle): Promise<void>;
}
```

Methods after `invoke()` are optional. The pipeline checks `describeCapabilities()` at runtime and falls back gracefully: no streaming? call `invoke()`. No cancel? skip it. This means adapters can be honest about what they support without breaking the pipeline.

## The Full Matrix {#matrix}

<div style="overflow-x:auto">
<table class="cap-table">
  <thead>
    <tr>
      <th>Capability</th>
      <th>A2A</th>
      <th>LangGraph</th>
      <th>ACP</th>
      <th>HTTP</th>
      <th>OpenAI</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>invoke()</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
    </tr>
    <tr>
      <td>stream()</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="cond">opt-in</td>
      <td class="yes">&#10003;</td>
    </tr>
    <tr>
      <td>resume()</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
    <tr>
      <td>resumeStream()</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
    <tr>
      <td>cancel()</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
    <tr>
      <td>HITL</td>
      <td class="yes">&#10003;</td>
      <td class="yes">&#10003;</td>
      <td class="cond">policy</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
    <tr>
      <td>Sessions</td>
      <td class="yes">contextId</td>
      <td class="yes">thread</td>
      <td class="yes">sessionId</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
    <tr>
      <td>Artifacts</td>
      <td class="yes">&#10003;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
      <td class="no">&#10007;</td>
    </tr>
  </tbody>
</table>
</div>

Three adapters — A2A, LangGraph, and ACP — implement the full operational surface. HTTP and OpenAI are intentionally simpler: they cover request-response and streaming, but stateful operations like HITL and session management are outside their protocol scope.

## The Full-Featured Trio {#full-featured}

### A2A — The Protocol Standard

Google's Agent-to-Agent protocol was the richest adapter in this comparison. It implemented every method on the interface and was the only adapter that supported **artifacts** — structured outputs beyond text (files, data payloads). On creation, the adapter fetched the agent's `/.well-known/agent.json` Agent Card for capability discovery. Sessions used A2A's `contextId` for multi-turn continuity. HITL worked via the `input-required` task state, and cancellation used `task/cancel` JSON-RPC.

### LangGraph — The Framework Native

LangGraph's Thread/Run API maps cleanly to the adapter interface. Each CAR conversation maps to a LangGraph thread; streaming uses `stream_mode: ["messages-tuple"]` for incremental deltas. HITL is powered by LangGraph's `__interrupt__` mechanism — the adapter detects interrupts after streaming completes and yields `input_required` events. Resume sends `command: { resume: text }` to continue execution. Cancellation deletes the active run via `DELETE /threads/{id}/runs/{runId}`.

### ACP — The Subprocess Protocol

Agent Client Protocol connects to coding agents (Claude Code, Gemini CLI) via subprocess and JSON-RPC over stdin/stdout. Streaming comes from `session/update` notifications delivering `message_chunk` events. HITL is controlled by `permissionPolicy`: when set to `hitl`, tool permission requests surface as `input_required` events; `auto-approve` and `deny` handle permissions silently. Sessions are keyed by conversation and reused across messages. Both `resume()` and `resumeStream()` send follow-up prompts on existing sessions.

## The Simple Pair {#simple}

### HTTP — Maximum Flexibility

The HTTP adapter connects to *any* HTTP endpoint. It supports customizable request bodies, response field extraction, and optional SSE streaming (via `streaming.enabled`). What it doesn't support — HITL, sessions, resume, cancel — isn't a bug; it's a fundamental protocol limitation. HTTP is stateless request-response. There's no standard mechanism for an HTTP server to pause execution and wait for human input, or for the client to cancel a request after the server has started processing.

### OpenAI — Direct LLM Access

The OpenAI adapter wraps `/v1/chat/completions` for direct LLM access with streaming. It's intentionally simple — stateless, no sessions, no HITL. Multi-turn context is managed by sending conversation history with each request. This adapter exists for quick prototyping and scenarios where you want a raw LLM without an agent runtime.

## Protocol Limitations vs. Implementation Decisions {#limitations}

Not every "&#10007;" in the matrix is the same. Some are hard protocol constraints; others are scope decisions we could revisit:

<div class="limit-grid">
  <div class="limit-card">
    <h4>&#x1F512; HTTP HITL / Resume / Cancel</h4>
    <p><strong>Protocol limitation.</strong> HTTP is fire-and-forget. No standard way to pause a request for human input, resume a paused task, or cancel server-side work. Would require inventing a custom protocol on top of HTTP — at which point you're just building A2A.</p>
  </div>
  <div class="limit-card">
    <h4>&#x1F512; OpenAI HITL / Sessions</h4>
    <p><strong>API design limitation.</strong> Chat Completions is stateless. There's no task or session concept. Every request is independent. OpenAI's Agents SDK and Responses API add statefulness, but those should be deployed as servers and connected via HTTP or A2A.</p>
  </div>
  <div class="limit-card">
    <h4>&#x1F4D0; LangGraph Artifacts</h4>
    <p><strong>Convention gap.</strong> LangGraph could return structured data via custom state values, but there's no standard convention for artifact delivery in the Thread/Run API. Implementing this would require opinionated assumptions about state structure.</p>
  </div>
  <div class="limit-card">
    <h4>&#x1F4D0; ACP Artifacts</h4>
    <p><strong>Protocol gap.</strong> The ACP specification doesn't define an artifact concept. Coding agents produce file changes as tool operations, not as structured artifact payloads. If ACP adds artifact semantics in a future version, we'll implement them.</p>
  </div>
</div>

## Streaming: Three Different Mechanisms {#streaming-detail}

Each adapter that supports streaming does so differently:

<table class="cap-table">
  <thead>
    <tr>
      <th>Adapter</th>
      <th>Transport</th>
      <th>Delta Source</th>
      <th>Opt-in?</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:left; font-weight:600">A2A</td>
      <td>HTTP SSE</td>
      <td><code>message/stream</code> &rarr; status-update, artifact-update, message events</td>
      <td>Always available</td>
    </tr>
    <tr>
      <td style="text-align:left; font-weight:600">LangGraph</td>
      <td>HTTP SSE</td>
      <td><code>/runs/stream</code> with <code>messages-tuple</code> stream mode</td>
      <td>Always available</td>
    </tr>
    <tr>
      <td style="text-align:left; font-weight:600">ACP</td>
      <td>stdin/stdout JSON-RPC</td>
      <td><code>session/update</code> notifications with <code>message_chunk</code> type</td>
      <td>Always available</td>
    </tr>
    <tr>
      <td style="text-align:left; font-weight:600">HTTP</td>
      <td>HTTP SSE</td>
      <td>Configurable <code>deltaTextField</code> extraction from SSE data chunks</td>
      <td>Yes &mdash; <code>streaming.enabled: true</code></td>
    </tr>
    <tr>
      <td style="text-align:left; font-weight:600">OpenAI</td>
      <td>HTTP SSE</td>
      <td>OpenAI delta format: <code>choices[0].delta.content</code></td>
      <td>Always available</td>
    </tr>
  </tbody>
</table>

## HITL: Three Different Mechanisms {#hitl-detail}

Each HITL-capable adapter triggers human input differently:

- **A2A:** The agent sets task state to `input-required`. The adapter detects this in status updates and yields `input_required`. Resume sends a new `message/send` or `message/stream` with the same `contextId`.
- **LangGraph:** The graph includes `interrupt()` nodes that pause execution. The adapter detects `__interrupt__` in the run result or thread state. Resume sends `command: { resume: text }`.
- **ACP:** The agent sends `session/request_permission` when it wants to use a tool. With `permissionPolicy: "hitl"`, the adapter yields `input_required` and surfaces the tool name. With `auto-approve`, it responds automatically.

## Choosing the Right Adapter {#choosing}

Decision tree:

1. Does your agent expose an **A2A endpoint**? Use `--type=a2a`. You get everything.
2. Is it deployed on **LangGraph Platform**? Use `--type=langgraph`. Full feature parity with A2A minus artifacts.
3. Is it a **local coding agent** (Claude Code, Gemini CLI)? Use `--type=acp`. Streaming, HITL, sessions, resume, cancel.
4. Does it expose a generic **HTTP endpoint**? Use `--type=http`. Request-response plus optional SSE streaming.
5. Do you just need a **raw LLM** for prototyping? Use `--type=openai`. Stateless with streaming.

As the agent ecosystem converges on A2A, the decision simplifies. Today's LangGraph and HTTP agents may expose A2A endpoints tomorrow. When they do, switch your adapter type and gain the full capability surface for free.

## Conclusion {#conclusion}

As a historical comparison, this matrix still shows something useful: protocol boundaries matter more than marketing checklists. Every checkmark in the matrix came from real behavior, and every "&#10007;" had a concrete reason: either the protocol didn't support it, or the underlying API design made it impractical. That clarity is part of what made the later shift to A2A as the standard agent-side boundary so compelling.

The full-featured trio (A2A, LangGraph, ACP) showed which protocols could support stateful relay scenarios cleanly. The simple pair (HTTP, OpenAI) covered lighter-weight use cases. Read that way, the matrix is less a product identity statement and more a snapshot of why CAR eventually narrowed its standard agent-side boundary.
