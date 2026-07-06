# linear-sync

Syncs an approved toto-wolff P10 plan into a Linear issue, using an already-authenticated
Linear MCP connector. No custom Linear client, no new package dependency — this skill only
orchestrates existing MCP tool calls (`get_user`, `list_teams`, `list_projects`,
`list_issue_statuses`, `save_issue`).

**Trigger:** `/linear-sync <plan-path> --team <name> --project <name>`. Human-invoked only.
Never runs automatically, never as a side effect of a `/p10` approval.

**Assumption (explicit, not implicit):** this skill depends on an authenticated Linear MCP
connector being present in the invoking session. It does not manage, initiate, or guarantee
that connection — it only verifies it at the start of each run (Step 0 below).

---

## Step 0 — Runtime connector pre-flight (every invocation, before all else)

Attempt a lightweight Linear MCP call (`get_user` with `query: "me"`, or `list_teams`).

- If it errors, is unavailable, or Linear MCP tools are not present in the current
  session's tool list: refuse immediately. Tell the user to authorize the Linear
  connector via `claude mcp` or their connector settings, and stop.
- No retry. No fallback path. Do not proceed to any step below until this check passes.

## Step 1 — Required inputs

- Plan file path (required).
- Team name or ID (required).
- Project name or ID (required).

If team or project is omitted, ask the user for it. **Never** guess or fuzzy/semantic-match
a team or project from a partial name — this workspace has 15+ projects across multiple
teams and an already-cluttered backlog; a wrong match creates real clutter in a real
workspace.

## Step 2 — Pre-flight checks (in order, after Step 0)

1. **Plan status.** Read the plan file. Confirm its frontmatter has `status: approved`.
   If not, refuse and explain why — do not proceed with a draft, blocked, or
   revision-required plan.
2. **Team and project resolution.** Call `list_teams` and `list_projects`. Confirm the
   given team/project names or IDs resolve to an exact match. If either does not match,
   refuse and explain — do not let Linear's own API error on `save_issue` be the first
   signal of a bad name.
3. **Backlog-status resolution.** Call `list_issue_statuses` for the resolved team.
   Find the entry whose `type` field indicates a backlog-type status — **do not** match
   on the literal string `"Backlog"`, since workspace status names vary. Use that
   status's ID as the default `state` param for `save_issue`. If no backlog-type status
   exists for the team, refuse and explain.

## Step 3 — Title classification (deterministic, not judgment)

Search the plan file's body text for the regex `Revision:\s*\d+`.

- **Match found** (the plan went through a revision cycle — investigatory/uncertain):
  prefix the title with `"SPIKE: "`.
- **No match** (clean single-pass approval): prefix the title with `"STORY: "`.

Full title: `"{PREFIX}{task title}"`, where the task title comes from the plan's H1
heading or its `task:` frontmatter field.

This is a mechanical string check. Do not use judgment or "does this feel exploratory"
reasoning here — the regex is the entire rule.

## Step 4 — Description synthesis (fixed template only)

Build the description in exactly this shape — no free-form matching to any other
issue's style, no additional sections:

```
**User Story:** *As a [role], I want [capability], so that [outcome]*

## Overview

- [one-line stage summary]
- [the plan's single biggest named risk, from its Risk Surface / Consequences section]
- Full plan: [vault path to the P10 plan file]
```

Rules:
- The User Story line is synthesized **only** from the plan's "Why this approach" section.
- The Overview has **exactly three** sub-bullets — no more, no fewer.
- Hard cap: **under 400 words total**, title + description combined.
- **Do not invent, infer, or add any fact not present in the plan file's own text.** If
  a required section (Why this approach, Risk Surface, etc.) is missing from the plan,
  say so in the Step 5 confirmation preview and ask the user how to proceed — never
  fabricate content to fill the template.

## Step 5 — Confirm-before-write (mandatory, unconditional, no bypass)

> **This is the first real, hard-to-fully-undo write this skill can make.** Everything
> before this point is read-only. Do not skip this step. Do not default through it
> silently under any condition, including reruns.

Render the full proposed issue back to the user:

- Title
- Full synthesized description
- Resolved team
- Resolved project
- Resolved status (the backlog-type status from Step 2.3, shown as the **default**)

Require explicit user go-ahead before calling `save_issue`.

- If the user wants a different initial status (e.g. `Todo` instead of `Backlog`), use
  their choice for **this run only** — the default resolution logic in Step 2.3 is
  unchanged for future runs.
- If Step 4 surfaced a missing-section fallback, this is where the user decides how to
  proceed — the skill never guesses on their behalf.

## Step 6 — Create the issue

Call `save_issue` with exactly these parameters:

- `title` (Step 3)
- `description` (Step 4)
- `team` (resolved, Step 2.2)
- `project` (resolved, Step 2.2)
- `state` (resolved default or user override, Step 5)

**Closed parameter set.** Do not pass `labels`, `assignee`, `delegate`, `cycle`, or
`milestone` — none of these are in scope for this skill. Adding any of them requires a
new P10 plan.

## Step 7 — Report the result

- **Success:** surface the created issue's ID and URL to the user.
- **Error:** show the raw error message and stop. No retry. No silent continue.

---

## Non-goals (binding — do not extend this skill to cover these without a new P10 plan)

- No semantic or fuzzy matching for team or project selection.
- No automatic sync triggered by a `/p10` approval — this skill is always human-invoked.
- No automatic stage/status movement after the initial sync (a separate future skill).
- No delegation to Linear's native "agent" assignee concept.
- No non-interactive/headless/CI-triggered sync path. If ever needed, that requires a
  real MCP client built inside `packages/mcp-server` (which already depends on
  `@modelcontextprotocol/sdk`), gated by its own future P10 plan — not silently added
  here.

## Reference

Full P10 plan and arbiter conditions:
`P10-Plans/2026-07-06-toto-wolff-linear-sync-skill.md` in the governance vault.
ADR-0009 (`ADR/adr-0009-use-linear-mcp-server-instead-of-custom-integration.md`)
established the "use Linear's MCP server, no custom client" decision this skill
implements.
