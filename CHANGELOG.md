# Changelog

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
