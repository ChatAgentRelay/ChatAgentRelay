# RFC: Chat Agent Relay Backend Adapter Interface Specification

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Backend adapter implementers |
| **Version** | v0.2 |
| **Last Updated** | 2026-03-25 |
| **Companion** | `backend-agent-adapter-contract.md` (high-level contract) |

## 1. Abstract

This document formalizes the TypeScript interface contracts that all Chat Agent Relay (CAR) backend adapters MUST implement. It complements the high-level backend agent adapter contract RFC with precise type-level requirements.

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 3. BackendAdapter Interface

A conforming backend adapter MUST implement the following interface:

```typescript
interface BackendAdapter {
  invoke(context: InvocationContext): Promise<InvocationResult>;
  invokeStreaming?(context: InvocationContext): AsyncGenerator<string, InvocationResult>;
}
```

### 3.1 invoke() — Synchronous Invocation

All backend adapters MUST implement `invoke()`.

#### Input: InvocationContext

```typescript
type InvocationContext = {
  invocationEvent: CanonicalEvent;
  messageText: string;
  route?: { route_id: string; reason: string };
  policy?: { policy_id: string; decision: string };
  backendSessionHandle?: string;
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

#### Output: InvocationResult

```typescript
type InvocationResult = InvocationSuccess | InvocationFailure;

type InvocationSuccess = {
  ok: true;
  event: CanonicalEvent;
  requestId: string;
};

type InvocationFailure = {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
  };
};
```

#### Success Path

- `event` MUST be a fully-formed `agent.response.completed` canonical event that passes both envelope and specialized schema validation.
- `event.correlation_id` MUST match `invocationEvent.correlation_id`.
- `event.causation_id` MUST be `invocationEvent.event_id`.
- `event.payload` MUST contain `{ text: string }` with the agent's response.
- `requestId` MUST be a unique identifier for the backend request.

#### Failure Path

- Adapters MUST NOT throw exceptions from `invoke()`. All backend failures MUST be returned as `InvocationFailure`.
- `error.retryable` MUST be `true` for transient failures (timeouts, rate limits, 5xx errors) and `false` for permanent failures.
- `error.category` MUST be one of: `"invalid_request"`, `"timeout"`, `"dependency_failure"`, `"backend_unavailable"`.

### 3.2 invokeStreaming() — Streaming Invocation (Optional)

Adapters MAY implement `invokeStreaming()` to support progressive response delivery.

```typescript
invokeStreaming?(context: InvocationContext): AsyncGenerator<string, InvocationResult>;
```

Requirements:

- Each `yield` MUST produce a `string` containing a text delta (partial response content).
- The `return` value MUST be an `InvocationResult` containing the complete final event.
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

## 8. Conformance Checklist

A conforming `BackendAdapter` implementation MUST:

- [ ] Implement `invoke()` accepting `InvocationContext` and returning `InvocationResult`
- [ ] Never throw from `invoke()` — all errors returned as `InvocationFailure`
- [ ] Produce schema-valid `agent.response.completed` events on success
- [ ] Preserve `correlation_id` and `causation_id` from invocation event
- [ ] Set `error.retryable` accurately on failure
- [ ] Include a unique `requestId` in all results
- [ ] Preserve backend metadata in `provider_extensions`

A conforming streaming adapter additionally MUST:

- [ ] Yield string deltas from `invokeStreaming()`
- [ ] Return a final `InvocationResult` with complete assembled text
- [ ] Not produce canonical delta events (deltas are transport-only)

## 9. Existing Implementations

| Adapter | Package | Backend |
|---|---|---|
| `GenericHttpBackend` | `@chat-agent-relay/backend-http` | Configurable HTTP endpoint |
| `OpenAIBackend` | `@chat-agent-relay/backend-openai` | OpenAI Chat Completions API |

### 9.1 GenericHttpBackend Configuration

`GenericHttpBackend` supports connecting to any HTTP agent without requiring the agent to speak CAR's native request/response format:

| Config Field | Type | Default | Purpose |
|---|---|---|---|
| `endpoint` | `string` | (required) | Agent HTTP endpoint URL |
| `timeoutMs` | `number` | `30000` | Request timeout in milliseconds |
| `headers` | `Record<string, string>` | `{}` | Custom request headers (e.g. `Authorization`) |
| `buildRequestBody` | `(messageText, history?) => unknown` | CAR native format | Custom request body builder function |
| `responseTextField` | `string` | `"output.text"` | Dot-path to extract response text (e.g. `"answer"`, `"result.data.text"`) |

When `buildRequestBody` and `responseTextField` are omitted, the adapter uses CAR's native request/response format for backward compatibility.
