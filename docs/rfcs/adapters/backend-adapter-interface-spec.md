# RFC: Chat Agent Relay Backend Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Backend adapter implementers |
| **Version** | v0.4 |
| **Last Updated** | 2026-03-28 |
| **Companion** | `backend-agent-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document formalizes the TypeScript interface contracts that all Chat Agent Relay (CAR) backend adapters MUST implement. It covers the **AgentAdapter** interface and the HTTP backend configuration. It complements the high-level backend agent adapter contract RFC with precise type-level requirements.

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. Protocol-Based Agent Integration

CAR integrates with agent runtimes exclusively through the A2A standard protocol:

- **A2A (Agent-to-Agent)** — `@chat-agent-relay/backend-a2a` — for HTTP-based agents using the A2A protocol (JSON-RPC 2.0, Agent Cards, SSE streaming). Covers CrewAI, Google ADK, AutoGen/AG2, LangGraph, Mastra, Semantic Kernel, and all A2A-compliant runtimes.

The A2A adapter implements `AgentAdapter` (§10) using canonical types from `@chat-agent-relay/contract-harness`.

### 3.1 invoke() — Synchronous Invocation

HTTP-oriented `AgentAdapter` implementations MUST implement `invoke()`.

#### Input: AgentInvocationContext

The full type is defined in §10.4. In summary:

```typescript
type AgentInvocationContext = {
  invocationEvent: CanonicalEvent;
  messageText: string;
  parts?: AgentPart[];
  route?: { route_id: string; reason: string };
  policy?: { policy_id: string; decision: string };
  sessionHandle?: string;
  conversationHistory?: ConversationTurn[];
};

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};
```

Requirements:

- `invocationEvent` MUST be a valid `agent.invocation.requested` canonical event.
- `messageText` MUST be the user's message text extracted from the originating `message.received` event.
- `conversationHistory` MAY contain previous conversation turns for multi-turn context. Adapters SHOULD use this to provide conversation memory.

#### Output: AgentResult

```typescript
type AgentResult = AgentSuccess | AgentFailure;

type AgentSuccess = {
  ok: true;
  event: CanonicalEvent;
  requestId: string;
  sessionHandle?: string;
  artifacts?: AgentArtifact[];
};

