# CAP Canonical Event Machine-Readable Strategy

This document defines the first practical machine-readable contract strategy for the CAP canonical event model.

It follows these already-made decisions:
- `docs/decisions/implementation-language-runtime-evaluation.md` — TypeScript on Node.js is the chosen implementation direction
- `docs/decisions/schema-authoring-strategy-evaluation.md` — hybrid schema authoring is the chosen strategy

## Decision Status

Decision made: **use JSON Schema as the primary machine-readable contract format for the canonical event envelope, with TypeScript implementation artifacts kept aligned through a controlled hybrid workflow**.

## Decision Scope

Choose the first machine-readable contract strategy for:
- the canonical event envelope
- the highest-value canonical event field structures
- the first validation/interoperability layer used by CAP implementations

This decision does **not** yet fully define:
- the entire code generation toolchain
- all adapter payload schemas
- external public API description strategy
- whether OpenAPI will later be used for selected transport bindings

## Why This Decision Exists

The repository has already chosen a hybrid schema authoring strategy. That means CAP now needs a concrete answer to:
- which machine-readable format should become first-class first
- how it relates to RFCs
- how it relates to TypeScript implementation-facing definitions

Without this decision, “hybrid” would remain too abstract to guide real implementation work.

## Candidate Directions Considered

- TypeScript-first runtime schemas with optional JSON Schema export
- JSON Schema as the primary machine-readable contract format
- OpenAPI-first contract strategy
- mixed informal approach with no primary machine-readable standard yet

## Evidence Summary

### JSON Schema has standards-based legitimacy
Evidence collected:
- JSON Schema has official documentation intended for authoring and learning.
- OpenAPI's current spec line aligns Schema Object behavior with JSON Schema dialect concepts.
- OpenAPI 3.1+ materially reduces the gap between JSON Schema and API-description-oriented schema workflows.

Implication:
- JSON Schema is a legitimate first-class machine-readable contract format, not just an implementation export format.

### TypeScript tooling can interoperate with JSON Schema
Evidence collected:
- Zod officially supports JSON Schema conversion.
- Ajv officially supports TypeScript-oriented usage and typed JSON Schema validation.
- TypeBox positions itself as a JSON Schema type builder with static type resolution for TypeScript.
- `ts-json-schema-generator` exists to derive JSON Schema from TypeScript types.

Implication:
- TypeScript implementation ergonomics do not require CAP to abandon JSON Schema.
- A JSON-Schema-centered hybrid workflow is realistic in the chosen language.

### OpenAPI is important, but not the best first anchor
Evidence collected:
- OpenAPI is relevant and increasingly aligned with JSON Schema.
- But OpenAPI is still centered on API description, operations, and transport-facing surfaces, while CAP's current need is a protocol-level canonical event contract.

Implication:
- OpenAPI may later matter for selected external transport or API bindings.
- It should not be the first machine-readable anchor for the core canonical event model.

## Option Analysis

### Option A: TypeScript-first runtime schemas with optional JSON Schema export

#### Definition
Author canonical event validation primarily in TypeScript-native schema libraries and treat JSON Schema as a derived artifact if needed.

#### Strengths
- Fastest implementation ergonomics in the chosen stack.
- Works naturally with TypeScript-native validation libraries.
- Low friction for v0 work.

#### Weaknesses
- Makes TypeScript the practical contract authority.
- Risks losing machine-readable neutrality if generated JSON Schema is partial, unstable, or not systematically reviewed.
- Increases the chance that runtime validation choices silently redefine protocol shape.

#### Assessment
Not recommended as the primary strategy.

### Option B: JSON Schema as the primary machine-readable contract format

#### Definition
Define canonical event machine-readable contracts first in JSON Schema, then derive or align TypeScript implementation artifacts from that contract layer.

#### Strengths
- Strong machine-readable source-of-truth clarity.
- Good cross-language portability.
- Good long-term fit for conformance tooling and code generation.
- Aligns well with the chosen hybrid strategy.
- Does not bind CAP's core protocol to one runtime language.

#### Weaknesses
- Slightly heavier authoring workflow than pure TypeScript-first validation.
- Requires discipline to keep RFC semantics and schema documents aligned.
- May need selected TypeScript-side helpers for the best developer ergonomics.

#### Assessment
Recommended.

### Option C: OpenAPI-first

#### Definition
Represent the canonical event model primarily through OpenAPI Schema Objects and surrounding OpenAPI descriptions.

