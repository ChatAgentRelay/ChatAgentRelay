---
layout: post
title: "Agent Runtime Compatibility Analysis — Connecting CAR to Every Agent Backend"
heading: "Agent Runtime Compatibility Analysis &mdash; Connecting CAR to Every Agent Backend"
date: 2026-03-30
description: "Historical analysis of how Chat Agent Relay evaluated agent runtime coverage before consolidating on A2A as its standard agent-side protocol boundary."
keywords: "Chat Agent Relay, CAR, agent compatibility, LangGraph, A2A, AutoGen, AG2, Google ADK, CrewAI, n8n, Dify, backend adapter, agent runtime, 2026"
og_type: article
og_title: "Agent Runtime Compatibility Analysis — Connecting CAR to Every Agent Backend"
og_description: "Compatibility analysis for CAR's earlier adapter coverage model. CAR now uses A2A as the sole agent protocol."
twitter_title: "Agent Runtime Compatibility Analysis — Chat Agent Relay"
twitter_description: "Compatibility analysis for CAR's earlier adapter coverage model. CAR now uses A2A as the sole agent protocol."
read_time: "12 min read"
category_label: "Technical analysis"
card_title: "Agent Runtime Compatibility Analysis"
card_description: "Analysis of CAR's earlier adapter coverage model. See &ldquo;One Protocol&rdquo; for the current architecture"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/"
cta_primary_text: "Try Chat Agent Relay"
cta_primary_track: "blog_compat_try"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay"
cta_secondary_text: "View on GitHub"
cta_secondary_track: "blog_compat_github"
extra_head: |
  <style>
    .compat-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 1.5rem 0; }
    .compat-table th, .compat-table td { padding: 0.5rem 0.65rem; border: 1px solid #e0e0e0; text-align: left; vertical-align: top; }
    .compat-table th { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
    .compat-table td:first-child { font-weight: 600; }
    .compat-table tr:hover { background: #fafafa; }
    .compat-table code { font-size: 0.82rem; }
    .arch-diagram { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1.25rem 1.5rem; overflow-x: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; line-height: 1.6; white-space: pre; margin: 1.5rem 0; }
    .summary-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1rem; margin: 1rem 0; }
    .summary-grid dt { font-weight: 600; }
    .summary-grid dd { margin: 0; }
  </style>
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "Agent Runtime Compatibility Analysis — Connecting CAR to Every Agent Backend"
  description: "Historical analysis of how Chat Agent Relay evaluated agent runtime coverage before consolidating on A2A as its standard agent-side protocol boundary."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/agent-compatibility-analysis/"
  datePublished: "2026-03-30"
  dateModified: "2026-03-30"
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
  <strong>Update (March 31, 2026):</strong> This article describes CAR's earlier multi-adapter architecture. CAR now uses <strong>A2A as the sole agent protocol</strong>. All frameworks analyzed here remain accessible via A2A, either natively or through a wrapper. See <a href="/ChatAgentRelay/blog/one-protocol-a2a/" style="font-weight:600">One Protocol to Connect Them All: Why CAR Chose A2A</a> for the rationale and updated coverage matrix.
</div>

## Historical Architecture: Five Adapters, One Canonical Model {#architecture}

Chat Agent Relay sits between chat platforms and agent runtimes. On the inbound side, **Channel Adapters** normalize Slack, Discord, WebChat, Telegram, Lark, and DingTalk protocols into canonical events. On the outbound side, **Agent Adapters** normalize agent runtime protocols so the relay pipeline never couples to a single vendor.

At the time of this analysis, we evaluated five agent adapters that together covered the 2026 landscape:

- `backend-a2a` — Connects to any **A2A-compliant** agent (the emerging standard, supported natively by AG2, Google ADK, and growing).
- `backend-langgraph` — Native adapter for **LangGraph Platform**, the most widely deployed agent framework, using its Thread/Run REST API.
- `backend-acp` — **Agent Client Protocol** adapter for coding agents (Claude Code, Gemini CLI) via subprocess + JSON-RPC over stdin/stdout.
- `backend-http` — Generic HTTP adapter for **any runtime** that exposes a request/response endpoint, with optional SSE streaming.
- `backend-openai` — Direct **OpenAI Chat Completions** API wrapper for prototyping with streaming support.

<div class="arch-diagram">Chat Platforms    &rarr;  CAR  &rarr;  Agent Runtimes
&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;       &#9474;       &#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;&#9472;
Slack              canonical  LangGraph         (backend-langgraph)
Discord            events     AG2 / AutoGen     (backend-a2a)
WebChat            + audit    Google ADK        (backend-a2a)
                   + policy   Claude Code       (backend-acp)
                              n8n / Dify        (backend-http)
                              CrewAI            (backend-http &rarr; backend-a2a)
                              Custom agents     (backend-a2a or backend-http)</div>

The canonical event model — seven events per turn plus `event.blocked` — remains the same regardless of which agent adapter is in use. Governance, audit, and replay are orthogonal to the backend choice.

## Complete Agent Landscape Analysis {#landscape}

The table below maps every significant agent platform and framework in the 2026 ecosystem to CAR's adapter layer. We evaluate protocol, streaming support, human-in-the-loop (HITL) capability, which CAR adapter applies, and overall coverage level.

<div style="overflow-x:auto">
<table class="compat-table">
  <thead>
    <tr>
      <th>Platform</th>
      <th>Category</th>
      <th>Protocol</th>
      <th>Streaming</th>
      <th>HITL</th>
      <th>CAR Adapter</th>
      <th>Coverage</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>LangGraph</td>
      <td>Agent Framework</td>
      <td>REST (Thread/Run API)</td>
      <td>SSE (messages-tuple)</td>
      <td>interrupt() / Command(resume=)</td>
      <td><code>backend-langgraph</code></td>
      <td>&#x2705; Full</td>
      <td>Native adapter with thread reuse, HITL, streaming</td>
    </tr>
    <tr>
      <td>AG2 (AutoGen v2)</td>
      <td>Agent Framework</td>
      <td>A2A (native)</td>
      <td>SSE</td>
      <td>A2A input-required</td>
      <td><code>backend-a2a</code></td>
      <td>&#x2705; Full</td>
      <td>Native A2A via A2aAgentServer</td>
    </tr>
    <tr>
      <td>Google ADK</td>
      <td>Agent Framework</td>
      <td>A2A (native, via to_a2a())</td>
      <td>SSE</td>
      <td>A2A input-required</td>
      <td><code>backend-a2a</code></td>
      <td>&#x2705; Full</td>
      <td>to_a2a() wraps any ADK agent for standard A2A</td>
    </tr>
    <tr>
      <td>CrewAI</td>
      <td>Agent Framework</td>
      <td>REST (kickoff/status/resume)</td>
      <td>No</td>
      <td>POST /resume</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Async polling pattern; CrewAI adopting A2A</td>
    </tr>
    <tr>
      <td>Mastra</td>
      <td>Agent Framework</td>
      <td>REST (Hono HTTP)</td>
      <td>SSE (/stream endpoint)</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Streaming not covered by current HTTP adapter</td>
    </tr>
    <tr>
      <td>LlamaIndex</td>
      <td>Agent Framework</td>
      <td>REST (WorkflowServer)</td>
      <td>SSE</td>
      <td>Events to in-progress workflows</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Basic request/response works; streaming/HITL need enhancement</td>
    </tr>
    <tr>
      <td>Semantic Kernel</td>
      <td>Agent Framework</td>
      <td>REST (ASP.NET)</td>
      <td>Streaming via Agent API</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x2705; Basic</td>
      <td>Standard HTTP request/response</td>
    </tr>
    <tr>
      <td>n8n</td>
      <td>Workflow Platform</td>
      <td>Webhook (HTTP POST)</td>
      <td>SSE (webhook streaming mode)</td>
      <td>No (workflow is atomic)</td>
      <td><code>backend-http</code></td>
      <td>&#x2705; Good</td>
      <td>Webhook trigger &rarr; workflow &rarr; response</td>
    </tr>
    <tr>
      <td>Dify</td>
      <td>Workflow Platform</td>
      <td>REST API</td>
      <td>SSE (response_mode: streaming)</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Blocking mode works; streaming needs SSE support</td>
    </tr>
    <tr>
      <td>Flowise</td>
      <td>Workflow Platform</td>
      <td>REST API</td>
      <td>SSE</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Blocking mode works; streaming needs SSE support</td>
    </tr>
    <tr>
      <td>Activepieces</td>
      <td>Workflow Platform</td>
      <td>Webhook (HTTP POST)</td>
      <td>No</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x2705; Good</td>
      <td>Standard webhook pattern</td>
    </tr>
    <tr>
      <td>Make.com / Zapier</td>
      <td>Workflow Platform</td>
      <td>Webhook (HTTP POST)</td>
      <td>No</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x2705; Good</td>
      <td>Standard webhook pattern</td>
    </tr>
    <tr>
      <td>OpenClaw</td>
      <td>Agent Platform</td>
      <td>REST API (Gateway)</td>
      <td>No</td>
      <td>No</td>
      <td><code>backend-http</code></td>
      <td>&#x2705; Good</td>
      <td>POST /api/sessions/main/messages</td>
    </tr>
    <tr>
      <td>OpenAI Agents SDK</td>
      <td>Dev SDK (client-side)</td>
      <td>N/A &mdash; runs locally</td>
      <td>N/A</td>
      <td>N/A</td>
      <td>N/A</td>
      <td>&#x1F535; Not applicable</td>
      <td>Client-side framework. Deploy as HTTP/A2A server, then connect.</td>
    </tr>
    <tr>
      <td>Anthropic Claude Agent SDK</td>
      <td>Dev SDK (client-side)</td>
      <td>N/A &mdash; runs locally</td>
      <td>N/A</td>
      <td>N/A</td>
      <td>N/A</td>
      <td>&#x1F535; Not applicable</td>
      <td>Build agent, deploy as server, connect via CAR.</td>
    </tr>
    <tr>
      <td>Cohere Agent API</td>
      <td>LLM Provider API</td>
      <td>REST API</td>
      <td>Streaming</td>
      <td>Tool loop</td>
      <td><code>backend-http</code></td>
      <td>&#x26A0;&#xFE0F; Partial</td>
      <td>Multi-step tool loop handled by Cohere; response is standard</td>
    </tr>
    <tr>
      <td>OpenAI Chat Completions</td>
      <td>LLM API (not agent)</td>
      <td>REST API</td>
      <td>SSE</td>
      <td>No</td>
      <td><code>backend-openai</code></td>
      <td>&#x2139;&#xFE0F; LLM only</td>
      <td>Raw LLM API, not an agent runtime. Use backend-http for general HTTP endpoints.</td>
    </tr>
    <tr>
      <td>Claude Code / Gemini CLI</td>
      <td>Coding Agent</td>
      <td>ACP (JSON-RPC over stdin/stdout)</td>
      <td>Yes (session/update)</td>
      <td>Yes (permission policy)</td>
      <td><code>backend-acp</code></td>
      <td>&#x2705; Full</td>
      <td>Subprocess agent with streaming, HITL, sessions, resume, cancel</td>
    </tr>
  </tbody>
</table>
</div>

## Key Insight: Development SDKs vs. Deployed Agents {#sdk-vs-deployed}

A common source of confusion in the agent ecosystem is conflating **development SDKs** with **deployed agent servers**. The distinction is critical for understanding CAR's adapter layer.

Frameworks like the **OpenAI Agents SDK**, **Anthropic Claude Agent SDK**, **LangChain**, and **CrewAI** are *tools for building agents*. They run in a developer's process, orchestrate LLM calls, manage tool execution, and handle state. But they are not, by themselves, server-side APIs that CAR connects to.

The workflow is always the same:

1. **Build** your agent using your preferred SDK (OpenAI Agents SDK, LangGraph, CrewAI, etc.)
2. **Deploy** the agent behind a server interface (HTTP endpoint, A2A server, LangGraph Platform)
3. **Connect** CAR to the deployed server using the appropriate adapter

<div class="arch-diagram">Developer builds agent   &rarr;   OpenAI Agents SDK / LangGraph / CrewAI / ADK
Developer deploys agent  &rarr;   HTTP server / A2A server / LangGraph Platform
CAR connects to server   &rarr;   backend-a2a / backend-http / backend-langgraph</div>

This is why the "Not applicable" entries in the compatibility table are not gaps. CAR doesn't connect to the SDK — it connects to whatever server the SDK produces. If you build an agent with the OpenAI Agents SDK and wrap it in a FastAPI server, CAR talks to FastAPI via `backend-http`. If you expose it as an A2A server, CAR uses `backend-a2a`. The SDK is invisible to CAR; only the deployment surface matters.

## Coverage Assessment {#coverage}

Rolling up the compatibility matrix into a summary:

<dl class="summary-grid">
  <dt>&#x2705; Full coverage (8 platforms)</dt>
  <dd>LangGraph, AG2, Google ADK, n8n, Activepieces, Make.com/Zapier, Claude Code, Gemini CLI — complete feature support including streaming and HITL where applicable.</dd>

  <dt>&#x26A0;&#xFE0F; Partial coverage (5 platforms)</dt>
  <dd>CrewAI, Mastra, LlamaIndex, Dify, Flowise — basic request/response works today. Streaming SSE from HTTP endpoints is the consistent gap.</dd>

  <dt>&#x1F535; Not applicable (3 entries)</dt>
  <dd>OpenAI Agents SDK, Anthropic Claude Agent SDK, Cursor/Codex — development or IDE tools without a CAR-facing agent protocol. Build with the SDK, deploy as a server, then connect.</dd>

  <dt>&#x2139;&#xFE0F; LLM only (1)</dt>
  <dd>OpenAI Chat Completions via <code>backend-openai</code> — raw LLM API, not an agent runtime. Use <code>backend-http</code> if the direct API is genuinely needed.</dd>
</dl>

In practical terms: any team deploying agents in 2026 is using one of the platforms in the "Full" or "Partial" rows. The partial platforms all work in blocking mode today, and a single enhancement (SSE streaming in the HTTP adapter) would promote them all to full coverage.

## Gap Analysis: Resolved {#gap-analysis}

**Update:** The streaming SSE gap in `GenericHttpBackend` has been resolved. The HTTP adapter now supports optional SSE streaming via `streaming.enabled` in its config. When enabled, the adapter sends requests with `Accept: text/event-stream`, parses SSE lines, and yields deltas using a configurable `deltaTextField` path.

Additionally, the `backend-acp` adapter was added for coding agents (Claude Code, Gemini CLI) with full streaming, HITL, session management, resume, and cancel support via subprocess and JSON-RPC over stdin/stdout.

For a detailed feature-by-feature comparison of all five adapters, see our [Agent Adapter Capability Matrix](/ChatAgentRelay/blog/agent-adapter-capability-matrix/) post.

## The A2A Convergence {#a2a-convergence}

The most important trend in the 2026 agent ecosystem is the convergence on the **A2A (Agent-to-Agent) protocol** as a standard communication layer. This has direct implications for CAR's adapter strategy.

Where frameworks stand today:

- **AG2 / AutoGen** — Already native A2A. Their `A2aAgentServer` is the reference implementation.
- **Google ADK** — Already native A2A. The `to_a2a()` function wraps any ADK agent into a compliant A2A server with one line.
- **LangChain / LangGraph** — A2A launch partner. The LangGraph Platform is expected to offer an A2A-compatible surface alongside its existing Thread/Run API.
- **CrewAI** — Publicly moving toward A2A adoption. Their async kickoff/status/resume pattern maps naturally to A2A's task lifecycle.
- **Semantic Kernel, LlamaIndex** — Following the A2A conversation; adoption is a matter of time for any framework that wants interoperability.

The implication for CAR is clear: **the agent-side boundary should converge on `backend-a2a` over time**. As frameworks adopt A2A, the need for framework-specific adapters diminishes. `backend-langgraph` and `backend-http` served as bridges in this phase of the analysis and become less central as A2A adoption matures.

This is a strong relay-layer position. Rather than redefining CAR around every framework, the project can keep its chat-to-agent middleware role stable while investing in one standards-based agent-side boundary and letting the ecosystem converge toward it. The adapter count shrinks over time instead of growing.

## Where `backend-openai` Fits {#openai-positioning}

`backend-openai` wraps OpenAI's `/v1/chat/completions` endpoint directly. It is a raw LLM API adapter, not an agent runtime. It is useful for quick prototyping, but for production agent workloads, prefer:

- **`backend-a2a`** for A2A-compliant agents
- **`backend-langgraph`** for LangGraph Platform agents
- **`backend-http`** for any HTTP endpoint (including OpenAI-compatible APIs)
- **`backend-acp`** for coding agents via Agent Client Protocol

If users want OpenAI's *agent* capabilities (the Responses API, the Agents SDK), the correct path is: build an agent with the SDK, deploy it behind an HTTP or A2A server, and connect CAR to *that* server. The LLM call is an implementation detail inside the agent, not something CAR should be reaching through to invoke.

## Conclusion: Why This Comparison Mattered in 2026 {#conclusion}

The 2026 agent ecosystem is sprawling — dozens of frameworks, workflow platforms, SDK variants, and deployment patterns. But the protocol surface is remarkably constrained. Every deployed agent speaks one of five languages:

1. **A2A** — The emerging standard, growing fast. Full feature coverage with `backend-a2a`.
2. **LangGraph Platform API** — The most popular framework's Thread/Run API. Full coverage with `backend-langgraph`.
3. **ACP** — Subprocess-based coding agents. Full coverage with `backend-acp`.
4. **Generic HTTP** — Webhooks, REST APIs, workflow triggers. Request-response plus SSE streaming with `backend-http`.
5. **OpenAI API** — Direct LLM access for prototyping with `backend-openai`.

At that moment, five adapters explained the ecosystem reach. As A2A adoption accelerated through 2026 and beyond, the picture simplified further. The lasting takeaway is not that CAR should define itself by adapter count, but that its relay architecture benefits when the agent side converges on a standard protocol boundary.
