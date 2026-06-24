# Toto Wolff Runbook

A new team member can complete this solo in under 30 minutes.

---

## Prerequisites

| Requirement | Minimum version | Install |
|-------------|----------------|---------|
| bash | 3.2 | macOS default; Linux: `apt install bash` |
| git | 2.x | `brew install git` / `apt install git` |
| Node.js | 24.x | `nvm install 24 && nvm use 24` |
| pnpm | 11.5.1 | `npm i -g pnpm@11.5.1` |
| Claude Code CLI | latest | `npm i -g @anthropic-ai/claude-code` |
| gstack | latest | `/gstack-upgrade` inside Claude Code (optional — provides `/ship`, `/review`, `/browse`; does not gate this install) |

Verify before continuing:

    bash --version       # GNU bash, version 3.2+
    git --version        # git version 2.x
    node --version       # v24.x
    pnpm --version       # 11.5.1
    claude --version     # exits 0

**Auth — set exactly one option:**

- **Option A (personal key):** `export ANTHROPIC_API_KEY=sk-ant-...`
- **Option B (enterprise/Manifest proxy):** `export ANTHROPIC_AUTH_TOKEN=mnfst_...` and `export ANTHROPIC_BASE_URL=http://localhost:2099`

Do not set both. When both are present, the MCP server and CLI both prefer `ANTHROPIC_API_KEY`.

---

## Install

    git clone <repo-url> ~/toto-wolff
    cd ~/toto-wolff
    chmod +x setup
    ./setup

If your vault should live somewhere other than `~/.toto/vault`:

    TOTO_VAULT_PATH=/your/vault/path ./setup

**Expected output:**

    Toto ready.
      vault:        ~/.toto/vault
      council logs: ~/.toto/vault/Council/Congressional-Records
      p10 plans:    ~/.toto/vault/P10-Plans
      CLAUDE.md:    /Users/<you>/.claude/CLAUDE.md -> ~/toto-wolff/CLAUDE.md

If setup exits with a non-zero code, the error message includes the failing line number. See the Troubleshooting table.

**Wire the toto CLI:**

    pnpm install
    pnpm -r build

Then add the CLI binary to your PATH (adjust path if you cloned elsewhere):

    export PATH="$HOME/toto-wolff/packages/cli/dist:$PATH"
    # Add to ~/.zshrc or ~/.bashrc to persist

**Register the MCP server with Claude Code:**

    toto init

This writes the `toto-wolff` entry under `mcpServers` in `~/.claude.json`. Without this step, `/council` and `/p10` inside Claude Code sessions will not route through the MCP server. Verify with `toto doctor`.

**Seed the signal store (run once after install):**

    toto backfill

Reads `ADR/` and `P10-Plans/` from your vault and writes typed `Signals/` records. Without this, all governance sessions start cold.

---

## First-Run Verification

### Test 1 — Council session

Open any Claude Code session and run:

    /council this: what lap strategy should we run at Monaco?

Pass: a Congressional Record appears at `~/.toto/vault/Council/Congressional-Records/YYYY-MM-DD-*.md`.

### Test 2 — P10 plan

    /p10 add a hello world endpoint to a sample Express app

Pass: a plan file appears at `~/.toto/vault/P10-Plans/YYYY-MM-DD-*.md`.

### Test 3 — MCP server + demo script

Terminal 1:

    pnpm -C packages/mcp-server start

Terminal 2:

    ./scripts/demo.sh

Pass: script runs `council_run` and `p10_plan`, prints each ruling, and names the vault artifacts it wrote. A `status: blocked` result from p10 is governance working — not an error.

---

## Daily Commands

| Command | What it does |
|---------|-------------|
| `toto` | Landing UI — pit lane status, blocked P10 count, daily team-radio quote |
| `toto doctor` | Checks credentials, vault path, git identity, Ollama probe (non-blocking) |
| `toto search <term>` | Full-text search across vault records |
| `toto last council` | Shows the most recent council ruling |
| `toto last p10` | Shows the most recent P10 plan |
| `toto audit` | Lists all blocked P10 plans still open |
| `toto backfill` | Ingests ADR/ and P10-Plans/ into Signals/; idempotent |
| `toto init` | Registers the MCP server in `~/.claude.json`; safe to re-run |
| `toto dashboard` | Opens `http://127.0.0.1:3099/dashboard` in the browser (requires MCP server running) |
| `toto radio` | Interactive pit wall chat — streaming Anthropic or Ollama fallback |
| `toto whoami` | Prints active persona, vault path, and auth source |

---

## Vault Layout

Default location: `~/.toto/vault` (override with `TOTO_VAULT_PATH`).

| Directory | Contents |
|-----------|---------|
| `Council/Congressional-Records/` | One `.md` per council session; written after every `/council` run |
| `P10-Plans/` | One `.md` per P10 plan; Opus arbiter status stamped in frontmatter |
| `ADR/` | Architectural decision records; source input for `toto backfill` |
| `Signals/` | One `.md` per SignalRecord; written by `toto backfill` or live council runs |
| `Cabinet/` | One `.md` per Cabinet release-gate session |
| `wiki/` | Free-form knowledge base; `hot.md` is the ~500-word recent-context entry point |

All files use YAML frontmatter (`--- ... ---`) for structured metadata. The body is human prose. Git-trackable, grep-able, editable in any text editor.

---

## Configuration Reference

