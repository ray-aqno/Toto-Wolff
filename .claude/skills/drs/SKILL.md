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

DRS evaluates every Write, Edit, NotebookEdit, and Bash tool call against 5 boundary rules before the call executes. If a rule fires, the tool call is blocked before any file is touched. The block is logged to the vault.

DRS does NOT evaluate Read, Glob, Grep, or any read-only tool. Only destructive/mutating tools are checked.

---

## The 5 rules

### Rule 1 — Frozen path

**Condition:** The write target matches any path listed in `.toto/freeze.json`.

**Action:** HALT. The path is frozen. Unfreezing requires `/council` or an explicit `toto unfreeze` command.

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

To bypass a DRS block, include this phrase in your message before the tool call:

```
override drs: [reason]
```

The override is logged to the DRS vault record. The reason is mandatory. A blank reason is not accepted. The override does not suppress the vault write — it adds an `override: true` field and the reason text.

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

The hook script reads the tool call from stdin as JSON. Exit 0 = allow. Exit 1 = block.

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
- Evaluates rules 1–5 in order
- If any rule fires: writes a DRS vault record, prints the block reason to stderr, exits 1
- If no rule fires: exits 0 (allow)

Rules 1 and 5 are fully implementable in shell (file existence check + grep). Rules 2, 3, and 4 require the config files to be present — if the config is absent, those rules do not fire. This ensures DRS works on fresh installs without configuration.
