# RFC: Chat Agent Relay Agent-Side Adapter Contract

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Agent-side adapter implementers |
| **Version** | v0.3 |
| **Last Updated** | 2026-04-02 |

## 1. Abstract

This RFC defines the agent-side contract that allows Chat Agent Relay (CAR) to invoke agents without coupling the relay core to agent-private runtime objects.

CAR is a standard relay layer between chat platforms and agents. On the agent side, CAR uses **A2A** as the standard protocol boundary. This RFC defines the contract at that boundary and the responsibilities that remain on the CAR side versus the agent side.

This document explicitly separates:
- **Core** — the normative agent-side contract required for CAR's relay identity
- **Extension** — optional but aligned agent-side capabilities
- **Future Considerations** — non-normative directions that are not current conformance requirements

## 2. Purpose

This RFC defines the stable boundary between the CAR message path and the agent-side integration boundary.

## 3. Product Boundary

For this RFC, the agent-side adapter contract is responsible for:
- receiving canonical invocation intent from CAR
- invoking agents through the standard agent-side boundary
- mapping agent outcomes back into canonical CAR semantics
- preserving correlation, causation, and session continuity relevant to the relay path

For this RFC, the agent-side adapter contract is not:
- a general-purpose runtime abstraction for arbitrary workflow engines
- a platform for exposing framework-private execution objects
- an agent-internal governance or tool-execution control plane
- a replacement for CAR's canonical audit and replay model

## 4. Layering Model

### 4.1 Core

Core semantics define the minimum stable agent-side contract that a conforming CAR implementation MUST preserve.

### 4.2 Extension

Extension semantics add useful but optional capabilities that fit CAR's relay model without redefining it.

### 4.3 Future Considerations

Future considerations preserve direction for later exploration, but MUST NOT be interpreted as current conformance requirements.

## 5. Core Contract Statement

The CAR core message path reaches the agent side through one standard boundary:

`route.decision.made -> agent.invocation.requested -> A2A invocation -> agent.response.completed or event.blocked`

A conforming CAR implementation MUST preserve this boundary as a relay contract rather than exposing framework-private runtime internals.

## 6. Core Responsibilities

### 6.1 CAR Owns

CAR owns:
- canonical conversation identity
- governance on the message path
- route decisions
- delivery behavior
- append-only recording, replay, and audit

### 6.2 Agent-Side Adapter Owns

The agent-side adapter owns:
- speaking the A2A protocol to the remote agent
- mapping CAR invocation context into the A2A request model
- mapping A2A results back into canonical CAR events or structured failures
- preserving runtime-specific session handles without redefining CAR's canonical session identity

### 6.3 Agent Runtime Owns

The remote agent runtime owns:
- its internal execution model
- its private memory and checkpoint model
- its internal tool usage and framework-private runtime objects

The runtime MUST NOT become the sole source of truth for CAR audit or replay.

## 7. Core Operations

### 7.1 describeCapabilities()

The agent-side adapter MUST declare the capabilities it supports for the relay path.

Core capability concerns include:
- synchronous completion support
- streaming support
- resumable interaction support
- cancellation support
- artifact support where applicable

### 7.2 invoke(context)

The adapter MUST accept CAR invocation context and attempt one agent-side invocation through A2A.

Core rules:
- the input MUST be grounded in a canonical `agent.invocation.requested` event
- the adapter MUST map the invocation into the A2A request model
- the adapter MUST return a canonical success result or a structured failure
- the adapter MUST NOT leak framework-private objects across the boundary

### 7.3 Success Mapping

On success, the adapter MUST return a schema-valid `agent.response.completed` canonical event.

Required properties:
- preserve `correlation_id`
- set `causation_id` to the invocation event identifier
- preserve the relay's canonical conversation/session scope
- carry the agent's result as canonical payload content

### 7.4 Failure Mapping

On failure, the adapter MUST return a structured failure result rather than throwing framework-specific exceptions across the boundary.

