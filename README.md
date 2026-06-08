# Toto Wolff

<img width="1200" height="800" alt="image" src="https://github.com/user-attachments/assets/b5172e7d-86f6-4fd7-8d91-36f8cebf413b" />

A strangler fig for your engineering practice.

It installs a seam — `~/.claude/CLAUDE.md` — that intercepts every Claude Code session and routes it through a governed cycle: deliberate with `/council`, plan safely with `/p10`, execute with Karpathy discipline. The legacy system is raw, ungoverned AI usage. The seam is what replaces it, incrementally, without downtime.

The `.NET migration skill` is included because it's the same pattern at the code level: gradual controller replacement, feature flag routing, behavioral parity, zero downtime.

```bash
./setup
```

**Full install guide:** [runbook.md](runbook.md)

## How it works

`./setup` symlinks this repo's `CLAUDE.md` to `~/.claude/CLAUDE.md`. Claude Code reads that file at the start of every session. From that point, every session runs through the protocol — no other changes to your machine.

v2 replaces the symlink with an MCP server. Same seam, enforced at the infrastructure level instead of relying on the model reading a file.

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
