# TODOS

Deferred work from the v0.0.2.0 CEO review (2026-06-04). Items are P1/P2/P3 — P1 blocks ship, P2 same branch or next sprint, P3 follow-up.

---

## P3 — Deferred (added 2026-07-06, post-testing feedback)

### T-LINEAR-CACHE: Session-scoped team/project resolution cache for `linear-sync`

**What:** `.claude/skills/linear-sync/SKILL.md` Step 2's team/project resolution (`list_teams`/`list_projects` exact-match check) currently re-runs its full walkthrough on every invocation, even when the same team/project was already confirmed earlier in the same session. Add a session-scoped (not persisted-to-disk) cache: once a team/project pair resolves successfully, skip re-narrating the walkthrough for the rest of that session — but still perform the actual `list_teams`/`list_projects` call, don't remove the underlying safety check, only the repeated narration.

**Why:** Real-world testing (2026-07-06) found Step 2 works well as a training/onboarding aid for someone unfamiliar with a Linear workspace, but creates repeat friction for a user who already knows their team/project and runs the skill multiple times in one session. Explicitly NOT urgent — usability is fine as-is today.

**Depends on:** Nothing structural. Deferred until downstream usage shows this friction is actually costing time, not implemented preemptively.

**Note:** Does not touch any of the 5 binding Arbiter conditions from `P10-Plans/2026-07-06-toto-wolff-linear-sync-skill.md` (Step 0 connector pre-flight, Step 5 confirm-before-write, description template, dynamic status resolution, closed `save_issue` param set) — Step 2's walkthrough narration was not one of them, so this can be scoped as a small revision without full re-arbitration when picked up.

---

## Completed (v1.3.0, 2026-07-06)

- **Runtime token-budget enforcement** — `packages/core/src/utils/TokenBudget.ts` tracks per-session token usage for Council and P10 dispatch. Merged via PR #23 (`feat/token-budget-enforcement`); this note closes the P2 item added 2026-07-02 that PR's merge left undocumented here. Full detail in CHANGELOG.md `[1.3.0]` and `P10-Plans/2026-07-02-toto-wolff-token-budget-enforcement.md`.
- **`linear-sync` skill** — see ADR-0009 and `P10-Plans/2026-07-06-toto-wolff-linear-sync-skill.md`.

---

## Completed (v1.1.1, 2026-07-01)

Cabinet ruled `2026-07-01-v1.1.0-tag-justification` APPROVED WITH CONDITIONS. The v1.1.0 tag was cut and distributed to the internal team before 2 of the 3 conditions were actually verified in code — a session limit hit mid-fix. Caught post-distribution.

