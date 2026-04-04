# RFC Authoring and Layering Rules

This directory is the highest-precedence source of truth for CAR.

## Purpose

RFCs define CAR's normative architecture boundaries and behavior. Other project materials — including schemas, README, docs, website copy, and roadmap summaries — should align downward from the RFCs.

## Product Baseline

RFCs should consistently describe CAR as:
- a standard relay layer between chat platforms and agents
- centered on canonical events and the message path
- using A2A as the standard agent-side protocol boundary
- providing governance, routing, delivery reliability, and auditability on the message path

RFCs should not redefine CAR as:
- an agent runtime or orchestration framework
- an agent-internal governance platform
- an inbox, CRM, or SaaS workspace product

## Required Layering

Every new or substantially revised RFC SHOULD explicitly separate content into these layers:

### Core
Normative semantics required to define CAR's identity and conformance center.

### Extension
Optional but aligned semantics that fit CAR without redefining it.

### Future Considerations
Long-range directions that are intentionally non-normative and MUST NOT be treated as current conformance requirements.

## Required Scope Discipline

Each RFC SHOULD make clear:
1. what the RFC defines
2. what in the document is normative core
3. what is extension guidance
4. what is future-facing and non-normative
5. what the RFC does **not** define

## Authoring Rules

- Prefer message-path semantics over broader product-surface speculation.
- Keep canonical relay responsibilities central: canonicalization, governance, routing, agent invocation, delivery, replay, and audit.
- Introduce future product surfaces only as clearly marked future considerations.
- Do not write future ideas as if they are current conformance requirements.
- Do not let downstream tools, projections, or product surfaces become hidden sources of truth.
- When describing agent integration, describe agents first and A2A second.

## Review Test

Before finalizing an RFC, check:
- Would a reader still understand CAR primarily as a chat-to-agent relay layer?
- Does the RFC keep runtime, inbox, and agent-governance concerns outside CAR's core identity?
- Are Core, Extension, and Future clearly separated?
- Could README, docs, schemas, and implementation decisions align to this RFC without ambiguity?