| Env var | Default | Used by | What breaks if wrong |
|---------|---------|---------|----------------------|
| `TOTO_VAULT_PATH` | `~/.toto/vault` | setup, CLI, MCP server | Council and P10 records write to the wrong path; `toto search` finds nothing |
| `ANTHROPIC_API_KEY` | — | CouncilService, P10Service, MCP server | `/council` and `/p10` fail fast with "credentials not set" error |
| `ANTHROPIC_AUTH_TOKEN` | — | Same as above (Option B) | Same failure if `ANTHROPIC_BASE_URL` is also not set |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Same as above (Option B) | If set without `ANTHROPIC_AUTH_TOKEN`, Option B is incomplete; falls through to Option A or fails |
| `TOTO_MCP_PORT` | `3099` | MCP server, `toto dashboard` | Dashboard `curl` commands and SSE stream hit the wrong port |
| `TOTO_RADIO_PROVIDER` | `anthropic` | `toto radio` | Radio falls back to Ollama if set to `ollama` |
| `TOTO_RADIO_MODEL` | `claude-sonnet-4-6` | `toto radio` | Overrides model for radio chat only; no effect on council/p10 |
| `OLLAMA_HOST` | `http://localhost:11434` | `toto radio` (Ollama path) | Radio Ollama fallback fails to connect |

**Signal index limits** — these are hard-coded in the MCP server and affect `toto search` and dashboard load behavior:

| Limit | Value | Enforced by |
|-------|-------|-------------|
| `MAX_RECORDS` | 500 | Signal index — loads at most 500 records per request |
| `MAX_RECORD_BYTES` | 10,240 | Signal index — records larger than 10 KB are silently skipped |
| `MAX_PLAN_FILES` | 500 | `GET /vault/reversed` — scans at most 500 P10 plan files |

---

## Persona Swap

To switch the active persona, replace the `## ROLE` section in `CLAUDE.md`. The file is a live symlink to the repo — every change takes effect on the next Claude Code session.

    $EDITOR ~/toto-wolff/CLAUDE.md

Replace everything under `## ROLE` with the new persona definition. Every other section stays untouched.

**Expected diff for a clean role swap:**

    -## ROLE
    -
    -You are **Toto Wolff** — engineering practice lead...
    -[old persona text]
    +## ROLE
    +
    +You are **[New Persona Name]** — [role definition]
    +[new persona text]

Only the `## ROLE` section changes. Zero other lines.

**To use a preset persona:**

    ./setup --role devops        # devops, r-and-d, data, engineering

Presets live in `setup.d/roles/` — one file per role name. Each file contains a complete `## ROLE` replacement block. The flag reads the matching file and splices it into `CLAUDE.md` before symlinking.

**To revert to the default:**

    ls ~/.claude/CLAUDE.md.bak-*    # setup keeps the last 5 backups
    cp ~/.claude/CLAUDE.md.bak-YYYYMMDD-HHMMSS ~/.claude/CLAUDE.md

Or re-run `./setup` — it restores the default `CLAUDE.md` before symlinking.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `setup` exits with code 2 | bash < 3.2 or git not found | Install the missing tool; re-run `./setup` |
| `setup` exits with code 3 | Vault path does not exist or is not writable | `mkdir -p ~/.toto/vault && chmod u+w ~/.toto/vault`; or set `TOTO_VAULT_PATH` to a valid path |
| `setup` exits with code 4 | Symlink conflict — `~/.claude/CLAUDE.md` is a regular file, not a symlink | Back up the existing file; run `./setup --force` to overwrite |
| `setup` exits with code 5 | Permission denied on vault directory | `chmod u+w "$HOME/.toto/vault"` |
| `/council` or `/p10` fails with "credentials not set" | Neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN`+`ANTHROPIC_BASE_URL` is set | Set one option per the Auth section; verify with `toto doctor` |
| `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` | pnpm version mismatch — pnpm 10's `onlyBuiltDependencies` removed in 11.5.1 | Run `npm i -g pnpm@11.5.1`; then `pnpm install` |
| MCP server starts but `/council` in Claude Code does not use it | MCP server not registered in `~/.claude.json` | Run `toto init`; verify the entry exists under `mcpServers["toto-wolff"]` |
| `toto dashboard` shows "server unreachable" | MCP server not running | `pnpm -C packages/mcp-server start` in a separate terminal; or check `TOTO_MCP_PORT` matches |
| `toto backfill` writes 0 signals | `ADR/` or `P10-Plans/` directories are empty or vault path is wrong | Confirm `TOTO_VAULT_PATH` is set correctly; confirm at least one `.md` file exists in `ADR/` or `P10-Plans/`; run `toto doctor` to check vault path |
| Council records appear in vault but are not committed to git | Vault directory has no `.git` | VaultService detects this and skips the commit (write still succeeds). Run `git init ~/.toto/vault` if you want git history |

---

## Bus-Factor Test

A new team member runs this checklist solo. Estimated time: 30 minutes.

- [ ] Read this runbook top to bottom
- [ ] All prerequisites verified (`bash`, `git`, `node`, `pnpm`, `claude` — each exits 0)
- [ ] Auth set: `toto doctor` reports credentials as valid
- [ ] `./setup` completes with "Toto ready." output
- [ ] Vault directories created: `ls ~/.toto/vault/P10-Plans` and `ls ~/.toto/vault/Council/Congressional-Records` both succeed
- [ ] Symlink confirmed: `readlink ~/.claude/CLAUDE.md` points to this repo's `CLAUDE.md`
- [ ] `pnpm install && pnpm -r build` exits 0
- [ ] `toto init` exits 0; `toto doctor` reports MCP server registered
- [ ] `toto backfill` runs without error (0 signals written is acceptable on a fresh install)
- [ ] `/council` session fires in Claude Code; Congressional Record appears in vault
- [ ] `/p10` session fires in Claude Code; plan file appears in vault
- [ ] `pnpm -C packages/mcp-server start` starts without error
- [ ] `./scripts/demo.sh` completes the governance cycle end-to-end
- [ ] `toto dashboard` opens the dashboard in the browser
