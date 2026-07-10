---
name: p10-bridge
description: >
  Apply NASA's Power of 10 safety rules as a pre-execution planning contract for any
  engineering task. Use this skill before writing or modifying code whenever a task has
  been defined (via gstack, /council ruling, or direct issue). The skill researches the
  codebase, drafts a P10-compliant implementation plan (full task or named stage), saves
  it to Obsidian, and provides a decision overview. The saved draft becomes the foundation
  the execution agent reads before touching any file. Trigger on: "plan this with p10",
  "p10 draft", "bridge to execution", "safe implementation plan", any task following a
  /council ruling, or any gstack /plan phase where correctness and safety are non-trivial.
  This is the bridge between planning and elite execution — always invoke it before
  implementing complex, stateful, or safety-critical logic.
compatibility:
  tools: [bash_tool, Task]
  models:
    scouts: claude-haiku-4-5-20251001
    analyst: claude-sonnet-4-6
    arbiter: claude-opus-4-8
  environment: Claude Code with gstack installed
  obsidian: local filesystem vault (configurable path)
  upstream: llm-council (optional — accepts /council rulings as input)
---

# P10 Bridge

A pre-execution planning layer grounded in NASA JPL's Power of 10 rules. Given a task,
the skill scouts the codebase, analyzes the task against each P10 rule, drafts a
compliant implementation plan, passes it to Opus for arbitration, and commits the
approved plan to Obsidian. The execution agent reads this draft before writing a single
line — ensuring complex architecture is built on a verified, safe foundation.

---

## NASA Power of 10 Rules

| # | Rule | Execution constraint |
|---|---|---|
| 1 | Simple control flow | No recursion. No `goto`. No `setjmp/longjmp`. |
| 2 | Fixed loop bounds | Every loop has a provable upper bound. Annotate it. |
| 3 | No dynamic memory post-init | Heap allocation only during initialization phase. |
| 4 | Functions ≤ 60 lines | One screen, one purpose. Split if exceeded. |
| 5 | ≥ 2 assertions per function | Invariants are explicit. Use `assert` or typed guards. |
| 6 | Minimal variable scope | Declare at narrowest scope. No wide globals. |
| 7 | Check every return value | No silent failures. Every call site handles errors. |
| 8 | Preprocessor / macro use minimal | No function-like macros. Constants over `#define`. |
| 9 | Restrict pointer use | No function pointers unless unavoidable. Dereference once. |
| 10 | Zero warnings | All compiler/linter warnings treated as errors. |

Rules 3, 8, and 9 adapt for dynamic and modern compiled languages — see
**Language Adapters** section below.

---

## Architecture

```
Task Input (gstack issue / /council ruling / direct prompt)
     │
     ▼
┌─────────────────┐
│  CODEBASE SCOUT │  Haiku subagents (parallel) — map files, deps, entry points
└─────────────────┘
     │
     ▼
┌─────────────────┐
│  P10 ANALYZER   │  Sonnet — maps task against each rule, surfaces risks + constraints
└─────────────────┘
     │
     ▼
┌─────────────────┐
│  DRAFT WRITER   │  Sonnet — writes staged, P10-compliant implementation plan
└─────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│  P10 ARBITER (Opus)                                 │
│  Reads: P10 analysis + draft only (not raw scouts)  │
│  Approve → status: approved                         │
│  Revise  → Sonnet rewrites once, Opus re-reviews    │
│  Block   → status: blocked, names rule + resolution │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────┐
│  OBSIDIAN WRITE │  Haiku — commits Opus-stamped plan to vault
└─────────────────┘
     │
     ▼
Execution agent reads Obsidian draft — status: approved required to proceed
```

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

### Step 1 — Codebase Scout (Haiku, parallel subagents)

Spawn 2–4 scout subagents to map the codebase relevant to the task. Each Agent tool
call MUST set these parameters explicitly — do not rely on defaults:

- `model: 'claude-haiku-4-5-20251001'` — inheriting the parent session's model
  (Sonnet/Opus) here is the single largest cost driver in this skill. Always set it.
- `subagent_type: 'Explore'` — scouts only read and map; they never write or edit.
  `general-purpose`'s default system prompt is far larger than a scout task needs.
- **Read-scope bound in the prompt itself:** "Inspect at most 15 files. Do not read
  any file end-to-end unless the task specifically requires its full content — prefer
  targeted symbol/grep lookups and cite line ranges." A word cap on the *response*
  (below) does nothing if the scout still burns its budget reading unbounded input.
