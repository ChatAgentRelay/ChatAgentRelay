# RFC Governance and Boundary Design for CAR

## Status
Draft

## Context
This design captures the agreed direction for how CAR RFCs should govern the repository as the top source of truth. The repository already treats `docs/rfcs/` as normative above schemas and README. The problem is not that CAR lacks a goal, but that some RFCs still blend current core architecture, plausible extensions, and future product-surface ideas in ways that make the project boundary harder to interpret consistently.

The agreed product positioning is:

- CAR is a standard relay layer between chat platforms and agents.
- On the agent side, CAR uses A2A as the standard protocol.
- Governance, routing, delivery reliability, and auditability are built into the message path.
- CAR is not an agent runtime, not an agent-internal governance system, and not an inbox/SaaS workspace product.

Because RFCs are the highest-precedence source of truth, these conclusions should first constrain the RFCs, and only then flow down into README, docs, website, and roadmap materials.

## Goal
Create an RFC governance model that preserves architectural vision while making the normative center of CAR unambiguous.

## Non-Goals
- This design does not rewrite implementation code.
- This design does not yet revise README, website, or non-RFC docs.
- This design does not force the RFC set into a minimal-only posture; it keeps the larger architecture map, but with explicit layering.

## Design Principles

### 1. RFC-first governance
RFCs remain the sole normative standard used to judge:
- architecture boundaries
- terminology
- current core behavior
- extension points
- future-facing but non-normative ideas

### 2. Stable product identity
RFCs should consistently describe CAR as:
- a standard relay layer between chat platforms and agents
- centered on canonical events and the message-path pipeline
- A2A-standardized on the agent side

RFCs should avoid drifting into descriptions that make CAR sound primarily like:
- an agent runtime/orchestration framework
- an agent-internal governance platform
- a support inbox or SaaS workspace

### 3. Explicit document layering
Core RFCs should preserve the larger architecture vision, but every major topic must be marked as one of:
- **Core** — required to define CAR’s normative identity and conformance center
- **Extension** — aligned with CAR’s identity, but optional or not required for all conforming implementations
- **Future / Consideration** — useful long-range direction, but not currently normative and not required for conformance

### 4. Message-path priority
Core RFC content should prioritize message-path semantics:
- channel ingress boundary
- canonicalization
- governance checkpoints
- routing
- agent invocation boundary
- delivery semantics
- append-only ledger, replay, and auditability

### 5. A2A placement
RFCs should describe agents first and A2A second:
- CAR connects chat platforms to agents
- CAR standardizes the agent-side boundary with A2A

This keeps the system understandable to readers who do not already think in protocol terms.

## RFC Classification Model

### Core
A topic belongs in **Core** when all of the following are true:
1. Without it, CAR would no longer be a standard chat-to-agent relay layer.
2. It is a first-class message-path semantic or boundary.
3. It should be stably promised across documentation and implementation.
4. It does not distort CAR into a runtime, inbox product, or generalized governance platform.

Likely core topics:
- reference relay boundary
- canonical event model
- ordered message-path pipeline
- governance checkpoints on the message path
- routing semantics
- delivery semantics
- append-only ledger, replay, and auditability
- channel adapter boundary
- agent-side A2A boundary

### Extension
A topic belongs in **Extension** when it is strongly aligned with CAR, but not required to define CAR’s minimum or stable core identity.

Likely extension topics:
- richer streaming modes
- richer message abstractions
- optional handoff event support
- identity-related flows
- advanced tenant controls
- enhanced observability references
- HITL refinements beyond the base relay semantics

### Future / Consideration
A topic belongs in **Future / Consideration** when it expands the architecture map but should not be interpreted as current normative scope.

Likely future/consideration topics:
- queue or assignee projection models
- inbox/operator workspace semantics
- broader productized control-plane surface
- secure companion trace stores as first-class architecture components
- broad backend/protocol-family expansion beyond the current A2A-first boundary

## Recommended RFC Review Order

### 1. `docs/rfcs/architecture/reference-architecture.md`
This is the top-level architecture map and should be revised first.

Primary changes:
- Make the relay-layer identity explicit.
- Keep long-term architecture vision.
- Reclassify major sections into Core / Extension / Future.
- Reduce the apparent centrality of handoff/queue/operator themes.
- Reduce the apparent centrality of non-core observability/control-plane themes.
- Make A2A the explicit agent-side standard boundary.

### 2. `docs/rfcs/middleware/routing-middleware-governance.md`
This should become the normative description of message-path processing semantics.

Primary changes:
- Emphasize governance on the message path, not generalized AI governance.
- Keep pre-route and pre-send checkpoints central.
- Reclassify handoff/identity/resilience content that exceeds current core semantics.

### 3. `docs/rfcs/canonical-model/canonical-event-schema.md`
This should define the stable event center of gravity.

Primary changes:
- Keep the core event envelope and event chain central.
- Explicitly classify event families as Core / Extension / Future.
- Reduce equal-footing treatment for event families that are not central to relay identity.

### 4. Adapter RFCs
These should be updated after the first three are aligned, so adapter boundaries inherit the clarified top-level architecture rather than redefine it.

## Proposed Review Method Per RFC
For each RFC, review every major section and tag it as one of:
- **Keep and strengthen in Core**
- **Keep but downgrade to Extension**
- **Move to Future / Considerations**
- **Delete or rewrite**

Each RFC should also answer three framing questions near the top:
1. What does this RFC define?
2. What is normative core in this document?
3. What is extension or future guidance and not required for conformance?

## Architecture RFC Direction
The reference architecture RFC should evolve into a long-range map with strict layering:

### Core Architecture
- standard relay layer between chat platforms and agents
- canonical event schema
- message-path governance and routing pipeline
- A2A on the agent side
- delivery orchestration
- append-only ledger and replay/audit

### Extension Architecture
- optional identity-related architecture
- optional handoff event support
- richer streaming and message capabilities
- enhanced operational controls that do not redefine CAR’s core identity

### Future Product-Surface Considerations
- inbox/operator projections
- expanded control-plane product surface
- companion trace-store ideas
- broader ecosystem/productization concepts

## Error Handling and Testing Guidance
When RFCs mention error handling, governance, or delivery, the focus should remain on message-path semantics and auditability. Testing discussions should stay attached to conformance and replayability where those are part of core identity, rather than drifting into speculative product features.

## Acceptance Criteria
This design is successful when:
1. CAR’s RFC set consistently describes CAR first as a standard relay layer between chat platforms and agents.
2. A2A is clearly presented as the agent-side standard boundary, but not as the first user-facing concept.
3. Core RFCs can be read without confusing CAR for an agent runtime, an agent-governance platform, or an inbox/SaaS workspace.
4. Major architecture topics across RFCs are explicitly layered as Core, Extension, or Future.
5. README, website, docs, and roadmap can later be aligned downward from the revised RFC set without ambiguity.

## Recommended Next Step
Start implementation of this design by revising `docs/rfcs/architecture/reference-architecture.md` first, since it most strongly influences the interpretation of the rest of the RFC set.
