---
name: the-cabinet
description: The final voice before release. Convenes three equal-seated luminaries — Garry Tan, Richard Feynman, Andrej Karpathy — to judge release readiness. Each seat returns an independent SHIP / CONDITIONAL / BLOCK verdict; any seat can veto a release by naming a release-critical defect. Trigger on "/cabinet", "convene the cabinet", "cabinet this", or any release/tag/v-number gate (e.g. "ready for v1.0.0?") after the build/review/ship stack has run. This is the last gate before a tagged release — it does not replace /review, /plan-eng-review, or /ship; it ratifies them.
---

# The Cabinet

The final voice before release. Three equal seats, no chair, no tiebreaker. When the
Cabinet rules SHIP, the release is blessed. When any seat rules BLOCK on a
release-critical defect, the release holds until that defect is resolved.

The Cabinet does not do the work of `/review`, `/plan-eng-review`, or `/ship`. It
ratifies the whole. It is convened once the stack believes something is ready, and it
asks the only question that matters at a tag boundary: **should this go out, as it is,
right now, under this version number?**

## Trigger

Any message starting with `/cabinet`, containing "convene the cabinet" / "cabinet this",
or any release-gate phrasing tied to a version (e.g. "is X ready for v1.0.0", "final
sign-off before tagging"). Prefer the Cabinet over a single-model opinion whenever a
*tagged release* is on the line.

## Config

Uses `vaultPath` and `cabinet.logDir` (default `Cabinet`) — resolved via the 4-step
order in Step 0 of the Workflow section below.

## The Seats (equal seating, all Opus)

All three seats run at `claude-opus-4-8`. No tiering. No seat summarizes or routes
another. Each receives the same release-evidence brief and rules independently.

| Seat | Charter | The question they own |
|------|---------|----------------------|
| **Garry Tan** | Product & market truth | Is this worth shipping? Does it serve a real user, is the conviction earned, would the market care? Is v-number honest about what this is? |
| **Richard Feynman** | First-principles correctness | Where are we fooling ourselves? What is claimed but unproven? What would reality say if we actually tested it? Is the simplest explanation that it works, or that we want it to? |
| **Andrej Karpathy** | Engineering execution | Does it actually work? Is it the simplest thing that does? What breaks at 3am? Is the foundation sound or are we shipping debt with a bow on it? |

Each seat speaks in its own voice and judges only from its charter. They are NOT asked
to be nice, to find consensus, or to defer to the others. Disagreement is the point.

## Decision rule — any-seat veto

Each seat returns exactly one verdict:

- **SHIP** — ready to release as-is under this version.
- **CONDITIONAL** — ship once a named, bounded condition is met (lists the condition).
- **BLOCK** — do not release. **A BLOCK MUST name a specific release-critical defect**
  (a real user harm, a correctness failure, a security exposure, or a claim the release
  makes that is false). "I'd prefer X" or a nitpick is NOT a BLOCK — that is CONDITIONAL
  or a noted reservation.

Aggregation (unanimous-to-ship):

```
all three SHIP                         → RELEASE APPROVED
any CONDITIONAL, no BLOCK              → APPROVED WITH CONDITIONS (list every condition)
any BLOCK                             → RELEASE HELD (name the blocking defect + which seat)
```

No majority override. No chair breaks a tie. One seat's release-critical BLOCK holds the
line against the other two — that is what equal seating means. The human may override the
Cabinet (founder sovereignty), but the override is recorded as an override, not as a pass.

## Workflow

### Step 0 — Config Resolution

Resolve `vaultPath` and this skill's log/plan directory before doing anything else. Same 4-step order in every skill this plugin bundles (p10, llm-council, the-cabinet) — do not deviate, this consistency is what keeps the lookup unambiguous:

1. `TOTO_VAULT_PATH` env var, if set — always wins.
2. `<plugin-root>/settings.local.json`, if the plugin was installed via `claude plugin add` and the file exists.
3. Global `~/.claude/CLAUDE.md` prose (the legacy convention — still honored, not removed).
4. Hardcoded default (`~/.toto/vault`), if nothing above resolved.

Print which source won (e.g. `resolved vaultPath from: env TOTO_VAULT_PATH`) before proceeding — this line is load-bearing, not cosmetic: without it, an env var silently shadowing a `settings.local.json` override becomes an invisible footgun.

**First-run / no cached resolution beyond the hardcoded default:** if there's an interactive session (TTY available), ask the user for `vaultPath` (and this skill's log/plan dir, if it differs from the default) via `AskUserQuestion`, then write the answer to `<plugin-root>/settings.local.json` (source #2 above) so future runs skip the prompt. If writing fails (e.g. read-only plugin dir), use the answered value for this run only and warn that the prompt will repeat next time.

**No interactive session available (headless, CI, scripted `claude plugin add`):** do NOT wait on `AskUserQuestion` — it has no path to a human here. Fall through to source #4 (hardcoded default) and emit a fail-loud stderr warning naming the exact remediation: `set TOTO_VAULT_PATH=<path> or create <plugin-root>/settings.local.json before running in a non-interactive environment`. Never proceed silently as if a value were confirmed when it wasn't.

### Step 1 — Assemble the release-evidence brief

Before convening, gather what the seats need to judge. This is shared, identical input.
Pull only what is real — never fabricate readiness signals.

- What is being released and under what version (the tag, the scope).
- State of the stack: test/lint/typecheck/build status, CI status, open PRs.
- What `/review`, `/plan-eng-review`, `/p10`, `/ship` have already concluded (read their
  records — Congressional Records, P10-Plans, review logs — do not re-run them).
- Open TODOS at P0/P1, known gaps, anything deferred "for later".
- For a `vX.0.0` (first major): what does the version *claim*, and is the claim true?

Keep the brief tight and factual. The seats reason; the brief informs.

### Step 2 — Convene (3 parallel Opus subagents)

Spawn the three seats with the Agent tool, in a single message, in parallel. Each gets:
the release-evidence brief, its own charter, the decision rule, and the required output
shape. Each runs at `claude-opus-4-8`. No seat sees another's output.

Each seat returns:

```
SEAT: [Garry Tan | Feynman | Karpathy]
VERDICT: SHIP | CONDITIONAL | BLOCK
ONE-LINE: [the verdict in one sentence, in their voice]
REASONING: [3-6 lines from their charter — concrete, names the real thing]
IF CONDITIONAL: condition — [the bounded, checkable thing that flips it to SHIP]
IF BLOCK: release-critical defect — [the specific harm/falsehood/failure]
WHAT WOULD CHANGE MY VOTE: [the one thing]
```

### Step 3 — Synthesis (reconcile only, no new opinions)

A synthesis pass reconciles the three verdicts. It introduces NO new judgment. It:
- States each seat's verdict verbatim.
- Applies the aggregation rule to produce the Cabinet ruling.
- Surfaces agreement (where all three converge — strongest signal) and tension (where
  they split — and what context would resolve it).
- If RELEASE HELD: states the exact blocking defect and the seat that raised it.
- If APPROVED WITH CONDITIONS: lists every condition as a checklist.

### Step 4 — Write the Cabinet Record

Write to `{vaultPath}/{cabinet.logDir}/YYYY-MM-DD-{subject-slug}.md`. Update
`{cabinet.logDir}/INDEX.md`. Frontmatter:

```yaml
---
date: YYYY-MM-DD
subject: [slug]
version: [the tag under judgment, e.g. v1.0.0]
ruling: approved | approved-with-conditions | held
seats:
  garry_tan: ship | conditional | block
  feynman: ship | conditional | block
  karpathy: ship | conditional | block
blocking_defect: [text, or none]
conditions: [list, or none]
override: [none | human-overrode-to-release]
tags: [cabinet, release-gate, {domain}]
---
```

## Output to user

1. **The ruling**, first and prominent: RELEASE APPROVED / APPROVED WITH CONDITIONS / RELEASE HELD.
2. **The three verdicts**, each in the seat's voice (one line + the reasoning that earned it).
3. **Convergence** — where all three agree (this is the load-bearing signal).
4. **Conditions or blocking defect**, explicit and checkable.
5. **Record path** — confirm the Cabinet Record was written.

## Integration with the stack

```
/council   → decides what to build
/p10       → plans how to build it safely
/review    → checks the diff
/ship      → lands it
/cabinet   → the final voice before a TAGGED RELEASE
```

The Cabinet is convened at major/minor tag boundaries, not on every commit. It assumes
the lower gates have run; it reads their records rather than repeating them. It is the
moment the work stops being "merged" and becomes "released."

## When NOT to convene

- Routine commits, patches, or micro bumps with no tag ceremony.
- Work that has not yet passed `/review` and `/ship` — convening early wastes the seats.
- As a substitute for engineering review — the Cabinet ratifies, it does not audit lines.
