# toto-wolff

<img width="1280" height="699" alt="tyk2eiagrizd1" src="https://github.com/user-attachments/assets/a130343c-26a3-4f88-a366-ac5671557f03" />


Persistent AI governance for Claude Code. Every architectural decision is deliberated by a chain of AI models and written to a local file. Every code change is planned against a safety checklist before execution starts. Nothing disappears when the session closes.

Claude Code sessions are stateless by default — decisions made in one session are gone in the next. toto-wolff fixes that: an MCP server that runs multi-model deliberation workflows, writes every ruling to plain Markdown files in a local vault, and lets future sessions pick up where the last one left off.

---

## Quickstart

```bash
git clone https://github.com/ray-aqno/Toto-Wolff ~/toto-wolff
cd ~/toto-wolff
pnpm install && pnpm -r build
./setup
```

Open any Claude Code session and run your first deliberation:

```
/council this: what is the highest-risk technical decision our team is about to make?
```

After it completes, check your vault:

```bash
ls ~/.toto/vault/Council/Congressional-Records/
# YYYY-MM-DD-*.md  ← your first ruling on file
```

That file is permanent. It survives the session, survives restarts, and is grep-able from the terminal. The governance loop is live.

**Want to point the vault at an existing Obsidian vault?** Every ruling, plan, and release record is plain Markdown — it will appear in your graph and search automatically:

```bash
TOTO_VAULT_PATH="/path/to/your/obsidian/vault" ./setup
```

**Already installed and want to update?** Run `toto upgrade` — it pulls the latest release, rebuilds all packages, and re-runs setup non-destructively. Vault, credentials, and config are untouched.

