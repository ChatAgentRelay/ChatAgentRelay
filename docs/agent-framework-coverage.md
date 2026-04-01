# Agent Framework Coverage Matrix

> Last updated: 2026-03-28

CAR integrates with AI agent runtimes exclusively through the **A2A (Agent-to-Agent) standard protocol**. This document maps every major agent framework to its CAR connectivity path.

## Design Principle

CAR connects to **agent runtimes**, not raw model APIs. Every framework connects through the A2A protocol adapter:

| Protocol | Package | Transport | Use Case |
|----------|---------|-----------|----------|
| **A2A** | `backend-a2a` | HTTP (JSON-RPC 2.0 + SSE) | Any agent exposing an A2A endpoint |

## Coverage Matrix

| Framework / Platform | GitHub Stars | A2A Support | CAR Coverage | Notes |
|---|---|---|---|---|
| **LangGraph** (LangChain) | 12k+ | ✅ Native (`A2ARemoteGraph`) | ✅ Full | A2A client-side native; Platform API also supports A2A server |
| **LangChain** | 100k+ | ✅ Via LangGraph deployment | ✅ Full | Deploy on LangGraph Platform → expose as A2A |
| **CrewAI** | 44k+ | ✅ Native (`crewai.a2a`) | ✅ Full | First-class A2A delegation; both client and server modes |
| **AutoGen / AG2** (Microsoft) | 40k+ | ✅ Native (`A2aRemoteAgent`) | ✅ Full | Full A2A server + client; Azure-native |
| **Google ADK** | 30k+ | ✅ Native (`to_a2a()`) | ✅ Full | Zero-config A2A server; Python/Java/Go/TS |
| **MS Agent Framework / Semantic Kernel** | 22k+ | ✅ Native A2A integration | ✅ Full | Official A2A samples and transport-agnostic agents |
| **Mastra** | 15k+ | ✅ A2A v0.3.0 | ✅ Full | TypeScript-native; A2A implemented |
| **Claude Agent SDK** (Anthropic) | — | ✅ Via A2A bridge (`a2a-opencode`, `coder/agentapi`) | ⚡ Wrappable | Coding agents connect via community A2A bridges |
| **LlamaIndex** | 40k+ | ✅ A2A Workflows demo | ✅ Full | A2A integration demonstrated |
| **Dify** | 80k+ | ✅ A2A plugin (Marketplace) | ✅ Full | Community-driven A2A client |
| **n8n** | 70k+ | ✅ A2A Server/Client | ✅ Full | MCP + A2A support |
| **Phidata / Agno** | 18k+ | 🔄 In progress | ✅ Trending | A2A support under active development |
| **OpenAI Agents SDK** | — | ❌ No native | ⚡ Wrappable | Community confirmed < 1hr to add A2A wrapper |
| **AutoGPT** | 170k+ | Via A2A wrapper | ⚡ Wrappable | HTTP endpoints → thin A2A wrapper |
| **Flowise** | 40k+ | ❌ No native | ⚡ Wrappable | HTTP API → thin A2A wrapper |
| **Haystack** (deepset) | 20k+ | Via A2A wrapper | ⚡ Wrappable | Pipeline-based; wrappable |

### Legend

- ✅ **Full** — native protocol support; works out of the box with CAR
- ⚡ **Wrappable** — no native support yet, but easily wrapped in A2A (< 1 hour)
- 🔄 **Trending** — support under active development; expected soon

## For Frameworks Without Native A2A

If your agent framework does not yet expose an A2A endpoint:

1. **Wait for native support** — A2A adoption is accelerating; most major frameworks added support in 2025–2026
2. **Write a thin A2A wrapper** — The [a2a-python](https://github.com/a2aproject/a2a-python) and [a2a-js](https://github.com/a2aproject/a2a-js) SDKs make this straightforward
3. **Use CAR's factory registration** — Register a custom `AgentAdapter` via `agentRegistry.registerFactory("custom", myFactory)` for non-standard protocols
4. **Contribute upstream** — PRs adding A2A server support to frameworks benefit the entire ecosystem

## Protocol Landscape (2026)

As of early 2026, A2A is managed by the **Linux Foundation's Agentic AI Foundation (AAIF)**:

- **A2A** — 150+ supporting organizations; the de facto standard for agent-to-agent HTTP communication
- **MCP** — Agent-to-tool protocol (orthogonal to A2A; agents use MCP internally for tools)

These protocols are **complementary**, not competing. A production agent system typically uses A2A for inter-agent communication and MCP for tool access.
