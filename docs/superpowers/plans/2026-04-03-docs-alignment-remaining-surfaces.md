# High-Risk Docs Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align only the highest-risk public docs surfaces to the approved RFC baseline so CAR's public identity stops drifting across high-traffic entry points.

**This plan is intentionally scoped down.** It does **not** attempt to finish every remaining docs surface in this round. It focuses on the pages most likely to redefine CAR incorrectly as a control plane, runtime platform, universal A2A product, or generic backend abstraction framework.

**Architecture:** This is a documentation-boundary correction plan, not a product or code change. Treat `docs/rfcs/` as normative, preserve the approved public framing of CAR as a **standard relay layer between chat platforms and agents**, and apply edits only to a fixed high-risk file list. Keep reference/docs surfaces and blog/strategy surfaces on separate acceptance lanes. Perform only scoped verification on edited files and their direct entry-chain dependencies.

**Tech Stack:** Markdown, static HTML docs pages, existing website docs structure, RFC baseline in `docs/rfcs/`, repository guidance in `CLAUDE.md`

---

## Scope Lock

### In scope for this round

**Reference / docs lane**
- `website/docs/configuration/storage.html`
- `website/docs/api/index.html`
- `docs/api-reference.md`

**Blog / strategy lane**
- `website/blog/index.html`
- `website/blog/one-protocol-a2a/index.html`
- `website/blog/agent-compatibility-analysis/index.html`
- `website/blog/agent-adapter-capability-matrix/index.html`

### Direct entry-chain sync points allowed if required

These files are **not** primary targets, but MAY be edited only if needed to keep in-scope pages from presenting stale entry text:
- page-local sidebar / pagination / adjacent links inside the in-scope HTML files
- list summaries or post cards inside `website/blog/index.html`
- local metadata inside the in-scope files (title, description, social summary text)

### Explicitly out of scope for this round

- full remaining-surface cleanup across `docs/` and `website/`
- `docs/getting-started.md`
- `docs/deployment-guide.md`
- broad website docs sweep beyond the in-scope files above
- low-risk blog posts not listed above
- creating a new repo-wide docs governance document
- global terminology search that opens new edit scope outside this plan's fixed file list

---

## Shared Framing Rules

Apply these rules to **every** in-scope file before making page-specific decisions.

### Core identity that MUST remain true

CAR is:
- a **standard relay layer between chat platforms and agents**
- centered on canonical events and the message path
- using **A2A as the standard agent-side protocol boundary**
- providing governance, routing, delivery reliability, replay, and auditability on the message path

CAR is **not**:
- an agent runtime or orchestration framework
- an inbox, CRM, or SaaS workspace product
- a broad enterprise control plane as the normative product identity
- a generic pluggable backend platform as the public story

### Page-type acceptance lanes

#### Lane A: Reference / docs surfaces
Goal:
- explain architecture, operational surfaces, and runtime behavior clearly
- keep product identity subordinate to RFC baseline

Must do:
- describe CAR as relay layer first
- mention A2A as boundary, not headline identity
- keep storage/API language operational and architectural

Must not do:
- reframe CAR as workspace, runtime platform, or control plane
- turn reference pages into strategic positioning essays

#### Lane B: Blog / strategy surfaces
Goal:
- preserve original post topic and voice
- allow strategic interpretation without rewriting normative identity

Must do:
- keep blogs readable as blogs, not RFCs
- preserve strategic/market commentary where useful
- ensure strategic claims do not redefine CAR core identity

Must not do:
- let “control surface,” “platform,” “compatibility,” or “A2A” rhetoric overwrite relay-layer identity
- silently promote strategic speculation into product definition

---

## Terminology Mapping Table

Use this as the single source of truth for high-risk wording changes.

