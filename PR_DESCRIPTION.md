## Summary

**Strangler Fig Migration Complete — Unified Governance Stack**

This PR completes the 6-stage strangler fig migration, unifying the governance stack from legacy skills to core services + MCP tools. All 6 stages approved and verified.

---

## Changes

### Stage 1: Core Services (5 new)
- `CabinetService` — Release gate with 3 equal Opus seats (Garry Tan, Feynman, Karpathy), any-seat veto
- `SafetyCarService` — Adversarial P10 review across 5 risk categories (runtime_failure, abuse_vector, blast_radius, wrong_assumption, partial_failure)
- `KarpathyService` — Execution verification (4 rules: simplicity, surgical, goal_driven, think_before_coding)
- `DRSService` — Deterministic boundary enforcement (5 rules: frozen_path, out_of_scope, auth_surface, cross_tenant, destructive_pattern)
- `SubagentService` — Agent discovery from `~/.pi/agent/agents/` + `.pi/agents/`

### Stage 2: MCP Tools + Dashboard (5 new tools)
| Tool | Service | Description |
|------|---------|-------------|
| `cabinet_run` | CabinetService | Release gate (3 Opus seats) |
| `safety_car_run` | SafetyCarService | Adversarial P10 review |
| `karpathy_check` | KarpathyService | Execution verification (4 rules) |
| `drs_check` | DRSService | Deterministic boundary enforcement |
| `subagent_list` | SubagentService | List registered subagents |

**Dashboard:** 7 sections with drill-down panels (Council, P10, Cabinet, SafetyCar, Karpathy, DRS, Subagent)

### Stage 3: Thin Skills (5 new)
- `cabinet`, `safety-car`, `karpathy`, `drs`, `subagent` — all < 200 lines, route to MCP tools, no core imports

### Stage 4: DRS PreToolUse Hook
- Installed at `.pi/hooks.json`
- Fires on every Write/Edit/NotebookEdit/Bash call
- 5 deterministic rules with override support (`"override drs: [reason]"`)

### Stage 5: Config/Docs Unification
- Single source: `.toto/config.yml`
- Generates: `AGENTS.md`, `CLAUDE.md`, `.toto/drs-config.json`, `.toto/freeze.json`
- Generators: `scripts/generate-{agents-md,claude-md,drs-config}.ts`
- Command: `pnpm generate:all`

### Stage 6: Hardening
- Cabinet Record: `Cabinet/2025-08-05-strangler-fig-migration-complete.md` (unanimous ship)
- All builds pass (`tsc --strict` clean)
- 105/105 tests pass

---

## Verification

```bash
pnpm build    # ✅ All 6 packages compile clean
pnpm test     # ✅ 17 test files, 105 tests pass
```

---

## Cabinet Review

| Seat | Verdict |
|------|---------|
| Garry Tan (Product) | ship |
| Richard Feynman (Correctness) | ship |
| Andrej Karpathy (Execution) | ship |

**Convergence:** Full — unanimous ship, zero tension.

---

## Release

**Version:** v1.4.1 (bumped from 1.3.0)

After merge, tag on merge commit:
```bash
git tag v1.4.1 <merge-commit-sha>
git push origin v1.4.1
```