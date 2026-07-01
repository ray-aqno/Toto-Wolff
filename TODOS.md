# TODOS

Deferred work from the v0.0.2.0 CEO review (2026-06-04). Items are P1/P2/P3 — P1 blocks ship, P2 same branch or next sprint, P3 follow-up.

---

## Completed (v1.0.2)

- **T2: Local governance pre-commit hook** — original GitHub Actions design BLOCKED by council (2026-06-29-t2-github-actions-seam-test: fails silently for 90%+ of fork PRs, adds a write-credentialed dependency). Redesigned as a host-agnostic local hook: `scripts/hooks/pre-commit` + `scripts/install-hooks.sh`, single-source pattern list in `.toto/sensitive-patterns.json`, `scripts/check-patterns.ts` lint gate keeping CLAUDE.md in sync, read-only advisory CI job. `toto doctor` surfaces install state. 8/8 bats tests passing. Shipped 2026-07-01.
- **T5: Decision reversal auto-detection** — `detectReversal()` in `packages/core/src/utils/reversalDetector.ts`, wired into `CouncilService.run()` via optional `currentTags`/`priors` params. Shared `jaccardSimilarity` extracted to core. Shipped 2026-07-01.

## Completed (v0.0.4.0)

- **Phase 1 demo path** — `scripts/demo.sh` drives the full council→p10 cycle end-to-end. MCP server returns HTTP 200 `{status:'blocked'}` for arbiter-blocked p10 plans (governance working, not an error). Shipped 2026-06-11.
- **Universal auth** — `createAnthropicClient()` in `packages/core/src/utils/anthropic.ts` accepts `ANTHROPIC_API_KEY` alone (personal key) or `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` (enterprise/Manifest path). P10Service and CouncilService both migrated. Shipped 2026-06-11.
- **Git-tolerant vault** — `VaultService.commitFile` detects missing `.git` via `git rev-parse --git-dir` exit-128, skips commit observably, write is source of truth. Fresh evaluator clones no longer crash on vault write. Shipped 2026-06-11.
- **P10BlockedError seam** — `p10_plan` handler catches `P10BlockedError` before generic handler; returns HTTP 200 `{status:'blocked'}`, writes fixed string to stderr (no vault path leak). Shipped 2026-06-11.
- **Dashboard package** — `packages/dashboard` implemented — terminal governance dashboard. Shipped 2026-06-15.
- **Self-integration** — toto-wolff MCP server registered in Claude Code settings. Shipped 2026-06-15.

## Completed (v0.0.2.0)

- **T1: bats test suite for `setup`** — 42 tests, ~84% coverage. `tests/setup.bats` covers read_config, check_prereqs, check_vault, symlink_claude_md, swap_role, rotate_backups, create_vault_dirs, print_summary, main flow. Shipped 2026-06-05.
- **CSO-2026-06-05-001: path traversal via `--role`** — allowlist guard added at `setup:126`. Blocks `--role '../FILENAME'` patterns. Shipped 2026-06-05.

---

## P2 — Next Sprint

### T7: bats test suite for `toto-report`

**What:** `tests/toto-report.bats` — no analytics dir → graceful exit, malformed frontmatter → unknown fields, happy path output. Scaffold shipped 2026-07-01: test 1 (no analytics dir) is live and green; tests 2 and 3 are `skip`-gated with `TODO(E4)` pending report.ts.

**Effort:** CC ~10 min to un-skip once toto-report ships.

**Depends on:** E4 (metrics dashboard, toto-report implementation).

---

## P3 — Right Feature, Deferred

### ~~T2: Council auto-trigger (GitHub integration)~~ — REDESIGNED & SHIPPED 2026-07-01

Original GitHub Actions design BLOCKED by council. See "Completed (v1.0.2)" above.

---

### ~~T3: Toto CLI (`toto status` + `toto search`)~~ — CLOSED 2026-06-08

Superseded by `packages/cli` (Phase 2). Closed per full TODOS eval.

---

### ~~T4: Public release~~ — DONE 2026-06-25

Shipped as v1.0.0 at github.com/ray-aqno/Toto-Wolff. Branch protection live (standard-practices ruleset). 74 tests passing. SECURITY.md, CODE_OF_CONDUCT.md, CODEOWNERS, issue templates all in place. Council ruling + Cabinet record written to vault.

---

### ~~T5: Decision reversal auto-detection~~ — DONE 2026-07-01

