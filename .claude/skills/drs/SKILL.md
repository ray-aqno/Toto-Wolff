---
name: drs
description: Drag Reduction System — ambient PreToolUse tripwire that fires deterministically on boundary violations. Not a slash command. Hooks into every tool call automatically.
version: 1.0.0
---

# DRS — Drag Reduction System

**This is not a slash command.** DRS fires automatically on every tool call via a PreToolUse hook wired in `.claude/settings.json`. It does not require invocation.

**F1 rationale:** In Formula 1, DRS (Drag Reduction System) opens automatically when the delta threshold is met — the driver does not activate it manually, and it is not always open. It has a deterministic condition and a deterministic effect. Same mechanic here: DRS fires when a tool call crosses a defined boundary. No model reasoning. No judgment call. The rule runs; the rule decides.

---

## What DRS does

DRS runs as a PreToolUse hook registered for Write, Edit, NotebookEdit, and Bash. Write, Edit, and NotebookEdit calls are checked against Rules 1 to 4; Bash commands are checked against Rules 3 and 5 only. If a rule fires, the tool call is blocked before any file is touched and the block is logged to the vault. Allowed calls leave no record.

DRS does NOT evaluate Read, Glob, Grep, or any read-only tool. Of the mutating tools, only the four above are checked; others (for example MCP file writers) never reach the hook.

---

## The 5 rules

### Rule 1 — Frozen path

**Condition:** The write target matches any path listed in `.toto/freeze.json`.

**Action:** HALT. The path is frozen. There is no `toto unfreeze` command. A frozen path changes only through an audited route, with authority:

- **Council ruling, then the unfreeze cycle.** Get a `/council` ruling. Then, on the machine that holds the real `.toto/config.yml` (it is git-ignored, and the tracked `.toto/config.yml.example` has no `drs:` block, so generating from the example would write an empty freeze list), remove the path from `drs.freeze_paths`, run `pnpm generate:drs-config`, make the change, and restore the path and regenerate in the same commit so the tracked `.toto/freeze.json` ends unchanged (unless the ruling unfreezes the path for good). Cite the ruling in the commit or PR.
- **Audited override.** Set `DRS_OVERRIDE_REASON` (see Override below). The write is allowed and an `OVERRIDDEN` record goes to the vault.

An Arbiter-approved P10 plan alone is enough only for the narrow removal-only class in council ruling `2026-09-20-types-ts-freeze-amendment`, and that delegation stays inert until a merge-base CI check for frozen paths exists.

Whichever route you take, write an audit note to the vault `DRS/` log naming the file, the authority, and the route; the unfreeze cycle leaves no DRS record of its own.

Do not reach a frozen file with a Bash command (`cp`, `mv`, a redirect). The hook does not evaluate Rule 1 for Bash commands, so nothing is blocked or recorded, and the ruling above names that route a process defect.

**Known gaps (tracked for the v1.5.1 patch):** the hook is registered for Write, Edit, NotebookEdit, and Bash only, so other tools (for example MCP file writers) never reach it; a missing or unparseable `.toto/freeze.json` currently allows the write instead of blocking it; and the freeze list's source, `.toto/config.yml`, is git-ignored, so an unfreeze step never appears in a commit or PR, and `pnpm generate:drs-config` without a `drs:` block writes empty lists.

**Rationale:** Frozen modules are locked by design decision. Writing to them without deliberation re-opens a closed question.

---

### Rule 2 — Out-of-scope write

**Condition:** The write target is outside the declared project scope. Project scope is defined in `.toto/drs-config.json` under the `allowed_paths` field. If `allowed_paths` is absent, this rule does not fire.

**Action:** HALT. The write target is outside declared scope.

**Rationale:** Agents that drift outside project scope create unexpected side effects — touching config files in parent directories, writing to sibling projects, or modifying system-level files.

---

### Rule 3 — Permission/auth/role/tenant surface

**Condition:** The write target filename matches any of: `*permission*`, `*auth*`, `*role*`, `*tenant*`, `*policy*`, `*rbac*`, `*acl*`, `*iam*` (case-insensitive). OR the Bash command contains phrases like `chmod`, `chown`, `usermod`, `groupadd`, `setcap`.

**Action:** HALT. This write touches an authorization or permission surface.

**Rationale:** Permission and auth surfaces have blast radii that far exceed their file size. A one-line change to an auth config can silently open all tenants to each other or lock everyone out.

---

### Rule 4 — Cross-tenant write

**Condition:** The write target path contains a tenant identifier (a UUID, slug, or name found in `.toto/drs-config.json` under `tenant_namespaces`) that does not match the `current_tenant` field.

**Action:** HALT. This write targets a different tenant's namespace.

**Rationale:** Multi-tenant systems have hard isolation boundaries. Writing to another tenant's namespace is never incidental.

---

### Rule 5 — Destructive shell pattern

