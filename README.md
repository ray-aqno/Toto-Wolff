# Toto Wolff

<img width="1200" height="800" alt="image" src="https://github.com/user-attachments/assets/b5172e7d-86f6-4fd7-8d91-36f8cebf413b" />

A strangler fig for your engineering practice.

Makes Claude Code deliberate before it executes: every session routes through `/council` (deliberate) → `/p10` (plan safely) → Karpathy discipline (execute). One symlink install. No changes to your existing workflow until you're ready.

---

## Quick Start

Paste this into any Claude Code session:

```
Set up Toto Wolff for me.

1. Ask me: where did you clone the repo? Save that path as REPO.
2. Ask me: where is your Obsidian vault? (default: ~/Documents/Obsidian Vault). Save that path as VAULT.
3. Run the preflight: TOTO_VAULT_PATH=VAULT REPO/scripts/bootstrap-env.sh — substitute the actual paths from steps 1 and 2.
   If it fails, surface each error and the remediation one-liner, then wait for me to fix it before continuing.
4. Run setup: cd to REPO, then run TOTO_VAULT_PATH=VAULT ./setup (omit the env var if VAULT is the default).
5. Verify: readlink ~/.claude/CLAUDE.md should point to REPO/CLAUDE.md.
6. Once preflight and setup both pass, run: /council this: "What is the highest-risk technical decision our team is about to make?"

After everything is confirmed, explain what changes about how you will work with me from this point forward.
```

Step 6 fires your first council session — the record lands in your Obsidian vault and the protocol is live.

Or run manually:

```bash
git clone <repo-url> ~/toto-wolff
cd ~/toto-wolff
./setup
# Vault elsewhere? TOTO_VAULT_PATH=/your/vault/path ./setup
```

**Full install guide and troubleshooting:** [runbook.md](runbook.md)

---

## What changes after setup

| Before | After |
|--------|-------|
| Claude writes code immediately on request | `/p10` drafts a plan first; Opus must approve before any file is touched |
| No record of why architectural decisions were made | `/council` writes a Congressional Record to your Obsidian vault after every deliberation |
| AI usage is ungoverned and hard to audit | Karpathy rules enforce: think first, surgical changes only, verify against stated goals |
| Switching AI behavior requires editing prompts | Swap the entire persona with `./setup --role <name>` — one command, git-tracked |

---

## What you get

- `/council` — tiered deliberation: Haiku scouts → Sonnet analysis → Opus ruling. Every architectural decision gets a record in your vault.
- `/p10` — NASA Power of 10 pre-execution planning. Opus must approve before any code is touched. Blockers halt execution and escalate back to `/council`.
- **Karpathy execution discipline** — think before coding, surgical changes only, verify against stated goals.
- `/strangler-pattern-guide` — step-by-step .NET Framework → Minimal API migration with MediatR, feature flag routing, and TDD behavioral parity checks.
- **Four personas** (`engineering`, `devops`, `r-and-d`, `data`) — swap with `./setup --role <name>`.

---

## Prerequisites

- Claude Code CLI (authenticated — `claude --version` exits 0)
- Obsidian vault (default path: `~/Documents/Obsidian Vault`)
- macOS or Linux, bash ≥ 3.2, git
- gstack (optional) — provides commodity skills (`/ship`, `/review`, `/browse`); `/council` and `/p10` are this repo's own skills and run without it. setup notes if gstack is absent but completes.

---

## Authentication

`/council`, `/p10`, and the MCP server tools call the Anthropic API. The plain symlink install needs no key. Set **one** of these:

- **Option A** — `ANTHROPIC_API_KEY`: a personal Anthropic API key.
- **Option B** — `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` together: a bearer token through a proxy (e.g. Manifest). Do not set both — if a personal key is present, it wins.

If neither is set, `/council` and `/p10` fail fast with a clear error.

---

## MCP Server (optional, v2 default)

The MCP server exposes the same cycle as four tools (`council_run`, `p10_plan`, `vault_write`, `vault_search`). Today the default install is the symlink; v2 flips the default to the server so governance is enforced by infrastructure rather than by the model reading a file.

To try it now:

```bash
pnpm -C packages/mcp-server start   # terminal 1 — server on 127.0.0.1:3099
./scripts/demo.sh                   # terminal 2 — drives council_run + p10_plan
```

A `blocked` p10 result returns HTTP 200 with `status: blocked` — that is governance working, not an error.

---

## Live Dashboard

The dashboard shows recent council sessions, P10 plans, and blocked items from your Obsidian vault.

```bash
pnpm -C packages/mcp-server start   # start the MCP server (port 3099 default)
toto dashboard                       # open http://127.0.0.1:3099/dashboard in your browser
```

Override the port:

```bash
TOTO_MCP_PORT=4000 node packages/mcp-server/dist/index.js
TOTO_MCP_PORT=4000 toto dashboard
```

The dashboard page connects over SSE (`/dashboard/events`) for live stats updates every 15 seconds. To inspect the raw stream:

```bash
curl -N http://127.0.0.1:3099/dashboard/events
```

To fetch a council or P10 record directly:

```bash
# council record
curl "http://127.0.0.1:3099/dashboard/record?type=council&file=2026-06-22-session.md"

# p10 record
curl "http://127.0.0.1:3099/dashboard/record?type=p10&file=2026-06-22-dashboard-interactive-v0.2.0.md"
```

The server binds loopback only (`127.0.0.1`) — no LAN exposure.