The failure MUST preserve:
- error code
- human-readable message
- retryability
- category
- correlation identity

## 8. Core Session Boundary

### 8.1 CAR Session Identity

CAR owns canonical session and conversation identity used for routing, governance, replay, and audit.

### 8.2 Agent Runtime Session Identity

The agent runtime MAY maintain runtime-specific session handles or task identifiers.

These MUST remain distinct from CAR's canonical identifiers.

### 8.3 Mapping Rule

The adapter is responsible for mapping between CAR canonical session identity and runtime-specific session handles without conflating them.

## 9. Core Correlation and Audit Rules

The adapter MUST preserve:
- `correlation_id`
- `causation_id`
- any relay-relevant trace context passed by CAR
- adapter/request identifiers needed for explainability

The adapter MUST NOT make CAR dependent on runtime-private state for understanding what happened on the message path.

## 10. Extension Capabilities

The following capabilities are aligned with CAR but are not required for all conforming implementations.

### 10.1 Streaming

An adapter MAY support streaming partial output when the remote agent and channel path support it.

Streaming is an extension of the relay path, not a replacement for the final canonical completion event.

### 10.2 Resumable Interaction and HITL

An adapter MAY support resumable flows where the agent requests additional user input and CAR later resumes the interaction.

This is acceptable when it remains within the relay boundary and maps back into canonical events such as:
- `agent.input.requested`
- `agent.input.provided`
- `agent.status.changed`

### 10.3 Cancellation

An adapter MAY support cancellation when the remote agent and runtime model allow it.

### 10.4 Artifacts

An adapter MAY support structured artifacts returned by the agent so long as they map back into CAR semantics without redefining CAR as an artifact-management system.

## 11. Future Considerations

The following directions are intentionally non-normative in this RFC.

### 11.1 Rich Runtime-Specific Lifecycle Modeling

Examples:
- detailed internal workflow graph states
- framework-private checkpoint semantics
- execution-engine-specific event families

These are outside the current relay-centered contract.

### 11.2 Agent-Internal Tool Governance

Examples:
- tool approval frameworks
- delegated authorization graphs
- execution control planes inside the agent runtime

These are not part of CAR's current core identity and MUST NOT be read into this contract by implication.

### 11.3 Broad Multi-Protocol Runtime Abstraction

Examples:
- expanding CAR's core identity into a generic abstraction layer for many unrelated runtime protocols
- treating framework-specific adapter proliferation as the defining agent-side architecture

Current CAR direction is to keep the agent-side standard boundary centered on A2A.

## 12. Ownership Boundary

- **CAR core** is responsible for govern / route / record / deliver on the message path
- **agent-side adapter** is responsible for A2A invocation and result mapping
- **remote agent runtime** is responsible for its internal execution mechanics
- **canonical audit and replay truth** remains with CAR's append-only ledger, not runtime-private memory

## 13. Conformance

A conforming CAR agent-side adapter MUST:
- invoke agents through the A2A protocol boundary
- accept canonical CAR invocation context
- return canonical CAR success or structured failure outcomes
- preserve CAR-owned correlation and causation semantics
- keep runtime-private state and objects outside the public relay contract
- preserve the distinction between CAR canonical session identity and runtime-specific session handles

A conforming implementation is NOT required to implement every extension or future consideration in this RFC.

## 14. Security Considerations

Implementations SHOULD:
- minimize exposure of runtime-private state to CAR core
- keep runtime privileges explicit rather than ambient
- avoid turning the adapter boundary into a hidden execution-governance layer
- preserve auditability even when runtime behavior is more complex than the relay path records directly

## 15. Open Questions

- Which extension capabilities should eventually move into their own dedicated RFCs?
- How much resumable interaction semantics should remain in this contract versus a dedicated companion RFC?
- Which agent-side metadata should be standardized more strongly for explainability without leaking runtime-private internals?