- **Report-length bound in the prompt itself:** "Report back in under 400 words,
  structured, file:line citations only — no full file dumps, no pasted source blocks
  longer than 5 lines." This is what keeps the P10 Analyzer's incoming context small.

**Tool preference:** When running inside Claude Code with Serena MCP registered, scouts
should default to Serena's symbol-aware tools instead of grep — AST-level scouting catches
structural violations (real function boundaries, actual call graphs) that text search misses:

- `mcp__serena__get_symbols_overview` — file-level symbol maps (Scout A, entry points)
- `mcp__serena__find_symbol` — locate specific functions/classes by name (Scout A, B)
- `mcp__serena__find_referencing_symbols` — call-graph / impact analysis (Scout B, C)

Fall back to grep-based scouting only if Serena MCP is not registered in the session.

```
Scout A: Find entry points and call sites related to the task scope
         (Serena: get_symbols_overview + find_symbol; fallback: grep for function
         names, imports, exports)

Scout B: Map data flow — what state is read/written by this task's scope
         (Serena: find_symbol + find_referencing_symbols; fallback: grep)

Scout C: Identify existing violations of P10 rules in affected files
         (functions > 60 lines, unchecked returns, dynamic alloc patterns —
         Serena: get_symbols_overview to get exact function boundaries/line counts;
         fallback: grep)

Scout D: Check gstack /freeze registry — flag any locked modules in scope
```

Scouts output a **codebase snapshot**: file list, relevant functions, existing violations,
freeze flags. Passed to P10 Analyzer — not to the user directly.

### Step 2 — P10 Analysis (Sonnet)

Agent tool call: `model: 'claude-sonnet-4-6'`, `subagent_type: 'general-purpose'`.
This step makes judgment calls across 10 interacting rules, not a search — a scoped
search-only agent type is the wrong fit here. Cap the incoming scout context to what
Step 1 already bounded; do not paste raw scout transcripts if a summary suffices.

For each of the 10 rules, assess impact on the task:

```markdown
### P10 Analysis

**Rule 1 — Control flow:** [SAFE | RISK | BLOCKED] — [why]
**Rule 2 — Loop bounds:** [SAFE | RISK | BLOCKED] — [why + bound annotation if needed]
**Rule 3 — Memory:** [SAFE | RISK | N/A] — [why]
**Rule 4 — Function size:** [SAFE | RISK] — [functions at risk of exceeding 60 lines]
**Rule 5 — Assertions:** [SAFE | MISSING] — [where assertions must be added]
**Rule 6 — Scope:** [SAFE | RISK] — [variable scope concerns]
**Rule 7 — Return values:** [SAFE | RISK] — [call sites that must handle errors]
**Rule 8 — Macros:** [SAFE | N/A] — [macro usage in scope]
**Rule 9 — Pointers:** [SAFE | RISK | N/A] — [pointer/reference concerns]
**Rule 10 — Warnings:** [CLEAN | FLAGS] — [known lint/type issues in scope]

**Blocking risks:** [rules with BLOCKED status must be resolved before execution]
**Pre-conditions:** [what must be true before execution begins]
```

### Step 3 — Draft Plan (Sonnet)

Agent tool call: `model: 'claude-sonnet-4-6'`, `subagent_type: 'general-purpose'`.
Drafting a staged plan is synthesis, not search — general-purpose is the right fit.

Write a staged, P10-compliant implementation plan:

```markdown
## P10 Implementation Draft — [TASK TITLE]

**Task:** [one sentence]
**Stage:** [if partial — which stage of the overall plan]
**gstack phase:** [plan / review / ship]
**Council ruling ref:** [link or slug if triggered by /council]
**Date:** [ISO]

### Pre-conditions
[What must be true before execution. Verified by scout.]

### Implementation Stages

#### Stage N: [name]
- **Scope:** [files and functions touched]
- **P10 constraints active:** [rules 1–10 relevant to this stage]
- **Assertions required:** [explicit invariants to add]
- **Return value handling:** [every call site that needs a handler]
- **Loop bound annotations:** [each loop with its provable upper bound]
- **Function split plan:** [if any function risks exceeding 60 lines]
- **Freeze check:** [any locked modules — do not touch without /council]

### Decision Overview

**Why this approach:** [reasoning grounded in P10 + codebase findings]
**Alternatives rejected:** [what was considered and why discarded]
**Risk surface:** [what could still go wrong and why it's acceptable]
**Execution agent instructions:** [what the agent must read/check before starting]
```

One draft per task or per named stage. Multi-stage tasks: one draft per stage, linked
in the Obsidian index.

