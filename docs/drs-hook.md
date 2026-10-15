# DRS bash hook (repository only)

This text moved here from `.claude/skills/drs/SKILL.md` in 2.0.0. It describes the repository's own PreToolUse hook, `.claude/skills/drs/bin/drs-check.sh`, which `.claude/settings.json` registers for this repository. The Claude Code plugin does not ship or register this hook; in the plugin, DRS runs through the `drs_check` tool.

## Rule 1 routes for a frozen path

- **Council ruling, then the unfreeze cycle.** Get a `/council` ruling. Then, on the machine that holds the real `.toto/config.yml` (it is git-ignored, and the tracked `.toto/config.yml.example` has no `drs:` block, so generating from the example would write an empty freeze list), remove the path from `drs.freeze_paths`, run `pnpm generate:drs-config`, make the change, and restore the path and regenerate in the same commit so the tracked `.toto/freeze.json` ends unchanged (unless the ruling unfreezes the path for good). Cite the ruling in the commit or PR.
- **Audited override.** Set `DRS_OVERRIDE_REASON` (see Override below). The write is allowed and an `OVERRIDDEN` record goes to the vault.

## Override

There are two distinct override mechanisms, with different scopes. The TS/MCP override cannot bypass Rule 1 (frozen path) or Rule 5 (destructive pattern); the bash-hook override applies to any rule that hook evaluates, Rules 1 and 5 included. Rule 1's freeze list is a small, deliberately curated set that the TS/MCP override shouldn't defeat, and Rule 5 already has its own narrower `--force-confirmed` override on the command itself. The bash-hook override is the audited route to a frozen path (see Rule 1), because every honored use is recorded in the vault.

**Bash-hook path (`drs-check.sh`):** set `DRS_OVERRIDE_REASON=<reason>` in the environment. This hook has no message field, so the phrase-in-your-message trigger above only exists on the TS/MCP path, not here. The bash path's override applies to any rule it evaluates (it doesn't distinguish Rule 1/5 the way the TS path does), and is subject to the same non-empty/non-placeholder validation. If the audit record can't be written, the override is not honored and the rule blocks (exit 2).

## Hook wiring

DRS runs as a PreToolUse hook. Wire it in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/skills/drs/bin/drs-check.sh"
          }
        ]
      }
    ]
  }
}
```

The hook script reads the tool call from stdin as JSON. Exit 0 = allow. Exit 2 = block.

## Implementation

The actual rule evaluation runs in `.claude/skills/drs/bin/drs-check.sh`. That script:

- Reads the tool call from stdin as JSON
- Extracts `tool_name` and `tool_input` fields
- Evaluates the rules that apply to that tool (see What DRS does)
- If any rule fires: writes a DRS vault record, prints the block reason to stderr, exits 2
- If no rule fires: exits 0 (allow)

Rules 1 and 5 are fully implementable in shell (file existence check + grep). Rules 2, 3, and 4 require the config files to be present: if the config is absent, those rules do not fire. This ensures DRS works on fresh installs without configuration.
