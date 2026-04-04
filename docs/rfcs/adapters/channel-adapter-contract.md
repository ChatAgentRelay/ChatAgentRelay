# RFC: Chat Agent Relay Channel Adapter Contract

| | |
|---|---|
| **Status** | Draft |
| **Author** | Claude Code |
| **Audience** | Channel adapter implementers |
| **Version** | v0.2 |
| **Last Updated** | 2026-04-02 |

## 1. Abstract

This RFC defines the contract between provider-native chat transports and the Chat Agent Relay (CAR) canonical event model.

CAR is a standard relay layer between chat platforms and agents. On the channel side, channel adapters provide the provider-facing boundary that receives provider-native traffic, verifies and normalizes it into canonical events, and translates canonical outbound intent back into provider-native delivery actions.

This document explicitly separates:
- **Core** — normative channel-side semantics required for CAR's relay identity
- **Extension** — optional but aligned channel-side capabilities
- **Future Considerations** — non-normative directions that are not current conformance requirements

## 2. Purpose

This RFC defines the stable boundary between chat-platform-specific transport behavior and CAR's canonical message path.

## 3. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## 4. Product Boundary

For this RFC, the channel adapter contract is responsible for:
- receiving provider-native inbound traffic
- verifying source authenticity where applicable
- normalizing provider-native payloads into canonical CAR events
- translating canonical outbound intent into provider-native delivery actions
- preserving provider-native detail only through structured extension data

For this RFC, the channel adapter contract is not:
- a routing or policy decision system
- the owner of CAR's canonical conversation identity
- a queue-management, operator-inbox, or workflow product layer
- the source of truth for replay, audit, or message-path governance

## 5. Layering Model

### 5.1 Core

Core semantics define the minimum stable channel-side contract that a conforming CAR implementation MUST preserve.

### 5.2 Extension

Extension semantics add useful but optional channel-side capabilities that fit CAR without redefining it.

### 5.3 Future Considerations

Future considerations preserve architectural direction, but MUST NOT be interpreted as current conformance requirements.

## 6. Core Contract Statement

A conforming CAR implementation MUST preserve a strict but narrow channel-side boundary:

`provider-native ingress -> verification -> canonicalization -> CAR middleware -> canonical outbound intent -> provider-native delivery`

The channel adapter contract exists to preserve relay semantics across provider-specific chat transports, not to redefine CAR as a broader channel operations platform.

## 7. Core Responsibilities

### 7.1 Channel Adapter Owns

The channel adapter owns:
- receiving inbound webhook, polling, or socket traffic from the provider
- verifying origin authenticity where the provider requires it
- mapping inbound provider payloads into canonical events
- translating outbound canonical send intent into provider-native requests
- preserving provider-native metadata in structured extension form when needed

### 7.2 CAR Core Owns

CAR core owns:
- canonical event semantics
- governance on the message path
- route decisions
- agent invocation
- delivery orchestration behavior above the provider boundary
- append-only recording, replay, and audit

### 7.3 The Provider Owns

The provider owns:
- provider-native transport semantics
- provider-native identifiers and callback formats
- provider-specific feature limits and delivery behavior

The provider MUST NOT become CAR's source of truth for canonical audit or replay.

## 8. Core Operations

### 8.1 describeCapabilities()

A channel adapter MUST declare the capabilities it supports for the relay path.

Core capability concerns include:
- inbound support
- outbound send support
- text support
- attachment support where applicable
- update support where applicable
- delete support where applicable
- threading support where applicable
- streaming update support where applicable

Capability declarations MAY include provider-specific limits or notes, but those details MUST remain subordinate to the canonical relay contract.

### 8.2 Inbound Handling

A channel adapter MUST support at least one provider-native ingress mode appropriate for the provider.

Examples include:
- webhook
- polling
- socket or gateway delivery

Core inbound rules:
1. verify source authenticity where applicable
2. classify the provider-native payload sufficiently to continue the relay path
3. normalize the payload into one or more canonical events
4. preserve relevant provider-native detail only through structured extensions
5. emit the normalized events into CAR middleware

### 8.3 Outbound Handling

A channel adapter MUST support translation of canonical outbound send intent into provider-native delivery requests.

Core outbound rules:
- accept canonical outbound intent from CAR
- translate that intent into provider-native actions
- return or preserve normalized delivery outcome information needed by CAR
- avoid making provider-native response shapes the canonical internal contract

### 8.4 Failure Mapping

When verification fails, inbound payloads are invalid, or provider delivery fails, the adapter MUST preserve structured failure information rather than silently dropping or obscuring the outcome.

Failure information SHOULD preserve:
- machine-readable code
- human-readable message
- retryability where relevant
- provider error details where relevant

## 9. Core Inbound Rules

### 9.1 Source Verification

Adapters SHOULD verify source authenticity whenever the provider supports signatures, tokens, or equivalent trust signals.

Unauthenticated or invalid provider traffic MUST NOT silently enter the canonical message path.

### 9.2 Canonicalization

Adapters MUST convert provider-native input into canonical CAR events.

