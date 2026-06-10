# Toto Wolff

<img width="1200" height="800" alt="image" src="https://github.com/user-attachments/assets/b5172e7d-86f6-4fd7-8d91-36f8cebf413b" />

A strangler fig for your engineering practice.

In plain terms: it makes Claude Code stop and think before it writes code — deliberate, plan, then execute — instead of letting AI run unchecked.

It installs a seam — `~/.claude/CLAUDE.md` — that intercepts every Claude Code session and routes it through a governed cycle: deliberate with `/council`, plan safely with `/p10`, execute with Karpathy discipline. The old way is raw, ungoverned AI usage. The seam replaces it incrementally, without downtime.

The `.NET migration skill` is included because it's the same pattern at the code level: gradual controller replacement, feature flag routing, behavioral parity, zero downtime.

```bash
./setup
```

**Full install guide:** [runbook.md](runbook.md)

## How it works

`./setup` symlinks this repo's `CLAUDE.md` to `~/.claude/CLAUDE.md`. Claude Code reads that file at the start of every session. From that point, every session runs through the protocol — no other changes to your machine.

The MCP server already exists (`packages/mcp-server`) and exposes the same cycle as four tools (`council_run`, `p10_plan`, `vault_write`, `vault_search`). Today the default install is the symlink above; v2 flips the default to the server, so the seam is enforced by infrastructure instead of relying on the model reading a file. Same governance, harder to bypass.

### Try the cycle on stage

With auth set (see [Authentication](#authentication)), start the server and run the included client in a second terminal:

```bash
pnpm -C packages/mcp-server start   # terminal 1: server on 127.0.0.1:3099
./scripts/demo.sh                   # terminal 2: drives council_run + p10_plan
```

`demo.sh` prints each ruling and points at the vault artifacts it wrote. A `blocked` p10 result comes back as HTTP 200 with `status: blocked` — that is governance working, not a server error.

## What you get

- `/council` — tiered deliberation (Haiku scouts → Sonnet analysis → Opus ruling). Every architectural decision gets a Congressional Record written to your Obsidian vault.
- `/p10` — NASA Power of 10 pre-execution planning. Opus must approve before any code is touched. Blockers halt execution.
- Karpathy execution discipline — think before coding, surgical changes only, verify against stated goals.
- `/strangler-pattern-guide` — step-by-step .NET Framework → Minimal API migration with MediatR, feature flag routing, and TDD behavioral parity checks.
- Four personas (`engineering`, `devops`, `r-and-d`, `data`) — swap with `./setup --role <name>`.

## Prerequisites

- Claude Code CLI + gstack ([install gstack](https://garryslist.org) if missing)
- Obsidian vault at `~/Documents/Obsidian Vault` (if yours is elsewhere: `TOTO_VAULT_PATH=/your/path ./setup`)
- macOS or Linux, bash ≥ 3.2, git

## Authentication

`/council`, `/p10`, and the MCP server tools call the Anthropic API (only these — the plain symlink install needs no key). Set up **one** of these, not both:

- **Option A —** `ANTHROPIC_API_KEY` alone: a personal Anthropic API key (the common case).
- **Option B —** `ANTHROPIC_AUTH_TOKEN` *and* `ANTHROPIC_BASE_URL` together: a bearer token routed through a proxy (e.g. a Manifest account, no personal key required).

If you set a personal key alongside the token pair, the key wins and the proxy is ignored. If neither is set, council and p10 fail fast with a clear error instead of running silently. Claude Code reads these from your environment at session start.
