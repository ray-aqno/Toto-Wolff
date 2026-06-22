# Changelog

## v0.2.0 — 2026-06-22
### Added
- `GET /dashboard/events` — SSE endpoint; live vault stats (councilCount, p10Count, blockedCount) broadcast every 15s; keep-alive comment every 10s; `event: error` on vault failure; max 50 clients (HTTP 503 before headers commit)
- `GET /dashboard/record` — raw vault record endpoint; serves council and P10 markdown files; path traversal guard with `path.sep` suffix; 100KB cap (HTTP 413); ENOENT→404, other errors→500 (no stack trace in response)
- `packages/mcp-server/src/handlers/sse_registry.ts` — singleton SSE broadcast registry; shared intervals start on 0→1, cleared on N→0; `res.destroyed` guard on every write; `isAtCapacity()` export
- `packages/mcp-server/src/handlers/sse_handler.ts` — `handleSseRequest`; capacity check fires before `writeHead(200)` to prevent `ERR_HTTP_HEADERS_SENT` on 503 path
- `packages/mcp-server/src/handlers/record_handler.ts` — `handleRecordRequest`; sibling-prefix traversal protection via `path.sep`
- `packages/mcp-server/src/handlers/dashboard_status.ts` — `handleDashboardStatus` extracted from `index.ts`; `DashboardStats` interface; `isValidItemType` guard
- Dashboard UI: live `#connection-status` (aria-live), `#panel-spinner`, slide-in record panel, mobile overlay (768px) / full-screen (<768px), `#blocked-count` aria-live
- 23 new tests: 9 SSE unit + 14 record unit + 1 real-socket integration test (hard disconnect → clean interval teardown verified)
- README Live Dashboard section; CLAUDE.md HTTP API docs
### Changed
- `packages/mcp-server/src/index.ts` — net -88 lines; `handleRequest` now takes `req: IncomingMessage`; SSE and record routes registered before TOOLS lookup
- `packages/cli/src/commands/dashboard.ts` — ANTHROPIC_AUTH_TOKEN credential hint in server-unreachable error message

## v0.1.0 — 2026-06-22
### Added
- `packages/cli`: 8 commands — init, doctor, whoami, search, last, audit, dashboard, radio
- `toto radio`: interactive pit wall chat; Anthropic streaming or Ollama NDJSON fallback; `TOTO_RADIO_PROVIDER`, `TOTO_RADIO_MODEL`, `OLLAMA_HOST` env controls
- `toto doctor`: added INFO-level Ollama probe (lists available models; non-blocking)
- `toto` landing UI: pit lane status (blocked P10 count), governance-voiced command descriptions, daily team-radio quote
- `packages/mcp-server`: 5 MCP tools (vault_write, vault_search, council_run, p10_plan, dashboard_status) + `GET /dashboard` server-rendered HTML paddock interface
- Dashboard: Mercedes design tokens, JetBrains Mono, slide panel, mobile-responsive, WCAG 44px touch targets
- `packages/personas`: engineering, devops, r-and-d, data persona stubs (runtime persona switching deferred to v1.0.0)
### Scope declarations (declared incomplete — not defects)
- Dashboard is static server-rendered HTML; real-time updates and WebSocket interactivity deferred to v1.0.0
- Personas package contains stubs only; no runtime persona switching in this release
- Phase 3 (Linear sync) blocked on T8 spec; not included
### Changed
- Version synced across all workspace packages (root, cli, core, mcp-server, dashboard, personas) to `0.1.0`

