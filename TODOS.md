# TODOS

Deferred work from the v0.0.2.0 CEO review (2026-06-04). Items are P1/P2/P3 — P1 blocks ship, P2 same branch or next sprint, P3 follow-up.

---

## Completed (v0.0.4.0)

- **Phase 1 demo path** — `scripts/demo.sh` drives the full council→p10 cycle end-to-end. MCP server returns HTTP 200 `{status:'blocked'}` for arbiter-blocked p10 plans (governance working, not an error). Shipped 2026-06-11.
- **Universal auth** — `createAnthropicClient()` in `packages/core/src/utils/anthropic.ts` accepts `ANTHROPIC_API_KEY` alone (personal key) or `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` (enterprise/Manifest path). P10Service and CouncilService both migrated. Shipped 2026-06-11.
- **Git-tolerant vault** — `VaultService.commitFile` detects missing `.git` via `git rev-parse --git-dir` exit-128, skips commit observably, write is source of truth. Fresh evaluator clones no longer crash on vault write. Shipped 2026-06-11.
- **P10BlockedError seam** — `p10_plan` handler catches `P10BlockedError` before generic handler; returns HTTP 200 `{status:'blocked'}`, writes fixed string to stderr (no vault path leak). Shipped 2026-06-11.

## Completed (v0.0.2.0)

- **T1: bats test suite for `setup`** — 42 tests, ~84% coverage. `tests/setup.bats` covers read_config, check_prereqs, check_vault, symlink_claude_md, swap_role, rotate_backups, create_vault_dirs, print_summary, main flow. Shipped 2026-06-05.
- **CSO-2026-06-05-001: path traversal via `--role`** — allowlist guard added at `setup:126`. Blocks `--role '../FILENAME'` patterns. Shipped 2026-06-05.

---

## P2 — Next Sprint

### T7: bats test suite for `toto-report`

**What:** `tests/toto-report.bats` — no analytics dir → graceful exit, malformed frontmatter → unknown fields, happy path output. Deferred from T1 (toto-report not yet implemented).

**Effort:** CC ~30 min once toto-report is built.

**Depends on:** E4 (metrics dashboard, toto-report implementation).

---

## P3 — Right Feature, Deferred

### T2: Council auto-trigger (GitHub integration)

**What:** GitHub Actions workflow or webhook that detects PRs touching sensitive patterns (auth, service boundaries, data migrations) and posts a comment: "This PR touches authentication — run /council before merging?" Engineer clicks a link that opens a pre-filled /council prompt.

**Why:** Without this, council adoption depends on individual discipline. With it, council becomes a structural quality gate. The PR comment with the ruling is also the artifact that makes Toto visible to reviewers and leadership who aren't running Claude Code themselves.

**Effort:** human ~2 weeks / CC ~2 hours

**Seam filter note:** This adds a GitHub webhook dependency (new seam). Revisit only after shared vault (E1) is live and GitHub org permissions are confirmed (see docs/linear-setup.md).

**Depends on:** E1 (shared vault live), GitHub org permissions resolved.

---

### ~~T3: Toto CLI (`toto status` + `toto search`)~~ — CLOSED 2026-06-08

Superseded by `packages/cli` (Phase 2). Closed per full TODOS eval.

---

### T4: Public release

**What:** Make the repo public at ray-aqno/Toto-Wolff (or a renamed generic version). Pre-release gate: confirm all Navistone-specific content lives in `.toto/config.yml` (gitignored) rather than tracked files. Scrub docs/linear-setup.md of internal workspace IDs. Consider renaming from "Toto Wolff" to a generic name for external adoption.

**Why:** Community moat. Other engineering teams are solving the same AI governance fragmentation problem. Being first to define the council+p10+karpathy protocol as an open standard creates traction that's hard to replicate.

**Natural trigger:** After E2 ships and the gitignore audit confirms no Navistone-specific content in tracked files.

**Effort:** human ~1 week (scrubbing + renaming decisions) / CC ~30 min

**Depends on:** E2 shipped and gitignore audit passed.

---

### T5: Decision reversal auto-detection

**What:** Instead of requiring engineers to manually add `reversal: true` frontmatter, detect reversals by matching council rulings against subsequent council sessions on the same topic (semantic similarity or topic tag match). Surface as a metric in `./toto-report`.

**Why:** Manual tagging works but degrades with team size. Auto-detection turns reversal rate into a reliable metric without requiring discipline.

**Effort:** human ~1 week / CC ~2 hours (requires embedding/similarity or topic tagging)

**Depends on:** E1 (shared vault with sufficient volume), E4 (metrics dashboard baseline established).

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

### T11: CI/CD pipeline for TypeScript monorepo

**What:** `.github/workflows/ci.yml` — install pnpm, run `tsc --noEmit` across all packages, run `vitest`. CI job must also `apt-get install ripgrep` (required for `vault_read` tests). Run on every PR and push to main.

**Why:** Without CI, TypeScript compilation failures are only caught locally. The 2-week Phase 1 parallel run requires a reliable green/red gate. This is a Phase 1 blocker — no Phase 1 ship without it.

**Effort:** human ~2h / CC ~5min

**Depends on:** TypeScript monorepo scaffold (Phase 1 first commit).

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