**New to the terminology?** See [Concepts](#concepts) below for plain-English definitions of everything you'll encounter.

---

## Concepts

If you're new to this project, these are the terms you'll see everywhere.

**P10 — Power of 10 rules**
NASA JPL's ten rules for safety-critical software: bounded loops, no recursion, assertions on every function, zero warnings. toto-wolff applies them as a pre-execution planning contract. Before any code is written, a P10 plan is generated, analyzed against all ten rules, and sent to Opus for approval. If Opus sets `status: blocked`, execution halts until the block is resolved. Think of it as a mandatory flight check before the runway.

**Council — tiered deliberation**
A three-tier AI chain for engineering decisions. Claude Haiku runs as fast "scouts" — two parallel agents that stress-test assumptions and find edge cases cheaply. Claude Sonnet runs as "analysts" — structured risk and implementation analysis. Claude Opus acts as the chairman, reading only a compressed brief from the scouts and analysts, then issuing a ruling, remanding for more information, or issuing a conditional decision. The output is a **Congressional Record** — a Markdown file with YAML frontmatter written to your vault after every session. It is permanent, grep-able, and version-controlled.

**Cabinet — release gate**
Three independent Opus agents, each shaped by a different persona, that review a release together and must unanimously agree to ship. Any one seat can veto. The personas are:

- **Garry Tan** — product and market truth. Asks: is this worth shipping? Does the version number match what was actually built? Would a real user care?
- **Richard Feynman** — first-principles correctness. Asks: where are we fooling ourselves? What is claimed but unproven? What does reality say if we actually test it?
- **Andrej Karpathy** — engineering execution. Asks: does it actually work? Is it the simplest thing that does? What breaks at 3am? Is the foundation sound?

These are not aesthetic choices. Each persona enforces a different failure mode: Garry Tan catches scope creep and version dishonesty; Feynman catches correctness theater; Karpathy catches engineering debt dressed up as a release. The Cabinet is only convened at tagged releases — not on every commit.

**The Senate — stacking council and cabinet**
When a decision is large enough to warrant both deliberation and a release gate, you run them in sequence: `/council` to reach a ruling on the architectural question, then `/cabinet` to ratify the release against that ruling. Internally this is called "the Senate" — the full legislative stack. You'd reach for it when: tagging a major version, reversing a prior council ruling, or shipping something where a single failure mode (product, correctness, or engineering) would be genuinely costly. For routine work, `/council` alone or `/cabinet` alone is enough.

**Signal store — grounding future plans in past decisions**
Every council ruling and P10 plan is a signal: evidence that your team has already reasoned about a particular pattern (architectural decision records, approved plans). The signal store is a directory of typed Markdown files in `~/.toto/vault/Signals/`. Before generating a new P10 plan, `score_confidence` — a deterministic function, not a model call — checks whether at least two distinct in-date signals exist for the same pattern with enough topic overlap (Jaccard similarity ≥ 50%). **HIGH confidence** means the plan proceeds with a `confidence_tier: HIGH` stamp. **LOW confidence** halts and surfaces exactly what is missing, prompting a `/council` session to generate the missing evidence. `toto backfill` seeds the signal store from your existing ADRs (Architectural Decision Records — Markdown files documenting why a technical decision was made) and P10 plans.

**Vault**
A local directory of plain Markdown files with YAML frontmatter. No database, no running process required to read it. Every council ruling, P10 plan, Cabinet record, and signal lives here. The vault is the source of truth: grep-able, diffable, and editable in any text editor.

The format is natively compatible with [Obsidian](https://obsidian.md). If you already use Obsidian, point `TOTO_VAULT_PATH` at your existing vault and every ruling, plan, and Cabinet record will appear in your graph, backlinks, and search automatically alongside your other notes. This is the recommended setup — the governance record becomes part of your second brain rather than an isolated directory.

Default location when `TOTO_VAULT_PATH` is not set: `~/.toto/vault` (a standalone directory, no Obsidian required).

**Karpathy guidelines — execution contract**
Four rules, derived from Andrej Karpathy's public writing on software craftsmanship, that govern how each P10 stage is implemented. P10 gates the structure; Karpathy governs the execution. The rules are: (1) think before coding — state assumptions, surface ambiguity, don't charge forward on a wrong interpretation; (2) simplicity first — minimum code that solves the stage, nothing speculative; (3) surgical changes — touch only what the stage authorizes, mention but don't fix things outside scope; (4) goal-driven execution — map each stage to verifiable success criteria and loop until met, not until it "looks right." Available as `/karpathy` in any Claude Code session.

**Safety Car — adversarial stress test**
Fires between P10 approval and execution. A single Sonnet agent with one job: find failure modes in the approved plan before any file is touched. It does not re-evaluate architecture — that is `/council`'s job. It asks: how does this plan fail in production, how could it be abused, what blast radius does a partial failure carry, and what assumptions could be wrong? Verdict is CLEAR (proceed) or DEPLOYED (halt — one or more HIGH or CRITICAL risks with no accepted mitigation). Available as `/safety-car` in any Claude Code session.

**DRS — Drag Reduction System**
A deterministic PreToolUse hook, not a slash command. Wired via `.claude/settings.json`, it evaluates every Write, Edit, NotebookEdit, and Bash call against 5 boundary rules before the call executes: (1) write target matches a frozen path in `.toto/freeze.json`; (2) write target is outside declared project scope; (3) write target filename matches an auth/permission surface pattern; (4) write target is in another tenant's namespace; (5) Bash command contains `rm -rf`, `DROP TABLE`, or `DELETE FROM` without a WHERE clause. No model reasoning — deterministic rule evaluation only. Override requires an explicit reason in `DRS_OVERRIDE_REASON`. Every block and every override is logged to the vault.

**gstack**
An optional Claude Code skill package built by Garry Tan that provides the `/council`, `/p10`, and `/cabinet` slash commands as interactive workflows. toto-wolff works without it — the MCP server tools (`council_run`, `p10_plan`) cover the same ground programmatically. If you use gstack, the slash commands trigger the full multi-agent chains and write records to your vault automatically. gstack is a Claude Code skill, not a CLI binary — there's nothing to add to your shell `$PATH`. Run `./setup --print-gstack-install-prompt` for a ready-to-paste Claude Code prompt that installs or upgrades it.

---

## What you get

- A **Congressional Record `.md`** in `~/.toto/vault/Council/Congressional-Records/` after every `/council` session — Haiku scouts, Sonnet analysis, Opus ruling, all recorded
- A **P10 plan `.md`** in `~/.toto/vault/P10-Plans/` before any code is touched — Opus must set `status: approved` or execution halts
- A **Safety Car record `.md`** in `~/.toto/vault/Safety-Car/` after every `/safety-car` run — adversarial risk table, CLEAR/DEPLOYED verdict
- A **Cabinet record `.md`** in `~/.toto/vault/Cabinet/` after every release gate — three Opus seats (Garry Tan, Feynman, Karpathy), any veto blocks the ship
- A **DRS event log** in `~/.toto/vault/DRS/` whenever the boundary hook fires — every block and every override is recorded with the rule, target, and reason
- A **signal store** in `~/.toto/vault/Signals/` that feeds past rulings forward into future plans — `toto backfill` seeds it from existing ADRs and P10 plans
- A **live dashboard** at `http://127.0.0.1:3099/dashboard` showing session counts, blocked plans, and vault records with SSE-backed live stats
- A **`toto` CLI** with 10 commands for vault search, audit, doctor, interactive pit-wall chat via `toto radio`, and in-place upgrades via `toto upgrade`

---

## Prerequisites

- macOS or Linux, bash ≥ 3.2, git
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`claude --version` exits 0)
- Node.js 24+ and pnpm 11.5.1+ (`node --version`, `pnpm --version`)
- One of:
  - `ANTHROPIC_API_KEY` — personal Anthropic API key
  - `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` — enterprise proxy (e.g. Manifest)

> **API cost:** Each full `/council` session runs 6 Anthropic API calls (2 Haiku scouts + 2 Sonnet analysts + 1 Sonnet brief + 1 Opus ruling). Estimated $0.10–$0.30 per session at standard rates.

---

## When to use each skill

| Situation | Skill | Why |
|-----------|-------|-----|
| Non-obvious architectural decision | `/council` | 6-call chain forces multiple perspectives; Opus rules on the brief, not the noise |
| About to write code from a plan | `/p10` | Opus must approve a P10-compliant plan before any file is touched |
| P10 plan approved — adversarial stress test | `/safety-car` | Single Sonnet agent with one job: find failure modes in the approved plan before any file is touched |
| Implementing an approved P10 stage | `/karpathy` | Four execution invariants: think first, simplest solution, surgical scope, verify before moving on |
| Agent crosses a boundary during execution | `/drs` (auto-fires) | Deterministic PreToolUse hook — frozen paths, auth surfaces, destructive shell patterns; no model reasoning |
| Tagging a release | `/cabinet` | Three independent Opus seats; any veto holds the release |
| Major version, reversed ruling, or high-stakes ship | `/council` then `/cabinet` (the Senate) | Full deliberation + release gate in sequence |
| Ongoing session context | `toto backfill` first | Seeds the signal store so confidence scoring has evidence to work with |

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
| `toto upgrade` | Pull latest release from GitHub, rebuild, re-run setup — vault and credentials untouched | `toto upgrade` |

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

The server exposes these read-only HTTP endpoints (loopback only — never accessible from outside your machine):

| Endpoint | What it does |
|----------|-------------|
| `GET /dashboard` | Rendered HTML dashboard |
| `GET /dashboard/events` | SSE stream of live vault stats |
| `GET /dashboard/record` | Serve a raw vault record file (`?type=council&file=...`) |
| `GET /vault/signal` | Query the signal store |
| `GET /vault/reversed` | Reverse-chronological vault records |

---

## Signal loop

`toto backfill` reads your `ADR/` and `P10-Plans/` vault directories and writes typed `Signals/` records with `pattern` and `topic_tags` fields. Before generating a new P10 plan, `score_confidence` checks whether ≥ 2 distinct in-date records exist for the same pattern with a topic Jaccard similarity ≥ 50%. **HIGH confidence** proceeds automatically with a `confidence_tier: HIGH` stamp. **LOW confidence** halts, surfaces the disqualifiers, and requests a `/council` session before retrying. Run `toto backfill` once after setup and again after each batch of new rulings. Without it, every session starts cold.

---

## How it works

Five packages in a pnpm workspace. `packages/core` owns shared types, error classes, and the three services: `VaultService` (reads/writes flat Markdown + YAML frontmatter files, no database), `CouncilService` (Haiku scouts → Sonnet analysis → Opus ruling via `createAnthropicClient()`), and `P10Service` (Skeptic scout + Minimalist scout → Sonnet draft → Opus arbiter with an 8-rule gate). `packages/mcp-server` exposes 6 MCP tools and 8 HTTP endpoints on `127.0.0.1:3099` — loopback only, no LAN exposure. `packages/cli` is the `toto` binary (10 commands including `toto upgrade` for in-place updates). `packages/dashboard` generates server-rendered HTML; no React, no build step at runtime. `packages/personas` holds the engineering persona for `./setup --role engineering` persona swaps.

The skill stack in `.claude/skills/` governs the full engineering workflow: `/council` for deliberation, `/p10` for pre-execution planning, `/safety-car` for adversarial stress testing of approved plans (CLEAR/DEPLOYED verdicts, single Sonnet agent), `/karpathy` for execution-time quality rules, and `/drs` as a deterministic PreToolUse hook that fires automatically on every Write/Edit/Bash call to enforce frozen paths, auth surfaces, and destructive shell pattern rules. `/cabinet` closes the loop at tagged releases.

The vault is the source of truth: a directory of `.md` files with YAML frontmatter, committed to git after every write. Every ruling is grep-able, diffable, and editable in any text editor — no running process required to read it.

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `TOTO_VAULT_PATH` | `~/.toto/vault` | Vault directory path — set this to your Obsidian vault for best results |
| `TOTO_MCP_PORT` | `3099` | MCP server port |
| `ANTHROPIC_API_KEY` | — | Personal Anthropic API key (Option A) |
| `ANTHROPIC_AUTH_TOKEN` | — | Enterprise/proxy bearer token (Option B) |
| `ANTHROPIC_BASE_URL` | — | Required with `ANTHROPIC_AUTH_TOKEN` (Option B) |

Option A and Option B are mutually exclusive. If both are set, `ANTHROPIC_API_KEY` wins.

Set `TOTO_VAULT_PATH` to your Obsidian vault path for the recommended setup, or leave it unset to use `~/.toto/vault` as a standalone directory. Shared team vaults (multi-user, git-backed) are a v1.1.0 roadmap item — the vault is single-user local storage in v1.0.0.

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
