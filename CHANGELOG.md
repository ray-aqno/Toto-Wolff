# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.0.0] - 2026-10-05

toto-wolff 2.0: the plugin becomes a dependency-free MCP server and a state engine for task graphs. Claude runs every step; the server keeps the state, checks the evidence and stops at human gates. Breaking for 1.6 users: no credentials, five model-backed tools removed, Node 24 required (see Breaking, and the README's "Upgrading to 2.0.0").

### Breaking
See the README's "Upgrading to 2.0.0" for what to do.
- **The plugin's MCP server makes no model calls and takes no credentials.** The `userConfig` settings (API key, auth token, base URL) and every `ANTHROPIC_*` lookup are gone; Claude runs each workflow step itself.
- **Five MCP tools are removed:** `council_run`, `p10_plan`, `cabinet_run`, `safety_car_run` and `karpathy_check`. The matching skills run those workflows through Claude.
- **Node 24 is required.** The server is readable `.mts` files that Node runs directly (no bundle, no build).
- **`subagent_list` lists project agents only** (`.pi/agents`). It no longer reads `~/.pi/agent` or `PI_CODING_AGENT_DIR`, the pi agent folder that also holds pi's credentials (the plugin directory refuses a plugin that reads it); `scope: "user"` finds nothing.
- **The Claude plugin directory installs from branch `plugin`**, which `.github/workflows/publish-plugin.yml` fills from each release tag as a forward commit. Marketplace installs still update from `main`'s `plugin/`.

These change v1.6 behavior of the six tools carried into the 2.0 plugin (issue #60). Details in `plugin/README.md`.
- **The dashboard HTTP server is off by default.** It starts only when `TOTO_MCP_PORT` is set (v1.6 always listened on 127.0.0.1:3099). Every Claude session runs its own plugin server, so a fixed default port would be raced. It now also answers only requests whose `Host` is `127.0.0.1:<port>` or `localhost:<port>`. `toto dashboard` says to set `TOTO_MCP_PORT` when it cannot reach the server.
- **The dashboard's POST tool routes are removed.** v1.6 let any HTTP POST to `127.0.0.1:3099/<tool>` call a tool, including `vault_write`, from any web page. Only the dashboard's GET routes remain.
- **`vault_search` matches literal text, not a regular expression**, case-sensitive as before, because v1.6's ripgrep is no longer used. A query that finds nothing and contains regex characters gets a `note` saying so.
- **`vault_search` returns `{ results, truncated }`** instead of a bare array; `truncated` is `true` when a cap cut the results (500 results, files over 1 MiB skipped, 512 KiB of results). Result entries and their absolute `file` paths are unchanged.

### Added
- **The publish workflow and release packaging.** `.github/workflows/publish-plugin.yml` copies a release tag's `plugin/` onto branch `plugin` (on a published release, or by hand with a tag and an optional dry run); a read-only gate job checks the tag is on `main`, matches `VERSION` and passes `check:plugin-sync`, and a separate job with write access commits and pushes without installing anything, never forced. `plugin/` now ships the icon and the LICENSE, and the sync check also refuses lockfiles, package manifests and minified files. RELEASE.md runs the pre-merge checks, the merge, the tag, a dry run, the release and portal Validate in that order. Issue #64.
- **The built-in `idea-to-pr` graph and the `graph-run` skill.** `idea-to-pr` takes an idea through spec, council, an approval, an RFC or ADR (you pick), a P10 plan, an approval, the Safety Car, a Karpathy build loop, an approval and the pull request. The server checks the RFC or ADR (right numbered path under `docs/rfc` or `docs/adr`, every template section, `DOC_EXISTS` if the idea already has one) and that the last step's evidence is a pull request URL (`BAD_EVIDENCE` otherwise). The new `graph-run` skill (the plugin's 8th) drives a run, asks you at every gate and choice, stops when it cannot ask, and writes a summary to the vault. Issue #63.
- **Loop nodes retry until they pass.** A `loop` step runs up to `maxIterations` attempts (default 3, at most 10): the step carries `iteration`, a fail starts the next attempt, a fail on the last attempt fails the run, and every attempt is logged in `events.jsonl`. `graph_report` takes an optional `iteration` so a retried report never uses up an attempt. Runs started before this change load as they are. Issue #62.
- **Task graphs.** Eight new tools (`graph_list`, `graph_template`, `graph_start`, `graph_next`, `graph_report`, `graph_approve`, `graph_status`, `graph_resume`) run a DAG of `skill`, `choice`, `loop` and `human_gate` steps defined in `.toto/graphs/*.json`, one step at a time, with the state in `.toto/runs/<runId>/`. Every change is checkpointed atomically, so a run survives a crash or a closed session and `graph_resume` returns the step in flight; a lock keeps two sessions from changing one run at once, and a lock left by a dead process is taken over. Loops run once for now (#62 adds retries). Human gates are advisory, as `plugin/README.md` explains. Issue #61.
- **The six carried-over tools are back in the plugin**: `vault_write`, `vault_search`, `drs_check`, `subagent_list`, `dashboard_status` and `score_confidence`, in both MCP eras, with no external programs required: search is built in, and the vault commits to git only when it is a git repository (best effort: a failed commit leaves the file written, with one warning). See Breaking above for what changed. Issue #60.
- **The plugin's MCP server also speaks MCP 2026-07-28**, the current, stateless revision of the protocol, alongside the 2025-11-25 `initialize` handshake. A request that carries the 2026-07-28 `_meta` fields (protocol version, client capabilities) gets `server/discover`, `tools/list` and `tools/call` with `resultType`, server identity and caching hints; every other request is answered exactly as before (pinned byte for byte by tests). No state is kept between requests. Claude Code 2.1.289 uses the new protocol when its stdio negotiation flag is on for the account; `pnpm check:modern-mcp` checks that path locally. Issue #66.

### Changed
- **CI pins `ubuntu-24.04`** on every job (GitHub moves `ubuntu-latest` to Ubuntu 26 on October 19, 2026).
- **The plugin's MCP server is rewritten as a dependency-free state engine.** `plugin/server/` holds readable `.mts` files that Node 24 runs directly, with no build and no bundle, so `plugin/server/index.mjs` and the esbuild step are gone. The server makes no model calls, so the plugin no longer asks for an API key, token or base URL (its `userConfig` is removed). It needs Node 24; Node 22.18 to 23.x get a one-line refusal, and older Node cannot load it at all. Of the 11 v1 MCP tools, the five model-backed ones (`council_run`, `p10_plan`, `cabinet_run`, `safety_car_run`, `karpathy_check`) are dropped for good, since the skills run those workflows through Claude; the other six carry over (issue #60). Issues #57 and #59.
- **The plugin ships from `plugin/`, not the whole repository**: the marketplace source is now `./plugin`, and `plugin/` holds only the manifest (moved to `plugin/.claude-plugin/plugin.json`), copies of the 7 listed skills, and `plugin/server/index.mjs`, a minified esbuild bundle of the MCP server (0.79 MiB, under the plugin directory's 1 MiB inspection limit). Before, CI workflows, docs and tests shipped as part of the plugin, and the directory's review flagged them. `.claude/skills/` stays the source of truth; `pnpm sync:plugin` regenerates `plugin/` and CI's `check:plugin-sync` fails if the committed copy differs in bytes, exec bit, missing or extra files, or symlinks. **Upgrading from 1.6.0:** the install root moved, so run `claude plugin marketplace update toto-wolff`, then reinstall the plugin. With the new skill paths, Claude Code lists the P10 skill as `p10` (it listed `p10-bridge` before); the skill itself is unchanged.
- **`packages/core/dist` and `packages/mcp-server/dist` are no longer committed**: the plugin's bundle inlines everything the server needs, so only `plugin/server/index.mjs` is tracked. `pnpm check:dist-sync` and `pnpm sync:dist` are replaced by `check:plugin-sync` and `sync:plugin`. Manual launches use `node plugin/server/index.mjs`.
- **`linear-sync` has frontmatter**: a `name` and `description`, which the plugin directory required. The description keeps the skill user-invoked only.
- **`strangler-pattern-guide` no longer ships in the plugin**: the plugin directory's review held the plugin because that skill's sample C# token handling, read together with a PowerShell `Invoke-RestMethod` call in its reference material, looks like a credential leaving the machine in two steps. It is a .NET migration guide rather than a governance skill, so it is removed from `plugin.json`'s `skills` list. It stays in the repository under `.claude/skills/` and still works as a project skill when working in this repo.

### Fixed
- **`vault_write` advertised the wrong arguments** (`content`, `filename`) while its handler required `path` and `content`, so a client following the schema was rejected. In the 2.0 plugin it advertises `{ path, content }`. The same bug is in v1.6 on `main` and is on the v1.6.x patch list. Issue #60.
- **Running `pnpm build` twice corrupted the server bundle**: esbuild bundled `packages/mcp-server/dist/index.js` in place, so when a stale `tsconfig.tsbuildinfo` made `tsc` skip emitting, the next build bundled the bundle, adding a second `createRequire` banner, and the server failed to start. The bundle now goes to its own file (`plugin/server/index.mjs`); repeated builds with a stale build cache produce byte-identical output with one banner.
- **Bundled MCP server was too large for the plugin directory**: `packages/mcp-server/dist/index.js` was 12.86 MiB, over the directory's 5 MiB per-file limit, so submission failed with "A file is too large". Almost all of it came from one import: `SubagentService` used `getAgentDir()` from `@earendil-works/pi-coding-agent`, which pulled that package's whole multi-provider AI stack (Mistral, Google, OpenAI SDKs, a runtime TypeScript loader, a syntax highlighter) into the bundle. `getPiAgentDir()` in `SubagentService.ts` now implements the same lookup: `$PI_CODING_AGENT_DIR` if set (a bare `~`, a leading `~/`, or `~\` on Windows expands to the home directory, and a `file://` URL becomes a path), otherwise `~/.pi/agent`. On Linux its output matches the original's on ten inputs, including `file://` URLs, spaces and a trailing slash; the Windows `~\` branch mirrors the original's code and is unit-tested but was not compared against it on Windows. The dependency is removed and the bundle is now 1.35 MiB.

## [1.6.0] - 2026-09-28

Plugin autopublish readiness: the marketplace plugin now declares its credential and launches with plain `node` instead of a shell script that builds at launch time, the pattern the plugin directory's automated review holds for a human reviewer. Two configuration changes are breaking, both now stopping the MCP server at startup: an auth token without a base URL from the same source, and a key and a token set in the same source (see Changed, and the README's "Upgrading to 1.6.0" note).

### Added
- **Credential declared via `userConfig`**: `.claude-plugin/plugin.json` declares three optional options, `anthropic_api_key`, `anthropic_auth_token` (both `sensitive`) and `anthropic_base_url`, set with `/plugin configure toto-wolff@toto-wolff` or `claude plugin install ... --config KEY=VALUE`. They reach the server as `TOTO_ANTHROPIC_API_KEY`, `TOTO_ANTHROPIC_AUTH_TOKEN` and `TOTO_ANTHROPIC_BASE_URL`, not the standard names: Claude Code passes an unset optional value as an empty string, which under the standard names would overwrite a key exported in the shell and crash the server at startup. `createAnthropicClient` now checks, in order: the `TOTO_*` values (non-empty only, and a plugin base URL pairs only with a plugin credential), the shell's `ANTHROPIC_*` variables, then `~/.claude.json`.
- **Build-free launch from committed `dist/`**: `packages/core/dist` and `packages/mcp-server/dist` are now tracked (a scoped `.gitignore` exception), and `packages/mcp-server/dist/index.js` is a single esbuild bundle, so a fresh install needs neither a build nor `node_modules`.
- **`pnpm check:dist-sync` and `pnpm sync:dist`**: `scripts/check-dist-sync.ts` deletes `dist/` and local `.tsbuildinfo`, rebuilds, and fails if `git status --porcelain --untracked-files=all` shows any difference, so stale, missing or extra committed build output fails closed. `scripts/sync-dist.ts` rebuilds and stages the result. The check runs unconditionally in the `lint-baseline` CI job.
- **`RELEASE.md`**: The canonical release runbook, including running `pnpm sync:dist` before `/cabinet`.
- **Spawn-path credential check in CI**: `plugin-launch-smoke-test` now also runs `claude mcp list` against the installed plugin with the key only in the shell, only in `userConfig`, and nowhere (which must fail), so the manifest's `userConfig`-to-env wiring is exercised through Claude Code itself, not a raw `node` launch.

### Changed
- **Plugin launch**: `plugin.json` runs `node ${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/dist/index.js` instead of `sh plugin-launch.sh`, which built TypeScript at launch time. `plugin-launch.sh` and the orphaned `tsconfig.plugin.json` are removed.
- **`plugin-launch-smoke-test` inverted**: It used to require that `dist/` be absent from the installed plugin; it now requires both committed `dist/` trees to be present and launches the manifest's own command.
- **DRS `allowed_paths`**: `.claude-plugin/` and `RELEASE.md` added, so the plugin manifest and runbook can be edited without an override.
- **README and CLAUDE.md credential instructions**: Describe both ways to supply the key (`/plugin configure` or a shell export) and the resolution order.
- **An auth token now requires its base URL**: `ANTHROPIC_AUTH_TOKEN` (or the plugin's `anthropic_auth_token`) without a base URL from the same source now fails the MCP server's startup check with a message naming the missing URL, instead of sending the gateway token to `https://api.anthropic.com`. This applies to the shell as well as the plugin and `~/.claude.json`: a shell token without a shell `ANTHROPIC_BASE_URL` used to go to the public endpoint. Set the matching base URL, or switch to an API key.
- **A key and a token from the same source are now refused**: previously both went out as separate headers to that source's base URL, so a key could reach a gateway configured for the token. The MCP server now fails its startup check and asks for only one. (The README had said the key wins; it now matches this behavior.)

### Fixed
- **`.gitleaks.toml` path exclusions never applied**: The top-level `paths-ignore` array is not a key gitleaks reads, so it had silently excluded nothing since it was added. Exclusions now live under `[allowlist].paths`. The committed `dist/` trees are exempt from the `generic-api-key` rule only (bundled library code matches it wherever an `apiKey` property is assigned a long unquoted identifier), so `anthropic-api-key` and `manifest-auth-token` still scan the shipped files. The old list's `ci.yml` and lockfile exclusions are dropped rather than carried over, so `.github/workflows/ci.yml`, `pnpm-lock.yaml` and the other lockfiles are scanned by every rule; the smoke-test placeholder is already covered by a value allowlist, and a full-history scan finds nothing in the lockfiles.
- **A credential could be sent to the shell's gateway**: When a credential came from `~/.claude.json` (and, within this release, from the plugin's `userConfig`) with no base URL of its own, `createAnthropicClient` handed the SDK an undefined base URL, and the SDK then read the shell's `ANTHROPIC_BASE_URL`. The base URL now always comes from the same source as the credential. An API key without one goes to `https://api.anthropic.com`.
- **Stale bundle sourcemap no longer shipped**: esbuild overwrote `dist/index.js` without regenerating `dist/index.js.map`, so the committed map described code that no longer existed. The build now removes it; a real bundle map would be about 20.5MB.

### Known limitations
- **`toto doctor` disagrees with the server on two credential setups**: its credential check still reports an `ANTHROPIC_AUTH_TOKEN` without a base URL as set, although the MCP server now refuses that setup at startup, and it cannot see credentials saved with `/plugin configure`, because those reach only the server process Claude Code launches. Until a future patch brings the check in line with the server, trust the server's startup error over `toto doctor` for these two cases. The `/plugin configure` half will stay invisible to `toto doctor` by design, since reading Claude Code's credential store from the CLI is not something the tool will do.
- **Safety Car and Karpathy still pass on unusable model output**: carried over unchanged from 1.5.0 (see its Known limitations). `safety_car_run` and `karpathy_check` return `pass` when the reviewing model's response is unparseable, truncated or empty. A future patch will make unusable output produce a non-pass result.
- **The plugin directory's automated review is not yet confirmed**: launching from committed `dist/` with plain `node` follows the plugin directory's published guidance on what its automated review holds for a human reviewer. The first real submission will confirm whether it clears without a hold; if it does not, a future release will address what the review reports.

## [1.5.0] - 2026-09-21

This release ships six streams: DRS live enforcement, the vault read API, credential and config-migration fixes, CLI and dashboard consolidation, repo hygiene, and documentation truth with an ESLint baseline gate. The credential and config stream ships Stages 1, 2 and 5 only (the credential-file reader, the config migration and a dead-export cleanup).

### Added
- **DRS `permissive` config flag**: Explicit opt-out for Rule 2 (out-of-scope write). By default, an empty `allowed_paths` now means "nothing allowed" (fail-closed), not "no restriction." Set `permissive: true` in `.toto/config.yml`'s `drs:` block to restore the old no-restriction behavior for an empty scope list.
- **DRS `configSource` diagnostic**: `DRSService` now publicly exposes where its active config actually came from (`cwd-relative`, `env:TOTO_DRS_CONFIG`, or `deny-all-fallback`), so a resolution failure from an unexpected working directory is a visible signal instead of an indistinguishable "everything is blocked" state.
- **DRS override audit trail (TS/MCP path)**: `checkOverride()`'s accepted overrides now write a durable vault record (mirroring the bash hook's existing `write_override_record()`), closing the fabricated-audit-trail gap named in audit finding L2-003. An override is honored only if that record is written: if the vault write fails (or no vault is configured) the override is ignored and the call is judged as if none was given. The bash hook behaves the same way, exiting 2 instead of proceeding unaudited.
- **`DRSService.test.ts`**: New contract-test suite (Rules 1/2/4 on known-bad fixtures, permissive opt-out, cwd-relative resolution failure/`TOTO_DRS_CONFIG` override, override-anchoring, and rule-precedence pinning).
- **DRS conformance suite**: `tests/drs-conformance.bats` (23 tests) checks that the bash hook and `DRSService` agree on the same inputs. It covers the python3 fallback with `jq` absent, override honoring and its audit record for Rules 1 and 5, and two documented known gaps. It runs in CI as the `drs-conformance-test` job.
- **Vault read API (`VaultServiceV2`)**: A pluggable storage abstraction under `packages/core/src/vault/`: `StorageBackend`, the filesystem-backed `FileStorage`, and `VaultFactory`, which constructs backends and caches them with reference counting. It is exported as `VaultServiceV2` beside the existing `VaultService`, so current callers keep working. The mcp-server handlers that read the vault directly (`vault_reversed`, `record_handler`, `signal_index`, `contradiction_auditor`, `dashboard_status`) now go through it.
- **Shared `~/.claude.json` credential reader** (`claudeJsonCredentials.ts`): used by the legacy Anthropic client path (`anthropicLegacy.ts`) and by `toto doctor`, replacing two duplicated implementations with one synchronous helper that never throws.
- **`pnpm migrate-config`** (`scripts/migrate-config.ts`): An idempotent, dry-run-by-default migration of `.toto/config.yml`'s old format. It writes atomically (temp file plus rename) and takes a backup before every write, so a crash mid-migration cannot corrupt the live config.
- **`toto dashboard --terminal`**: Scans the vault directly and prints blocked Council and P10 items. It tells "vault not found", "ALL CLEAR" and blocked items apart, and reports unreadable files instead of skipping them. The default (browser) path is unchanged.
- **ESLint baseline gate**: `.eslint-baseline.json` records the 115 existing violations and `scripts/check-eslint-baseline.ts` fails on any new one. It compares findings as multisets keyed on file, line and rule, and fails closed on a spawn failure, an unexpected exit code, unparseable output, or a suspiciously clean run. A `lint-baseline` CI job builds first (an unbuilt tree reports far more findings) and then runs it. `scripts/generate-eslint-baseline.ts` regenerates the file; the procedure is in `CONTRIBUTING.md`.
- **`.env.example`**: Lists the 11 environment variables the code reads.
- **Ruling parser tests**: `parseRuling`, `parseP10Ruling` and `parseSafetyCarRisks` are exported with contract docstrings and covered by 21 unit tests.

### Changed
- **DRS Rule 2 fails closed by default**: Breaking behavior change: `rule2_scope()`'s old bypass (`allowedPaths.length === 0 → allow`) is removed. Any deployment relying on an empty `allowed_paths` meaning "no restriction" must now set `permissive: true` explicitly.
- **DRS override scope narrowed (TS/MCP path)**: `message_before: "override drs: <reason>"` on the `drs_check` tool now bypasses Rules 2/3/4 only. It no longer bypasses Rule 1 (frozen path, a curated list an override shouldn't defeat) or Rule 5 (destructive pattern, which already has its own narrower `--force-confirmed` override). This is a live behavior change from the previous undocumented all-5-rules bypass.
- **DRS hook registration moved**: The live PreToolUse hook is now registered in the committed `.claude/settings.json` (using `${CLAUDE_PROJECT_DIR}`, so it holds across worktrees and machines), pointing at the tracked `.claude/skills/drs/bin/drs-check.sh`. The previous registration lived only in the git-ignored `.claude/settings.local.json` with a hardcoded absolute path. `.pi/hooks.json` (which pointed at a stale, divergent external fork) is removed.
- **`.toto/freeze.json` schema**: Now `{"frozen": [...]}` instead of a bare array, matching `DRSService.ts`'s own tolerant parse and fixing a schema mismatch that silently broke the bash hook's Rule 1 check (both the jq and python3 code paths).
- **`.toto/config.yml`'s `drs.allowed_paths` widened**: Added `.toto/`, `.claude/`, `P10-Plans/`, `.pi/sessions/`, `.github/`, and repo-root essentials (`CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`, `package.json`, `pnpm-lock.yaml`) so Rule 2's new fail-closed default doesn't block this repo's own normal write traffic.
- **Override documentation corrected at 5 sites** (`generate-claude-md.ts`, `generate-agents-md.ts`, `.claude/skills/drs/SKILL.md`, and `drs-check.sh`'s own comment/echo text): previously described a single message-based override mechanism; now accurately describes the two distinct mechanisms (TS/MCP path, Rules 2/3/4 only, audited; bash-hook path, `DRS_OVERRIDE_REASON` env var only, any rule) and their different scopes.
- **DRS Rule 1 and coverage documentation** (`.claude/skills/drs/SKILL.md`): Rule 1 now names the real route to a frozen path (a council ruling and the unfreeze cycle, or an audited `DRS_OVERRIDE_REASON`; there is no `toto unfreeze` command). The coverage claims now match the hook: Bash commands are checked against Rules 3 and 5 only, other mutating tools never reach the hook, and the bash-hook override applies to any rule it evaluates. The known gaps are listed in the same file.
- **Ruling parsers exported**: `SafetyCarService.parseRisks` is extracted, verbatim, into the exported `parseSafetyCarRisks` (the private method delegates to it), and `parseRuling` and `parseP10Ruling` are exported. The package barrel is unchanged.
- **CLI palette**: One shared `colors.ts` replaces two drifted copies in `ui.ts` and `radio.ts`. `packages/cli` is now `"private": true`.
- **ESLint**: Test files get a 150-line `max-lines-per-function` limit; source stays at 60.
- **Documentation**: The README counts (CLI commands, MCP tools, HTTP endpoints, packages and services) are re-derived from the code. The generator templates behind `AGENTS.md` and `CLAUDE.md` no longer show nonexistent CLI commands or a deleted package, and they describe the hook registration and both override paths accurately. `CONTRIBUTING.md` and the PR template gain the lint-baseline steps.

### Removed
- **`packages/dashboard` and `packages/personas`**: The standalone terminal dashboard was never published to npm and its logic now lives in `toto dashboard --terminal`.
- **Dead code in `packages/core/src/types.ts`**: The duplicate `P10Result` interface and five unused error classes (`CabinetError`, `SafetyCarError`, `KarpathyError`, `DRSError`, `SubagentError`), plus the dead exports in `anthropic.ts`.
- **Committed CI artifacts**: `report.json` and `gitleaks-report.json`. CI regenerates the latter on every run and it is now git-ignored.

### Fixed
- **DRS hook exit code**: `drs_halt()` now exits 2, not 1. This harness's PreToolUse contract only blocks on exit code 2, so every rule that fired via the bash hook was previously non-blocking regardless of whether it detected a real violation.
- **`PROJECT_ROOT` miscalculation in `drs-check.sh`**: Was resolving to `.claude/` (3 `..` from `.claude/skills/drs/bin`), not the repo root, so the hook could never actually find `.toto/drs-config.json` or `.toto/freeze.json`. Now resolves correctly (4 `..`).
- **Rules 2, 4, and the custom-`halt_patterns` half of Rule 5 silently no-op'd when `jq` was absent** (no `else` branch existed at all): all three now have real python3 fallbacks, verified end-to-end on a machine without `jq` installed.
- **A fired rule no longer fails open when the vault is unwritable**: `drs_halt()` wrote its block record unchecked under `set -e`, so an unwritable vault aborted the hook with exit 1 (non-blocking here) before it reached `exit 2`. The record is now best-effort and the block is always enforced.
- **Rule 2 in the bash hook now fails closed on an empty `allowed_paths`**, matching `DRSService` (blocks unless `permissive: true`). It previously allowed every write, so the live hook and the TS service disagreed.
- **The python3 fallbacks no longer fail open on project paths containing an apostrophe**: the path was spliced into a single-quoted python string, producing invalid python that was silently read as "no restriction configured" (Rules 1, 2 and 4). Path and field are now passed as arguments.
- **`HookSystem.execute()` no longer discards `override` / `overrideReason`** from an executor that accepted an override.
- **`DRS_OVERRIDE_REASON` validation gate (L2-004)**: Previously any non-empty value was accepted with no further checks. Now rejects whitespace-only and common placeholder values (`reason`, `todo`, `n/a`, etc.) via a new `validate_override_reason()` helper.
- **Browser dashboard** (`dashboard_html.ts`): Blocked items are no longer hidden by the empty state. The cabinet and subagent sparklines animate, and sparklines plot real monthly buckets. Card labels meet WCAG AA contrast, the record panel tells a 404 from other failures, and sparkline sizing and the mobile grid are fixed.

### Known limitations
- **Safety Car and Karpathy pass on unusable model output**: `safety_car_run` and `karpathy_check` return a `pass` verdict when the reviewing model's response is unparseable, truncated or empty, or when a finding is missing a required field. A `pass` from either gate therefore does not by itself show that the review ran. This is inherited from v1.4.1, not new in this release; a fix that makes unusable output produce a non-pass result is planned for a future patch.

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
