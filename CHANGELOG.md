# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.1] - 2025-08-05

### Added
- **Strangler Fig Migration Complete (6 stages)** — Unified governance stack from legacy skills to core services + MCP tools:
  - **Stage 1: Core Services** — `CabinetService`, `SafetyCarService`, `KarpathyService`, `DRSService`, `SubagentService` in `@toto-wolff/core`
  - **Stage 2: MCP Tools + Dashboard** — 5 new tools (`cabinet_run`, `safety_car_run`, `karpathy_check`, `drs_check`, `subagent_list`) + 7 dashboard sections (Council, P10, Cabinet, SafetyCar, Karpathy, DRS, Subagent)
  - **Stage 3: Thin Skills** — cabinet, safety-car, karpathy, drs, subagent skills routing to MCP tools (< 200 lines each, no core imports)
  - **Stage 4: DRS PreToolUse Hook** — Installed at `.pi/hooks.json`, fires on every mutating tool call, 5 deterministic rules with override support
  - **Stage 5: Config/Docs Unification** — Single source `.toto/config.yml` generates `AGENTS.md`, `CLAUDE.md`, `.toto/drs-config.json`, `.toto/freeze.json` via `pnpm generate:all`
  - **Stage 6: Hardening** — All builds pass (`tsc --strict`), 105 tests pass, lint clean on new code
- **Cabinet Release Gate** — Three equal Opus seats (Garry Tan, Feynman, Karpathy), any-seat veto, unanimous-to-ship
- **Safety Car Adversarial Review** — Post-P10, pre-execution stress test across 5 risk categories
- **Karpathy Execution Verification** — 4 rules (simplicity, surgical, goal-driven, think-before-coding) at every P10 stage
- **DRS Boundary Enforcement** — Ambient PreToolUse hook, 5 rules (frozen, scope, auth, tenant, destructive)
- **Subagent Orchestration** — Parallel scouts, adversarial review, verification chains
- **Config Generators** — `scripts/generate-agents-md.ts`, `scripts/generate-claude-md.ts`, `scripts/generate-drs-config.ts`

### Changed
- **Vault fully session-memory backed** — Replaced Obsidian filesystem vault with pi's durable session memory (`~/.pi/sessions/governance/`)
- **Single-source configuration** — All governance config now in `.toto/config.yml`; AGENTS.md/CLAUDE.md are generated artifacts
- **MCP as primary interface** — All 11 governance operations exposed as MCP tools; CLI/skills delegate to MCP

### Fixed
- **DRS hook false positives** — Resolved Rule 2 (out-of-scope) by adding allowed_paths for packages/, scripts/, .agents/, tests/, docs/
- **TypeScript strict compliance** — All new code passes `tsc --strict --noEmit`
- **Dashboard empty states** — Added per-card empty-state copy for all 7 governance types (T9 completion)

## [1.4.0] - 2026-07-10

### Added
- **Install toto-wolff as a Claude Code plugin** — `claude plugin marketplace add ray-aqno/Toto-Wolff` then `claude plugin install toto-wolff@toto-wolff` replaces manual `~/.claude.json` wiring as the primary install path. The plugin bundles the MCP server plus all 8 skills (`drs`, `karpathy`, `linear-sync`, `safety-car`, `strangler-pattern-guide`, `p10`, `llm-council`, `the-cabinet`) and launches with zero prebuild step (`.claude-plugin/marketplace.json`, `plugin.json`). Manual `~/.claude.json` wiring is kept as a documented fallback, not removed. Full plans: `P10-Plans/2026-07-09-toto-wolff-mcp-plugin-marketplace-registration.md`, `P10-Plans/2026-07-09-toto-wolff-skill-config-packaging.md` (both arbiter-approved, executed).
- **`p10`, `llm-council`, and `the-cabinet` skills vendored into the repo** — previously only lived globally in `~/.claude/skills/`; now shipped as part of the plugin under `.claude/skills/`. Each gets a shared, byte-identical config-resolution scheme (`config.schema.json`): `TOTO_VAULT_PATH` env var → plugin-scoped `settings.local.json` → global `~/.claude/CLAUDE.md` prose (still honored) → hardcoded default, with a first-run interactive prompt and a fail-loud headless fallback — no dependency on an unconfirmed platform install-time-config feature (verified absent by testing 4 real plugin manifests before committing to this design).