See "Completed (v1.0.2)" above.

---

### T10: Fast-path for trivial council questions

**What:** `council_run` option that skips the 6-call chain (2 Haiku scouts + 2 Sonnet analysts + 1 Sonnet brief + 1 Opus ruling) for simple vault lookups. Fast-path: `vault_search` + single Sonnet call for questions that are factual ("which pattern did we use for X?") rather than deliberative.

**Why:** Full chain costs ~$0.10-0.30 per session. Quick vault queries don't warrant Opus-level deliberation. A fast-path reduces per-query cost to ~$0.01 and makes council more usable for routine lookups without cheapening deliberative sessions.

**Trigger heuristic (proposed):** If `question` contains no tradeoff language and vault_search returns a direct match, skip to Sonnet summary. Otherwise full chain.

**Effort:** human ~0.5 days / CC ~10 min

**Depends on:** Phase 1 (`council_run` baseline) must ship first; fast-path is a post-baseline optimization.

---

### T6: Resolve Q2 — first persona to ship with real content

**What:** Decide which of the 4 roles (Engineering, R&D, DevOps, Data) gets the most authoring investment in the E5 persona library. The other 3 can ship as stubs initially.

**Why:** E5 builds all 4 persona files but the first strangler fig migration target gets the most refined persona. This determines which team is first off the old setup.

**Action:** Answer this before the E5 p10 implementation session. Candidate answer: whichever role has the most acute pain with the current fragmented setup (per original design doc — the "highest-pain role" question was deferred from June 2).

**Depends on:** Conversation with team leads before E5 p10 starts.

---

---

## v1.0.1 (added 2026-06-26)

Skills and upgrade path — no runtime changes to MCP server, CLI core, or vault format.

### `/safety-car` skill (shipped 2026-06-26)

Single adversarial Sonnet subagent between P10 approval and execution. Verdicts: CLEAR or DEPLOYED. Vault path: `{VAULT_PATH}/Safety-Car/`. Stack position: after `/p10` approval, before karpathy execution.

---

### `/drs` PreToolUse hook (shipped 2026-06-26)

Deterministic boundary enforcer. Five rules: frozen paths, out-of-scope writes, auth surfaces, cross-tenant writes, destructive shell patterns. Hook script: `.claude/skills/drs/bin/drs-check.sh`. Override via `DRS_OVERRIDE_REASON` env var. Events logged to `{VAULT_PATH}/DRS/`.

---

### `toto upgrade` command (shipped 2026-06-26)

`scripts/upgrade.sh` + `packages/cli/src/commands/upgrade.ts`. Pulls `origin/main`, rebuilds, re-runs setup non-destructively. Vault and credentials untouched.

---

## v1.1.0 Roadmap

### ~~T-RADIO-TONE: toto radio persona grounding~~ — DONE 2026-07-01

`SYSTEM_PROMPT` in `packages/cli/src/commands/radio.ts` rewritten: model is now "an engineering practice lead," direct/data-driven/builder-to-builder tone, must name files/lines/commands/numbers. F1 terms permitted only as occasional seasoning, never a sustained character voice. Added explicit no-argue clause — accept redirection, never stonewall the user.

---

### ~~Dynamic P10 plans (Serena-assisted)~~ — DONE 2026-07-01

Used for the T2/T5/T7 P10 cycle. Serena scouts (`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`) confirmed exact function line counts and existing symbol shapes before drafting — caught the CouncilService.run() 60-line budget precisely instead of estimating from grep.

---

### ~~Safety-car follow-ups from T2/T5/T7 ship~~ — DONE 2026-07-01

6 of 7 fixed: (1) `jaccardSimilarity` now trims + NFC-normalizes tags, (2) `CouncilResult.priorId` invariant documented on the interface, (3) skipped — accepted as correct behavior, not a bug, (4) `doctor.ts checkHookInstalled` now also verifies the hook content references `.toto/sensitive-patterns.json`, not just the sentinel comment, (5) pre-commit hook has an explicit `jq`-missing guard with a friendly message, (6) new `pre-commit-hook-test` CI job runs `bats tests/pre-commit.bats`, (7) `detectReversal` now truncates to `SIGNAL_MAX_PRIORS` instead of asserting/crashing.

---

## P2 — Council-Ruled (added 2026-06-08, council session toto-wolff-upgrade-sequencing)

