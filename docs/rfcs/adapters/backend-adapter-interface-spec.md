# RFC: Chat Agent Relay Agent-Side Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Agent-side adapter implementers |
| **Version** | v0.5 |
| **Last Updated** | 2026-04-02 |
| **Companion** | `backend-agent-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document defines the interface-level contract for agent-side adapters in Chat Agent Relay (CAR).

CAR is a standard relay layer between chat platforms and agents. On the agent side, CAR uses **A2A** as the standard protocol boundary. This RFC defines the precise adapter-facing types and result-shape requirements used at that boundary.

This document explicitly separates:
- **Core** — normative interface semantics required for conformance
- **Extension** — optional but aligned interface capabilities
- **Future Considerations** — non-normative directions that are not current conformance requirements

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. Purpose

This RFC defines the stable type-level contract for CAR's agent-side invocation boundary.

## 4. Product Boundary

For this RFC, the agent-side interface specification is responsible for:
- defining the adapter-facing invocation contract
- defining the result contract returned to CAR core
- defining the capability contract used by the relay path
- defining the structured event shapes used for optional streaming and resumable interaction

For this RFC, the agent-side interface specification is not:
- a general-purpose abstraction for arbitrary non-agent backends
- a framework-private runtime object model
- an agent-internal execution-governance contract
- a replacement for CAR's canonical event or middleware RFCs

## 5. Layering Model

### 5.1 Core

Core semantics define the minimum agent-side interface that a conforming CAR implementation MUST preserve.

### 5.2 Extension

Extension semantics define optional capabilities that fit CAR's relay model without redefining it.

### 5.3 Future Considerations

Future considerations preserve direction for later exploration, but MUST NOT be interpreted as current interface requirements.

## 6. Core Interface Statement

A conforming CAR implementation MUST expose an `AgentAdapter` interface as the primary agent-side boundary.

The standard protocol realized by that boundary is **A2A**. This RFC defines the CAR-side interface and mapping requirements, not the full A2A protocol itself.

## 7. Core AgentAdapter Interface

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

Core requirements:
- All implementations MUST implement `describeCapabilities()` and `invoke()`.
- `stream()`, `resume()`, `resumeStream()`, and `cancel()` are OPTIONAL.
- Implementations MUST return structured results rather than exposing runtime-private exceptions or objects across the boundary.

## 8. Core Invocation Contract

### 8.1 AgentInvocationContext

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

Core requirements:
- `invocationEvent` MUST be a valid `agent.invocation.requested` canonical event.
- `messageText` MUST be grounded in the originating canonical message path.
- `sessionHandle`, when present, MUST remain distinct from CAR's canonical identifiers.
- `conversationHistory` MAY be provided when relay-level multi-turn context is available.

### 8.2 AgentResult

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

Core requirements:
- `invoke()` MUST resolve to `AgentResult`.
- Adapters MUST return `AgentFailure` on failure rather than throwing framework-specific exceptions across the boundary.
- `requestId` MUST identify the adapter request for explainability.
- `sessionHandle` MAY be returned to preserve runtime-specific continuity.

## 9. Core Success Semantics

On success, the adapter MUST return an `AgentSuccess` whose `event` is a schema-valid `agent.response.completed` canonical event.

Required event constraints:
- `event.event_type` MUST be `"agent.response.completed"`
- `event.correlation_id` MUST match `invocationEvent.correlation_id`
- `event.causation_id` MUST be `invocationEvent.event_id`
- `event.tenant_id` MUST match `invocationEvent.tenant_id`
- `event.workspace_id` MUST match `invocationEvent.workspace_id`
- `event.conversation_id` MUST match `invocationEvent.conversation_id`
- `event.session_id` MUST match `invocationEvent.session_id`
- `event.payload` MUST carry the canonical response content

When channel context is present on the invocation event, the success event SHOULD preserve the relay-relevant channel fields needed by downstream delivery and audit.

## 10. Core Failure Semantics

On failure, adapters MUST return `AgentFailure`.

Core requirements:
- `error.code` MUST provide a stable machine-readable identifier
- `error.message` MUST provide a human-readable explanation
- `error.retryable` MUST distinguish transient from non-transient failure
- `error.category` MUST classify the failure in a stable way

Recommended categories:
- `"invalid_request"`
- `"timeout"`
- `"dependency_failure"`
- `"backend_unavailable"`

Illustrative error codes include:
- `agent_timeout`
- `agent_unavailable`
- `invalid_response`
- `empty_response`
- `contract_violation`

The exact error code vocabulary MAY evolve by implementation as long as category and retryability remain structured and stable.

## 11. Core Capability Semantics

`describeCapabilities()` MUST return accurate capability declarations for the relay path.

Core capability meanings:
- `streaming` — the adapter supports progressive output through `stream()`
- `multiTurn` — the adapter can use relay-provided conversation history
- `resume` — the adapter supports resumed execution after additional input
- `hitl` — the adapter can request human input during execution
- `cancel` — the adapter supports cancellation for an active runtime session
- `artifacts` — the adapter can return structured artifacts in addition to text

Rule:
- `hitl` MUST NOT be `true` unless resumable interaction semantics are supported by the adapter/runtime combination.

## 12. Extension Semantics

The following capabilities are aligned with CAR but are not required for all conforming implementations.

### 12.1 Streaming

Adapters MAY implement:

```typescript
stream?(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult>;
```

Requirements:
- Each yielded value MUST be an `AgentEvent`
- The generator return value MUST be a final `AgentResult`
- Streaming deltas are transport-side interaction semantics and MUST NOT replace the final canonical completion event

### 12.2 AgentEvent Types

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

These events extend the relay path with richer runtime interaction while remaining outside the minimum core success contract.

### 12.3 Resumable Interaction and HITL

Adapters MAY implement:

```typescript
resume?(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult>;
resumeStream?(sessionHandle: string, input: AgentResumeInput): AsyncGenerator<AgentEvent, AgentResult>;
```

When the adapter/runtime requires human input mid-execution, the relay path MAY map that requirement into canonical events such as:
- `agent.input.requested`
- `agent.input.provided`
- `agent.status.changed`

### 12.4 Cancellation

Adapters MAY implement:

```typescript
cancel?(sessionHandle: string): Promise<void>;
```

### 12.5 Artifacts and Content Parts

```typescript
type TextPart = { kind: "text"; text: string };
type FilePart = { kind: "file"; name: string; mimeType: string; uri?: string; bytes?: string };
type DataPart = { kind: "data"; data: Record<string, unknown> };
type AgentPart = TextPart | FilePart | DataPart;
```

`parts` MAY be used for richer A2A-aligned content input and artifact output where supported.

### 12.6 Provider Extensions

Adapters MAY preserve runtime-specific metadata in `provider_extensions`, namespaced by protocol or implementation key.

Illustrative example:

```json
{
  "provider_extensions": {
    "a2a": {
      "request_id": "req_abc",
      "task_id": "task_123",
      "finish_reason": "completed"
    }
  }
}
```

Rules:
- provider extensions MUST remain optional to the core contract
- provider extensions MUST NOT become the core source of truth for relay semantics
- framework-specific metadata MAY be included only as structured extension data

## 13. Existing Implementation

| Adapter | Package | Status | Protocol |
|---|---|---|---|
| `A2AAgentAdapter` | `backend-a2a` | Active | A2A |

The built-in implementation is A2A-centered. This RFC does not require CAR core to standardize unrelated agent-side protocol families.

## 14. Runtime Registration Context

Implementations MAY register multiple `AgentAdapter` instances at runtime. Route decisions then select which named adapter receives a given `agent.invocation.requested` flow.

Requirements:
- each registered adapter MUST be addressable by a stable name aligned with route configuration
- runtime selection MUST preserve the same `AgentAdapter` contract regardless of which registered agent is chosen
- multiple registered adapters do not change the agent-side standard boundary, which remains A2A-centered

This section describes runtime selection context, not a change to the interface contract itself.

## 15. Future Considerations

The following directions are intentionally non-normative in this RFC.

### 15.1 Rich Runtime Lifecycle Modeling

Examples:
- detailed workflow graph state models
- richer private checkpoint structures
- framework-specific internal state families

These are outside the current relay-centered interface core.

### 15.2 Agent-Internal Governance Semantics

Examples:
- tool approval systems inside the runtime
- delegated authorization graphs internal to the agent
- internal execution policy models

These are not part of the CAR agent-side interface contract.

### 15.3 Broad Multi-Protocol Abstraction

Examples:
- treating CAR's agent-side boundary as a generic abstraction over many unrelated non-A2A protocols
- expanding protocol-specific adapter families into the defining center of CAR's architecture

Current CAR direction is to keep the standard agent-side boundary centered on A2A.

## 16. Conformance

A conforming CAR agent-side adapter interface implementation MUST:
- implement `describeCapabilities()` and `invoke()`
- accept `AgentInvocationContext` grounded in canonical CAR invocation semantics
- return `AgentResult` as canonical success or structured failure
- preserve correlation and causation semantics on success
- preserve structured failure semantics on error
- keep runtime-private state and framework-private objects outside the public relay contract

A conforming implementation is NOT required to implement every extension or future consideration in this RFC.

## 17. Security Considerations

Implementations SHOULD:
- minimize exposure of runtime-private state through the interface boundary
- keep runtime-specific metadata in structured optional extension fields
- preserve the distinction between CAR canonical identity and runtime session handles
- avoid turning the interface contract into an implicit runtime-governance layer

## 18. Open Questions

- Which extension capabilities should eventually move into dedicated RFCs?
- How strongly should provider-extension metadata be standardized for explainability?
- Which resumable interaction semantics should remain here versus move to a dedicated companion RFC?
