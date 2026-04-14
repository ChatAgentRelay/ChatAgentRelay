---
layout: post
title: "From Prototype to Production: CAR v0.2–v0.6 Journey"
heading: "From Prototype to Production: CAR v0.2&ndash;v0.6 Journey"
date: 2026-04-01
description: "How Chat Agent Relay evolved from v0.1 to v0.6: bug fixes, security, HITL, enterprise channels, and the path to v1.0 production readiness."
keywords: "Chat Agent Relay, CAR, roadmap, production, security, HITL, middleware, channels, governance, 2026"
og_type: article
og_title: "From Prototype to Production: CAR v0.2–v0.6 Journey"
og_description: "Five milestones from prototype to near-production: security, governance, HITL, Teams and WhatsApp, and what remains for v1.0."
twitter_title: "From Prototype to Production: CAR v0.2–v0.6"
twitter_description: "Milestones, test growth, and the remaining P3 work before v1.0."
read_time: "5 min read"
category_label: "Roadmap"
card_title: "From Prototype to Production: CAR v0.2&ndash;v0.6 Journey"
card_description: "Five milestones, 20 requirements, 692 tests &mdash; how CAR went from a prototype to a production-ready relay"
show_cta: true
cta_primary_url: "/ChatAgentRelay/docs/"
cta_primary_text: "Documentation"
cta_primary_track: "blog_v1_docs"
cta_secondary_url: "https://github.com/ChatAgentRelay/ChatAgentRelay"
cta_secondary_text: "View on GitHub"
cta_secondary_track: "blog_v1_github"
structured_data:
  "@context": "https://schema.org"
  "@type": "BlogPosting"
  headline: "From Prototype to Production: CAR v0.2–v0.6 Journey"
  description: "Evolution of Chat Agent Relay from v0.1 through v0.6: fixes, security, HITL, enterprise features, and v1.0 readiness."
  url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/v1-road-to-production/"
  datePublished: "2026-04-01"
  dateModified: "2026-04-01"
  author:
    "@type": "Organization"
    name: "Chat Agent Relay"
  publisher:
    "@type": "Organization"
    name: "Chat Agent Relay"
    url: "https://ChatAgentRelay.github.io/ChatAgentRelay/"
  isPartOf:
    "@type": "Blog"
    name: "Chat Agent Relay Blog"
    url: "https://ChatAgentRelay.github.io/ChatAgentRelay/blog/"
---

Chat Agent Relay (CAR) began as a working prototype: enough adapters and pipeline to prove the canonical event model end to end. Over five numbered milestones we closed operational gaps, hardened security and governance, and expanded channel coverage. This post summarizes where v0.1 left off, what each release emphasized, and what v1.0 production readiness still requires.

## Where we started: v0.1 {#started}

v0.1 shipped **six channel adapters** and a **basic policy layer** limited to keyword and regex rules. The control plane had **no API authentication**, **no outbound governance**, and **no human-in-the-loop (HITL) completion path** through the pipeline. The suite stood at **528 tests** — solid for a first cut, but skewed toward happy paths and single-tenant assumptions.

## What changed across five milestones {#milestones}

### v0.2 — Stability and correctness {#v02}

We fixed **six critical bugs** that operators would hit on day one: mismatches between CLI behavior and HTTP API semantics, incorrect or ignored **port configuration**, and **route hot-reload** edge cases that left stale routing in memory. The theme was *predictable runtime behavior* — config and admin actions had to match what the server actually did.

### v0.3 — Security hardening {#v03}

v0.3 introduced **API authentication**, **outbound governance** so sends respect the same policy posture as ingress, **rate limiting**, and **access control** primitives. Untrusted networks and multi-user deployments became first-class concerns rather than "run behind a VPN and hope."

### v0.4 — Core product features {#v04}

The pipeline gained a full **HITL path** (request input, resume, and completion signals aligned with the ledger). Policy evolved beyond flat keyword lists to **structured conditions**, with **mandatory deny** semantics where operators require explicit safety rails. **Config hot-reload** and per-route **enable/disable** reduced the need for process restarts during routine changes.

### v0.5 — Enterprise readiness {#v05}

We added **Microsoft Teams** as a channel, a **webhook verification framework** shared across adapters, and an **idempotency framework** so duplicate provider deliveries do not double-invoke agents or double-send replies. Together, these target the reliability and integrity expectations of production chat integrations.

### v0.6 — Channel expansion and policy ergonomics {#v06}

**WhatsApp** joined the supported channel set. Policy configuration gained **YAML** as a first-class option for teams that version infrastructure as files. Remaining channel adapters received **webhook verifiers** where the provider supports cryptographic or signed validation, closing gaps left after the v0.5 framework landed.

## Where we are now {#now}

CAR today covers **eight channels**, runs **692 tests**, and satisfies **20 of 20** tracked production-readiness requirements in our internal checklist. Feature work against the public matrix sits at roughly **88% completion** — enough to run serious pilots, with clear remaining items before we call the line "1.0."

## What's next: P3 and v1.0 {#next}

Priority-three (P3) work still includes a **dead letter queue** for permanently failed deliveries, **retention policy** for the event ledger, a **rich message abstraction** that keeps channel-specific formatting out of the core pipeline, and related operator ergonomics. **Tenant isolation** is done. The north star for the next phase is **v1.0 production readiness**: operability, observability, and the last contract surfaces we want to freeze before semantic versioning promises stability for downstream integrators.
