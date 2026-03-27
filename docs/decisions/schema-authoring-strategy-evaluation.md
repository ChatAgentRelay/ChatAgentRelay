# Chat Agent Relay Schema Authoring Strategy Evaluation

This decision is intentionally separated from the language/runtime decision.

This document exists because schema authoring strategy can heavily influence validation tooling, code generation, contract drift risk, cross-language portability, and how much TypeScript's strengths should matter in the broader architecture.

## Decision Status

Decision made: **hybrid model**.

Specifically:
- RFC documents remain the normative semantic source of truth
- machine-readable schemas should exist as first-class artifacts
- TypeScript schema definitions may be used as an implementation-facing source for selected runtime contracts where they can generate or stay aligned with machine-readable schemas
- CAR should avoid a pure code-first model that makes TypeScript the only practical source of truth
- CAR should also avoid a pure schema-first model that creates too much early authoring overhead for v0/v1

## Decision Scope

Choose how CAR's canonical event schema and related contracts should be authored and maintained.

## Candidate Directions Considered

- code-first
- schema-first
- hybrid model

## Why This Matters

This decision can influence:
- validation tooling
- code generation
- developer experience
- contract drift risk
- cross-language portability
- fit with RFC-first workflow
- how much TypeScript's ecosystem advantage should affect the architecture

## Evidence Summary

### JSON Schema as a real source-of-truth format
Official JSON Schema documentation and the OpenAPI specification family both establish JSON Schema as a real machine-readable schema language, not merely an implementation detail.

Evidence collected:
- JSON Schema has official docs intended for learning and authoring.
- OpenAPI's current specification family explicitly aligns Schema Object behavior with JSON Schema dialect concepts.
- OpenAPI 3.1+ alignment materially reduces the historical gap between API description and JSON Schema-based schema authoring.

Implication:
- A schema-first or hybrid approach has a strong standards-based foundation.
- Choosing machine-readable schemas as first-class artifacts is justified by ecosystem standards, not just tool fashion.

### TypeScript-first schema tooling is strong
Evidence collected:
- Zod officially supports JSON Schema conversion.
- Ajv officially supports TypeScript-oriented usage and typed JSON Schema validation.
- TypeBox positions itself as a JSON Schema type builder with static type resolution for TypeScript.
- `ts-json-schema-generator` exists to derive JSON Schema from TypeScript types.

Implication:
- TypeScript has multiple credible paths for connecting runtime code and machine-readable schemas.
- This makes a hybrid strategy especially realistic in the chosen language.

### Pure code-first and pure schema-first each have costs
Evidence-backed interpretation from the ecosystem:
- Pure code-first can be pleasant in TypeScript, but it risks turning runtime library choices into the only practical contract source.
- Pure schema-first improves language neutrality and machine readability, but it can slow early implementation if every change must start from external schema artifacts before the surrounding implementation conventions settle.

## Option Analysis

### Option A: Code-first

#### Definition
Author the canonical event and related contracts primarily in TypeScript code, then optionally generate JSON Schema or OpenAPI artifacts from code.

#### Strengths
- Best immediate developer ergonomics inside the chosen TypeScript stack.
- Works naturally with TypeScript-first tooling.
- Lowest friction for early implementation.
- Can keep runtime validation and static typing close together.

#### Weaknesses
- Makes TypeScript the de facto contract authority.
- Increases risk that RFC semantics drift behind implementation.
- Weakens cross-language portability if generated artifacts are partial, lossy, or optional.
- Encourages architecture to follow library conventions rather than repository governance.

#### Assessment
Pure code-first is too implementation-led for a repository that is explicitly RFC-first and contract-heavy.

### Option B: Schema-first

#### Definition
Author canonical event schemas and major contracts first in machine-readable schema artifacts, then generate or derive code-facing types and validators from them.

#### Strengths
- Strongest source-of-truth clarity for machine-readable contracts.
- Best cross-language portability.
- Best protection against implementation drift across multiple runtimes.
- Strong fit if CAR later grows SDK/codegen/distributed integration surfaces.

