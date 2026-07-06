# Linear Integration

toto-wolff syncs approved P10 plans into Linear issues via the `linear-sync` skill
(`.claude/skills/linear-sync/SKILL.md`). This uses Linear's own official hosted MCP
server — there is no custom Linear API client, no keytar-stored credential, and no
service-account token to provision. See [ADR-0009](../../../Obsidian%20Vault/ADR/adr-0009-use-linear-mcp-server-instead-of-custom-integration.md)
for why.

> **Superseded:** an earlier version of this doc described org-level OAuth scope
> grants, a service-account token, and automatic council-ruling-to-Linear field
> mapping. None of that was built. This doc reflects what actually shipped in v1.3.0.

---

## Setup (one-time, per developer)

1. Authorize the Linear connector: `claude mcp` (interactive session) or your
   claude.ai connector settings, under `plugin:engineering:linear`.
2. Confirm it's live — the skill's own Step 0 does this on every invocation, but you
   can check manually by asking Claude to call `get_user` against Linear.

That's it. No workspace-side setup, no label pre-creation, no custom fields, no token
rotation policy to write — Linear's hosted MCP server owns auth and rate limiting
entirely (see ADR-0009's consequences for the trade-off: toto-wolff has no fallback if
that server has an outage or changes its tool contract).

---

## Usage

```
/linear-sync <plan-path> --team <name> --project <name>
```

- `<plan-path>` — path to an **approved** P10 plan (vault frontmatter must have
  `status: approved`; anything else is refused).
- `--team` / `--project` — explicit Linear team and project. No fuzzy or semantic
  matching — you must know these, or the skill will ask.

The skill walks through pre-flight checks (connector live, plan approved, team/project
resolve to real entities, a backlog-type status exists for the team), classifies the
title as `STORY:` or `SPIKE:` based on whether the plan went through a P10 revision
cycle, synthesizes a bounded description (User Story + 3-bullet Overview, capped at 400
words, no fabricated content), and **shows you the full proposed issue before creating
it** — nothing gets written to Linear without your explicit go-ahead.

Full skill spec: `.claude/skills/linear-sync/SKILL.md`.
Full P10 plan and arbiter conditions: `P10-Plans/2026-07-06-toto-wolff-linear-sync-skill.md`.

---

## Recommended use cases

**Sync a plan once it's genuinely ready for team visibility, not the moment it's
approved.** The skill is human-invoked by design — nothing about P10 approval
triggers this automatically. Good moments to run it:

- A P10 plan just cleared arbitration and you want it trackable in the team's normal
  workflow (sprint planning, standup, whatever your team already uses Linear for) —
  not just sitting in the governance vault where only people who know to look will
  find it.
- You're handing execution off to someone else (or to a future session) and want a
  Linear issue as the durable "this is real, tracked work" marker, separate from the
  vault's plan-of-record.
- A plan required a revision cycle and you want that uncertainty visible to the team
  up front — the automatic `SPIKE:` prefix communicates "this needs investigation,"
  not "this is a known quantity," before anyone opens the ticket.

**Don't use it for:**

- Every P10 plan, reflexively. If a plan is small, self-contained, and you're
  executing it yourself in the next few minutes, a Linear issue just adds clutter to
  an already-busy Kanban with no one else needing to track it.
- Anything that needs stage-by-stage status movement as execution proceeds — that's
  explicitly out of scope for this skill (a deliberate non-goal, see the skill file).
  You'll move the issue's status yourself, or wait for a future skill that covers it.
- CI-triggered or otherwise headless sync. This skill assumes an interactive session
  with a human confirming the write. A non-interactive path is a real but distinct
  future decision — it needs its own MCP client and its own P10 plan, not a shortcut
  through this one.

---

## Known limitations (by design, not oversight)

- **No fuzzy team/project matching.** You must know the exact name. This is
  intentional — the team's Kanban is already busy enough that guessing which of 15+
  projects you meant is a bigger risk than the friction of typing it out.
- **No stage/status automation.** Creating the issue is the only write this skill
  performs. Moving it through Backlog → Todo → In Progress → Done is manual.
- **No labels, assignee, or delegate set on creation.** The `save_issue` parameter set
  is intentionally closed to title/description/team/project/state. Extending it
  requires a new P10 plan, not a quiet edit to the skill file.
- **Repeat-invocation friction for known team/project pairs.** Step 2 re-verifies
  team/project against Linear on every run, even if you already confirmed the same
  pair minutes ago in the same session. Tracked as `T-LINEAR-CACHE` in `TODOS.md`
  (P3, deferred until real usage shows this actually costs time).