### Changed
- **MCP server credentials no longer require a separate shell export** — `createAnthropicClient()` (`packages/core/src/utils/anthropic.ts`) now falls back to `~/.claude.json`'s `mcpServers.toto-wolff.env` when `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` aren't in shell env, promoting a pattern that previously only powered the `toto doctor` CLI check. Still throws the same clear assertion error if no credential is found anywhere.

### Fixed
- **Plugin launch works with no build step** — a fresh marketplace install has no `dist/` (gitignored, no `bin` field), so the MCP server launches from TypeScript source directly (`npx tsx@4.22.4`, pinned) with a scoped `tsconfig.plugin.json` path override for the `@toto-wolff/core` workspace dependency. Verified with a real `claude plugin install` against the copied plugin cache.

## [1.3.0] - 2026-07-06

### Added
- **Runtime token-budget enforcement** — `packages/core/src/utils/TokenBudget.ts` tracks per-session token usage for Council and P10 dispatch, instrumented at the single private `_callModel()`/`callModel()` wrapper in each service. Distinguishes legitimate deep deliberation (`seat_overrun` — warn only, session completes) from structural fan-out bugs (`fanout_overrun` — hard-flagged, `budgetFlag` set on the result) using a call-count/aggregate-usage ceiling derived from each service's verified call graph (`COUNCIL_STATIC_CEILING = 9×1024`, `P10_STATIC_CEILING = 9×2048`), not the descriptive SKILL.md budget tables — a 27-session audit showed those are already well-calibrated; the real failure mode was scouts spawning secondary subagents (2 incidents at 30–70x budget). Detection is post-hoc by design (v1 scope): flags a session after tokens are spent, does not abort mid-fan-out. Full plan: `P10-Plans/2026-07-02-toto-wolff-token-budget-enforcement.md` (revision 2, arbiter-approved).
- **`linear-sync` skill** — `.claude/skills/linear-sync/SKILL.md`, a human-invoked Claude Code skill that syncs an approved P10 plan into a Linear issue via Linear's official hosted MCP connector. No custom Linear client, no new package dependency (per ADR-0009). Explicit team/project targeting (no fuzzy matching), `STORY:`/`SPIKE:` title convention verified against real workspace issues, fixed description template (400-word cap, no-fabrication constraint), dynamic backlog-status resolution by `type` field, and a mandatory confirm-before-write step — this is the first real write capability in the Linear integration. Full plan: `P10-Plans/2026-07-06-toto-wolff-linear-sync-skill.md` (revision 2, arbiter-approved; revision 1 was blocked for stating connector auth as a permanent fact instead of a per-invocation check).

### Changed
- **ADR-0009: Use Linear's official MCP server instead of a custom Linear integration.** Supersedes TODOS.md T8's original scope (custom `packages/linear-sync` GraphQL client + keytar-stored auth + rate-limit backoff + rotation procedure) — Linear's hosted MCP server (`mcp.linear.app`) already owns auth, rate limiting, and the GraphQL surface. Discovered while investigating T8's auth model.
- **T8 (Linear integration spec) marked superseded** in TODOS.md, replaced by a smaller task: register the `plugin:engineering:linear` connector and decide which skill/handler calls its tools.

### Deferred
- `packages/cli/src/keychain.ts`'s stub-to-real-keytar swap: deferred until T8's actual consumer needs it. CI feasibility was verified empirically ahead of time — `keytar`'s prebuilt binary resolves cleanly on `ubuntu-latest` via `prebuild-install`, no toolchain change needed. Full plan: `P10-Plans/2026-07-06-toto-wolff-keytar-swap-deferred.md`.
- `T-LINEAR-CACHE` — session-scoped caching for `linear-sync`'s team/project resolution walkthrough, to reduce repeat-invocation friction for users who already know their team/project. Parked (P3) pending evidence the friction actually costs time.

## [1.2.0] - 2026-07-02

