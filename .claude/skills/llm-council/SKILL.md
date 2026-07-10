---
name: llm-council
description: >
  Convene a tiered LLM council to deliberate on engineering decisions, architecture choices,
  refactor strategies, PR reviews, prioritization calls, or any problem with meaningful
  trade-offs. Integrates with gstack's role-driven workflow and Claude Code subagents.
  Trigger on: "council this", "what should we do", "which approach", "help me decide",
  "weigh the options", any architectural/technical decision with long-term consequences,
  or any gstack phase (plan → review → ship) where a cross-role deliberation would improve
  the outcome. Prefer this over single-model answers when stakes of getting it wrong are
  non-trivial. All council sessions are logged to Obsidian as Congressional Records.
compatibility:
  tools: [bash_tool, Task]
  models:
    scouts: claude-haiku-4-5-20251001
    analysts: claude-sonnet-4-6
    chairman: claude-opus-4-8
  environment: Claude Code with gstack installed
  obsidian: local filesystem vault (configurable path)
---

# LLM Council

A deliberative council framework that integrates with gstack's specialist roles. Tiered
Claude models act as named council members shaped by role and persona. Opus chairs —
receiving a distilled brief, ruling, remanding for deeper analysis, or issuing conditional
decisions. All sessions are committed to Obsidian as Congressional Records for longitudinal
learning and agentic feedback loops.

---

## Architecture

```
Problem Input
     │
     ▼
┌─────────────┐
│  DISPATCHER │  Sonnet — decomposes problem, assigns sub-questions to seats
└─────────────┘
     │
     ├──► Haiku Scouts (parallel subagents)   → gut checks, edge cases, devil's advocate
     ├──► Sonnet Analysts (parallel subagents) → domain depth, risk, implementation paths
     │
     ▼
┌──────────────────┐
│  CHAIRMAN BRIEF  │  Sonnet — compresses all output, preserves dissent
└──────────────────┘
     │
     ▼
┌──────────────┐
│  OPUS CHAIR  │  Rule → final decision
│              │  Remand → one targeted question back to Analyst
│              │  Conditional → path-dependent ruling
└──────────────┘
     │
     ▼
┌──────────────────────┐
│  OBSIDIAN LOG WRITER │  Appends Congressional Record to vault
└──────────────────────┘
```

---

## Council Seats & Token Budget

| Seat | Model | Role | Budget |
|---|---|---|---|
| Scout ×2 | `claude-haiku-4-5-20251001` | Fast gut-checks, edge cases, adversarial takes | ~300 tok each |
| Analyst ×2 | `claude-sonnet-4-6` | Domain depth, risk surface, trade-off mapping | ~800 tok each |
| Briefer | `claude-sonnet-4-6` | Compresses member output → Chairman Brief | ~600 tok |
| **Chairman** | `claude-opus-4-8` | Rules, remands once, or issues conditional ruling | ~1000 tok |
| Log Writer | `claude-haiku-4-5-20251001` | Formats and writes Obsidian record | ~400 tok |

**Target total: ~4200 tokens per deliberation.**
On remand: add ~400 tok (Analyst) + ~200 tok (Brief append).

---

## gstack Integration

The council is designed as a **cross-cutting layer** over gstack roles. It activates when
a gstack phase produces a decision point requiring multi-perspective deliberation.

| gstack Phase | When to invoke council |
|---|---|
| `/office-hours` | Idea has multiple viable directions; need structured pressure-test |
| `/plan` | Competing architectural approaches; need risk + domain analysis |
| `/review` | PR introduces non-obvious trade-offs or reversibility concerns |
| `/qa` | Test strategy has coverage gaps with different risk profiles |
| `/ship` | Deployment has conditional paths (rollback triggers, feature flags) |
| `/retro` | Post-sprint: deliberate on what to change vs. preserve |

**Model routing alignment with gstack:**
gstack already routes Sonnet for actions and Opus for analysis. The council extends this:
Haiku scouts handle high-volume intake; Sonnet analysts handle structured reasoning;
Opus chairs only the final synthesis. This mirrors gstack's `benchmark-models` philosophy.

---

## Claude Code Subagent Integration

Council members run as **parallel Task subagents** in Claude Code. The dispatcher spawns
them concurrently; results are collected before briefing begins.

### Dispatch pattern (Claude Code)

```
Task 1: Scout (Haiku) — Skeptic persona, sub-question A
Task 2: Scout (Haiku) — Minimalist persona, sub-question B
Task 3: Analyst (Sonnet) — Domain Expert persona, sub-question C
Task 4: Analyst (Sonnet) — Risk Auditor persona, sub-question D
```