| High-risk wording | Replace / reframe as | Allowed in which lane | Notes |
|---|---|---|---|
| control plane | relay layer, operational surface, governance on the message path | docs, blogs (with caution) | blogs may discuss strategy, but not as CAR's normative identity |
| agent backend / backends | agent-side boundary, agent integration, A2A agent adapter | docs, blogs | do not make “backend” the public product story |
| universal A2A product | relay layer using A2A as the agent-side protocol boundary | docs, blogs | A2A is important, but not the top-level identity |
| runtime platform | relay runtime, runtime surface, server/runtime configuration | docs | avoid implying CAR owns agent runtime internals |
| pluggable storage/backend story | storage role in CAR architecture, interface-driven implementation underneath | docs | extensibility can stay, but not as headline identity |
| compatibility matrix as product identity | boundary-disciplined comparison of agent-side capabilities | blogs | preserve comparison value without redefining the product |

### Banned or near-banned public framings for this round

Treat these as red flags that require explicit justification or rewrite:
- “control plane” when used as CAR's primary identity
- “runtime platform” when it implies CAR owns general agent execution
- “universal standard” when it overclaims beyond the relay boundary
- “agent backends” when used as the main public framing
- “storage backends” as headline product framing

---

## Threat Model and Boundary Safety

This is a docs task, but it still has security-like failure modes. The main threat is **boundary pollution**.

### Threats to defend against

1. **Strategic-to-normative pollution**
   - A blog or strategic page uses bold language that gets copied into docs/reference surfaces.
2. **Normative-to-blog flattening**
   - A blog post gets rewritten into dry RFC language and loses its original purpose.
3. **Entry-point drift**
   - A page body is corrected, but titles, summaries, metadata, or list entries still tell the old story.
4. **Scope creep through verification**
   - A final check turns into a repo-wide edit sweep and silently expands the task.

### Boundary rules

- `docs/rfcs/` remain the highest-precedence source of truth.
- `README.md` and aligned overview pages are style references, not permission to edit more files.
- `docs/decisions/` can hold strategic interpretation, but cannot overwrite RFC core.
- Blog pages may keep strategic language, but cannot redefine CAR's normative identity.
- Verification may inspect broader context, but edits must stay inside the fixed file list and direct entry-chain sync points above.

---

## Error and Rescue Map

Silent failure is the main risk in this plan. Treat these as explicit failure modes.

| Codepath | Failure mode | Detection | Rescue action |
|---|---|---|---|
| reference page rewrite | wording changes but product identity is still wrong | compare title, subtitle, first 2 paragraphs against framing rules | rewrite again until CAR is relay layer first |
| page body update | body is fixed but title/summary/meta still amplify old framing | inspect entry-chain fields for each edited page | sync local metadata / index summary in scope |
| blog revision | blog is flattened into RFC tone | compare edited copy against original topic and audience | restore blog voice while keeping identity boundary |
| verification step | final check opens new out-of-scope files to edit | compare candidate edits against fixed file list | defer new surfaces to future plan, do not edit now |
| terminology cleanup | one page invents a new replacement term that conflicts with another page | validate against terminology mapping table | normalize to approved replacements |
| completion handoff | future worker cannot tell what was covered this round | inspect structured result record | update result record before closing |

---

## Page-Level Test Matrix

Every in-scope file must be validated with the following checks.

### Required checks for every file
- page type is correctly classified: docs/reference or blog/strategy
- title does not redefine CAR incorrectly
- subtitle / first paragraph uses approved framing
- CAR is relay layer first
- A2A is boundary, not headline identity, unless the page topic is specifically about A2A
- banned framings are removed or intentionally constrained
- direct entry-chain text is synchronized where applicable
- no out-of-scope file was edited to make this page “feel consistent”

### File-by-file matrix

