# Toto-Wolff Governance Stack — Strangler Fig Analysis & Execution Plan

**Date:** 2025-08-05
**Status:** Analysis complete — ready for P10 planning

---

## Current Architecture (What Exists)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GOVERNANCE LAYERS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │   AGENTS.md │  │  CLAUDE.md  │  │  .agents/   │  │  .claude/ │  │
│  │  (pi role)  │  │ (claude role)│ │  skills     │  │  skills   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
│         │                │                │                │        │
│         └────────────────┼────────────────┼────────────────┘        │
│                          ▼                                            │
│              ┌───────────────────────┐                               │
│              │   GOVERNANCE SKILLS   │  (meta, council, p10,        │
│              │   ~/.agents/skills/   │   cabinet, safety-car,       │
│              │   toto-governance/    │   karpathy, drs, vault,      │
│              │                       │   subagent)                  │
│              └───────────┬───────────┘                               │
│                          │                                            │
│         ┌────────────────┼────────────────┐                           │
│         ▼                ▼                ▼                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │   CORE      │  │   CLI       │  │  MCP SERVER │                   │
│  │   @toto-    │  │   @toto-    │  │  toto-wolff │                   │
│  │   wolff/core│  │   wolff/cli │  │  (HTTP+stdio)│                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                   │
│         │                │                │                            │
│         └────────────────┼────────────────┘                            │
│                          ▼                                            │
│              ┌───────────────────────┐                               │
│              │   VAULT (session mem) │                               │
│              │   ~/.pi/sessions/     │                               │
│              └───────────────────────┘                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Components Inventoried

| Component | Location | Status | Completeness |
|---|---|---|---|
| **VaultService** | `packages/core/src/VaultService.ts` | ✅ Working | 100% — file write, search (rg), git commit, queue drain |
| **CouncilService** | `packages/core/src/CouncilService.ts` | ✅ Working | 95% — full chain + T10 fast-path, token budget, reversal detection |
| **P10Service** | `packages/core/src/P10Service.ts` | ✅ Working | 95% — scouts→compress→analyze→draft→arbiter→commit, revision loop |
| **TokenBudget** | `packages/core/src/utils/TokenBudget.ts` | ✅ Working | 100% — seat_overrun / fanout_overrun enforcement |
| **ReversalDetector** | `packages/core/src/utils/reversalDetector.ts` | ✅ Working | 100% — Jaccard on tags, bounded priors |
| **CLI Commands** | `packages/cli/src/commands/*.ts` | ✅ Working | 12 commands (init, doctor, whoami, search, last, audit, dashboard, radio, backfill, upgrade, synthesize, report) |
| **MCP Server** | `packages/mcp-server/src/` | ✅ Working | 90% — 6 tools + SSE dashboard + HTTP endpoints |
| **Dashboard** | `packages/dashboard/src/index.ts` | ⚠️ Removed 2026-09-10 | Historical row — the terminal-ANSI capability was ported into `toto dashboard --terminal` (`packages/cli`); the HTML render lives in `packages/mcp-server`. `packages/dashboard` itself no longer exists. |
| **mcp-client extension** | `.pi/agent/extensions/mcp-client/` | ✅ Fixed | Works after npm install + dynamic imports |
| **subagent extension** | `.pi/agent/extensions/subagent/` | ✅ Fixed | agent-list, agent-show commands work |

---

## Governance Skills Inventory (in `~/.agents/skills/toto-governance/`)

| Skill | Implemented in Core? | Notes |
|---|---|---|
| **meta** | ❌ No | Orchestrator only — routes to other skills |
| **council** | ✅ Partial | Core has CouncilService; skill adds subagent orchestration |
| **p10** | ✅ Partial | Core has P10Service; skill adds codebase scouting |
| **cabinet** | ❌ No | Only in skill — no core service |
| **safety-car** | ❌ No | Only in skill — adversarial review spec |
| **karpathy** | ❌ No | Only in skill — execution invariants spec |
| **drs** | ❌ No | Only in skill — PreToolUse hook spec (not implemented) |
| **vault** | ✅ Partial | Core has VaultService; skill adds session-memory indexing |
| **subagent** | ❌ No | Extension only — agent discovery/management |

---