### Added
- `toto synthesize` — new CLI command (`packages/cli/src/commands/synthesize.ts`) that scans 5 vault directories (Council/Congressional-Records, P10-Plans, ADR, Cabinet, Signals), runs a parallel Haiku scout per directory, and synthesizes cross-cutting patterns with a single Sonnet call: repeated architectural patterns resolved differently across projects, council rulings never referenced in a later P10/commit, orphaned ADRs, and recurring builder-instinct patterns. Writes a typed `Synthesis/YYYY-MM-DD-connections.md` vault record with a new `pattern_refs` field. No Opus call in the runtime path (synthesis, not a gate); manual CLI trigger only this stage (cron/post-backfill-hook triggers are documented follow-up work, not yet built).
- `withLLMTimeout` added to `packages/core/src/index.ts`'s barrel export — previously only reachable within `packages/core` itself; needed cross-package for `synthesize.ts` to reuse the existing LLM-timeout wrapper instead of reimplementing it.
- Full P10 plan at `P10-Plans/2026-07-02-toto-wolff-t-auto-vault-synthesis.md` — approved after 1 revision cycle. The Opus arbiter caught a real defect in the first draft: an assertion requiring non-empty `pattern_refs` that directly contradicted the design's own degraded-empty-refs path, which would have crashed on exactly the failure mode it was built to tolerate. Also required `Promise.all` → `Promise.allSettled` on the 5-way scout fan-out so one scout's failure doesn't abort the other four.

## [1.1.1] - 2026-07-01

Closes the two conditions the Cabinet attached to v1.1.0 (`2026-07-01-v1.1.0-tag-justification`) that were still open when that tag was cut and distributed. Both were previously "shipped" in name only — the code paths existed but were unreachable/unguarded from any real invocation.