| File | Lane | Must verify |
|---|---|---|
| `website/docs/configuration/storage.html` | docs | storage role in CAR architecture, SQLite default, config + ledger split, no “storage backends” headline identity |
| `website/docs/api/index.html` | docs | API framed as operational/reference surface around relay runtime, not workspace/control-plane layer |
| `docs/api-reference.md` | docs | reference tone preserved, relay-path support surfaces clear, no product identity drift |
| `website/blog/index.html` | blog entry surface | summaries, titles, and cards for in-scope posts do not over-amplify old framing; treat this page as a reader entry-point with stricter boundary discipline than a normal post |
| `website/blog/one-protocol-a2a/index.html` | blog | preserves post topic, but makes A2A subordinate to relay-layer identity |
| `website/blog/agent-compatibility-analysis/index.html` | blog | keeps comparison value without redefining CAR as compatibility catalog product |
| `website/blog/agent-adapter-capability-matrix/index.html` | blog | keeps capability discussion boundary-disciplined and avoids generic backend/platform framing |

---

## Entry-Chain Verification Rules

Users do not experience these files by filesystem path. They experience them through entry chains.

For each edited file, verify the whole local chain that a real reader sees:

```text
list / summary / card
  → page title
  → subtitle or first paragraph
  → body framing
  → local sidebar / adjacent navigation
```

### Important rule

If the body is corrected but the entry chain still sells the old story, the page is **not done**.

---

## Commit and Rollback Strategy

This repo requires narrow commits. Treat commit structure as part of the plan.

### Required commit grouping

Commits MUST follow risk clusters. Do not mix unrelated page classes.

Recommended grouping:
1. storage page only
2. website API + repo API reference if both changed and are tightly coupled
3. blog index + one related post summary sync if needed
4. A2A / compatibility blog posts as their own cluster

### Do not do
- one giant docs commit for the whole round
- mixing reference pages and blog pages without a clear reason
- hiding entry-chain sync edits inside an unrelated commit

### Rollback posture

If one page cluster is wrong, it should be possible to revert that cluster without undoing the whole round.

---

## Structured Result Record

At the end of implementation, update this plan file with a short structured status block so later sessions do not have to rediscover the scope.

Append a section like:

```markdown
## Round Result Record

| File | Lane | Status | Notes |
|---|---|---|---|
| ... | ... | done / deferred / unchanged | ... |

### Remaining high-risk files not handled this round
- ...

### Mapping table version used
- High-Risk Docs Alignment v1
```

This record is mandatory for handoff quality.

---

## Minimal Regression Guardrail

This plan does not create a full governance system, but it MUST leave one lightweight anti-regression rule behind:

> Future public docs or blog edits that touch CAR identity should first classify the page type, then validate wording against the terminology mapping table in this plan before merging.

That is the minimum viable guardrail to stop this exact drift from coming back next month.

---

## Implementation Tasks

### Task 1: Align highest-risk storage surface

**Files:**
- Modify: `website/docs/configuration/storage.html`
- Reference: `website/docs/configuration/index.html`
- Reference: `website/docs/configuration/routing.html`
- Reference: `docs/rfcs/README.md`
- Reference: `docs/rfcs/architecture/reference-architecture.md`

- [ ] Read the current storage page and compare it against the approved framing rules and aligned docs references.
- [ ] Rewrite the page around storage's role in CAR architecture.
- [ ] Verify title, subtitle, first paragraph, and any local navigation or metadata for stale “storage backend” framing.
- [ ] Commit this page in its own narrow commit.

### Task 2: Align highest-risk API reference surfaces

**Files:**
- Modify: `website/docs/api/index.html`
- Modify if needed: `docs/api-reference.md`
- Reference: `website/docs/concepts/events.html`
- Reference: `website/docs/concepts/pipeline.html`
- Reference: `docs/rfcs/README.md`

- [ ] Review both API surfaces for runtime/control-plane/product-identity drift.
- [ ] Rewrite only as needed so both pages read as reference/operational surfaces around the relay path.
- [ ] Verify entry-chain text on the website API page.
- [ ] Commit API-related pages together only if they are correcting the same framing defect or the same terminology replacement; otherwise keep separate commits.