## Strangler Fig Target State

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STRANGLER FIG TARGET                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SINGLE SOURCE OF TRUTH                     │   │
│  │  ┌─────────────────────────────────────────────────────────┐  │   │
│  │  │  @toto-wolff/core  (ALL governance logic lives here)    │  │   │
│  │  │  - VaultService     (existing)                          │  │   │
│  │  │  - CouncilService   (existing)                          │  │   │
│  │  │  - P10Service       (existing)                          │  │   │
│  │  │  - CabinetService   (NEW — from skill)                  │  │   │
│  │  │  - SafetyCarService (NEW — from skill)                  │  │   │
│  │  │  - KarpathyService  (NEW — from skill)                  │  │   │
│  │  │  - DRSService       (NEW — from skill, hook impl)       │  │   │
│  │  │  - SubagentService  (NEW — from extension)              │  │   │
│  │  └─────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────┬────────────────────────────────────┘   │
│                             │                                          │
│         ┌───────────────────┼───────────────────┐                     │
│         ▼                   ▼                   ▼                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐               │
│  │   CLI       │    │  MCP Server │    │   Skills    │               │
│  │   (thin)    │    │  (thin)     │    │  (thin      │               │
│  │             │    │             │    │   adapters) │               │
│  └─────────────┘    └─────────────┘    └─────────────┘               │
│         │                   │                   │                     │
│         └───────────────────┼───────────────────┘                     │
│                             ▼                                          │
│              ┌───────────────────────┐                                │
│              │   VAULT (session mem) │                                │
│              └───────────────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Strangler Fig Principle:** Incrementally migrate logic from skills → core → expose via CLI/MCP/Skills as thin adapters. Never duplicate logic.

---

## Migration Phases

### Phase 1: Foundation — Unify Core Services (Week 1)
**Goal:** All governance logic in `@toto-wolff/core`, zero duplication

| Task | Target File | Source | Effort |
|---|---|---|---|
| 1.1 Create CabinetService | `packages/core/src/CabinetService.ts` | `~/.agents/skills/toto-governance/cabinet/SKILL.md` | 2 days |
| 1.2 Create SafetyCarService | `packages/core/src/SafetyCarService.ts` | `~/.agents/skills/toto-governance/safety-car/SKILL.md` | 2 days |
| 1.3 Create KarpathyService | `packages/core/src/KarpathyService.ts` | `~/.agents/skills/toto-governance/karpathy/SKILL.md` | 1 day |
| 1.4 Create DRSService | `packages/core/src/DRSService.ts` | `~/.agents/skills/toto-governance/drs/SKILL.md` | 2 days |
| 1.5 Create SubagentService | `packages/core/src/SubagentService.ts` | Extension + `~/.agents/skills/toto-governance/subagent/` | 1 day |
| 1.6 Export all from `packages/core/src/index.ts` | `packages/core/src/index.ts` | — | 0.5 day |
| 1.7 Add types to `packages/core/src/types.ts` | `packages/core/src/types.ts` | — | 0.5 day |

**Success Criteria:** All 7 governance services in core, fully typed, testable.

---

### Phase 2: MCP Server as Primary Interface (Week 1-2)
**Goal:** MCP server exposes ALL governance operations; CLI/Skills become thin adapters

| Task | Target | Effort |
|---|---|---|
| 2.1 Add cabinet_run, safety_car_run, karpathy_check, drs_check, subagent_list tools to MCP | `packages/mcp-server/src/handlers/` + `index.ts` | 2 days |
| 2.2 Add SSE event types for new tools (cabinet, safety-car, karpathy, drs) | `packages/mcp-server/src/handlers/sse_handler.ts` | 0.5 day |
| 2.3 Update dashboard HTML to show new governance types | `packages/mcp-server/src/handlers/dashboard_html.ts` | 0.5 day |
| 2.4 Add dashboard endpoints for new record types | `packages/mcp-server/src/handlers/record_handler.ts` | 0.5 day |
| 2.5 Update CLI commands to call MCP tools instead of direct core | `packages/cli/src/commands/` | 1 day |

**Success Criteria:** All governance operations accessible via MCP; CLI delegates to MCP.

---

### Phase 3: Skills as Thin Adapters (Week 2)
**Goal:** Skills route to core via MCP, no logic duplication

| Task | Target | Effort |
|---|---|---|
| 3.1 Rewrite council skill to call `council_run` MCP tool | `~/.agents/skills/toto-governance/council/` | 1 day |
| 3.2 Rewrite p10 skill to call `p10_plan` MCP tool | `~/.agents/skills/toto-governance/p10/` | 1 day |
| 3.3 Create cabinet skill calling `cabinet_run` MCP tool | `~/.agents/skills/toto-governance/cabinet/` | 0.5 day |
| 3.4 Create safety-car skill calling `safety_car_run` MCP tool | `~/.agents/skills/toto-governance/safety-car/` | 0.5 day |
| 3.5 Create karpathy skill calling `karpathy_check` MCP tool | `~/.agents/skills/toto-governance/karpathy/` | 0.5 day |
| 3.6 Create drs skill for config management + hook installation | `~/.agents/skills/toto-governance/drs/` | 1 day |
| 3.7 Create vault skill calling `vault_search`/`vault_write` MCP tools | `~/.agents/skills/toto-governance/vault/` | 0.5 day |
| 3.8 Create subagent skill calling `subagent_list` MCP tool | `~/.agents/skills/toto-governance/subagent/` | 0.5 day |

