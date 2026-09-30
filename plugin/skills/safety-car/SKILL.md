---
name: safety-car
description: Adversarial stress test of an approved P10 plan. Fires after Opus approval, before any file is touched. One Sonnet agent with one job — find how this plan fails.
version: 1.0.0
---

# Safety Car

**Trigger:** `/safety-car [p10-plan-reference]` or "run safety car on this plan"

A P10 plan approved by Opus has been verified for structural compliance — bounded loops, assertions present, function sizes within limit. What it has not been verified against is how it could fail in practice: abuse vectors, blast radius, edge cases the author didn't consider, assumptions that hold in tests but break under adversarial input.

Safety car closes that gap. One adversarial Sonnet agent reads the approved plan with a single explicit instruction: find failure modes, not alternative approaches. This is not deliberation — that is `/council`'s job. This is stress testing a decision that has already been made.

**F1 rationale:** A safety car is deployed when conditions become dangerous — it slows everything down for inspection before racing resumes. The race is not cancelled. The approach is not re-litigated. The track is inspected, risks are surfaced, and racing resumes only when conditions are confirmed safe. Same mechanic here.

---

## Workflow

### Step 1 — Read the P10 plan

Load the referenced P10 plan from the vault:

```
{VAULT_PATH}/P10-Plans/[plan-filename].md
```

If no specific plan is referenced, check for the most recent plan with `status: approved`. If no approved plan exists, halt and ask the engineer to run `/p10` first.

### Step 2 — Spawn the adversarial agent

Spawn one Sonnet subagent (`claude-sonnet-4-6`) with this instruction:

> You are an adversarial reviewer. Your job is NOT to evaluate whether this plan is well-structured or correct from an engineering standpoint — that has already been done. Your job is to find failure modes.
>
> Read this P10 plan and answer ONLY these questions:
> 1. How could this plan fail in production? (runtime failures, race conditions, edge cases the plan did not account for)
> 2. How could this plan be abused? (inputs that trigger unintended behavior, paths that bypass intended controls)
> 3. What blast radius does this plan carry? (what breaks if stage N fails partway through, what state is left in an inconsistent condition)
> 4. What assumptions does this plan make that could be wrong? (environment assumptions, data shape assumptions, dependency assumptions)
>
> For each risk you find: name it, rate its severity (LOW / MEDIUM / HIGH / CRITICAL), and state the minimum mitigation that would address it.
>
> Do not suggest architectural changes. Do not re-evaluate the approach. Only find risks within the approved plan as written.

The agent receives the full P10 plan text as context.

### Step 3 — Produce the Safety Car Report

The adversarial agent returns a structured report:

```
## Risks Found

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | [description] | LOW/MEDIUM/HIGH/CRITICAL | [minimum mitigation] |

## Verdict

CLEAR — No HIGH or CRITICAL risks found. Safe to proceed with execution.

  OR

DEPLOYED — [N] HIGH/CRITICAL risk(s) found. Halt execution.
[list the blocking risks explicitly]
```

**Verdict rules:**
- `CLEAR` — zero HIGH or CRITICAL risks, or all HIGH/CRITICAL risks have documented mitigations the engineer has explicitly accepted
- `DEPLOYED` — one or more HIGH or CRITICAL risks with no accepted mitigation. Execution must not proceed.

LOW and MEDIUM risks do not trigger DEPLOYED on their own. They are surfaced for awareness and logged.

### Step 4 — Write to vault

Write the full report to:

```
{VAULT_PATH}/Safety-Car/YYYY-MM-DD-[plan-slug].md
```

Frontmatter:

```yaml
---
date: YYYY-MM-DD
plan_ref: [plan-filename]
verdict: CLEAR | DEPLOYED
risks_found: [count]
critical_count: [count]
high_count: [count]
---
```

### Step 5 — Surface the verdict

**If CLEAR:** Report the risk table to the engineer and confirm execution can proceed. Mention any LOW/MEDIUM risks that warrant attention.

**If DEPLOYED:** Stop. Surface each blocking risk explicitly with its severity and the minimum mitigation required to clear it. Execution does not proceed until either:
a) The mitigations are applied and safety car is re-run, or
b) The engineer types: `override safety-car: [documented justification]`

An override is logged to the Safety Car record. The override text becomes a permanent part of the vault entry.

---

## Output format

```
Safety Car — [plan-slug]
Verdict: CLEAR | DEPLOYED

Risks:
  HIGH   [1] [description]
  MEDIUM [2] [description]
  LOW    [1] [description]

[If CLEAR]: Execution authorized. Proceed with karpathy.
[If DEPLOYED]: Execution halted. Resolve the HIGH/CRITICAL risks above before proceeding.

Record: {VAULT_PATH}/Safety-Car/YYYY-MM-DD-[slug].md
```

---

## How this fits the toto-wolff stack

```
/council     → deliberate on what to build (ruling written to vault)
/p10         → plan how to build it safely (Opus must approve)
/safety-car  → adversarial stress test of the approved plan (CLEAR or DEPLOYED)
karpathy     → govern how each stage is executed (four execution invariants)
/drs         → ambient tripwire — fires automatically on boundary violations
/cabinet     → ratify the release (three Opus seats, unanimous-to-ship)
```

Safety car sits between P10 approval and execution. P10 verifies compliance. Safety car verifies survivability. Both must pass before karpathy begins.

---

## When to use

- After every `/p10` approval, before any file is touched
- Mandatory for changes that cross tenant boundaries, touch permission surfaces, or modify frozen modules
- Mandatory for any stage where a partial failure would leave state in an inconsistent condition
- Recommended for any stage the P10 analysis flagged as HIGH risk

## When NOT to use

- Trivial single-file edits with no authorization or state surface
- Pure documentation or configuration changes with no runtime impact
- Hotfixes where speed is critical — flag for post-hoc safety car review and proceed, but log the skip explicitly
- If safety car was already run against this exact plan version and returned CLEAR with no subsequent plan changes
