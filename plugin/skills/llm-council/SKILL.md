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

## Step 0 — Config Resolution

The vault folder is `${user_config.vault_path}` (the plugin's Vault folder setting). If this line still shows the placeholder, ask the user once for the vault folder and use their answer for this session; do not write it anywhere.

Below, `vaultPath` is that folder, and this skill's log directory `council.logDir` is `Council/Congressional-Records` inside it.

---

## Step 1 — Dispatch

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

Uses `vaultPath` (the vault folder from Step 0) and `council.logDir` (`Council/Congressional-Records`).

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
