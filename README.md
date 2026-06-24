# toto-wolff

Persistent AI governance for Claude Code. Every architectural decision gets a deliberation record. Every code change gets a pre-execution safety plan. Within the `/p10` workflow, nothing executes without Opus signing off.

Claude Code sessions are ephemeral. Council rulings disappear when the tab closes. P10 plans are files no one revisits. Engineers on the same team start from zero on every session — no shared memory of what was decided, why, or what went wrong last time. toto-wolff closes that loop: a TypeScript MCP server that routes deliberation through a three-tier model chain, writes every ruling to a local vault, and gates execution behind a deterministic confidence check grounded in what your team has already decided.

---

## What you get

- A **Congressional Record `.md`** in `~/.toto/vault/Council/Congressional-Records/` after every `/council` session — Haiku scouts, Sonnet analysis, Opus ruling, all recorded
- A **P10 plan `.md`** in `~/.toto/vault/P10-Plans/` before any code is touched — Opus must set `status: approved` or execution halts
- A **Cabinet record `.md`** in `~/.toto/vault/Cabinet/` after every release gate — three Opus seats (Garry Tan, Feynman, Karpathy — model personas), any veto blocks the ship
- A **signal store** in `~/.toto/vault/Signals/` that feeds past rulings forward into future plans — `toto backfill` seeds it from existing ADRs and P10 plans
- A **live dashboard** at `http://127.0.0.1:3099/dashboard` showing session counts, blocked plans, and vault records with SSE-backed live stats
- A **`toto` CLI** with 9 commands for vault search, audit, doctor, and interactive pit-wall chat via `toto radio`

---

## Prerequisites

- macOS or Linux, bash ≥ 3.2, git
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`claude --version` exits 0)
- Node.js 24+ and pnpm 11.5.1+ (`node --version`, `pnpm --version`)
- One of:
  - `ANTHROPIC_API_KEY` — personal Anthropic API key
  - `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` — enterprise proxy (e.g. Manifest)

gstack is optional. `/council` and `/p10` are repo-native skills and run without it.

---

## Install

```bash
git clone https://github.com/ray-aqno/toto-wolff ~/toto-wolff
cd ~/toto-wolff
pnpm install
pnpm -r build
./setup
```

Vault elsewhere:

```bash
TOTO_VAULT_PATH=/your/vault/path ./setup
```

Expected output:

```
Toto ready.
  vault:        ~/.toto/vault
  council logs: ~/.toto/vault/Council/Congressional-Records
  p10 plans:    ~/.toto/vault/P10-Plans
  CLAUDE.md:    /Users/<you>/.claude/CLAUDE.md -> ~/toto-wolff/CLAUDE.md

Run /council to test.
```

Seed the signal store so governance sessions start with context from your existing ADRs and P10 plans:

```bash
toto backfill
```

---

## First run

Open any Claude Code session and run:

```
/council this: what is the highest-risk technical decision our team is about to make?
```

When it completes, check your vault:

```bash
ls ~/.toto/vault/Council/Congressional-Records/
# YYYY-MM-DD-*.md  ← your first Congressional Record
```

That file is the proof. The governance loop is live.

---

## Commands

| Command | What it does | Example |
|---------|-------------|---------|
| `toto init` | Wire vault dirs and `~/.claude/CLAUDE.md` symlink | `toto init` |
| `toto doctor` | Check prerequisites, credentials, and vault health | `toto doctor` |
| `toto whoami` | Print identity from vault config | `toto whoami` |
| `toto search` | Full-text search across vault records | `toto search "auth boundary"` |
| `toto last` | Show the most recent council or P10 record | `toto last council` |
| `toto audit` | Vault integrity check — counts, stale entries, contradictions | `toto audit` |
| `toto dashboard` | Open `http://127.0.0.1:3099/dashboard` in browser | `toto dashboard` |
| `toto radio` | Interactive pit-wall chat; streams via the Anthropic API | `toto radio` |
| `toto backfill` | Ingest ADR/ and P10-Plans/ into Signals/ — idempotent, safe to re-run | `toto backfill` |

---

## MCP tools

Register the MCP server in `~/.claude.json` under `mcpServers["toto-wolff"]`. Then these tools are available in every Claude Code session:

| Tool | What it does |
|------|-------------|
| `vault_write` | Write a record (council session, P10 plan, signal) to the vault |
| `vault_search` | Full-text search across vault records |
| `council_run` | Run a multi-agent council session; writes Congressional Record to vault |
| `p10_plan` | Generate a P10 pre-execution plan; Opus arbiter gates approval |
| `dashboard_status` | Return vault stats (`councilCount`, `p10Count`, `blockedCount`) |
| `score_confidence` | Deterministic HIGH/LOW confidence tier for plan provenance — not model reasoning |

Start the server:

```bash
node packages/mcp-server/dist/index.js   # binds 127.0.0.1:3099
```

Override the port:

```bash
TOTO_MCP_PORT=4000 node packages/mcp-server/dist/index.js
```

---

## Signal loop

`toto backfill` reads your `ADR/` and `P10-Plans/` vault directories and writes typed `Signals/` records with `pattern` and `topic_tags` fields. Before generating a new P10 plan, the strangler-pattern skill calls `score_confidence` — a deterministic function (not a model call) that checks whether ≥ 2 distinct in-date records exist for the same pattern with a topic Jaccard similarity ≥ 50%. **HIGH confidence** proceeds automatically with a `confidence_tier: HIGH` stamp. **LOW confidence** halts, surfaces the disqualifiers, and requests a `/council` session before retrying. Run `toto backfill` once after setup and again after each batch of new rulings. Without it, every session starts cold.

---

## How it works

Five packages in a pnpm workspace. `packages/core` owns shared types, error classes, and the three services: `VaultService` (reads/writes flat Markdown + YAML frontmatter files, no database), `CouncilService` (Haiku scouts → Sonnet analysis → Opus ruling via `createAnthropicClient()`), and `P10Service` (Skeptic scout + Minimalist scout → Sonnet draft → Opus arbiter with an 8-rule gate). `packages/mcp-server` exposes 6 MCP tools and 8 HTTP endpoints on `127.0.0.1:3099` — loopback only, no LAN exposure. `packages/cli` is the `toto` binary. `packages/dashboard` generates server-rendered HTML; no React, no build step at runtime. `packages/personas` holds role stubs (engineering, devops, r-and-d, data) for `./setup --role` persona swaps.

The vault is the source of truth: a directory of `.md` files with YAML frontmatter, committed to git after every write. Every ruling is grep-able, diffable, and editable in any text editor — no running process required to read it.

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `TOTO_VAULT_PATH` | `~/.toto/vault` | Vault directory path |
| `TOTO_MCP_PORT` | `3099` | MCP server port |
| `ANTHROPIC_API_KEY` | — | Personal Anthropic API key (Option A) |
| `ANTHROPIC_AUTH_TOKEN` | — | Enterprise/proxy bearer token (Option B) |
| `ANTHROPIC_BASE_URL` | — | Required with `ANTHROPIC_AUTH_TOKEN` (Option B) |

Option A and Option B are mutually exclusive. If both are set, `ANTHROPIC_API_KEY` wins.

Set `TOTO_VAULT_PATH` in `.toto/config.yml` to share across teams — the file is gitignored by default.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run the full gate before opening a PR:

```bash
pnpm typecheck && pnpm test && pnpm -r build
```

We run `/council` for architectural decisions and include the Congressional Record link in the PR description.

---

## License

MIT — Copyright (c) 2026 Rayyan Aquino