Rules:
- canonical events MUST remain the downstream contract for middleware
- provider-native detail MUST remain optional structured extension data
- canonicalization MUST preserve enough information for routing, delivery, replay, and audit within CAR's relay scope

### 9.3 Idempotency and Duplicate Delivery

When provider identifiers or delivery semantics permit it, adapters SHOULD derive stable dedupe information for duplicate ingress handling.

Duplicate suppression is important, but it does not replace the canonical event ledger as CAR's durable message-path record.

## 10. Core Outbound Rules

### 10.1 Canonical Send Boundary

Channel adapters MUST treat canonical outbound send intent as the outbound boundary from CAR core.

### 10.2 Delivery Outcomes

When provider responses or callbacks make delivery outcomes available, adapters SHOULD map those outcomes back into CAR semantics without redefining the canonical event model around provider-native states.

### 10.3 Update and Delete

If a provider supports message update or delete behavior, an adapter MAY expose those capabilities as part of its declared support.

These are not required for all conforming implementations.

## 11. Core Provider Extensions Rule

Rules for `provider_extensions`:
- provider-native fields MUST be namespaced
- provider-native fields MUST remain optional to CAR core semantics
- canonical relay behavior MUST NOT depend on extension data as the core source of truth

Illustrative example:

```json
{
  "provider_extensions": {
    "slack": {
      "team_id": "T123",
      "event_ts": "1710.11"
    }
  }
}
```

## 12. Extension Semantics

The following capabilities are aligned with CAR but are not required for all conforming implementations.

### 12.1 Richer Capability Modeling

Adapters MAY expose richer capability detail such as:
- reactions
- receipts
- rich text
- buttons or cards
- templates
- quick replies
- audio, video, or location support
- max-length or media-type constraints

### 12.2 Fallback and Transcoding

Adapters or delivery layers MAY support deterministic fallback or transcoding when a provider cannot natively express a canonical outbound form.

Examples:
- rich text to plain text
- interactive elements to plain-text choices
- media to text fallback descriptors

These capabilities are useful, but they are not the conformance center of the channel adapter contract.

### 12.3 Delivery Status and Callback Mapping

Adapters MAY support richer delivery status mapping when providers expose callback or receipt semantics.

### 12.4 Multi-Instance Isolation Details

Implementations MAY support richer instance-level isolation concerns such as:
- isolated credentials per `channel_instance_id`
- isolated quotas or rate limits per instance
- stronger operational naming or configuration conventions

### 12.5 Adapter Lifecycle Controls

Implementations MAY provide operational lifecycle methods such as:
- health checks
- pause or resume behavior
- drain behavior
- shutdown or disconnect hooks

These may be valuable operationally, but they are not the normative center of the channel adapter contract.

### 12.6 Contract Testing Guidance

Adapters SHOULD be exercised with contract tests covering:
- representative inbound payloads
- expected canonical event outputs
- outbound translation examples
- verification failure paths
- duplicate ingress scenarios
- provider outage scenarios

## 13. Future Considerations

The following directions are intentionally non-normative in this RFC.

### 13.1 Broad Channel Operations Layers

Examples:
- queue-management semantics
- operator routing surfaces
- channel-operations control planes

These are outside the current relay-centered contract.

### 13.2 Dead-Letter and Poison-Message Productization

Examples:
- first-class dead-letter operating models
- poison-message workflow systems
- queue-style remediation products

These may complement delivery operations later, but they are not part of the current core channel adapter contract.

### 13.3 Rich Realtime and Media-Heavy Protocol Families

Examples:
- voice-first or realtime transports
- deeply media-native interaction models
- large provider-specific feature taxonomies becoming central to CAR identity

These are possible future directions, but they do not define current conformance.

## 14. Ownership Boundary

- **channel adapter** is responsible for provider translation at the chat boundary
- **middleware core** is responsible for govern / route / invoke / record on the message path
- **delivery orchestration** is responsible for delivery behavior above the provider boundary
- **canonical audit and replay truth** remains with CAR's append-only ledger, not provider-native transport state

## 15. Conformance

A conforming CAR channel adapter MUST:
- declare its supported relay-relevant capabilities
- verify source authenticity where applicable
- normalize provider-native input into canonical CAR events
- translate canonical outbound intent into provider-native delivery behavior
- preserve structured failure information for invalid, blocked, or failed channel-side operations
- keep provider-native metadata optional and namespaced rather than making it the canonical contract

A conforming implementation is NOT required to implement every extension or future consideration in this RFC.

## 16. Security Considerations

Implementations SHOULD:
- treat inbound provider traffic as untrusted until verified
- isolate provider credentials appropriately per channel instance
- minimize raw provider-native payload exposure in canonical records
- preserve a clear distinction between provider-native detail and canonical relay semantics
- surface authentication failures distinctly from payload or delivery failures where possible

## 17. Open Questions

- Which fallback or transcoding rules should eventually be standardized more strongly?
- Which delivery callback mappings should remain implementation-specific versus shared across adapters?
- Which lifecycle or isolation concerns deserve a separate operational RFC rather than expansion of this contract?