**Condition:** The Bash command contains any of the following patterns (case-sensitive):
- `rm -rf`
- `DROP TABLE`
- `DELETE FROM` (without a `WHERE` clause — DRS checks for the absence of `WHERE` on the same line)
- Custom halt patterns defined in `.toto/drs-config.json` under `halt_patterns`

Unless the command includes the literal string `--force-confirmed` anywhere in it.

**Action:** HALT. The command contains a destructive pattern without explicit force confirmation.

**Rationale:** `rm -rf` and raw SQL deletions are the two most common causes of unrecoverable data loss in agentic contexts. The `--force-confirmed` flag is a deliberate friction point — the engineer must type it explicitly, which prevents accidental invocation.

---

## Override

There are two distinct override mechanisms, with different scopes. The TS/MCP override cannot bypass Rule 1 (frozen path) or Rule 5 (destructive pattern); the bash-hook override applies to any rule that hook evaluates, Rules 1 and 5 included. Rule 1's freeze list is a small, deliberately curated set that the TS/MCP override shouldn't defeat, and Rule 5 already has its own narrower `--force-confirmed` override on the command itself. The bash-hook override is the audited route to a frozen path (see Rule 1), because every honored use is recorded in the vault.

**TS/MCP path (`drs_check` tool):** pass `message_before: "override drs: <reason>"` as an argument to the `drs_check` tool call. This bypasses Rules 2/3/4 only (out-of-scope, auth-surface, cross-tenant). The reason is mandatory and is validated (non-empty after trimming, not a placeholder value) before being accepted. Every accepted override writes an audit record to the vault. The override does not suppress the vault write; it adds an `override: true` field and the reason text. If the record can't be written, the override is not honored.

**Bash-hook path (`drs-check.sh`):** set `DRS_OVERRIDE_REASON=<reason>` in the environment. This hook has no message field, so the phrase-in-your-message trigger above only exists on the TS/MCP path, not here. The bash path's override applies to any rule it evaluates (it doesn't distinguish Rule 1/5 the way the TS path does), and is subject to the same non-empty/non-placeholder validation. If the audit record can't be written, the override is not honored and the rule blocks (exit 2).

Use overrides for genuine exceptions. Do not use them to unblock yourself from rules you disagree with — use `/council` for that.

---

## Configuration

DRS reads two optional config files:

### `.toto/freeze.json`

```json
{
  "frozen": [
    "packages/core/src/types.ts",
    "packages/mcp-server/src/server.ts"
  ]
}
```

Paths are relative to the project root. Glob patterns are supported (e.g., `packages/core/**`).

### `.toto/drs-config.json`

```json
{
  "allowed_paths": ["packages/", "scripts/", ".claude/"],
  "tenant_namespaces": ["acme-corp", "northwind", "contoso"],
  "current_tenant": "acme-corp",
  "halt_patterns": ["TRUNCATE TABLE", "git push --force"]
}
```

All fields are optional. Missing fields disable the corresponding rule.

---

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

---

## Vault output

Every DRS block (and every override) is written to:

```
{VAULT_PATH}/DRS/YYYY-MM-DD-{slug}.md
```

Frontmatter:

```yaml
---
date: YYYY-MM-DD
rule_fired: 1 | 2 | 3 | 4 | 5
tool: Write | Edit | Bash | NotebookEdit
target: [file path or command excerpt]
verdict: BLOCKED | OVERRIDDEN
override: false | true
override_reason: [text or null]
---
```

DRS events accumulate in `DRS/` as a permanent audit log. They are grep-able and diffable. A pattern of overrides on the same rule indicates the rule needs refinement via `/council` — not silent exception accumulation.

---

## How this fits the toto-wolff stack

```
/council     → deliberate on what to build
/p10         → plan how to build it safely
/safety-car  → adversarial stress test of the approved plan
karpathy     → govern how each stage is executed
/drs         → ambient tripwire — fires automatically on boundary violations
/cabinet     → ratify the release
```

DRS is not a gate in the sequence — it runs continuously alongside execution. While karpathy governs the quality of each stage, DRS enforces the hard boundaries that karpathy does not: frozen paths, auth surfaces, cross-tenant writes, and destructive shell patterns.

DRS fires on tool calls, not on intent. It does not reason about whether the engineer means well. It evaluates the call against the rules and blocks or allows.

---

## Implementation

The actual rule evaluation runs in `.claude/skills/drs/bin/drs-check.sh`. That script:

- Reads the tool call from stdin as JSON
- Extracts `tool_name` and `tool_input` fields
- Evaluates the rules that apply to that tool (see What DRS does)
- If any rule fires: writes a DRS vault record, prints the block reason to stderr, exits 2
- If no rule fires: exits 0 (allow)

Rules 1 and 5 are fully implementable in shell (file existence check + grep). Rules 2, 3, and 4 require the config files to be present — if the config is absent, those rules do not fire. This ensures DRS works on fresh installs without configuration.