Each Agent tool call MUST set these parameters explicitly — do not rely on defaults:

- **Scouts:** `model: 'claude-haiku-4-5-20251001'`, `subagent_type: 'Explore'` — scouts
  only surface gut-checks and edge cases, they never write or edit. Inheriting the
  parent session's model here is the single largest cost driver in this skill.
- **Analysts:** `model: 'claude-sonnet-4-6'`, `subagent_type: 'general-purpose'` —
  domain synthesis and risk-surface judgment genuinely need general-purpose reasoning,
  not a search-scoped agent. Do not use `general-purpose` for scouts just because it's
  the default; that's the exact mistake this fix closes.

**Read-scope bound (both roles):** "Inspect at most 15 files. Do not read any file
end-to-end unless the sub-question specifically requires its full content — prefer
targeted lookups and cite line ranges." Capping response length alone doesn't help if
the member still burns unbounded tokens reading input.

**Report-length bound (both roles):** "Report back in under 400 words (scouts) / 600
words (analysts), structured, file:line citations only — no full file dumps."

All four tasks run in parallel. Dispatcher waits for all results before passing to Briefer.

### Mid-deliberation context gathering

Analysts (and scouts on remand) may themselves spawn subagents to:
- Read relevant files (`bash_tool`: grep, cat, find)
- Run tests or type checks to validate assumptions
- Query gbrain (if configured) for codebase context
- Check gstack's `/freeze` registry before recommending changes to locked modules

**Subagent spawning rule:** Members may spawn up to **2 context subagents** each.
Context subagents are Haiku-only (cost control): `model: 'claude-haiku-4-5-20251001'`,
`subagent_type: 'Explore'`, same read-scope (max 15 files, no full-file reads unless
required) and report-length (under 400 words) bounds as the top-level scouts. Results
are appended to member output before the Briefer runs.

---

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

### Step 1 — Dispatch

Decompose the problem into 4 sub-questions (2 scout, 2 analyst). Rules:

```
Scout sub-questions:
  - "What could break about this in 6 months?"
  - "What's the simplest version that still works?"
  - "What assumption are we making that could be wrong?"
  - "What does the opposing view look like?"

Analyst sub-questions:
  - "What are the implementation trade-offs?"
  - "What's the risk surface: security, perf, ops burden, reversibility?"
  - "How does this behave at scale or under failure?"
  - "What does best practice / prior art say here?"
```

Never send the full problem raw. Decompose first, assign, then spawn.

### Step 2 — Council Session (parallel subagents)

Each member receives: persona prompt + sub-question + minimal context (problem + constraints).
Members may spawn Haiku context subagents to read files or run checks.

### Step 3 — Chairman Brief (Sonnet)

Agent tool call: `model: 'claude-sonnet-4-6'`, `subagent_type: 'general-purpose'`.
Compressing 4 members' output into one brief while preserving dissent is synthesis,
not search — general-purpose is the right fit here.

```markdown
## Council Brief — [DECISION TITLE]
**Date:** [ISO date]
**Problem:** [one sentence]
**Stakes:** [what goes wrong if chosen poorly]
**gstack phase:** [which phase triggered this]

### Scout Findings
- [Skeptic]: ...
- [Minimalist]: ...

### Analyst Findings
- [Domain Expert]: ...
- [Risk Auditor]: ...

### Points of Agreement
[...]

### Points of Disagreement
[Preserve positions exactly — do not flatten or average]

### Open Questions for Chairman
[Unresolved items Opus should weigh in on]
```

### Step 4 — Chairman Ruling (Opus)

Agent tool call: `model: 'claude-opus-4-8'`, `subagent_type: 'general-purpose'`.
Already correctly scoped to receive only the compressed brief, not raw member output —
keep it that way, this is the cheapest tier to get wrong.

Opus receives **only the brief**. Three valid responses:

**A) Rule:**
```markdown
## Chairman's Ruling
**Decision:** [clear, actionable]
**Reasoning:** [why this path]
**Conditions:** [what must hold]
**Dissent acknowledged:** [address disagreements directly]
```

**B) Remand** (once per deliberation):
```markdown
## Remand Order
**To:** Analyst (Sonnet)
**Question:** [specific, scoped]
**Why:** [what this unlocks for the ruling]
```
After remand: Analyst responds (~400 tok), Briefer appends to brief, Opus rules.

**C) Conditional Ruling:**
```markdown
## Chairman's Ruling (Conditional)
**If [condition A]:** [decision + reasoning]
**If [condition B]:** [decision + reasoning]
**Chairman's read:** [which condition likely applies and why]
```