### U1: agentalloy + TheForge symlink

**What:** Run `scripts/install-symlink.sh /path/to/agentalloy` and `scripts/install-symlink.sh /path/to/TheForge` to wire toto-wolff governance into both repos. CLAUDE.md in each repo symlinks to `personas/engineering.md`. Commit the symlink in each target repo.

**Why:** Demonstrates the strangler fig seam working across repos. The demo story: "toto-wolff governs any repo in 30 seconds."

**Effort:** CC ~5 min. Requires local access to agentalloy + TheForge repos.

**Gate:** Symlink only. MCP integration blocked until eval-gate fires.

**Depends on:** `scripts/install-symlink.sh` (shipped 2026-06-08).

---

### U5: Serena in P10 scouting

**What:** P10Service scout prompts updated (shipped 2026-06-08) to instruct structured code analysis. When running inside Claude Code, p10 skill scouts should prefer `mcp__serena__get_symbols_overview` and `mcp__serena__find_symbol` over grep for codebase analysis. Document this in `.claude/skills/p10/P10.md` (or the equivalent skill file).

**Why:** AST-level scouting catches structural violations that grep misses. The P10 plan quality improves materially with symbol-aware analysis.

**Effort:** CC ~10 min. Prompt/doc change only — no package changes.

**Gate:** None. `.serena/project.yml` is already committed, MCP tools are live.

---

## P1 — v2 Phase 1 Gates (added 2026-06-07, /plan-eng-review)

### ~~T11: CI/CD pipeline for TypeScript monorepo~~ — DONE 2026-06-15

Implemented `.github/workflows/ci.yml` — Phase 1 eval-gate unblocked.

---

## P2 — v2 Implementation (added 2026-06-05, /plan-ceo-review SCOPE EXPANSION)

### T8: Linear integration spec (pre-Phase-3 gate)

**What:** One-page spec for `packages/linear-sync` covering: auth model (keytar-stored API key, service account vs personal token), error handling for deleted Linear issues (log + skip, don't fail the council write), rate limit strategy (exponential backoff, max 3 retries), and API key rotation procedure.

**Why:** Linear sync was accepted in the v2 CEO plan with no auth or error model specified. The spec doc prevents implementation drift and ensures Phase 3 starts with a verified design, not an open question.

**Effort:** human ~2h / CC ~10min

**Depends on:** Phase 2 (CLI + keytar) complete before Phase 3 starts.

---

### T9: Dashboard empty-state copy

**What:** Write empty-state copy for all 4 dashboard views before Phase 4 ships: decision velocity ("No sessions yet — run /council to start"), reversal rate ("0 reversals recorded"), p10 compliance ("No p10 plans yet — run /p10 to start"), role adoption ("No personas active — run toto persona add").

**Why:** For a new install, all 4 dashboard panels show blank charts. Without intentional copy, users think the dashboard is broken. Empty state is the most common state for the first 30 days of use.

**Effort:** human ~30min / CC ~5min

**Depends on:** Phase 4 (dashboard) design underway.

## v1.2.0 Roadmap

### T-AUTO: Automated vault cross-connection synthesis
**Feature:** `toto synthesize` — periodic background job that scans vault records across Council, P10-Plans, ADR, Cabinet, and Signals directories and surfaces non-obvious connections.

**What it does:**
- Detects repeated architectural patterns across projects (same tradeoff resolved differently)
- Flags council rulings that were never referenced in a subsequent P10 or commit
- Identifies ADRs orphaned from any follow-up work
- Surfaces builder instinct patterns (what consistently recurs, what is consistently avoided)
- Writes a `Synthesis/YYYY-MM-DD-connections.md` record to the vault

**Trigger options:**
- Manual: `toto synthesize`
- Scheduled: cron via `toto schedule synthesize --interval weekly`
- Post-backfill hook: run automatically after `toto backfill` when new signals are written

**Implementation sketch:**
- Haiku scouts fan out across each vault subdirectory in parallel (bounded: max 20 files each)
- Sonnet analyst receives all scout summaries, identifies cross-cutting patterns
- Output written as a typed vault record with `pattern_refs` linking source files
- No Opus call needed — this is synthesis, not a gate

**Why:** Discovered manually during 2026-06-26 session that Feynman's v1.0.0 block (signal loop inert on fresh install) was the strongest proof point for the LinkedIn launch post — but it took a full vault grep to surface it. This should be automatic.