### Step 4 — P10 Arbiter (Opus)

Agent tool call: `model: 'claude-opus-4-8'`, `subagent_type: 'general-purpose'`.
Already correctly scoped to receive only the compressed analysis/draft, not raw
scout output — keep it that way, this is the cheapest tier to get wrong.

Opus receives **only the P10 analysis and draft plan** — not raw scout output.
Three valid responses:

**A) Approve:**
```markdown
## P10 Arbiter — Approved
**Status:** approved
**Ruling:** [confirmation that plan satisfies all 10 rules]
**Conditions:** [any execution-time conditions the agent must uphold]
**Cross-rule notes:** [interactions between rules Sonnet may have missed]
```

**B) Revision Required** (once per draft):
```markdown
## P10 Arbiter — Revision Required
**Status:** revision-required
**Rule(s):** [specific rules insufficiently addressed]
**Required change:** [exactly what Sonnet must fix in the draft]
```
After revision: Sonnet updates draft (~400 tok), Opus re-reviews. Maximum one cycle.

**C) Blocked:**
```markdown
## P10 Arbiter — Blocked
**Status:** blocked
**Blocking rule:** [rule N — exact violation]
**Resolution required:** [what architectural decision must be made first]
**Escalation:** [/council recommended | task must be redesigned]
```
Blocked drafts cannot proceed. Resolution typically requires a `/council` session —
the block reason becomes the council input.

### Step 5 — Obsidian Commit (Haiku)

Uses `vaultPath` and `p10.planDir` (default `P10-Plans`) resolved in Step 0.

**File:** `{vaultPath}/{p10.planDir}/YYYY-MM-DD-{task-slug}.md`

**Frontmatter:**
```yaml
---
date: YYYY-MM-DD
task: [slug]
stage: [N or "full"]
gstack_phase: [phase]
council_ref: [slug or null]
status: draft | revision-required | approved | blocked | executed | revised
arbiter_action: approved | revision-required | blocked
p10_blocking_rules: [list of BLOCKED rules, or none]
tags: [p10, planning, gstack, {domain}]
---
```

Update `P10-Plans/INDEX.md` with each new draft (date, task, stage, status).

---

## gstack Integration

| gstack Phase | P10 Bridge role |
|---|---|
| `/plan` | Primary trigger — draft P10 plan before any architecture is locked |
| `/review` | Re-run P10 analysis on PR diff; flag new violations |
| `/ship` | Verify `status: approved` before execution proceeds |
| `/retro` | Surface P10 violations introduced during execution; update draft status |
| `/council` ruling | Ruling becomes `council_ref` in the draft frontmatter |

**Freeze respect:** If scout finds a frozen module in task scope, the draft must include:
`⚠️ FROZEN: [module] — /council required before touching.`

---

## Execution Agent Handoff

```
Before writing any code, read:
{vaultPath}/{p10.planDir}/{draft-filename}.md

Verify status is `approved` and arbiter_action is `approved`.
If status is anything other than `approved` — STOP. Do not execute.
If blocked, escalate to /council. If revision-required, return to p10-bridge.

Follow the staged plan exactly. Do not exceed function size limits.
Add all annotated assertions. Handle every return value listed in the draft.
Respect all freeze flags.
```

---

## Token Budget

| Step | Model | Budget |
|---|---|---|
| Scout ×2–4 | Haiku | ~250 tok each |
| P10 Analyzer | Sonnet | ~800 tok |
| Draft Writer | Sonnet | ~1000 tok |
| P10 Arbiter | Opus | ~800 tok |
| Revision (if needed) | Sonnet + Opus | ~400 + ~500 tok |
| Obsidian Writer | Haiku | ~300 tok |

**Target: ~3800–4300 tok per draft. With revision: ~4700–5200 tok.**

---

## Language Adapters

Rules 3, 8, and 9 do not map directly to dynamic or modern compiled languages.
Scouts load the relevant section below at codebase scan time.

### TypeScript / JavaScript