#### Strengths
- Good if the main problem were public HTTP API description.
- Familiar to many toolchains.
- Related to JSON Schema through current OpenAPI evolution.

#### Weaknesses
- CAP's first machine-readable need is not endpoint description but canonical protocol modeling.
- OpenAPI introduces API-description concerns earlier than needed.
- Risks shaping the core protocol around transport-facing documentation concerns.

#### Assessment
Not recommended as the first anchor.

### Option D: Mixed informal approach

#### Definition
Keep RFC examples plus ad hoc implementation validation without choosing one machine-readable standard yet.

#### Strengths
- Lowest immediate cost.
- Maximally flexible in the short term.

#### Weaknesses
- Delays the main benefit of the hybrid decision.
- Increases risk of drift and fragmented validation logic.
- Gives no stable machine-readable target for future tooling.

#### Assessment
Not recommended.

## Final Recommendation

Use **JSON Schema as the primary machine-readable contract format for the canonical event envelope**.

## Recommended Operating Model

### 1. RFC semantics remain normative
- `docs/rfcs/canonical-model/canonical-event-schema.md` remains the semantic source of truth for meaning, constraints, and architectural role.

### 2. JSON Schema becomes the first machine-readable contract layer
- The canonical event envelope should gain a first-class JSON Schema artifact.
- That artifact should focus first on the envelope and shared field structures, not on every event-family-specific payload detail at once.

### 3. TypeScript implementation artifacts are aligned, not sovereign
- TypeScript validators/types may be generated from, checked against, or carefully aligned with JSON Schema artifacts.
- They must not become the only practical source of truth.

### 4. OpenAPI is deferred to transport-facing surfaces
- If CAP later exposes HTTP APIs or binding descriptions that benefit from OpenAPI, those should build on the established canonical machine-readable contract layer rather than replace it.

## First Practical Scope

The first JSON Schema work should cover:
- canonical event envelope fields
- required vs optional top-level fields
- `actor_type` enum
- `event_type` enum for the current minimum-kernel event families
- `trace_context` object shape
- `attachments` item shape
- baseline rules for `provider_extensions` as an open/namespaced object

The first version should **not** try to fully freeze every payload variant for every future event type.

## Why This Scope Is Right

The RFC already says the minimum kernel does not require every future event family before v1, but it must preserve forward-compatible extension points.

That means the first machine-readable contract should:
- strongly define the envelope
- strongly define the common cross-cutting fields
- leave room for future payload specialization

## Recommended TypeScript Strategy Under This Decision

Given the chosen TypeScript stack, the implementation strategy should favor tools that cooperate well with JSON Schema rather than tools that trap the project in runtime-only definitions.

The practical implication is:
- JSON Schema should be treated as primary for the canonical event contract layer
- Ajv is naturally relevant for validation when JSON Schema is first-class
- TypeScript-side tooling may still be used for developer ergonomics, but should not replace the JSON Schema contract layer

## Guardrails

### Guardrail 1: no Zod-only canonical source
Do not let Zod-only runtime definitions become the only authoritative definition of the canonical event contract.

### Guardrail 2: no transport-first distortion
Do not let OpenAPI-first API modeling redefine the canonical event model before the core machine-readable contract is stable.

### Guardrail 3: phased payload formalization
Do not attempt to formalize every payload variant immediately. Start with the envelope and minimum-kernel event families.

### Guardrail 4: explicit precedence
If drift occurs:
1. RFC semantics win for meaning
2. JSON Schema is authoritative for machine-readable contract shape
3. TypeScript implementation artifacts must be corrected to match

## Likely Follow-up Work

This decision implies the next practical tasks are:
1. create a `docs/schemas/` or similarly named machine-readable contract directory
2. define the first canonical event envelope JSON Schema
3. define how event-family-specific payload specialization will be layered
4. choose the TypeScript validation path that best aligns with JSON Schema-first machine-readable contracts

## Revisit Conditions

Revisit this decision if:
- CAP later decides that OpenAPI is the primary external contract surface
- the JSON Schema workflow proves too heavy for v0/v1 iteration
- TypeScript-side ergonomics become so poor that the chosen hybrid balance is no longer sustainable
- the project adopts stronger cross-language SDK/codegen goals, which may push toward an even more schema-first regime

## Current Decision Statement

CAP should adopt the following strategy for the canonical event model:
- RFCs define semantics
- JSON Schema is the primary machine-readable contract layer for the canonical event envelope
- TypeScript implementation artifacts must align to that contract layer rather than replace it
