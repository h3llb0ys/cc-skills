---
name: premortem
description: Use when about to recommend a high-cost irreversible technical decision — architecture choice (sync vs async, monolith split, transport, storage model), migration plan (schema, framework version, runtime, library swap), dependency with deep integration (auth, ORM, queue, observability), refactor crossing 3+ files or 2+ modules, project-wide pattern adoption, or any commitment where rollback would cost more than a day of work. Skip for bug fixes, single-file edits, factual or "how does X work" questions, implementing already-agreed plans, decisions the user has already committed to, or cheaply reversible changes.
---

# Premortem

Klein's prospective hindsight: instead of asking "what could go wrong" (which produces hedged risk assessment), assume the decision already failed and explain how. The framing shift forces specific failure identification — narrative mode generates more honest output than evaluation mode, and breaks the default agreeable-optimism bias.

## When to fire (autonomous trigger)

YES — fire automatically when about to recommend:
- An architectural choice (sync vs async, monolith vs split, transport, storage model)
- A migration plan (schema, framework version, library swap, runtime)
- A dependency with deep integration (auth, ORM, queue, observability)
- A refactor that crosses ≥3 files or ≥2 modules
- A pattern to apply project-wide
- Any plan where rollback cost > 1 day of work

NO — never fire on:
- Bug fixes, single-function edits, single-file changes
- "How does X work" / factual questions
- Implementing an already-agreed plan (premortem during plan creation, not execution)
- Decisions the user has already committed to (irreversibility kills the point)
- Inside `superpowers:executing-plans` mid-run

If borderline, ask one question: "Is rollback cheap if this doesn't pan out?" Cheap → skip. Expensive → run.

**On skip:** just answer normally. Do NOT mention you considered premortem and skipped — that's noise. The skill either fires fully or stays invisible.

## Announce before firing

When triggering autonomously, signal in one line so the user can opt out:

> "Before I recommend [X], running a quick premortem on it. Skip if you'd rather just have the answer."

This matters because the user might be in a hurry, or already know the failure modes, or want execution not analysis. Don't sneak the ritual in — make it visible and skippable.

## Minimum context gate

Three things, derive from conversation + open files + CLAUDE.md before asking the user anything:

1. **What** — one-sentence description of the decision
2. **Constraints** — codebase scale, team, downstream consumers, deadlines
3. **Success** — what "this worked" looks like in the relevant timeframe

Gather using `Read` / `Grep` / `git log` directly — do NOT spawn a subagent for context gathering, since the subagent cannot see the conversation context that defines the decision being analyzed.

If one of the three is still missing after scanning, ask one focused question for the most-missing piece. Never interrogate.

## Timeframe (match scope, do not hardcode)

| Decision type | Timeframe |
|---|---|
| Migration / refactor | 4–8 weeks |
| Architectural choice | 3–6 months |
| Library / framework | 3–6 months |
| Pattern adoption | 2–3 months |

Pick what fits. "6 months from now" by default produces incongruent failure stories for a 4-week migration.

## Procedure

### 1. Set the frame explicitly

> "Premortem: it's [timeframe] from now. [Decision] failed. Working backward."

The framing IS the mechanism. Do not soften, do not skip, do not paraphrase to "let's think about risks."

### 2. Generate failure modes — single pass, no fan-out

List every genuine failure mode. Each must be:
- Specific to **this** codebase / situation (reference real files, real constraints)
- A real threat, not edge-case theater
- Distinct from siblings (no overlap)

Stop when the list is honest, not when it hits a number. **3 strong > 7 padded.**

**Default: single pass, no subagent fan-out.** Subagents lose codebase context, can't grep accurately, and produce generic stories. Single-pass synthesis with the file context already loaded is stronger.

Exception: if after synthesis the user asks to dig deep into one specific failure mode, then a focused subagent on that single mode (with explicit file paths handed to it) is fine. Do not preemptively fan out across all modes.

### 3. For each failure mode, three lines max

- **Story** — 2–3 sentences of how it actually plays out, grounded in this codebase (real files, real constraints)
- **Assumption** — one sentence: what was taken for granted that made this possible
- **Signal** — one observable thing that would indicate it's happening (test pattern, metric, error shape, team friction signal)

### 4. Synthesis — this is the product

- **Most likely failure** — highest probability given what I know. Commit to one. No "could maybe."
- **Most dangerous failure** — worst damage if it hits, even if less likely.
- **Hidden assumption** — the single biggest unexamined belief across all failures. This is often where the real value lives.
- **Revised plan** — concrete actions. Not "be careful with X." Yes "split into two PRs: schema migration first, code change second; verify with prod snapshot replay before second PR."
- **Pre-commit checklist** — 3–5 specific verifiable items to confirm before executing.

### 5. Output — chat only, no files

One chat message. Markdown. **Do not write HTML reports, transcript files, or any other artifacts to disk.** The conversation is the transcript.

Template:

```
**Premortem: [one-line decision]**
Frame: [timeframe] from now, this failed.

1. [failure mode]
   Story: ...
   Assumption: ...
   Signal: ...
2. ...

---

**Synthesis**
- Most likely: ...
- Most dangerous: ...
- Hidden assumption: ...
- Revised plan: [concrete actions]
- Before-commit checklist:
  - [ ] ...
  - [ ] ...
```