type AgentFailure = {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
    details?: Record<string, unknown>;
  };
};
```

(See §10.5 for normative `AgentResult` semantics.)

#### Success Path

- `event` MUST be a fully-formed `agent.response.completed` canonical event that passes both envelope and specialized schema validation.
- `event.correlation_id` MUST match `invocationEvent.correlation_id`.
- `event.causation_id` MUST be `invocationEvent.event_id`.
- `event.payload` MUST contain `{ text: string }` with the agent's response.
- `requestId` MUST be a unique identifier for the backend request.

#### Failure Path

- Adapters MUST NOT throw exceptions from `invoke()`. All backend failures MUST be returned as `AgentFailure`.
- `error.retryable` MUST be `true` for transient failures (timeouts, rate limits, 5xx errors) and `false` for permanent failures.
- `error.category` MUST be one of: `"invalid_request"`, `"timeout"`, `"dependency_failure"`, `"backend_unavailable"`.

### 3.2 stream() — Streaming Invocation (Optional)

Adapters MAY implement `stream()` (§10) to support progressive response delivery.

```typescript
stream?(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult>;
```

Requirements:

- Each `yield` MUST produce an `AgentEvent` (§10.3); for text deltas, adapters MUST use `{ type: "text_delta", content: string }`.
- The generator’s **return** value MUST be an `AgentResult` containing the complete final `agent.response.completed` event.
- The final `agent.response.completed` event MUST contain the full assembled text, not just the last delta.
- Streaming deltas are a transport optimization. Only the final `agent.response.completed` event is appended to the canonical ledger. No intermediate delta events enter the canonical event model.

## 4. Required Event Fields

The produced `agent.response.completed` event MUST include:

| Field | Requirement |
|---|---|
| `event_id` | MUST be globally unique |
| `schema_version` | MUST be `"v1alpha1"` |
| `event_type` | MUST be `"agent.response.completed"` |
| `tenant_id` | MUST match `invocationEvent.tenant_id` |
| `workspace_id` | MUST match `invocationEvent.workspace_id` |
| `channel` | MUST match `invocationEvent.channel` |
| `conversation_id` | MUST match `invocationEvent.conversation_id` |
| `session_id` | MUST match `invocationEvent.session_id` |
| `correlation_id` | MUST match `invocationEvent.correlation_id` |
| `causation_id` | MUST be `invocationEvent.event_id` |
| `actor_type` | MUST be `"agent"` |
| `payload` | MUST contain `{ text: string }` |

## 5. Provider Extensions

Adapters SHOULD preserve backend-specific metadata in `provider_extensions`, namespaced by backend type:

```json
{
  "provider_extensions": {
    "openai": {
      "request_id": "req_abc",
      "model": "gpt-4o-mini",
      "openai_id": "chatcmpl-xyz",
      "finish_reason": "stop",
      "prompt_tokens": 20,
      "completion_tokens": 8,
      "total_tokens": 28
    }
  }
}
```

## 6. Conversation History

When `conversationHistory` is provided:

- Adapters SHOULD prepend the history to the current message before invoking the backend.
- History entries are ordered chronologically (oldest first).
- Each turn has a `role` (`"user"` or `"assistant"`) and `content` (text).
- The current user message (`messageText`) MUST be appended after the history — it MUST NOT be included in `conversationHistory` itself.

## 7. Error Taxonomy

Adapters SHOULD use the following error codes:

| Code | Category | Retryable | Meaning |
|---|---|---|---|
| `backend_timeout` | `timeout` | Yes | Backend did not respond in time |
| `backend_unavailable` | `backend_unavailable` | Yes | Could not reach backend |
| `openai_http_error` | varies | varies | Backend returned non-2xx HTTP status |
| `invalid_response` | `dependency_failure` | No | Response was not valid JSON |
| `empty_response` | `dependency_failure` | No | Response contained no content |
| `contract_violation` | `invalid_request` | No | Mapped event failed schema validation |

## 8. HTTP Backend Conformance Checklist

A conforming HTTP backend implementation MUST:

- [ ] Implement `AgentAdapter` with `describeCapabilities()` and `invoke()` accepting `AgentInvocationContext` and returning `AgentResult`
- [ ] Never throw from `invoke()` — all errors returned as `AgentFailure`
- [ ] Produce schema-valid `agent.response.completed` events on success
- [ ] Preserve `correlation_id` and `causation_id` from invocation event
- [ ] Set `error.retryable` accurately on failure
- [ ] Include a unique `requestId` in all results
- [ ] Preserve backend metadata in `provider_extensions`

A conforming streaming adapter additionally MUST:

- [ ] Yield `AgentEvent` values from `stream()` (e.g. `text_delta` for partial content)
- [ ] Return a final `AgentResult` with complete assembled text
- [ ] Not produce canonical delta events (deltas are transport-only)

## 9. Existing Implementations

| Adapter | Package | Status | Backend |
|---|---|---|---|
| `A2AAgentAdapter` | `backend-a2a` | Active | A2A protocol (HTTP-based agents) |

## 10. AgentAdapter Interface (v2)

The `AgentAdapter` interface is the primary agent-side boundary. It is aligned with the [A2A (Agent-to-Agent) protocol](https://google.github.io/A2A/) and supports structured events, human-in-the-loop (HITL) signaling, artifacts, and session management.

### 10.1 Design Rationale

`AgentAdapter` supports the full lifecycle of modern agent runtimes:
- Task lifecycle status (submitted → working → completed)
- Human input mid-execution (HITL)
- Structured artifacts (files, data)
- Session management across multiple interactions

A2AAgentAdapter is the built-in AgentAdapter implementation; capabilities vary by the remote agent's declared features.

Capability semantics:
- `multiTurn` — when `true`, the pipeline provides conversation history from the ledger. Agents that do not maintain their own context SHOULD declare this.
- `resume` — when `true`, the agent supports `resume()` and `resumeStream()` for continuing execution after human input. MUST be `true` when `hitl` is `true`.

### 10.2 Interface Definition

```typescript
interface AgentAdapter {
  describeCapabilities(): AgentCapabilities;
  invoke(context: AgentInvocationContext): Promise<AgentResult>;
  stream?(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult>;
  resume?(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult>;
  resumeStream?(sessionHandle: string, input: AgentResumeInput): AsyncGenerator<AgentEvent, AgentResult>;
  cancel?(sessionHandle: string): Promise<void>;
}

type AgentCapabilities = {
  streaming: boolean;
  multiTurn: boolean;
  resume: boolean;
  hitl: boolean;
  cancel: boolean;
  artifacts: boolean;
};
```

Requirements:

- All implementations MUST implement `describeCapabilities()` and `invoke()`.
- `stream()`, `resume()`, `resumeStream()`, and `cancel()` are OPTIONAL.
- Implementations MUST NOT throw from `invoke()` or `stream()` — all failures MUST be returned as `AgentFailure`.

### 10.3 AgentEvent Types

`AgentAdapter.stream()` yields structured `AgentEvent` values:

```typescript
type AgentEvent =
  | AgentStatusEvent
  | AgentTextDeltaEvent
  | AgentArtifactEvent
  | AgentInputRequiredEvent;

type AgentStatusEvent = { type: "status"; status: AgentTaskStatus; message?: string };
type AgentTextDeltaEvent = { type: "text_delta"; content: string };
type AgentArtifactEvent = { type: "artifact"; artifact: AgentArtifact };
type AgentInputRequiredEvent = {
  type: "input_required";
  prompt: string;
  metadata?: Record<string, unknown>;
};

type AgentTaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "cancelled";
```

Status events SHOULD be emitted at lifecycle transitions. `text_delta` events carry progressive response content. `input_required` signals HITL (see section 10.6). `artifact` events carry structured output.

### 10.4 AgentInvocationContext

```typescript
type AgentInvocationContext = {
  invocationEvent: CanonicalEvent;
  messageText: string;
  parts?: AgentPart[];
  route?: { route_id: string; reason: string };
  policy?: { policy_id: string; decision: string };
  sessionHandle?: string;
  conversationHistory?: ConversationTurn[];
};
```

Key fields:
- `parts` supports multi-modal input (text, file, data) aligned with A2A's Part model.
- `sessionHandle` provides session continuity across turns.

### 10.5 AgentResult

```typescript
type AgentResult = AgentSuccess | AgentFailure;

type AgentSuccess = {
  ok: true;
  event: CanonicalEvent;
  requestId: string;
  sessionHandle?: string;
  artifacts?: AgentArtifact[];
};

type AgentFailure = {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
    details?: Record<string, unknown>;
  };
};
```

`sessionHandle` is returned on success to allow session continuity across turns. `artifacts` carries structured output from the agent (files, data).

### 10.6 HITL Flow (Human-in-the-Loop)

When an agent requires human input mid-execution:

1. The agent adapter yields `{ type: "input_required", prompt: "..." }` during streaming (or returns status `"input-required"` in sync mode).
2. The pipeline emits an `agent.input.requested` canonical event and surfaces the prompt to the user via the chat channel.
3. The user replies. The pipeline emits an `agent.input.provided` canonical event.
4. The pipeline calls `resume(sessionHandle, input)` or `resumeStream(sessionHandle, input)` to continue agent execution.

Canonical events involved:
- `agent.status.changed` — records task lifecycle transitions
- `agent.input.requested` — agent asks for human input
- `agent.input.provided` — human provides the requested input

### 10.7 Content Parts (A2A Part Model)

```typescript
type TextPart = { kind: "text"; text: string };
type FilePart = { kind: "file"; name: string; mimeType: string; uri?: string; bytes?: string };
type DataPart = { kind: "data"; data: Record<string, unknown> };
type AgentPart = TextPart | FilePart | DataPart;
```

Parts are used in `AgentInvocationContext.parts`, `AgentResumeInput.parts`, and `AgentArtifact.parts`.

### 10.8 AgentAdapter Conformance Checklist

A conforming `AgentAdapter` implementation MUST:

- [ ] Implement `describeCapabilities()` returning accurate `AgentCapabilities`
- [ ] Implement `invoke()` accepting `AgentInvocationContext` and returning `AgentResult`
- [ ] Never throw from `invoke()` — all errors returned as `AgentFailure`
- [ ] Produce schema-valid `agent.response.completed` events on success
- [ ] Preserve `correlation_id` and `causation_id` from invocation event
- [ ] Set `error.retryable` accurately on failure
- [ ] Include a unique `requestId` in all results

A conforming streaming adapter additionally MUST:

- [ ] Yield `AgentEvent` values from `stream()` (not raw strings)
- [ ] Return a final `AgentResult` with complete assembled text
- [ ] Emit `{ type: "status", status: "working" }` at stream start

A conforming HITL adapter additionally MUST:

- [ ] Yield `{ type: "input_required", prompt }` when human input is needed
- [ ] Implement `resume()` to continue execution after input is provided
- [ ] Return a `sessionHandle` in `AgentSuccess` for session continuity

## 11. Dynamic agent registration and AgentRegistry

Implementations MAY register **multiple** `AgentAdapter` instances at runtime (for example after loading rows from a config store). The server-side **`AgentRegistry`** holds named agent instances; **`routeFn`** (together with stored route rules) selects which registered agent receives each `agent.invocation.requested` flow.

Requirements:

- Each registered adapter MUST be addressable by a stable **name** aligned with route configuration.
- Adding, updating, disabling, or removing an agent SHOULD NOT require a full process restart when the deployment supports hot reload (channels likewise use a **ChannelRegistry**).
- The pipeline MUST receive a **`resolveAgent(agentName)`** (or equivalent) callback rather than assuming a single global backend instance.
- All agents connect via the A2A standard protocol; framework-specific adapters are not provided.

This section does not change the `AgentAdapter` contract itself — it describes how the runtime **selects** which conforming adapter executes for a given conversation turn.

## 12. ConfigStore interface

Configuration persistence follows an interface-driven pattern parallel to the event ledger's `LedgerStore`:

- **`ConfigStore`** defines the CRUD contract for channels, agents, routes, and settings.
- **`SqliteConfigStore`** is the built-in default implementation using `bun:sqlite`.
- Implementers MAY provide alternative backends (PostgreSQL, MySQL, etc.) by implementing the `ConfigStore` interface.
- Sensitive configuration fields (tokens, API keys) SHOULD be encrypted at rest; the default implementation uses AES-256-GCM via the `EncryptionEngine` utility.
