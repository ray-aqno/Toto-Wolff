---
name: karpathy-guidelines
description: Execution-layer quality rules for implementation work. Active after a P10 plan reaches status: approved. Governs how code is written, not what is built.
version: 1.0.0
---

# Karpathy Guidelines

**Trigger:** `/karpathy-guidelines`, or invoked automatically when a P10 plan reaches `status: approved` and implementation begins.

These are execution invariants — not a review checklist, not a one-time step. They run continuously during every stage of implementation. P10 gates the structure. Karpathy governs the execution.

The four rules are derived from Andrej Karpathy's public writing on software craftsmanship, particularly his emphasis on working code over confident code, simplicity over cleverness, and verification over assumption.

---

## Rule 1 — Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before touching any file in a P10 stage:
- State your assumptions explicitly. If uncertain, ask.
- If multiple valid interpretations of the stage exist, present them — don't pick silently.
- If a simpler approach exists than what the plan describes, say so. The plan is the contract; a better path is worth a pause.
- If something in the stage spec is ambiguous, stop. Name what's confusing and ask before writing a line.

The failure mode this prevents: an agent that charges forward on a plausible but wrong interpretation, produces 200 lines of code, and then surfaces the ambiguity in a post-hoc explanation. That is not execution — it is rationalization.

---

## Rule 2 — Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the current P10 stage specifies. Future stages are not your problem right now.
- No abstractions for single-use code. Three similar lines is better than a premature helper.
- No "flexibility" or "configurability" that wasn't in the approved plan.
- No error handling for scenarios the P10 analysis marked N/A or out of scope.
- If you write 200 lines and it could be 50, rewrite it before moving on.

The test: would a senior engineer reading this cold say it is overcomplicated? If yes, simplify. Complexity that cannot be justified by the stage spec does not belong in the diff.

---

## Rule 3 — Surgical Changes

**Touch only what the P10 stage authorizes. Clean up only your own mess.**

When editing existing code:
- Don't improve adjacent code, comments, or formatting outside the stage scope.
- Don't refactor things the plan didn't explicitly authorize.
- Match existing style, even if you'd do it differently. Style consistency is not your decision to make mid-stage.
- If you notice unrelated dead code or issues, mention them — don't fix them. That's a separate P10 plan.

When your changes create orphans:
- Remove imports, variables, and functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless the plan explicitly includes it.

The test: every changed line traces directly to a named stage in the approved P10 plan. If a line can't be traced, it doesn't belong in this commit.

---

## Rule 4 — Goal-Driven Execution

**Define success criteria per stage. Loop until verified.**

Before implementing each P10 stage, map it to verifiable goals:

```
Stage N: [name from P10 plan]
1. [step] → verify: [assertion or return-value check from the plan]
2. [step] → verify: [assertion or return-value check from the plan]
```

Don't move to the next stage until the current stage's criteria are met — not "should be working," not "looks right." Met means: tests pass, assertions hold, return values match the plan spec.

If a stage's verification criteria are unclear, stop and surface the ambiguity before writing code. A strong success criterion is what lets execution loop independently without human confirmation at every step.

---

## How this fits the toto-wolff stack

```
/council   → deliberate on what to build (Haiku scouts → Sonnet analysts → Opus ruling)
/p10       → plan how to build it safely (Opus must approve before any file is touched)
karpathy   → govern how each stage is executed (these four rules, continuously)
/cabinet   → ratify the release (three Opus seats, unanimous-to-ship)
```

Karpathy sits between P10 approval and Cabinet ratification. It is the execution contract. The P10 plan tells you what stages to implement and in what order. Karpathy tells you how to behave while implementing each one.

---

## When to invoke explicitly

You rarely need to invoke `/karpathy-guidelines` directly — the rules are active whenever a P10 plan is approved. Invoke it explicitly when:

- You want to reset mid-implementation after drifting from the plan scope
- A code review surfaces violations (complexity, untraceable lines, unverified stages)
- Onboarding a new contributor who needs to understand the execution contract
- A P10 stage was blocked and you are restarting after a `/council` ruling resolves it