End with one prompt back to user: "Proceed with revised plan, or dig into a specific failure mode?"

## Worked example (calibration)

User: "Let's extract inventory and reservations from the shop monolith into their own service so we can scale checkout independently."

Context I have: Go modular monolith, ~3-person team, `Reservation` rows are created in the same
transaction as `Order`, stock levels are a plain FK-guarded column, checkout is the suspected hotspot.

Announce: "Before recommending the split, running a quick premortem on it. Skip if you'd rather just have the answer."

Frame: 4 months from now, the split failed.

```
**Premortem: extract inventory + reservations into a separate service**
Frame: 4 months from now, this failed.

1. Reserve-then-order stops being atomic
   Story: PlaceOrder() used to write Reservation + Order in one DB tx. Split → two systems,
     eventual consistency. Under Black Friday load the reservation lands, the order fails,
     and stock stays locked until a sweeper notices — customers see "out of stock" on goods
     nobody bought.
   Assumption: that the reserve/commit invariant is independent of transport.
   Signal: first appearance of a "release orphaned reservations" cron job.

2. Oversell window opens under retries
   Story: checkout retries a timed-out reserve call; the first call had actually succeeded.
     Without an idempotency key carried across the boundary, two reservations consume
     the same unit and the warehouse ships one order short.
   Assumption: that the network boundary is retry-safe because the DB used to be.
   Signal: mismatch between reserved units and order lines in the nightly reconciliation.

3. Ops overhead exceeds 3-person team capacity
   Story: 2 services = 2 deploy pipelines, 2 oncall surfaces, 2 sets of metrics. Checkout
     debugging now crosses a network boundary; trace correlation takes weeks to wire up.
   Assumption: that scaling benefit > coordination cost at current team size.
   Signal: oncall pages double; feature velocity drops below pre-split baseline.

---

**Synthesis**
- Most likely: ops overhead exceeds capacity (HIGH for a 3-person team).
- Most dangerous: oversell — it ships wrong goods and costs customer trust, not just latency.
- Hidden assumption: that inventory IS the bottleneck. No load profile cited.
- Revised plan:
  1. Profile checkout first; identify whether reservation writes or catalog reads dominate.
  2. If reads — add a read replica or cache inside the monolith. One DB, one tx boundary.
  3. Revisit the service split only after a measured bottleneck resists in-process fixes.
- Before-commit checklist:
  - [ ] Load profile attached (p50/p95/p99 by endpoint, last 30 days)
  - [ ] Measured bottleneck named (not assumed)
  - [ ] Reserve/commit invariant restated for the proposed boundary
  - [ ] Idempotency key defined for every cross-boundary write
  - [ ] Team-capacity check: who is oncall for service #2
```

Then: "Proceed with profile-first plan, or dig into a specific failure mode?"

This is the target shape. Note: failure modes reference real entities (`Reservation`, the order tx),
assumptions are testable, signals are observable, and the revised plan is concrete actions rather than advice.

## Anti-patterns

- **Padding** — if the honest list is 3, write 3. Don't pad to look thorough.
- **Generic advice** — every failure must reference specifics from this codebase/situation, not patterns that fit any project.
- **Hedging in synthesis** — "could potentially maybe" defeats the mechanism. Commit.
- **Re-running unchanged** — if user re-asks without changing the plan, point to previous output and ask what changed.
- **Firing on small stuff** — this is heavy. Bug fixes don't need it.
- **Asking for context already on disk** — read CLAUDE.md, open files, recent diffs first.
- **Writing artifacts to disk** — chat only.

## Self-rationalizations to watch (red flags)

These are the excuses I'll generate to skip or dilute the ritual. Each means: stop and run it properly, or honestly skip.

| Excuse | Reality |
|---|---|
| "Plan is obvious, skip context gate" | Generic plans → generic failures. Two minutes of reading saves twenty of bad analysis. |
| "User is in a hurry, do a lite version" | Lite premortem = polite hedging. The mechanism dies. Either run full or skip and say so. |
| "I already wrote the recommendation, premortem after" | Once the answer is out, anchoring is set. Run before, or admit it's now cosmetic. |
| "Failure modes look similar to last time, copy them" | Different codebase / different state / different constraints. Re-derive. |
| "User pushed back on a failure mode, abandon the analysis" | Pushback ≠ rationalization. User often has info I lacked. Update that one mode and continue, don't capitulate wholesale. |

**Letter and spirit:** running a hedged "premortem" that softens conclusions to please the user violates the spirit even if the structure is intact. The whole point is honest failure identification before reality forces it.

## Conflict resolution with other skills

- **`/dispute`** — sticky dialogue mode for critiquing user's idea. If active, don't double-fire. Premortem is one-shot on a specific commitment; dispute is iterative on idea quality.
- **`superpowers:writing-plans`** — fire premortem AFTER plan is drafted, BEFORE execution begins.
- **`superpowers:executing-plans`** — never fire mid-execution. The decision is past; running now is theater.
- **`superpowers:brainstorming`** — premortem is for narrowed concrete plans, not exploration. If still brainstorming, defer.