## v0.0.5.1 — 2026-06-17
### Fixed
- Build: migrate esbuild build-approval to pnpm 11 `allowBuilds` (pnpm 10's `onlyBuiltDependencies` is removed in pnpm 11.5.1, which silently broke the local typecheck/lint/test/build gate via `ERR_PNPM_IGNORED_BUILDS`).
- Docs: correct `/p10` skill path in CLAUDE.md (`p10/P10.md` → `p10/SKILL.md`).
### Changed
- CI/toolchain: pin pnpm 11.5.1 (`packageManager`) and Node 24 (`.nvmrc`) as single sources of truth; CI jobs read `packageManager` + `node-version-file` instead of hardcoded pnpm 9 / Node 20. Moves CI off end-of-life Node 20 (EOL 2026-04-30).

## v0.0.5 — 2026-06-15
### Added
- CouncilService: persona injection for all 5 roles (scout1, scout2, analyst1, analyst2, chairman)
- CouncilService: 2-turn compression between scouts and analysts (Format Tax paper)
- CouncilService: context positioning — important context at primacy position (Lost in the Middle paper)
- CouncilService: temperature=0 on all governance calls (deterministic governance)
- P10Service: same context positioning, 2-turn compression, and temperature=0 pattern
- MCP server: dashboard_status tool
- packages/dashboard: terminal governance dashboard
- .github/workflows/ci.yml: CI pipeline (T11 — Phase 1 eval-gate unblocked)
### Fixed
- CLAUDE.md MCP Server: replaced hardcoded absolute start-command path with a `<repo>` placeholder so the setup reference works on any clone (install-ux defect from council ruling 2026-06-16)
- Build tooling: repaired the dead `pnpm lint` gate — eslint `parserOptions.project` now targets per-package tsconfigs (the solution-style root config resolved zero source files); added `dist`/config `ignorePatterns`
- packages/dashboard: aligned tsconfig with core/mcp-server (extends base, `composite`, `exclude`) and added it to the root project references; removed a vestigial `scanDirectory` parameter; made the sync `render` function non-async
- P10Service: added explicit return types on the six prompt-builder functions
- Workspace: synced `core`/`mcp-server`/`dashboard` package versions to 0.0.5.0
### Security
- CLAUDE.md: documented per-user MCP credentials — `ANTHROPIC_AUTH_TOKEN` supplied via each developer's `~/.claude.json` (never committed); placeholder-only example
- CI: added a gitleaks secret-scan job wiring the existing `.gitleaks.toml` into the pipeline
### Removed
- runbook.md: Loom tutorial placeholder (demo runs directly via demo.sh)

## [0.0.4.1] - 2026-06-12

### Added

- `tests/bootstrap-env.bats` — 9 tests covering the preflight gate: all-pass path (asserts no phantom `ERROR:` line on a clean system), the report-all contract (no-creds + no-tools surfaces all four errors in one pass, proving `set -e` does not abort mid-check), per-tool isolation (only the missing tool's error appears, ruling out a regression in any one `command -v` line), multi-source accumulation (Option B partial-credential failure surfaces alongside tool failures in a single run), the Option B partial/complete credential paths, and git init gated behind a clean preflight (failed preflight creates no `.git`). Tool presence is stubbed via symlinked `STUB_BIN` and `ABSENT_BIN` dirs so the suite is hermetic — runs without ripgrep/node/pnpm on the host, and survives the count-guard-vs-`set -u` footgun that would print a phantom `ERROR:` on the all-pass path.

### Changed

- `scripts/bootstrap-env.sh` — preflight now reports **all** failed prerequisites in one pass, then exits once, instead of failing on the first miss. A fresh evaluator with three missing tools and no credentials sees four `ERROR:` lines and the four remediation one-liners in a single run, not one error per re-run. Exit codes unchanged (0 pass / 2 fail). State mutation (`git init`) still gated behind a clean preflight. (P10 plan `2026-06-12-bootstrap-env-report-all`, council `toto-wolff-ux-optimization`.)
- `scripts/bootstrap-env.sh` — `fail()` now returns `0` explicitly. Belt-and-suspenders against a future maintainer adding a non-zero trailing statement: the `cmd || fail` sites would otherwise trip `set -e` mid-check and silently collapse report-all back to fail-fast with no test catching it. The 9-test bats suite already proves the report-all contract holds; this just removes the implicit-dependency footgun.
- `README.md` — leads with a paste-into-Claude setup prompt as the primary install path, plus a before/after table of what the protocol changes. Preflight runs before `./setup`, so a missing prerequisite surfaces at install time rather than at first `/council`. Manual `git clone`/`./setup` path retained.

## [0.0.4.0] - 2026-06-11

### Added

- `scripts/demo.sh` — drives the full governance cycle end-to-end: preflight check on the MCP server, `council_run` with a real architectural question, `p10_plan` with a real task. A `blocked` p10 result returns HTTP 200 with `status: blocked` — governance working, not an error.
- `packages/core/src/utils/anthropic.ts` — universal Anthropic client factory. Accepts `ANTHROPIC_API_KEY` alone (personal key) or `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` together (enterprise/proxy path, e.g. Manifest). Fails fast with a clear error if neither is set.
- `packages/core/src/utils/anthropic.test.ts` — 5 tests covering both auth paths, both-set precedence, and the missing-credentials fast-fail.
- `packages/core/src/VaultService.test.ts` — real (no-mock) integration test: writes to a temp directory with no `.git`, asserts `drainQueue()` resolves without throwing and the file persists.
- `packages/mcp-server/src/handlers/p10_plan.test.ts` — two tests: `P10BlockedError` → `{status:'blocked'}` (HTTP 200, no vault path in logs), and non-blocked errors rethrow cleanly.

### Fixed

- `P10Service` was hard-asserting `ANTHROPIC_API_KEY` at construction time, crashing on any Manifest/enterprise-token setup. Migrated to `createAnthropicClient()` — same fix applied to `CouncilService` in `4c5fed5`.
- `VaultService.commitFile` would crash on a fresh clone with no `.git`. Now detects via `git rev-parse --git-dir` exit-128, skips the commit observably (`{committed: false, reason: 'not a git repo'}`), and still writes the file — write is source of truth, commit is audit-trail nicety.
- `p10_plan` handler was letting `P10BlockedError` bubble as a 500. A blocked arbiter ruling is a governance outcome, not a server fault — now returns HTTP 200 `{status:'blocked'}` and writes a fixed string to stderr (no vault path leak).

### Changed

- `README.md` — plain-language intro, two-altitude auth section (Option A / Option B with precedence note), MCP server v2 roadmap line, and "Try the cycle on stage" runblock.
- `CLAUDE.md` — jCodeMunch code exploration policy and docstring rules added.

## 0.0.3.0 — 2026-06-08

### Added

- `.github/workflows/ci.yml` — CI pipeline: typecheck (`tsc --noEmit`) + test (`vitest --passWithNoTests`) on every PR and push; `eval-gate` job gates main pushes on `ANTHROPIC_API_KEY` secret being set and all 3 assertions passing. (T11)
- `scripts/install-symlink.sh` — wire toto-wolff governance into any repo in ~30 seconds. Backs up existing `CLAUDE.md`, symlinks to the active persona. `TOTO_ROLE` env var selects role. Validates target is a git repo (worktree-aware) and role slug is allowlisted.
- Phase 1 MCP foundation: `packages/core` (VaultService, CouncilService, P10Service, withLLMTimeout), `packages/mcp-server` (vault_write, vault_search, council_run, p10_plan handlers, HTTP server), `scripts/eval-gate.ts` (3/3 exit gate).

### Changed

- `personas/engineering.md` — rewritten: welcoming tone, explains council/p10/role-switch commands, first-run onboarding line.
- `packages/core/src/P10Service.ts` — scout/analyzer/arbiter prompts replaced with structured role-specific templates: Skeptic scout (failure modes), Minimalist scout (scope creep), ranked risk Analyzer, structured DraftWriter, 8-rule Arbiter. Revision prompt now uses `P10_REVISE` template matching arbiter's expected format.
- `package.json` — `pnpm test` now passes with no test files (`--passWithNoTests`) so CI does not fail during the pre-unit-test phase.

### Fixed

- `packages/core/src/P10Service.ts` — revision cap exhaustion now forces `status: blocked` instead of falling through to an `AssertionError` in `commitPlan`.
- `packages/core/src/CouncilService.ts` — added `drainQueue()` after `vault.write` in `runSession`; council records were written to disk but never committed to vault git history.
- `.github/workflows/ci.yml` — eval-gate job now sets `user.email` and `user.name` on the ephemeral vault before running; git commit in VaultService would otherwise fail on runners with no global git identity.
- `.github/workflows/ci.yml` — eval-gate now uses `pnpm exec tsx` (locked version) instead of `npx tsx` (unversioned download).
- `scripts/install-symlink.sh` — git repo check now uses `git rev-parse --git-dir` (worktree-safe) instead of `-d .git` directory check; path traversal guard added for `TOTO_ROLE` env var.

### Security

- `scripts/install-symlink.sh:30` — `TOTO_ROLE` validated against `^[a-z][a-z0-9-]+$` before constructing persona file path; blocks path traversal via `TOTO_ROLE=../../../tmp/payload`.

---

## 0.0.2.0 — 2026-06-05

### Added

- `setup --role <name>` — swap the `# ROLE` section in `CLAUDE.md` to a named persona (`engineering`, `devops`, `r-and-d`, `data`). Requires `.toto/config.yml`. Aborts on dirty `CLAUDE.md`, missing persona, stub personas. Backup rotation keeps last 5.
- `.toto/config.yml.example` — team config template with `vault_path`, `vault_remote`, and `linear_workspace` fields. `.toto/config.yml` is gitignored.
- `personas/engineering.md` — full Engineering practice lead persona (active, non-stub).
- `personas/devops.md`, `personas/r-and-d.md`, `personas/data.md` — persona stubs (blocked by E5 content authoring).
- `tests/setup.bats` — 42-test bats suite covering read_config, check_prereqs, check_vault, symlink_claude_md, swap_role, rotate_backups, create_vault_dirs, print_summary, and main flow. Coverage ~84%.

### Security

- `setup:126` — added allowlist guard in `swap_role()` to block path traversal via `--role '../FILENAME'` patterns. Only `engineering|devops|r-and-d|data` are accepted; all others exit 4. (CSO-2026-06-05-001)

### Changed

- `setup` — arg parsing now handles any flag order (`--role` and `--force` interchangeable). Backup rotation capped at 5 files. Trap reports line number on exit error.

---

## 0.0.1.0 — 2026-06-03

Initial release of the Toto Wolff engineering stack for Navistone.

### Added

- `CLAUDE.md` — Toto Wolff persona with council + p10 + Karpathy execution discipline. Three-tier engineering cycle: deliberation (council) → safety planning (p10) → implementation discipline (karpathy). Strangler fig seam: the `## ROLE` section is the sole swap point for persona changes.
- `setup` — installer script. Creates Obsidian vault dirs, symlinks `~/.claude/CLAUDE.md` to repo. Supports `TOTO_VAULT_PATH` env var for multi-developer installs. `--help` and `--force` flags. Runs check_vault before create_vault_dirs (prevents silent wrong-path creation). gstack check is a warning, not a hard exit.
- `runbook.md` — full install guide, first-run verification, SPOF notes, bus-factor checklist, troubleshooting table.
- `README.md` — entry point for new developers.
- `docs/linear-setup.md` — Linear MCP integration permissions checklist and council→issue field mapping.
- `.claude/skills/strangler-pattern-guide/` — Navistone .NET strangler pattern skill (express-web-api → actions.api migration). Sourced from MCP marketplace (resolve-io). Includes 4-line controller pattern, 6-phase TDD checklist, PRISM workflow YAML.
- `.gitignore` — excludes `.gstack/` (local session state) and `settings.local.json` (machine-specific permissions).

### Security

- Hardcoded dev credentials (`SuperAdmin/R3solv3!`) from MCP marketplace skill redacted to `<YOUR_USERNAME>/<YOUR_PASSWORD>` placeholders before first commit.
- `settings.local.json` double-slash permission paths corrected.
- CLAUDE.md symlink attack vector documented in runbook SPOF section.
