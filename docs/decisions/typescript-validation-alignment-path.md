# CAP TypeScript Validation Alignment Path

This document defines how TypeScript implementation artifacts should align with CAP's JSON-Schema-first canonical event contract layer.

It follows these already-made decisions:
- `docs/decisions/implementation-language-runtime-evaluation.md` — TypeScript on Node.js is the chosen implementation direction
- `docs/decisions/schema-authoring-strategy-evaluation.md` — hybrid schema authoring is the chosen strategy
- `docs/decisions/canonical-event-machine-readable-strategy.md` — JSON Schema is the primary machine-readable contract layer for the canonical event envelope

## Decision Status

Decision made: **use JSON Schema as the primary contract artifact and Ajv as the default TypeScript-side runtime validation path for canonical event schemas, with TypeScript types derived from or checked against the schema layer rather than replacing it**.

## Decision Scope

Choose the first TypeScript-side validation and typing direction for:
- canonical event envelope validation
- conformance-oriented contract checks
- implementation-facing TypeScript ergonomics

This decision does not yet fully define the entire code generation pipeline.

## Why This Decision Exists

The project has already chosen:
- TypeScript on Node.js as the implementation direction
- a hybrid schema authoring strategy
- JSON Schema as the first-class machine-readable contract format for the canonical event envelope

That means CAP now needs a practical answer to:
- what validates JSON Schema in the TypeScript implementation
- how TypeScript types relate to the schema layer
- how to avoid drifting into a TypeScript-only source of truth

## Candidate Directions Considered

- Ajv-centered JSON Schema validation
- TypeBox-centered schema builder workflow
- Zod-first runtime schemas with JSON Schema export
- ad hoc hand-written validators plus interface types

## Final Recommendation

Use an **Ajv-centered alignment path** for the first implementation stage.

## Why This Is the Right Default

### 1. It matches the contract hierarchy already chosen
- JSON Schema is already the primary machine-readable contract format
- Ajv is a natural runtime validator when JSON Schema is authoritative
- this keeps implementation validation aligned with the repository's contract precedence rules

### 2. It avoids making TypeScript runtime libraries sovereign
- a Zod-first path would improve local ergonomics
- but it would also create pressure to treat runtime schemas as the real contract source
- that would directly conflict with the machine-readable strategy guardrails

### 3. It preserves optionality for later type generation or helpers
- CAP can later add generated TypeScript types from JSON Schema
- CAP can also add helper builders or narrower internal validation layers where justified
- those additions can remain subordinate to the schema layer

## Recommended Operating Model

### 1. JSON Schema artifacts stay primary
- canonical event contract artifacts live under `docs/schemas/`
- schema review should happen at the contract layer first
- TypeScript validators and types must be updated to match schema changes, not vice versa

### 2. Ajv is the default runtime validator
- use Ajv to compile and validate canonical event schemas in implementation code
- use the schema artifacts directly where possible rather than manually rewriting equivalent rules in TypeScript

### 3. TypeScript types are derived or checked, not normative
CAP may use one or both of these patterns later:
- generate TypeScript types from JSON Schema
- define hand-written interfaces that are systematically checked against schema-backed validation boundaries

But in both cases:
- the schema layer remains authoritative for machine-readable shape
- TypeScript types remain implementation artifacts

### 4. Zod may still exist at edges, but not as the canonical core source
- Zod can still be reasonable for internal configuration parsing or narrow implementation-local validation tasks
- it should not become the sole canonical event contract source
- canonical event envelope semantics should not depend on a Zod-only definition

## Guardrails

### Guardrail 1: no TS-only contract authority
Do not let interfaces, Zod schemas, or framework DTO classes become the only practical canonical event definition.

### Guardrail 2: avoid duplicate handwritten validation logic
If the JSON Schema already defines the contract boundary, do not maintain a second equivalent hand-written validator unless there is a compelling implementation reason.

### Guardrail 3: prioritize contract review at schema level
When event shape changes, review and discuss the JSON Schema artifact first, then update TypeScript-facing artifacts.

### Guardrail 4: keep implementation ergonomics subordinate to protocol integrity
If a TypeScript convenience pattern conflicts with the chosen contract hierarchy, the contract hierarchy wins.

## First Practical Follow-up

The first implementation phase should aim to produce:
1. a loader for canonical schema artifacts
2. Ajv compilation/validation for the envelope schema
3. a small TypeScript-facing validation boundary around canonical event ingestion
4. a documented rule for how generated or aligned types will be handled later

## Revisit Conditions

Revisit this decision if:
- Ajv-based workflow proves too cumbersome for routine CAP iteration
- TypeScript developer ergonomics become a sustained drag on delivery
- CAP later adopts a stronger schema-builder workflow that still preserves JSON Schema as primary
- code generation needs become strong enough to justify a more automated schema-to-type pipeline

## Current Decision Statement

CAP should use the following TypeScript alignment path for canonical event contracts:
- JSON Schema remains the primary machine-readable contract layer
- Ajv is the default runtime validation path in TypeScript
- TypeScript types and helpers must align to the schema layer rather than replace it
