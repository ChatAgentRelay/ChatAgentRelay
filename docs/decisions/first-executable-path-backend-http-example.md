# Chat Agent Relay First Executable Path Generic HTTP Backend Example

This document gives a concrete example of the generic HTTP backend boundary for the first executable path.

It is a planning/design artifact derived from `docs/decisions/first-executable-path-plan.md`, not a finalized transport RFC or OpenAPI contract and not an approval to begin backend runtime work.

## Purpose

Show one narrow backend invocation and one narrow completed-response example for the first path so implementers can converge on:
- what the generic backend adapter sends
- what the backend minimally returns
- how CAR identifiers and runtime-private identifiers stay separated
- how the result maps back into canonical events

## First-Path Scope

This example is intentionally limited to:
- one request per `agent.invocation.requested`
- one completed plain-text response
- optional backend session mapping handle
- optional backend request id
- no tools
- no handoff
- no streaming deltas in the first happy path
- no async callback mode

## Example Invocation

The generic backend adapter may send a request conceptually like this:

```json
{
  "request_id": "req_01_first_path",
  "cap": {
    "event": {
      "event_id": "evt_103",
      "schema_version": "v1alpha1",
      "event_type": "agent.invocation.requested",
      "tenant_id": "tenant_acme",
      "workspace_id": "ws_support",
      "channel": "webchat",
      "channel_instance_id": "webchat_acme_prod",
      "conversation_id": "conv_1",
      "session_id": "sess_1",
      "correlation_id": "corr_1",
      "causation_id": "evt_102",
      "occurred_at": "2026-03-18T10:00:02Z",
      "actor_type": "system",
      "trace_context": {
        "trace_id": "trace_123",
        "span_id": "span_103",
        "parent_span_id": "span_102"
      },
      "payload": {
        "backend": "generic-http-agent",
        "input_event_id": "evt_100"
      }
    },
    "input": {
      "message": {
        "text": "Where is my order?"
      }
    },
    "context": {
      "route": {
        "route_id": "default_webchat_agent",
        "reason": "default_first_path_route"
      },
      "policy": {
        "policy_id": "default_ingress",
        "decision": "allow"
      }
    }
  },
  "backend_session": {
    "handle": "be_sess_42"
  }
}
```

## Invocation Notes

### What is CAR-owned
The following values remain platform-owned and must retain their canonical meaning:
- `tenant_id`
- `workspace_id`
- `channel`
- `channel_instance_id`
- `conversation_id`
- `session_id`
- `correlation_id`
- `causation_id`
- canonical invocation `event_id`

### What is backend-private
The following values are backend-owned or adapter-owned and must not replace canonical identifiers:
- `request_id`
- backend session handle
- runtime run ids
- framework-private object references

### Why the input is narrow
The first path only needs enough context to answer one inbound plain-text message. It does not need:
- full transcript replay in the backend request
- tool definitions
- handoff state
- rich capability negotiation
- provider-native raw payloads

## Example Completed Response

The generic backend may return a response conceptually like this:

```json
{
  "request_id": "req_01_first_path",
  "status": "completed",
  "output": {
    "text": "Your order shipped yesterday."
  },
  "backend": {
    "request_id": "backend_req_987",
    "session_handle": "be_sess_42",
    "agent_id": "support_agent_v1"
  },
  "trace_context": {
    "trace_id": "trace_123",
    "span_id": "span_104",
    "parent_span_id": "span_103"
  }
}
```

## Mapping Back Into CAR

The generic backend adapter should map the completed response into a canonical event shaped like:

```json
{
  "event_id": "evt_104",
  "schema_version": "v1alpha1",
  "event_type": "agent.response.completed",
  "tenant_id": "tenant_acme",
  "workspace_id": "ws_support",
  "channel": "webchat",
  "channel_instance_id": "webchat_acme_prod",
  "conversation_id": "conv_1",
  "session_id": "sess_1",
  "correlation_id": "corr_1",
  "causation_id": "evt_103",
  "occurred_at": "2026-03-18T10:00:04Z",
  "actor": {
    "id": "support_agent_v1"
  },
  "actor_type": "agent",
  "trace_context": {
    "trace_id": "trace_123",
    "span_id": "span_104",
    "parent_span_id": "span_103"
  },
  "payload": {
    "text": "Your order shipped yesterday."
  },
  "provider_extensions": {
    "generic_http_backend": {
      "backend_request_id": "backend_req_987",
      "backend_session_handle": "be_sess_42"
    }
  }
}
```

## Structured Error Shape Reserved for the Same Boundary

Even though the happy path does not use it, the same backend boundary should reserve a structured error shape like:

```json
{
  "request_id": "req_01_first_path",
  "status": "failed",
  "error": {
    "code": "backend_timeout",
    "message": "Backend did not complete within the configured timeout.",
    "retryable": true,
    "category": "timeout",
    "details": {
      "timeout_ms": 30000
    }
  }
}
```

At the CAR boundary, the adapter must preserve at least:
- `correlation_id`
- optional `causation_id`
- `code`
- `message`
- `retryable`
- `category`
- optional `details`

## Non-Goals of This Example

This document does not yet define:
- the final HTTP path or header set
- a formal OpenAPI description
- streaming chunk framing
- async callback mode
- tool event transport
- cancellation transport
- framework-specific backend bindings

## Current Review-Gate Use

This example should currently be used only to:
- preserve the intended backend boundary shape in docs-first review
- check that the frozen seven-event baseline stays end-to-end coherent
- support later discussion of a separately approved runtime slice

It should not be interpreted as approval to build the HTTP client, callback path, streaming path, or runtime integration surface now.
