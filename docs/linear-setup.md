# Linear Integration Setup

Required before the council + p10 demo can update Linear issues automatically.

---

## Org-Level Permissions Checklist

- [ ] Workspace admin grants the Claude Code Linear integration OAuth scope: `read:issues`, `write:issues`, `write:comments`
- [ ] Linear workspace has the MCP plugin enabled under workspace Settings → Integrations → Claude Code (or equivalent API token flow)
- [ ] Executing user's Linear account has **Member** role (not Guest) — Guests cannot create issues via API
- [ ] If using a service account token: confirm token has org-wide issue creation permission, not project-scoped only
- [ ] Document token rotation policy — Linear personal API tokens do not expire by default; verify whether org policy requires rotation (common: 90 days)

---

## Council Ruling → Linear Issue Field Mapping

When a council session completes, the Congressional Record frontmatter maps to Linear fields as follows:

| Council output field | Linear issue field | Notes |
|---|---|---|
| Decision title (`title` in Congressional Record) | Issue title | Truncate to 256 chars |
| Chairman ruling body | Issue description (markdown) | Full text |
| `tags` array from frontmatter | Issue labels | Labels must be pre-created in Linear before the demo |
| `gstack_phase` | Custom field "Phase" (if configured) | Optional |
| `status: approved / blocked` | Issue status → Backlog / Blocked | Map to your team's workflow states |
| `council_ref` | Parent issue or linked issue | If your workspace uses issue hierarchy |
| Date | Created-at (informational) | |

---

## Current Status

- [ ] Org-level permissions confirmed
- [ ] GitHub plugin org permissions confirmed (separate from Linear)
- [ ] Test run: trigger one council session, verify Linear issue created

**Resolve both before demo day.** A failed Linear write during the live demo is recoverable (vault still captures the ruling), but it undercuts the "end-to-end under 10 minutes" success criterion.
