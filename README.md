# Toto Wolff

A Claude Code persona stack for Navistone engineers. Installs the council + p10 + Karpathy engineering cycle globally on your machine.

```bash
./setup
```

Then open Claude Code and run `/llm-council` to test.

**Full install guide:** [runbook.md](runbook.md)

## What it does

- Wires `/llm-council` (deliberation), `/p10` (safety planning), and Karpathy execution discipline into every Claude Code session
- All council rulings and p10 plans write automatically to your Obsidian vault
- Includes the Navistone strangler pattern skill for .NET controller migrations
- One `## ROLE` section swap in `CLAUDE.md` is all it takes to switch personas

## Prerequisites

- Claude Code CLI + gstack ([install gstack](https://garryslist.org) if missing)
- Obsidian vault at `~/Documents/Obsidian Vault` (if yours is elsewhere: `TOTO_VAULT_PATH=/your/path ./setup`)
- macOS or Linux, bash ≥ 3.2, git