#### Weaknesses
- Higher early authoring overhead.
- Can slow iteration while the protocol is still settling.
- Requires more up-front decisions about schema packaging, versioning, and generation flow.
- Risks creating a standards-heavy workflow before v0/v1 implementation pressure clarifies what must actually be generated.

#### Assessment
Pure schema-first is principled, but probably too heavy for the current repository stage.

### Option C: Hybrid model

#### Definition
Keep semantics and precedence anchored in RFCs, introduce first-class machine-readable schema artifacts for the most important contracts, and allow TypeScript-native schema tooling where it can stay aligned with those artifacts rather than replacing them.

#### Strengths
- Preserves the repository's RFC-first discipline.
- Avoids making TypeScript the only real source of truth.
- Keeps open a path to JSON Schema/OpenAPI/codegen portability.
- Lets the implementation use TypeScript-friendly validation and type tooling without surrendering architectural neutrality.
- Reduces early workflow heaviness compared with a strict schema-first regime.

#### Weaknesses
- Requires active discipline to prevent dual-source drift.
- Needs explicit rules for what is normative:
  - RFC semantics
  - machine-readable schemas
  - generated or implementation-facing TypeScript artifacts
- Slightly more process complexity than pure code-first.

#### Assessment
This is the best fit for the current CAR repository state.

## Comparison Summary

### Source-of-truth clarity
- Best: schema-first
- Good if disciplined: hybrid
- Weakest: code-first

### Early implementation velocity
- Best: code-first
- Good: hybrid
- Weakest: schema-first

### Cross-language portability
- Best: schema-first
- Good: hybrid
- Weakest: code-first

### Fit with RFC-first repository governance
- Best: hybrid or schema-first
- Weakest: code-first

### Fit with chosen TypeScript stack
- Best immediate ergonomics: code-first
- Best long-term balance: hybrid

## Final Recommendation

Use a **hybrid model**.

## Recommended Operating Model

### 1. Normative semantic source of truth
- RFC documents define semantics, boundaries, and meaning.

### 2. Machine-readable contract artifacts
- Introduce first-class machine-readable schemas for the most important contracts, starting with the canonical event envelope and selected adapter-facing payloads.
- These artifacts should be treated as authoritative for machine-readable validation and interoperability.

### 3. TypeScript implementation-facing schemas
- Use TypeScript-native schema tooling where it helps runtime validation, type inference, and developer ergonomics.
- However, TypeScript definitions must not silently replace the machine-readable contract artifacts as the only practical truth.

### 4. Drift prevention rule
For any contract promoted into first-class machine-readable form:
- RFC meaning must stay aligned
- machine-readable schema must stay aligned
- implementation-facing TypeScript validation/types must be generated from, or systematically checked against, that contract layer

## What This Means Practically

For v0/v1, the likely practical shape is:
- keep RFCs as the normative semantic documents
- define machine-readable schemas for the highest-value protocol surfaces first
- use TypeScript tooling that can interoperate with JSON Schema or emit/consume machine-readable schemas
- avoid a setup where Zod-only runtime definitions become the only real contract source

## Why This Recommendation Fits the TypeScript Decision

This approach lets the project benefit from TypeScript's strengths:
- strong contract ergonomics
- validation tooling
- good developer experience

without paying the full architectural cost of a pure code-first approach.

It also preserves future optionality if CAR later wants:
- cross-language SDKs
- stronger code generation
- machine-readable public contracts
- external conformance tooling

## Revisit Conditions

Revisit this decision if:
- CAR becomes strongly SDK/codegen-driven, in which case a more schema-first model may become preferable
- the team repeatedly experiences drift between RFCs, schemas, and TypeScript definitions
- the first v0/v1 implementation proves that machine-readable contract artifacts are either too heavy or not heavy enough

## Current Decision Statement

CAR should use a **hybrid schema authoring strategy**:
- RFCs define semantics
- machine-readable schemas become first-class contract artifacts where it matters most
- TypeScript-native schema tooling serves implementation ergonomics, but does not become the sole contract authority