### Task 3: Align highest-risk blog positioning surfaces

**Files:**
- Modify if needed: `website/blog/index.html`
- Modify: `website/blog/one-protocol-a2a/index.html`
- Modify: `website/blog/agent-compatibility-analysis/index.html`
- Modify: `website/blog/agent-adapter-capability-matrix/index.html`
- Reference: `docs/decisions/chat-control-surface-and-strategic-boundaries.md`
- Reference: `README.md`

- [ ] Review blog index summaries for the in-scope posts first.
- [ ] Review the three in-scope blog posts using the blog/strategy lane rules.
- [ ] Rewrite only where framing materially conflicts with the approved baseline.
- [ ] Preserve each post's topic and tone while removing product-identity drift.
- [ ] Sync blog index summaries or local metadata only where needed for the edited posts.
- [ ] Commit blog changes in narrow risk clusters.

### Task 4: Run scoped verification only

**Files:**
- Inspect only the in-scope files and their direct entry-chain sync points listed above

- [ ] Run the page-level test matrix for every changed file.
- [ ] Confirm no out-of-scope file was edited.
- [ ] Confirm terminology is consistent across edited files.
- [ ] Append the structured result record to this plan.
- [ ] Make one last narrow commit only if scoped verification required a real in-scope fix.

---

## Verification Checklist

Use this checklist after each task and again at the end:

- The file is still serving its original document class.
- The file does not contradict `docs/rfcs/README.md`.
- The file does not redefine CAR away from “standard relay layer between chat platforms and agents.”
- A2A is not promoted ahead of CAR's relay identity except where the page is explicitly about A2A.
- Blog posts still read like blog posts.
- Entry-chain text is synchronized for each edited page.
- No out-of-scope file was edited.
- Commits remain narrow and reversible.
- The result record has been appended.

## Self-Review

**Spec coverage:** This plan covers the highest-risk public docs surfaces only: one storage page, two API reference surfaces, the blog index as needed for entry sync, and the three highest-risk blog posts.

**Scope discipline:** This plan explicitly removes the earlier “finish all remaining surfaces” ambition. Anything outside the fixed file list is deferred.

**Type consistency:** Naming is consistent with the approved baseline: relay layer, canonical message path, A2A as agent-side boundary, append-only ledger, reference vs strategy layering.

## Round Result Record

| File | Lane | Status | Notes |
|---|---|---|---|
| `website/docs/configuration/storage.html` | docs | unchanged | Verified unchanged; still frames storage as relay-supporting architecture, not product identity |
| `website/docs/api/index.html` | docs | unchanged | Verified unchanged; still reads as relay-runtime reference surface |
| `docs/api-reference.md` | docs | done | Opening now frames API as operational/reference surface around the relay runtime |
| `website/blog/index.html` | blog entry surface | done | In-scope summaries and JSON-LD updated; March entries ordered consistently |
| `website/blog/one-protocol-a2a/index.html` | blog | done | Preserves blog topic while constraining A2A to the agent-side boundary story |
| `website/blog/agent-compatibility-analysis/index.html` | blog | done | Historical analysis framing made explicit; no longer reads like current multi-adapter guidance |
| `website/blog/agent-adapter-capability-matrix/index.html` | blog | done | Historical matrix framing made explicit; current-state operator guidance removed |

### Remaining high-risk files not handled this round
- None inside the fixed file list for this plan.
- Broader remaining-surface cleanup across other docs and website pages stays deferred by scope lock.

### Mapping table version used
- High-Risk Docs Alignment v1

### Scoped verification summary
- Page-level test matrix: PASS for all changed files and previously verified unchanged in-scope docs files.
- Terminology consistency: PASS. Edited files keep CAR as a relay layer and A2A as the standard agent-side boundary.
- Scope check: PASS. No intended out-of-scope file changes are part of the final result.
- Additional verification fixes: none required after final review.