### Fixed
- **T10 fast-path routing (Karpathy's condition).** `CouncilService._isFactualQuestion()` used bare `.includes()` substring matching, so a genuinely deliberative question with none of the 5 trigger keywords as a whole word (e.g. "which approach should the team take for the migration") silently routed to the single-call fast-path and got written to the vault as `Status: approved` with zero deliberation. Replaced with word-boundary regex matching, an explicit deliberative-marker guard (`which approach`, `how should we`, etc.), and a 20-word length cap. `packages/core/src/CouncilService.test.ts` now asserts this exact case is rejected.
- **T5 reversal detection, end-to-end (Feynman's condition).** `handleCouncilRun()` never loaded real priors — `SignalIndex` existed but was only ever wired into the dashboard's read-only signal feed, and the `council_run` MCP tool schema didn't even expose `currentTags`/`priors` as inputs, so no real client could reach `detectReversal`'s conflict branch. The handler now constructs a real `SignalIndex(vaultPath)`, loads it, and forwards live priors (plus tags derived from the question via new `extractQuestionTags()`) into `CouncilService.run()` when the caller doesn't supply them explicitly. The `council_run` tool schema now advertises `currentTags`/`priors` as real inputs. `packages/mcp-server/src/__tests__/council_run.test.ts` proves `reversalDetected === true` fires through the real handler against a real on-disk vault fixture — not just a hand-built test double.
- Removed the phantom `SignalIndex.MAX_RECORDS` references in `reversalDetector.ts` / `constants.ts` comments — that symbol was never exported; the comments now describe the actual (independent) bound each module enforces.

## [1.0.2] - 2026-07-01

### Added
- Decision reversal auto-detection: `detectReversal()` in `packages/core/src/utils/reversalDetector.ts` scans prior `SignalRecord`s for a topic-matched, conflicting verdict; wired into `CouncilService.run()` via optional `currentTags`/`priors` params (backward-compatible defaults).
- Shared `jaccardSimilarity`/`JACCARD_MATCH_THRESHOLD` extracted to `packages/core/src/utils/jaccard.ts`; `scoreConfidence.ts` now imports from core instead of duplicating the implementation.
- Local governance pre-commit hook (`scripts/extensions/pre-commit`, installed via `scripts/install-hooks.sh`): greps staged diffs against `.toto/sensitive-patterns.json` and blocks the commit with a `/council` prompt on a match. Host-agnostic — no GitHub Actions dependency, replaces the blocked auto-trigger design from the 2026-06-29 council ruling.
- `scripts/check-patterns.ts` (`pnpm check-patterns`): lint gate keeping `.toto/sensitive-patterns.json` and the CLAUDE.md `##sensitive-patterns` fence in sync; rejects overbroad patterns (bare `.*`, `.+`, empty string) that would match every diff. Runs locally and in a new read-only `check-patterns` CI job (`contents: read`, no `pull_request_target`).
- `toto doctor` now checks whether the governance pre-commit hook is installed.
- `tests/pre-commit.bats` (8 tests) and `tests/toto-report.bats` (1 live test, 2 pre-green pending E4).

### Fixed
- `CouncilService.run()` no longer throws if `detectReversal` fails on a bad input — the council record is already written to vault by that point, so a detection failure now degrades gracefully instead of surfacing as a false "the whole run failed."

## [1.0.0] - 2026-06-25

### Added
- Signal loop type fix: `SignalRecord` extended with optional `pattern` and `topic_tags` fields; `parseFrontmatter` handles inline JSON arrays via `parseArrayValue`; 4 unsafe casts removed from `scoreConfidence.ts`.
- 4 signal loop integration tests: HIGH on fixture records, exact `query()` membership, LOW on mismatched Jaccard, ENOENT cold-start path.
- Cold-start UX: `handleScoreConfidence` returns LOW with actionable "run toto backfill" disqualifier when `Signals/` is absent or empty.
- `seed_signals()` in `./setup` — idempotent backfill on first install if vault history exists.
- Dashboard empty-state copy: "No sessions yet — run /council to start your first."
- `/vault/reversed` and `/vault/signal` endpoints documented in README.

### Changed
- README: single-user scope explicit (line 5, 159), shared team vault deferred to v1.1.0; API cost disclosed ($0.10–$0.30/session, 6 calls itemized).
- `./setup --role` allowlist trimmed to `engineering` only; error message updated.

### Removed
- `personas/devops.md`, `personas/data.md`, `personas/r-and-d.md` — stub files removed; additional roles ship in v1.1.0 when content exists.

## [0.3.0] - 2026-06-24

### Added
- `SignalIndex` (`packages/core/src/signal_index.ts`) — in-memory typed verdict index; reads `Signals/` dir, filters expired records, loads per-request with `MAX_RECORDS=500` and `MAX_RECORD_BYTES=10240`.
- `GET /vault/signal` endpoint — returns active (non-expired) `SignalRecord[]`; empty array is a valid cold-start response.
- `GET /vault/reversed?id=` endpoint — scans `P10-Plans/` for plans citing a verdict ID; path traversal guarded; `MAX_PLAN_FILES=500`.
- `score_confidence` MCP tool (tool #6) — deterministic tiered veto: HIGH (≥2 distinct in-date records, known pattern, topic Jaccard ≥ 0.5) proceeds; LOW halts with disqualifiers.
- `scoreConfidence` function (`packages/core/src/scoreConfidence.ts`) — binary cardinality + Jaccard veto with novel-pattern halt; per ADR-0007; `N_DISTINCT=2`, `JACCARD_MATCH_THRESHOLD=0.5`.
- `auditContradictions` — pure function that flags plans with `loop_informed:true` citing expired or missing verdicts.
- `checkProvenance` — fail-closed provenance binding; cited-but-not-returned records are a hard reject.
- `toto backfill` CLI command — ingests `ADR/` and `P10-Plans/` into `Signals/` with `pattern` and `topic_tags` fields; idempotent via lowercase ID dedup.
- `SIGNAL_PATTERNS` closed enum: `shared-session-state-auth-extraction`, `architectural-decision-record`, `p10-approved-plan`.
- Strangler-pattern skill tiered veto — calls `score_confidence` MCP tool deterministically; halts on LOW with disqualifiers surfaced.
- `ADR-0001` (`docs/ADR/ADR-0001-system-architecture.md`) — records monorepo package structure, vault flat-file decision, and loopback-only binding rationale.
- 13 new tests (8 × `scoreConfidence`, 5 × `checkProvenance`); 64 total passing.

### Fixed
- `scoreConfidence.ts:69` — replaced `now.length === 10` check with an ISO regex; US-format dates now throw instead of silently passing (ISSUE-002).
- `runBackfill` — `existingIds` set normalized to lowercase to prevent duplicate signal writes on macOS HFS+ case-insensitive volumes (ISSUE-001).

### Security
- `dashboard_html.ts` — `item.date` and `b.date` values in inline script block wrapped in `escHtml()` to close XSS vector in date output (SEC-001).
- `.gitleaks.toml` — added `manifest-auth-token` rule matching `mnfst_` prefix with placeholder allowlist entry (SEC-002).

## [0.2.0] - 2026-06-22 (same-day follow-on to 0.1.0)

### Added
- `GET /dashboard/events` SSE endpoint — broadcasts `connected`, `stats` (councilCount, p10Count, blockedCount every 15s), and `error` events; keep-alive comment every 10s; 503 when at capacity (max 50 clients).
- `GET /dashboard/record` endpoint — serves raw council and P10 vault records; path traversal guarded via `path.sep` suffix check; 100 KB cap (HTTP 413); ENOENT → 404, unexpected errors → 500 with no stack trace in response body.
- `packages/mcp-server/src/handlers/sse_registry.ts` — singleton SSE broadcast registry; shared intervals start on 0→1 client and clear on N→0; `res.destroyed` guard on every write; exports `isAtCapacity()`.
- `packages/mcp-server/src/handlers/sse_handler.ts` — `handleSseRequest`; capacity check fires before `writeHead(200)` to prevent `ERR_HTTP_HEADERS_SENT` on the 503 path.
- `packages/mcp-server/src/handlers/record_handler.ts` — `handleRecordRequest`; path traversal guarded via `path.sep` suffix check; 100 KB cap (HTTP 413); ENOENT → 404, unexpected errors → 500 with no stack trace in response body.
- `packages/mcp-server/src/handlers/dashboard_status.ts` — `handleDashboardStatus` extracted from `index.ts`; introduces `DashboardStats` interface and `isValidItemType` guard.
- Dashboard UI: live `#connection-status` (aria-live), `#panel-spinner`, slide-in record panel, mobile overlay at 768px breakpoint and full-screen below 768px, `#blocked-count` aria-live.
- 23 new tests: 9 SSE unit, 14 record unit, 1 real-socket integration test verifying clean interval teardown on hard disconnect.

### Changed
- `packages/mcp-server/src/index.ts` — net -88 lines; `handleRequest` now takes `req: IncomingMessage`; SSE and record routes registered before TOOLS lookup.
- `packages/cli/src/commands/dashboard.ts` — added `ANTHROPIC_AUTH_TOKEN` credential hint to the server-unreachable error message.

## [0.1.0] - 2026-06-22

### Added
- `CouncilService` — tiered deliberative council (2 Haiku scouts, 2 Sonnet analysts, Sonnet briefer, Opus chairman).
- `P10Service` — NASA JPL Power of 10 pre-execution planner; Arbiter (Opus) gates execution with `status: approved | revision-required | blocked`.
- `VaultService` — Obsidian-agnostic flat-file vault with commit queue; `vault_write`, `vault_search`, `council_run`, `p10_plan` MCP tools.
- `VERSION` file at repo root — single source of truth for version string.
- `pnpm-workspace.yaml` — 4 packages: `core`, `cli`, `mcp-server`, `dashboard`.
- `tsconfig.json` — strict mode, `"strict": true`, no `any`, no `eval`, no unchecked returns.
- `scripts/setup` — writes `CLAUDE.md`, `~/.claude.json` (MCP server registration), `~/.toto/vault` init.
- `toto` CLI — `council`, `p10`, `vault`, `report`, `radio`, `doctor`, `search`, `init`, `upgrade`.
- `.gitleaks.toml` — path-traversal and secret patterns.
- `tests/setup.bats`, `tests/toto-report.bats` — 14 tests.
- GitHub Actions CI: typecheck, test, check-patterns, eval-gate.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue templates.
- `.github/workflows/ci.yml` — protected branches, required status checks.

### Changed
- Single-user scope explicit (line 5, 159), shared team vault deferred to v1.1.0; API cost disclosed ($0.10–$0.30/session, 6 calls itemized).
- `./setup --role` allowlist trimmed to `engineering` only; error message updated.
- Removed `personas/devops.md`, `personas/data.md`, `personas/r-and-d.md` — stub files removed; additional roles ship in v1.1.0 when content exists.

## [0.2.0] - 2026-06-22 (same-day follow-on to 0.1.0)

### Added
- `GET /dashboard/events` SSE endpoint — broadcasts `connected`, `stats` (councilCount, p10Count, blockedCount every 15s), and `error` events; keep-alive comment every 10s; 503 when at capacity (max 50 clients).
- `GET /dashboard/record` endpoint — serves raw council and P10 vault records; path traversal guarded via `path.sep` suffix check; 100 KB cap (HTTP 413); ENOENT → 404, unexpected errors → 500 with no stack trace in response body.
- `packages/mcp-server/src/handlers/sse_registry.ts` — singleton SSE broadcast registry; shared intervals start on 0→1 client and clear on N→0; `res.destroyed` guard on every write; exports `isAtCapacity()`.
- `packages/mcp-server/src/handlers/sse_handler.ts` — `handleSseRequest`; capacity check fires before `writeHead(200)` to prevent `ERR_HTTP_HEADERS_SENT` on the 503 path.
- `packages/mcp-server/src/handlers/record_handler.ts` — `handleRecordRequest`; path traversal guarded via `path.sep` suffix check; 100 KB cap (HTTP 413); ENOENT → 404, unexpected errors → 500 with no stack trace in response body.
- `packages/mcp-server/src/handlers/dashboard_status.ts` — `handleDashboardStatus` extracted from `index.ts`; introduces `DashboardStats` interface and `isValidItemType` guard.
- Dashboard UI: live `#connection-status` (aria-live), `#panel-spinner`, slide-in record panel, mobile overlay at 768px breakpoint and full-screen below 768px, `#blocked-count` aria-live.
- 23 new tests: 9 SSE unit, 14 record unit, 1 real-socket integration test verifying clean interval teardown on hard disconnect.

### Changed
- `packages/mcp-server/src/index.ts` — net -88 lines; `handleRequest` now takes `req: IncomingMessage`; SSE and record routes registered before TOOLS lookup.
- `packages/cli/src/commands/dashboard.ts` — added `ANTHROPIC_AUTH_TOKEN` credential hint to the server-unreachable error message.

## [0.1.0] - 2026-06-22

### Added
- `CouncilService` — tiered deliberative council (2 Haiku scouts, 2 Sonnet analysts, Sonnet briefer, Opus chairman).
- `P10Service` — NASA JPL Power of 10 pre-execution planner; Arbiter (Opus) gates execution with `status: approved | revision-required | blocked`.
- `VaultService` — Obsidian-agnostic flat-file vault with commit queue; `vault_write`, `vault_search`, `council_run`, `p10_plan` MCP tools.
- `VERSION` file at repo root — single source of truth for version string.
- `pnpm-workspace.yaml` — 4 packages: `core`, `cli`, `mcp-server`, `dashboard`.
- `tsconfig.json` — strict mode, `"strict": true`, no `any`, no `eval`, no unchecked returns.
- `scripts/setup` — writes `CLAUDE.md`, `~/.claude.json` (MCP server registration), `~/.toto/vault` init.
- `toto` CLI — `council`, `p10`, `vault`, `report`, `radio`, `doctor`, `search`, `init`, `upgrade`.
- `.gitleaks.toml` — path-traversal and secret patterns.
- `tests/setup.bats`, `tests/toto-report.bats` — 14 tests.
- GitHub Actions CI: typecheck, test, check-patterns, eval-gate.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue templates.
- `.github/workflows/ci.yml` — protected branches, required status checks.

### Changed
- Single-user scope explicit (line 5, 159), shared team vault deferred to v1.1.0; API cost disclosed ($0.10–$0.30/session, 6 calls itemized).
- `./setup --role` allowlist trimmed to `engineering` only; error message updated.
- Removed `personas/devops.md`, `personas/data.md`, `personas/r-and-d.md` — stub files removed; additional roles ship in v1.1.0 when content exists.

## [0.1.0] - 2026-06-22 (original release)

### Added
- `CouncilService` — tiered deliberative council (2 Haiku scouts, 2 Sonnet analysts, Sonnet briefer, Opus chairman).
- `P10Service` — NASA JPL Power of 10 pre-execution planner; Arbiter (Opus) gates execution with `status: approved | revision-required | blocked`.
- `VaultService` — Obsidian-agnostic flat-file vault with commit queue; `vault_write`, `vault_search`, `council_run`, `p10_plan` MCP tools.
- `VERSION` file at repo root — single source of truth for version string.
- `pnpm-workspace.yaml` — 4 packages: `core`, `cli`, `mcp-server`, `dashboard`.
- `tsconfig.json` — strict mode, `"strict": true`, no `any`, no `eval`, no unchecked returns.
- `scripts/setup` — writes `CLAUDE.md`, `~/.claude.json` (MCP server registration), `~/.toto/vault` init.
- `toto` CLI — `council`, `p10`, `vault`, `report`, `radio`, `doctor`, `search`, `init`, `upgrade`.
- `.gitleaks.toml` — path-traversal and secret patterns.
- `tests/setup.bats`, `tests/toto-report.bats` — 14 tests.
- GitHub Actions CI: typecheck, test, check-patterns, eval-gate.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue templates.
- `.github/workflows/ci.yml` — protected branches, required status checks.

### Changed
- Single-user scope explicit (line 5, 159), shared team vault deferred to v1.1.0; API cost disclosed ($0.10–$0.30/session, 6 calls itemized).
- `./setup --role` allowlist trimmed to `engineering` only; error message updated.
- Removed `personas/devops.md`, `personas/data.md`, `personas/r-and-d.md` — stub files removed; additional roles ship in v1.1.0 when content exists.
