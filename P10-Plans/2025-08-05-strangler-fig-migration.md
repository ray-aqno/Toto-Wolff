---
status: approved
---

# P10 Plan — Strangler Fig Migration (Phases 1-6)

**Task:** Implement strangler fig migration phases 1-6 per STRANGLER_FIG_ANALYSIS.md to unify governance stack before RL feature

**Stage:** full
**Council ruling ref:** none (direct execution)
**Date:** 2025-08-05

---

## Pre-conditions

- [x] `STRANGLER_FIG_ANALYSIS.md` exists with complete inventory
- [x] Current architecture mapped: Core (Vault, Council, P10), CLI, MCP Server, Dashboard, Skills, Extensions
- [x] All 8 governance skills documented in `~/.agents/skills/toto-governance/`
- [x] MCP server exposes 6/11 governance tools
- [x] Two doc sources (AGENTS.md + CLAUDE.md) identified as drift risk
- [x] Node 24 + pnpm 11 available
- [ ] TypeScript strict mode clean on all packages

---

## P10 Analysis (All 10 Rules)

### Rule 1 — Control Flow: **SAFE**
- No recursion in service methods, CLI commands, MCP handlers
- All loops bounded (file scans, tool lists, config arrays)
- Async/await for I/O; no deep promise chains

### Rule 2 — Loop Bounds: **SAFE** (annotated)
| Location | Loop | Bound |
|---|---|---|
| `discoverAgents()` | fs.readdirSync | `.md` files ≤ 50 per dir |
| `loadExtensions()` | configured paths | ≤ 20 extensions |
| `vault.search()` | rg results | rg internal limit |
| MCP tool dispatch | TOOLS lookup | O(1) hash map |
| Skill routing | keyword match | ≤ 10 skills |

### Rule 3 — Memory: **SAFE**
- No unbounded collections — all capped by config constants
- Extension cache: `Map` with generation-based invalidation
- Session memory: pi-managed, not in-process
- File reads: streamed, not loaded fully (except small configs)

### Rule 4 — Function Size: **SAFE** (target ≤60 lines)
Planned splits for new services:
- `CabinetService.run()` → `assembleBrief()`, `conveneSeats()`, `synthesize()`, `writeRecord()`
- `SafetyCarService.run()` → `loadPlan()`, `adversarialReview()`, `emitReport()`
- `KarpathyService.check()` → `verifyStage()`, `assertInvariants()`, `reportViolations()`
- `DRSService.check()` → `rule1_frozen()`, `rule2_scope()`, `rule3_auth()`, `rule4_tenant()`, `rule5_destructive()`
- `SubagentService.list()` → `discoverAgents()`, `formatOutput()`

### Rule 5 — Assertions: **SAFE** (min 2/function)
Every new public method:
1. Input validation (types, ranges, non-empty)
2. Output validation (shape, non-null)
3. Invariant checks (e.g., `status ∈ {'approved','blocked','conditional'}`)

### Rule 6 — Scope: **SAFE**
- Config loaded once → immutable config objects
- Services stateless (vault passed in)
- No module-level mutable state
- Freeze registry: read-only at check time

### Rule 7 — Return Values: **SAFE**
- All async calls: try/catch → typed errors
- MCP handlers: validate input, catch → 400/500
- CLI commands: exit codes + stderr messages
- File writes: verify bytes written

### Rule 8 — Macros: **N/A** (TypeScript)
- No eval, Function(), dynamic require
- Constants via const + config

### Rule 9 — Pointers/References: **SAFE**
- Strict TypeScript, no `any`
- All service interfaces typed
- MCP tool schemas: Zod/TypeBox validated

### Rule 10 — Warnings: **CLEAN** (target)
- `tsc --strict --noEmit` clean
- ESLint zero warnings
- Prettier formatted

---

## Blocking Risks

| Risk | Rule | Resolution |
|---|---|---|
| Skill loading breaks on pi upgrade | 7 | Pin pi version in package.json; test after upgrades |
| DRS hook false positives blocking valid work | 5,7 | Start with Rules 1,5 only; add 2,3,4 after config exists |
| Config drift between AGENTS.md/CLAUDE.md/skills | 6,10 | Single source `.toto/config.yml` + generators |
| MCP stdio transport breaks on Node version change | 7 | Pin Node in `.nvmrc`; test on 20,22,24 |
| Session memory migration loses history | 3,7 | Write migration script; test on copy first |

**All blocking risks have mitigations — no hard blocks.**

---

## Implementation Stages

### Stage 1: Core Services (Phase 1) — 9 days
**Scope:** `packages/core/src/{CabinetService,SafetyCarService,KarpathyService,DRSService,SubagentService}.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`