**Success Criteria:** All skills < 200 lines, pure routing/adaptation, no LLM prompts or logic.

---

### Phase 4: DRS Hook Implementation (Week 2-3)
**Goal:** DRS runs as actual PreToolUse hook, not just spec

| Task | Target | Effort |
|---|---|---|
| 4.1 Implement `drs-check.sh` (bash) or `drs-check.ts` (node) | `~/.agents/skills/toto-governance/drs/bin/drs-check.ts` | 1 day |
| 4.2 Add pi hook config generator to drs skill | `~/.agents/skills/toto-governance/drs/` | 0.5 day |
| 4.3 Test DRS blocks on frozen paths, auth surfaces, cross-tenant, destructive | Manual + integration test | 1 day |

**Success Criteria:** DRS blocks writes per 5 rules; override mechanism works; logged to session memory.

---

### Phase 5: Documentation & Config Unification (Week 3)
**Goal:** Single source of truth for config, no drift between AGENTS.md/CLAUDE.md/skills

| Task | Target | Effort |
|---|---|---|
| 5.1 Generate AGENTS.md from skill metadata (single source) | `scripts/generate-agents-md.ts` | 1 day |
| 5.2 Generate CLAUDE.md from same source | `scripts/generate-claude-md.ts` | 0.5 day |
| 5.3 Create `.toto/config.yml` schema + validation | `packages/core/src/types.ts` + `schemas/` | 0.5 day |
| 5.4 Add config loading to all services | All core services | 0.5 day |
| 5.5 Document MCP server setup in README | `README.md` | 0.5 day |

**Success Criteria:** One config file (`.toto/config.yml`), docs auto-generated, no manual sync needed.

---

### Phase 6: Hardening & Ship (Week 3-4)
**Goal:** Production-ready, zero known issues

| Task | Target | Effort |
|---|---|---|
| 6.1 Add integration tests for full governance loop | `packages/core/src/__tests__/` | 2 days |
| 6.2 Add MCP server E2E tests (stdio + HTTP) | `packages/mcp-server/src/__tests__/` | 1 day |
| 6.3 Fix any TypeScript strict mode violations | All packages | 0.5 day |
| 6.4 Run full lint/typecheck/test pipeline | `pnpm lint && pnpm typecheck && pnpm test` | 0.5 day |
| 6.5 Cabinet review for v1.4.0 release | `/cabinet v1.4.0` | 1 day |

**Success Criteria:** All checks pass, cabinet approves release.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Core services become too large (>500 lines) | Medium | High | Keep services focused; split if >300 lines |
| MCP stdio transport breaks on Node version change | Low | High | Pin Node version in `.nvmrc`; test on 20, 22, 24 |
| Skill routing breaks on pi upgrade | Medium | Medium | Version skills; test after pi upgrades |
| DRS hook causes false positives blocking valid work | High | Medium | Start with Rules 1,5 only; add 2,3,4 after config exists |
| Session memory migration loses history | Low | High | Write migration script; test on copy first |

---

## Dependencies Between Phases

```
Phase 1 (Core Services) ──► Phase 2 (MCP Tools) ──► Phase 3 (Thin Skills)
       │                         │                        │
       ▼                         ▼                        ▼
Phase 4 (DRS Hook) ◄────── Phase 5 (Config/Docs) ◄──────┘
       │
       ▼
Phase 6 (Hardening/Ship)
```

- Phase 1 MUST complete before Phase 2 (MCP tools need core services)
- Phase 2 MUST complete before Phase 3 (skills call MCP tools)
- Phase 4 can start after Phase 1 (DRS service exists)
- Phase 5 can start after Phase 1 (config schema exists)
- Phase 6 requires all prior phases

---

## Estimated Timeline

| Phase | Working Days | Calendar Weeks |
|---|---|---|
| 1: Core Services | 9 | 1.5 |
| 2: MCP Tools | 4.5 | 1 |
| 3: Thin Skills | 5.5 | 1 |
| 4: DRS Hook | 2.5 | 0.5 |
| 5: Config/Docs | 3 | 0.5 |
| 6: Hardening/Ship | 5 | 1 |
| **Total** | **29.5** | **~5.5** |

---

## Next Step

**Ready for P10 planning.** The analysis is complete. Next:

```
/p10 plan: implement strangler fig migration phases 1-6 per analysis
```

This will produce a NASA JPL Power of 10 compliant execution plan with staged implementation, assertions, and Opus arbitration before any code is written.