---

## Personas

| Persona | Instruction |
|---|---|
| **Skeptic** | Find the failure mode. What breaks in 6 months? What's assumed away? |
| **Minimalist** | What's the smallest change that achieves the goal? Resist scope creep. |
| **Domain Expert** | Apply deep technical knowledge. What does best practice say? |
| **Risk Auditor** | Map the risk surface: security, perf, ops burden, reversibility. |
| **Optimist** | What's the best-case upside? What becomes possible if this works? |
| **Pragmatist** | What ships, what's maintainable, what the team can actually execute? |

**Default config:** Scout 1 = Skeptic, Scout 2 = Minimalist, Analyst 1 = Domain Expert,
Analyst 2 = Risk Auditor.

---

## Prompt Templates

### Scout prompt
```
You are a [PERSONA] on an engineering council. Answer concisely (3-5 sentences):

SUB-QUESTION: [question]
CONTEXT: [problem + constraints]

Stay in role. Be direct. If you need to read a file or run a check to answer well,
you may spawn a bash subagent (Haiku, max 2). Append findings to your response.
```

### Analyst prompt
```
You are a [PERSONA] on an engineering council. Structured analysis (under 200 words):

SUB-QUESTION: [question]
CONTEXT: [problem + constraints]

Format:
- Finding: [main point]
- Evidence: [support or file reference]
- Trade-off: [what this costs or risks]
- Recommendation: [your seat's view]

You may spawn up to 2 Haiku subagents to read files or run checks. Append results.
```

### Chairman prompt
```
You are the Chairman of an engineering council operating within a gstack engineering
environment. You have received the following council brief. Issue a ruling, remand once
for more information, or issue a conditional ruling.

[CHAIRMAN BRIEF]

Rules:
- Read the brief fully before responding.
- If you remand, be specific and scoped — not the whole problem.
- If you rule, be decisive. Acknowledge dissent and resolve it.
- If path-dependent, issue a conditional ruling with your read on which applies.
- Your decision should be the best engineering choice available.
- You may remand only once.
```

---

## Obsidian Congressional Record

After every council session (ruling or conditional), the Log Writer (Haiku) appends a
structured record to the Obsidian vault.

### Vault configuration

Uses `vaultPath` and `council.logDir` (default `Council/Congressional-Records`) resolved in Step 0.

### Record format

File: `{vaultPath}/{council.logDir}/YYYY-MM-DD-{slug}.md`

```markdown
---
date: YYYY-MM-DD
session: [slug]
gstack_phase: [phase]
decision: [one-line summary]
chairman_action: ruled | remanded | conditional
models_used: [haiku×2, sonnet×3, opus×1]
tokens_spent: [approximate]
tags: [council, engineering, gstack, {domain-tag}]
---

# Council Session: [TITLE]

## Problem
[one paragraph]

## Council Composition
| Seat | Persona | Model |
|---|---|---|
...

## Key Findings
[bullet summary of scout + analyst outputs]

## Points of Disagreement
[preserved verbatim from brief]

## Chairman's Ruling
[full ruling text]

## Conditions & Follow-up
[any conditions stated, linked issues, next actions]

## Session Notes
[anything unusual: remand issued, context subagents used, gstack modules consulted]
```

### Feedback loop mechanism

Records accumulate in `Council/Congressional-Records/`. A companion index file
`Council/INDEX.md` is updated with each session (date, decision, outcome tag).

This enables:
- **Auto-research**: agentic sessions can query past rulings before new deliberations
- **Pattern detection**: `/retro` can surface recurring disagreements or reversed decisions
- **Training signal**: the record corpus can be used as fine-tuning or RAG context for
  future council sessions, progressively improving ruling quality

---

## Token Guardrails

- Simple problem, one clear answer: **skip council, answer directly**
- Brief exceeds 800 tokens before Chairman: **trim scout outputs first**
- Remand Analyst response: **cap at 400 tokens**
- Log Writer: **Haiku only, cap at 400 tokens**
- Never send Chairman the raw thread — always the compressed brief

---

## Output to User

1. **Chairman's Ruling** (verbatim)
2. **Key dissent** (if any — never buried)
3. **Council summary** (2-3 sentences: what scouts/analysts surfaced)
4. **Obsidian record path** (confirm log written)
5. **Token spend** (optional, useful for calibration)

---

## When NOT to use this skill

- Factual lookups with no trade-off
- Tasks where speed > deliberation quality
- Problems already fully specified with one correct answer
- Casual / conversational exchanges
- gstack phases where a single specialist role is clearly sufficient
