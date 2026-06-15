# Toto Wolff Runbook

A new team member should be able to complete this solo in 30 minutes. Demo runs directly via ./scripts/demo.sh — no recording required.

---

## Prerequisites

- macOS or Linux
- bash ≥ 3.2 (macOS default is fine)
- git
- Claude Code CLI installed and authenticated (`claude --version` exits 0)
- gstack (optional) — provides commodity skills (`/ship`, `/review`, `/browse`) and an optional `/freeze` integration. `/council` and `/p10` are this repo's own skills (in `~/.claude/skills/`) and run without gstack. Install via `/gstack-upgrade` in Claude Code if you want the commodity skills.
- Obsidian vault at `~/Documents/Obsidian Vault` — if your vault is elsewhere, update `VAULT_PATH` in both `CLAUDE.md` and `setup` before running
- **Anthropic API credentials** (required only for `/council`, `/p10`, and MCP server tools — the plain symlink install needs no key):
  - Option A: `ANTHROPIC_API_KEY` environment variable (personal Anthropic key)
  - Option B: `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` together (enterprise/proxy, e.g. Manifest)
  - If neither is set, council and p10 fail fast with a clear error

---

## Install

```bash
git clone <toto-wolff-repo-url>
cd toto-wolff
chmod +x setup
./setup
# If your Obsidian vault is not at ~/Documents/Obsidian Vault:
# TOTO_VAULT_PATH=/your/vault/path ./setup
```

Expected output:
```
Toto ready.
  vault:        ~/Documents/Obsidian Vault
  council logs: ~/Documents/Obsidian Vault/Council/Congressional-Records
  p10 plans:    ~/Documents/Obsidian Vault/P10-Plans
  CLAUDE.md:    /Users/<you>/.claude/CLAUDE.md -> <repo>/CLAUDE.md

Run /council to test.
```

If setup exits with an error code, see **Troubleshooting** below.

---

## First Run Verification

> **Note:** `/council` and `/p10` need only Claude Code + your vault — gstack is not required. setup only notes if gstack is absent; it does not block on it.

**Step 1 — Test council:**

Open a new Claude Code session (any repo) and run:
```
/council this: what lap strategy should we run at Monaco?
```

Expected: council session runs, Congressional Record appears at:
```
~/Documents/Obsidian Vault/Council/Congressional-Records/YYYY-MM-DD-*.md
```

**Step 2 — Test p10:**

```
/p10 add a hello world endpoint to a sample Express app
```

Expected: p10 plan draft appears at:
```
~/Documents/Obsidian Vault/P10-Plans/YYYY-MM-DD-*.md
```

Both vault writes confirm the closed training loop is running.

**Step 3 — Test MCP server + demo script (requires Anthropic credentials):**

In one terminal, start the MCP server:
```bash
pnpm -C packages/mcp-server start
```

In a second terminal, run the demo client:
```bash
./scripts/demo.sh
```

Expected: the script runs a `council_run` call and a `p10_plan` call, prints each ruling, and points at the vault artifacts it wrote. A `blocked` p10 result is printed as `status: blocked` — that is governance working, not an error.

---

## Strangler Fig Swap Procedure

To switch the active persona, edit the `## ROLE` section in `CLAUDE.md`:

```bash
# Open the seam
$EDITOR /path/to/toto-wolff/CLAUDE.md
```

Replace the content under `## ROLE` with the new persona definition. Every other section stays untouched. The change takes effect on the next Claude Code session — no restart, no reinstall.

To revert to the default gstack persona: restore the original `## ROLE` block or repoint `~/.claude/CLAUDE.md` to the original file (backed up at `~/.claude/CLAUDE.md.bak-*` by setup).

Expected diff for a role swap: one section replaced, zero other lines changed.

---

## SPOF Notes

Three single points of failure to know before rollout:

**1. Vault path is hardcoded.**
For a different vault path: `TOTO_VAULT_PATH=/your/path ./setup` handles the script. But `CLAUDE.md` still has the vault path hardcoded in three places (council config, p10 config, vault section). If the vault moves permanently, update all three in `CLAUDE.md` in a single PR alongside the env var. Updating any one without the others breaks council or p10 vault writes silently.

**2. CLAUDE.md symlink = live attack surface once a remote exists.**
`~/.claude/CLAUDE.md` is a live symlink to the repo. A `git pull` that modifies `CLAUDE.md` takes effect on the next Claude Code session with no confirmation prompt. Before adding a remote: restrict push access to the repo (branch protection, required reviews). Never `git pull --no-verify` or skip hooks on this repo.

**3. gstack upgrades may change commodity-skill invocation syntax.**
After running `/gstack-upgrade`, re-test the gstack commodity skills (`/ship`, `/review`) end-to-end. `/council` and `/p10` are repo-native skills and are unaffected by gstack upgrades.

**4. Obsidian is invisible to the team by design.**
Vault writes succeed even when Obsidian is closed — they write directly to the filesystem. To verify a write happened, check the filesystem path, not the Obsidian UI. The UI is a viewer; the vault is just a directory of Markdown files.

---

## Bus-Factor Test

A new team member can run this checklist solo:

- [ ] Read this runbook top to bottom
- [ ] Run `./setup` and see "Toto ready." output
- [ ] Confirm vault dirs were created: `ls "$HOME/Documents/Obsidian Vault/P10-Plans"` and `Council/Congressional-Records`
- [ ] Confirm symlink: `readlink ~/.claude/CLAUDE.md` points to this repo's CLAUDE.md
- [ ] Trigger one `/council` session, confirm Congressional Record appears in vault
- [ ] Review `docs/linear-setup.md` and confirm Linear permissions status
- [ ] Estimated time: 30 minutes
- [ ] Run ./scripts/demo.sh and confirm governance cycle completes end-to-end

---

## Troubleshooting

| Exit code | Meaning | Fix |
|---|---|---|
| 2 | Missing prereq (bash version or git) | Install the missing tool; re-run `./setup` |
| 3 | Vault not found or not writable | Confirm Obsidian vault path; update `VAULT_PATH` in `CLAUDE.md` and `setup` |
| 4 | Symlink conflict or assertion failure | See error message; re-run with `./setup --force` to override an existing symlink |
| 5 | Permission denied on vault | `chmod u+w "$HOME/Documents/Obsidian Vault"` |

If `setup` exits with "setup exited at line N with code C", the line number points directly to the failing assertion.
