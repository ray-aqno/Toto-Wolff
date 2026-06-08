# Changelog

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