**P10 Constraints:** Rules 1,2,4,5,6,7,9,10

**Deliverables per Service:**

#### CabinetService
```typescript
// Input: subject, version, evidence brief (from vault)
// Output: CabinetResult { ruling, seats: [{seat, verdict, reasoning, condition?}], blocking_defect? }
// Seats: GarryTan, Feynman, Karpathy (all Opus-level)
// Decision: any-seat veto = held
```

#### SafetyCarService
```typescript
// Input: P10 plan path (from vault)
// Output: SafetyCarReport { risks: [{category, severity, description, mitigation}], critical_count, verdict }
// Categories: runtime_failure, abuse_vector, blast_radius, wrong_assumption, partial_failure
```

#### KarpathyService
```typescript
// Input: P10 plan path, current stage, implementation diff
// Output: KarpathyCheck { stage, status: pass|fail, violations: [{rule, file, line, description}] }
// Checks: simplicity, surgical_changes, goal_driven, think_before_coding
```

#### DRSService
```typescript
// Input: tool_call {tool, target_path, command?}
// Output: DRSVerdict { allowed: boolean, rule_fired?, override_reason? }
// 5 Rules: frozen_path, out_of_scope, auth_surface, cross_tenant, destructive_pattern
```

#### SubagentService
```typescript
// Input: scope (user|project|both)
// Output: AgentConfig[] { name, description, tools, model, thinking, systemPrompt, source }
// Reads: ~/.pi/agent/agents/ + .pi/agents/
```

**Assertions per Service:**
- Constructor: vault path exists, config valid
- Main method: input non-empty, output schema valid
- All errors typed (CabinetError, SafetyCarError, etc.)

**Loop Bounds:** File scans ≤ 50, LLM calls ≤ 7 per run

**Function Split:** Each service ≤ 5 methods, each ≤ 50 lines

---

### Stage 2: MCP Tools for New Services (Phase 2) — 4.5 days
**Scope:** `packages/mcp-server/src/handlers/{cabinet_run,safety_car_run,karpathy_check,drs_check,subagent_list}.ts`, `packages/mcp-server/src/index.ts`

**P10 Constraints:** Rules 1,2,4,5,7,10

**New MCP Tools:**
| Tool | Input | Output |
|---|---|---|
| `cabinet_run` | `{subject, version, evidence_brief?}` | `CabinetResult` |
| `safety_car_run` | `{plan_path}` | `SafetyCarReport` |
| `karpathy_check` | `{plan_path, stage, diff?}` | `KarpathyCheck` |
| `drs_check` | `{tool, target_path, command?}` | `DRSVerdict` |
| `subagent_list` | `{scope?}` | `AgentConfig[]` |

**Dashboard Updates:**
- `dashboard_html.ts`: Add Cabinet, SafetyCar, Karpathy, DRS sections
- `dashboard_status.ts`: Add counts for new record types
- `sse_handler.ts`: Emit events for new governance types

**Record Handler:**
- `record_handler.ts`: Support `type=cabinet|safety-car|karpathy|drs|subagent`

**Assertions:**
- Input validation via TypeBox schemas
- Output matches service return types
- Error handling: 400 for bad input, 500 for service errors

---

### Stage 3: Thin Skills (Phase 3) — 5.5 days
**Scope:** `~/.agents/skills/toto-governance/{council,p10,cabinet,safety-car,karpathy,drs,vault,subagent}/`

**P10 Constraints:** Rules 1,4,6,10 (skills must be thin adapters < 200 lines)

**Pattern for each skill:**
```typescript
// Skill entry point: routes to MCP tool
// No LLM prompts, no logic, no vault access
// Only: parameter validation → MCP call → format output
```

**Council skill:** Call `council_run` MCP tool
**P10 skill:** Call `p10_plan` MCP tool
**Cabinet skill:** Call `cabinet_run` MCP tool
**Safety-car skill:** Call `safety_car_run` MCP tool
**Karpathy skill:** Call `karpathy_check` MCP tool
**DRS skill:** Config management + hook installation helper
**Vault skill:** Call `vault_search`/`vault_write` MCP tools
**Subagent skill:** Call `subagent_list` MCP tool

**Assertions:**
- Each skill file < 200 lines
- No direct core imports (only MCP)
- Parameter validation before MCP call

---

### Stage 4: DRS Hook Implementation (Phase 4) — 2.5 days
**Scope:** `~/.agents/skills/toto-governance/drs/bin/drs-check.ts`, pi hook config generator

**P10 Constraints:** Rules 1,2,3,4,5,7