- **T10 fast-path routing fixed (Karpathy's condition)** — `_isFactualQuestion` now uses word-boundary regex + a deliberative-marker guard + a word-count cap, replacing the old substring heuristic. Test proves "which approach should the team take for the migration" no longer silently auto-approves.
- **T5 reversal detection wired end-to-end (Feynman's condition)** — `handleCouncilRun` now loads real `SignalIndex` priors from the vault and forwards them into `CouncilService.run()`; the `council_run` MCP tool schema now exposes `currentTags`/`priors`. End-to-end test proves `reversalDetected === true` fires against a real on-disk vault fixture, not a hand-built test double.

---

## Completed (post-v1.0.2 strangler-fig fixes, 2026-07-01)

Council ruling `2026-07-01-strangler-fig-seam-bugs` (lean mode, ~86K tokens vs. standard full chain). Both bugs found by a preemptive `/investigate` pass on the strangler-fig seam.

- **CRITICAL — `install-symlink.sh` clobbered target CLAUDE.md** — replaced bare `ln -sf` with a marker-delimited splice (`<!-- TOTO:ROLE:START/END -->`). Preserves all pre-existing content, idempotent on repeat install, handles upgrade from a prior buggy symlink install. 5 new tests in `tests/install-symlink.bats`.
- **HIGH — pre-commit hook false-positived on persona-swap prose** — `.toto/sensitive-patterns.json`'s bare `role` pattern matched any English sentence containing the word "role" (e.g. `--role engineering`), blocking every persona swap. Replaced with 6 compound-identifier patterns (`hasRole`, `role_based`, etc.) that only match code-shaped RBAC usage. 2 new regression tests in `tests/pre-commit.bats` using the real repo pattern list (existing 8 tests used an isolated fixture and wouldn't have caught this).

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

## Completed (v1.3.x follow-up, 2026-07-07)

- **T7: `toto report` CLI command shipped** — `packages/cli/src/commands/report.ts`, all 3 `tests/toto-report.bats` tests green (PR #25). Verified against 42 real Congressional Records, not just the bats fixtures — caught and fixed a real frontmatter-field mismatch (`chairman_action` vs. fixture-assumed `status`) plus two real-data gaps (`INDEX.md` isn't a record; a legitimate record has a blank line inside its frontmatter block). Full plan: `P10-Plans/2026-07-07-toto-wolff-t7-t9-unblock.md`.
- **T9: Role Adoption dashboard card shipped** — `buildRoleAdoptionCard()` in `dashboard_html.ts` (PR #26). Permanent hardcoded empty state with a marker comment, since no `toto persona` command exists yet to back it with real data. Empty-state copy for the other 3 cards (velocity/p10/reversal) explicitly deferred as a separate follow-up, not done here.

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

### ~~T10: Fast-path for trivial council questions~~ — DONE 2026-07-01

**What:** `council_run` option that skips the 6-call chain (2 Haiku scouts + 2 Sonnet analysts + 1 Sonnet brief + 1 Opus ruling) for simple vault lookups. Fast-path: `vault_search` + single Sonnet call for questions that are factual ("which pattern did we use for X?") rather than deliberative.

**Why:** Full chain costs ~$0.10-0.30 per session. Quick vault queries don't warrant Opus-level deliberation. A fast-path reduces per-query cost to ~$0.01 and makes council more usable for routine lookups without cheapening deliberative sessions.

**Trigger heuristic (proposed):** If `question` contains no tradeoff language and vault_search returns a direct match, skip to Sonnet summary. Otherwise full chain.

**Effort:** human ~0.5 days / CC ~10 min

**Depends on:** Phase 1 (`council_run` baseline) must ship first; fast-path is a post-baseline optimization.

**Shipped:** `CouncilService.run()` in `packages/core/src/CouncilService.ts` now checks `_isFactualQuestion()` (keyword check against `vs`, `should we`, `tradeoff`, `trade-off`, `risk`) before the scout chain. If factual and `vault.search()` returns hits, `_tryFastPath()` runs a single Sonnet call (`claude-sonnet-4-6`) over the top 5 matches and returns an early `CouncilResult` with `status: 'approved'`, writing a `*-council-fastpath.md` vault record. Falls through to the unchanged full chain otherwise. `pnpm -C packages/core build`, `pnpm typecheck`, and `pnpm -C packages/mcp-server build` all pass; no existing CouncilService test file to regress.

---

### ~~T6: Resolve Q2 — first persona to ship with real content~~ — DECIDED 2026-07-02

**Decision: Engineering.** Chosen after a repo demo — engineering showed the most enthusiasm of the 4 candidate roles. This resolves the "highest-pain role" question deferred since June 2.

**What:** Engineering gets the most authoring investment in the E5 persona library. R&D, DevOps, and Data ship as stubs initially.

**Why:** E5 builds all 4 persona files but the first strangler fig migration target gets the most refined persona. Engineering is now that target.

**Next:** Kick off the E5 p10 implementation session for the Engineering persona content.

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

Used ad hoc for the T2/T5/T7 P10 cycle first (confirmed the approach works — caught CouncilService.run()'s exact 60-line budget instead of estimating from grep), then made the default behavior: `~/.claude/skills/p10/SKILL.md` Step 1 — Codebase Scout now instructs scouts to prefer Serena tools (`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`) over grep, falling back only when Serena MCP is unregistered. See U5 below for the integration commit.

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

### ~~U5: Serena in P10 scouting~~ — DONE 2026-07-01

**What:** P10Service scout prompts updated (shipped 2026-06-08) to instruct structured code analysis. When running inside Claude Code, p10 skill scouts should prefer `mcp__serena__get_symbols_overview` and `mcp__serena__find_symbol` over grep for codebase analysis. Documented in `~/.claude/skills/p10/SKILL.md`, Step 1 — Codebase Scout section: scouts now default to Serena's `get_symbols_overview`, `find_symbol`, and `find_referencing_symbols`, falling back to grep only if Serena MCP isn't registered.

**Why:** AST-level scouting catches structural violations that grep misses. The P10 plan quality improves materially with symbol-aware analysis.

**Effort:** CC ~10 min. Prompt/doc change only — no package changes.

**Gate:** None. `.serena/project.yml` is already committed, MCP tools are live.

---

## P1 — v2 Phase 1 Gates (added 2026-06-07, /plan-eng-review)

### ~~T11: CI/CD pipeline for TypeScript monorepo~~ — DONE 2026-06-15

Implemented `.github/workflows/ci.yml` — Phase 1 eval-gate unblocked.

---

## P2 — v2 Implementation (added 2026-06-05, /plan-ceo-review SCOPE EXPANSION)

### ~~T8: Linear integration spec (pre-Phase-3 gate)~~ — SUPERSEDED 2026-07-06

**Original scope (superseded):** One-page spec for `packages/linear-sync` covering: auth model (keytar-stored API key, service account vs personal token), error handling for deleted Linear issues (log + skip, don't fail the council write), rate limit strategy (exponential backoff, max 3 retries), and API key rotation procedure.

**Why superseded:** ADR-0009 (vault: `ADR/adr-0009-use-linear-mcp-server-instead-of-custom-integration.md`) — Linear runs an official hosted MCP server (`mcp.linear.app`, built with Anthropic + Cloudflare) that already owns auth, rate limiting, and the GraphQL surface. No custom `packages/linear-sync`, no keytar auth code, no rotation cron needed. Discovered while investigating T8's auth model against the keytar deferral plan (`P10-Plans/2026-07-06-toto-wolff-keytar-swap-deferred.md`).

**Replacement task:** Register the `plugin:engineering:linear` MCP connector (present in the environment, currently unauthenticated — needs `claude mcp` or claude.ai connector settings) and decide which toto-wolff skill/handler calls its tools and when.

**Open follow-up (not resolved by ADR-0009):** non-interactive/headless Linear sync (e.g. a CI job posting without a human session) needs the Bearer-token API-key auth mode, not interactive OAuth 2.1 — ownership and storage of that key is undecided.

---

### ~~T9: Dashboard empty-state copy~~ — PARTIALLY SHIPPED 2026-07-07

**Original ask:** empty-state copy for all 4 dashboard views: decision velocity, reversal rate, p10 compliance, role adoption.

**Shipped:** role adoption card built from scratch (didn't exist before — see "Completed (v1.3.x follow-up)" above, PR #26). The other 3 views (velocity/p10/reversal) already had *some* empty-state text buried in their detail-panel builders, but it's not surfaced on the card face itself for the mixed-empty case (e.g. council sessions exist but p10 plans don't — `card-p10` just shows a bare `0`).

**Remaining:** surface empty-state copy on the card face for velocity/p10/reversal in the mixed-empty case. Explicitly deferred as a separate task (different blast radius than building a new card) — not scoped or estimated yet.

## v1.2.0 Roadmap

### ~~T-AUTO: Automated vault cross-connection synthesis~~ — SHIPPED 2026-07-02

**P10 plan:** `P10-Plans/2026-07-02-toto-wolff-t-auto-vault-synthesis.md` — status: approved (1 revision cycle). Arbiter caught and required a fix for an unsatisfiable assertion (Rule 5 required non-empty `pattern_refs` while Rule 7's design called for a degraded empty-refs path) and a `Promise.all` → `Promise.allSettled` fix (a single failed scout would otherwise abort all 5, defeating the designed degradation behavior). Both fixed in the approved plan and in the shipped code.

**Shipped:** `packages/cli/src/commands/synthesize.ts` — `toto synthesize` CLI command (manual trigger only this stage) that scans vault records across Council, P10-Plans, ADR, Cabinet, and Signals directories and surfaces non-obvious connections. Wired into `packages/cli/src/index.ts` dispatch and `ui.ts` command listing. Required adding `withLLMTimeout` to `packages/core/src/index.ts`'s barrel export (it existed in core but wasn't reachable cross-package — not called out explicitly in the P10 plan, added as a necessary Stage 1 prerequisite). 10 new tests in `packages/cli/src/__tests__/synthesize.test.ts` covering the ENOENT scan path, REF-parsing including the degraded empty-refs path, and the write-with-empty-refs path. 99/99 total tests pass, `tsc --strict` clean, `pnpm check-patterns` in sync (26 patterns). Manually verified the credential-missing exit path (clean exit 1, no stack trace) since a live LLM call wasn't run as part of this pass.

**What it does:**

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

**Implementation sketch (superseded by the P10 plan above — see it for the authoritative staged plan):**
- Haiku scouts fan out across each vault subdirectory in parallel (bounded: max 20 files each), fan-out uses `Promise.allSettled` not `Promise.all`
- Sonnet analyst receives all scout summaries, identifies cross-cutting patterns; empty `pattern_refs` from a parse failure is a legal degraded outcome, not an error
- Output written as a typed vault record with `pattern_refs` linking source files, plus a `synthesis_status: complete | degraded` field
- No Opus call needed — this is synthesis, not a gate
- CLI-side only (`packages/cli/src/commands/synthesize.ts`), following the `radio.ts` precedent for calling `createAnthropicClient` directly from a CLI command — no new MCP-server handler

**Why:** Discovered manually during 2026-06-26 session that Feynman's v1.0.0 block (signal loop inert on fresh install) was the strongest proof point for the LinkedIn launch post — but it took a full vault grep to surface it. This should be automatic.