| Rule | Adaptation |
|---|---|
| 1 — Control flow | No recursion. No `eval`. Flatten promise chains with `async/await`. |
| 2 — Loop bounds | Every `for`/`while` must have a provable bound. Comment the max count. No unbounded `while(true)`. |
| 3 — Memory | No unbounded data structure growth at runtime. Arrays and maps must have max-size guards. |
| 4 — Function size | ≤ 60 lines. ESLint `max-lines-per-function` enforced. |
| 5 — Assertions | `assert` from `node:assert` or typed invariant helper. Min 2 per function. Type guards that throw count. |
| 6 — Scope | `const` over `let`. `let` over `var`. No `var`. Module-level state must be justified. |
| 7 — Return values | No ignored Promise rejections. Every `await` in try/catch or `.catch()`. ESLint `@typescript-eslint/no-floating-promises`. |
| 8 — Macros | No `eval`, no `Function()` constructor, no dynamic `require`. |
| 9 — Pointers | No `any` type. No unchecked type assertions (`as Type` without guard). |
| 10 — Warnings | `tsc --strict --noEmit` clean. ESLint zero warnings. `"strict": true` in tsconfig. |

### Python

| Rule | Adaptation |
|---|---|
| 1 — Control flow | No recursion (or explicit `sys.setrecursionlimit` with documented bound). No `exec`. No dynamic `import` at runtime. |
| 2 — Loop bounds | All `while` loops must document max iteration count. `for` over iterables preferred — document expected max length. |
| 3 — Memory | No unbounded list/dict growth. Use `collections.deque(maxlen=N)` for bounded queues. Document max size for all growing structures. |
| 4 — Function size | ≤ 60 lines. `flake8 --max-function-length` enforced. |
| 5 — Assertions | `assert` with descriptive messages. Min 2 per function. `isinstance` checks count. |
| 6 — Scope | No module-level mutable state unless justified. No `global` without documentation. |
| 7 — Return values | No ignored returns for functions that can fail. Never bare `except:`. All exceptions caught at appropriate boundary. |
| 8 — Macros | No `exec`, no `eval`, no `__import__`. |
| 9 — Pointers | All parameters and returns must have type annotations. `mypy --strict` must pass. |
| 10 — Warnings | `mypy --strict` clean. `flake8` zero warnings. `pylint` score ≥ 9.0. |

### Go

| Rule | Adaptation |
|---|---|
| 1 — Control flow | No recursion unless provably bounded and documented. No `goto`. |
| 2 — Loop bounds | All `for` loops with a condition (not range) must document max iterations. |
| 3 — Memory | No unbounded goroutine spawning. Channel buffers must be sized. Use `sync.Pool` for reuse. |
| 4 — Function size | ≤ 60 lines. `gocyclo` complexity ≤ 10. |
| 5 — Assertions | Explicit error checks as assertions. `panic` with message for true invariant violations. |
| 6 — Scope | `:=` at narrowest scope. Package-level vars must be justified. |
| 7 — Return values | Every `error` return checked. `errcheck` linter enforced. No `_` for error values. |
| 8 — Macros | No `unsafe` package without documented justification. |
| 9 — Pointers | Prefer value receivers. Document every pointer receiver choice. |
| 10 — Warnings | `go vet` clean. `staticcheck` clean. `golangci-lint` zero warnings. |

### Rust

| Rule | Adaptation |
|---|---|
| 1 — Control flow | No recursion unless bounded. No `unsafe` control flow. |
| 2 — Loop bounds | All `loop` blocks must document exit condition and maximum iteration bound. |
| 3 — Memory | Ownership system enforces structurally. No `unsafe` allocator use. `Box::new` only in init paths. |
| 4 — Function size | ≤ 60 lines. `clippy::too_many_lines` enforced. |
| 5 — Assertions | `assert!` and `debug_assert!` min 2 per function. No `unwrap()` — use `expect("invariant reason")`. |
| 6 — Scope | Narrowest scope always. No unnecessary `mut`. |
| 7 — Return values | All `Result` and `Option` handled. No `unwrap()` in production paths. `#[must_use]` on all Result-returning functions. |
| 8 — Macros | `macro_rules!` only for well-understood patterns. No proc macros without team review. |
| 9 — Pointers | No raw pointers (`*const`, `*mut`) outside `unsafe`. No `unsafe` without /council-reviewed justification. |
| 10 — Warnings | `cargo clippy -- -D warnings` clean. `cargo check` clean. |

---

## Output to User

1. **Draft path** — confirm file written to vault
2. **Arbiter ruling** — Approved / Revision Required / Blocked (prominent)
3. **P10 analysis summary** — any RISK or BLOCKED rules called out
4. **Stage overview** — what the execution agent will do, in order
5. **Execution readiness** — `READY` | `BLOCKED: [rule N — reason]`

---

## When NOT to use this skill

- Trivial single-line fixes with no architectural surface
- Pure documentation or config changes
- Tasks already covered by an approved, unexecuted P10 draft
- Hotfixes where speed is critical — flag for post-hoc P10 review instead