**DRS Check Script (Node/TypeScript):**
```typescript
// Reads stdin JSON: {tool_name, tool_input}
// Evaluates 5 rules in order
// Rule 1: target_path matches .toto/freeze.json globs
// Rule 2: target_path outside .toto/drs-config.json allowed_paths
// Rule 3: target_path matches *auth*|*permission*|*role*|*tenant*|*policy*|*rbac*|*acl*|*iam*
// Rule 4: target_path contains tenant ≠ current_tenant
// Rule 5: Bash command contains rm -rf | DROP TABLE | DELETE FROM (no WHERE) | custom halt_patterns
// Override: "override drs: [reason]" in message before tool call
// Output: exit 0 (allow) or exit 1 + stderr (block)
// Logs to session memory: ~/.pi/sessions/<id>/governance/drs/YYYY-MM-DD-{slug}.md
```

**Pi Hook Config Generator:**
```bash
# Outputs .pi/hooks.json for pi's PreToolUse hook system
```

**Assertions:**
- Script exits 0/1 correctly
- All 5 rules tested with fixtures
- Override mechanism works
- Session memory write succeeds

---

### Stage 5: Config/Docs Unification (Phase 5) — 3 days
**Scope:** `.toto/config.yml` (schema), `scripts/generate-agents-md.ts`, `scripts/generate-claude-md.ts`, `packages/core/src/config.ts`

**P10 Constraints:** Rules 1,4,6,8,10

**Config Schema (`.toto/config.yml`):**
```yaml
vault_path: ~/.toto/vault
freeze:
  - packages/core/src/types.ts
  - packages/mcp-server/src/index.ts
drs:
  allowed_paths: [packages/, scripts/, .agents/]
  tenant_namespaces: [acme-corp, northwind]
  current_tenant: acme-corp
  halt_patterns: [TRUNCATE TABLE, git push --force]
rl:
  # ... from RL P10
```

**Generators:**
- `generate-agents-md.ts`: Reads config + skill metadata → writes AGENTS.md
- `generate-claude-md.ts`: Same source → writes CLAUDE.md
- Both run in `pnpm build` pipeline

**Assertions:**
- Config loads and validates
- Generators produce identical governance sections
- No manual edits needed to AGENTS.md/CLAUDE.md

---

### Stage 6: Hardening & Ship (Phase 6) — 5 days
**Scope:** Tests, CI, cabinet review

**Tests:**
| Package | Tests |
|---|---|
| `@toto-wolff/core` | Unit: all 5 new services + config; Integration: full governance loop |
| `@toto-wolff/cli` | Command dispatch, MCP delegation |
| `@toto-wolff/mcp-server` | All 11 tools, SSE, dashboard HTML, record handler |
| `@toto-wolff/dashboard` | Terminal render, HTML render, data parsing |

**Pipeline:**
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**Cabinet Review:**
- Convene cabinet for v1.4.0
- Subject: "Strangler fig migration complete — unified governance stack"
- Evidence: test results, demo of full loop

**Assertions:**
- All tests pass on Node 24
- TypeScript strict clean
- Zero ESLint warnings
- Cabinet approves release

---

## Invariants (Cross-Stage)

1. **Single source of truth** — All governance logic in `@toto-wolff/core`
2. **MCP as primary interface** — CLI, Skills, HTTP all delegate to MCP tools
3. **Skills are thin adapters** — < 200 lines, no logic, route to MCP
4. **Config is unified** — `.toto/config.yml` → generates AGENTS.md/CLAUDE.md
5. **DRS is ambient** — Hook fires on every mutating tool call, not a slash command
6. **Session memory is vault** — No Obsidian dependency

---

## Blocked Paths (Ruled Out)

| Approach | Reason |
|---|---|
| Keep logic in skills | Duplication; drift; not testable |
| CLI calls core directly | Bypasses MCP; no HTTP access; no dashboard |
| Obsidian vault | Not portable; no session memory; pi-native is better |
| DRS as slash command | Must be ambient; fires on every tool call |
| Separate config per doc | Drift guaranteed; single source only |

---

## Verification Checklist (Per Stage)

| Stage | Verification |
|---|---|
| 1 | All 5 services construct, types export, unit tests pass |
| 2 | All 5 MCP tools respond, dashboard shows new types, SSE emits |
| 3 | All 8 skills < 200 lines, route to MCP, no core imports |
| 4 | DRS script blocks 5 rules, override works, logs to session memory |
| 5 | Config validates, generators produce identical AGENTS.md/CLAUDE.md |
| 6 | Full pipeline clean, cabinet approves v1.4.0 |

---

## Cross-Rule Notes

- **Rule 2 + 3:** File scan bounds (50) limit both loops and memory
- **Rule 4 + 5:** Small functions with assertions → verifiable
- **Rule 6 + 7:** Immutable config → no surprise state; errors typed
- **Rule 10:** `max-lines-per-function: 60` enforced on all new code