---
status: approved
---

# P10 Plan — Strangler Fig Stage 2: MCP Tools + Dashboard Updates

**Task:** Implement MCP tools for CabinetService, SafetyCarService, KarpathyService, DRSService, SubagentService + dashboard updates per strangler fig P10 plan

**Stage:** 2 of 6
**Parent Plan:** 2025-08-05-strangler-fig-migration.md
**Depends on:** Stage 1 (Core Services) — MUST be approved and implemented first
**Date:** 2025-08-05

---

## Pre-conditions

- [ ] Stage 1 P10 approved (status: approved) ✓
- [ ] Stage 1 implemented: 5 services in @toto-wolff/core with typed interfaces
- [ ] @toto-wolff/core exports: CabinetService, SafetyCarService, KarpathyService, DRSService, SubagentService
- [ ] @toto-wolff/mcp-server builds clean
- [ ] Existing MCP tools (vault_write, vault_search, council_run, p10_plan, dashboard_status, score_confidence) working

---

## P10 Analysis (All 10 Rules)

### Rule 1 — Control Flow: **SAFE**
- No recursion in MCP handlers
- All loops bounded (tool dispatch O(1), dashboard render loops ≤ record counts)

### Rule 2 — Loop Bounds: **SAFE** (annotated)
| Location | Loop | Bound |
|---|---|---|
| Tool dispatch | TOOLS lookup | O(1) hash map |
| Dashboard render | council records | ≤ council.length |
| Dashboard render | p10 records | ≤ p10.length |
| Dashboard render | blocked items | ≤ blocked.length |
| SSE event loop | client connections | ≤ 50 (hardcoded max) |

### Rule 3 — Memory: **SAFE**
- No unbounded collections in handlers
- Request bodies capped at 64KB (MAX_BODY_BYTES)
- Dashboard data: streamed, not fully buffered
- SSE: per-client state only

### Rule 4 — Function Size: **SAFE** (target ≤ 60 lines)
Each handler ≤ 50 lines:
- `handleCabinetRun()` → validate → service.run() → format response
- `handleSafetyCarRun()` → validate → service.run() → format response
- `handleKarpathyCheck()` → validate → service.check() → format response
- `handleDrsCheck()` → validate → service.check() → format response
- `handleSubagentList()` → validate → service.list() → format response
- Dashboard: `renderCabinetSection()`, `renderSafetyCarSection()`, etc.

### Rule 5 — Assertions: **SAFE** (min 2/handler)
Every handler:
1. Input validation (TypeBox schema, required fields)
2. Service result validation (shape, non-null)
3. Response serialization check

### Rule 6 — Scope: **SAFE**
- Services instantiated once at server start (singleton pattern)
- Config loaded once, passed to services
- No handler-level mutable state

### Rule 7 — Return Values: **SAFE**
- try/catch around service calls
- Typed errors → 400 (validation) / 500 (service)
- JSON serialization verified

### Rule 8 — Macros: **N/A**
- No eval, Function(), dynamic require

### Rule 9 — Pointers/References: **SAFE**
- Strict TypeScript, no `any`
- TypeBox schemas for all tool inputs/outputs
- Service return types match handler outputs

### Rule 10 — Warnings: **CLEAN** (target)
- tsc --strict --noEmit clean
- ESLint zero warnings
- max-lines-per-function: 60 enforced

---

## Blocking Risks

| Risk | Rule | Resolution |
|---|---|---|
| Service import fails (Stage 1 not built) | 7 | Verify `pnpm -C packages/core build` first |
| TypeBox schema mismatch | 5,9 | Generate schemas from service interfaces |
| Dashboard HTML template breaks | 4,10 | Test render with mock data |
| SSE connection leak | 3 | Max 50 clients; cleanup on close |

---

## Implementation Stages

### Stage 2A: MCP Tool Handlers (2 days)
**Scope:** `packages/mcp-server/src/handlers/{cabinet_run,safety_car_run,karpathy_check,drs_check,subagent_list}.ts`

**New Tools (add to TOOLS map in index.ts):**

#### cabinet_run
```typescript
// Input: { subject: string, version: string, evidence_brief?: string }
// Output: CabinetResult { ruling, seats[], convergence, tension, blockingDefect?, conditions[], recordPath }
// Validation: subject non-empty, version matches ^v\d+\.\d+\.\d+$
```

#### safety_car_run
```typescript
// Input: { plan_path: string }
// Output: SafetyCarReport { planPath, risks[], criticalCount, highCount, verdict, summary }
// Validation: plan_path exists in vault (VaultService check)
```

#### karpathy_check
```typescript
// Input: { plan_path: string, stage: string, diff?: string }
// Output: KarpathyCheck { stage, status, violations[], summary }
// Validation: plan_path exists, stage non-empty
```

#### drs_check
```typescript
// Input: { tool: "Write"|"Edit"|"NotebookEdit"|"Bash", target_path?: string, command?: string, message_before?: string }
// Output: DRSResult { allowed, ruleFired?, reason?, override?, overrideReason? }
// Validation: tool enum, target_path for Write/Edit/NotebookEdit, command for Bash
```

#### subagent_list
```typescript
// Input: { scope?: "user"|"project"|"both" }
// Output: AgentConfig[] { name, description, tools, model, thinking, systemPrompt, source, filePath }
// Validation: scope enum if provided
```

**Handler Pattern (all follow same structure):**
```typescript
export async function handleCabinetRun(
  body: unknown,
  vaultPath: string
): Promise<CabinetResult> {
  // 1. Validate input schema (TypeBox)
  // 2. Instantiate service (or use singleton)
  // 3. Call service method
  // 4. Validate output shape
  // 5. Return result
}
```

**Assertions per Handler:**
- Input schema validation passes
- Service call succeeds (or typed error thrown)
- Output matches declared return type
- JSON serializable

---

### Stage 2B: MCP Server Integration (0.5 days)
**Scope:** `packages/mcp-server/src/index.ts`

**Changes:**
1. Import 5 new handlers
2. Add to `TOOLS` map
3. Add tool schemas to `ListToolsRequestSchema` handler
4. Verify stdio transport still works

**Tool Schemas (TypeBox):**
```typescript
// Each tool needs inputSchema for MCP protocol
cabinet_run:      { subject: String, version: String, evidence_brief?: String }
safety_car_run:   { plan_path: String }
karpathy_check:   { plan_path: String, stage: String, diff?: String }
drs_check:        { tool: Enum, target_path?: String, command?: String, message_before?: String }
subagent_list:    { scope?: Enum }
```

---

### Stage 2C: Dashboard Updates (1.5 days)
**Scope:** `packages/mcp-server/src/handlers/{dashboard_html,dashboard_status,record_handler,sse_handler}.ts`

#### dashboard_status.ts
```typescript
// Add to returned data:
interface DashboardData {
  // ... existing
  cabinet: Session[];      // Cabinet records
  safetyCar: Session[];    // SafetyCar reports
  karpathy: Session[];     // Karpathy checks
  drs: Session[];          // DRS blocks/overrides
  subagent: Session[];     // Subagent lists (optional)
}
```

#### dashboard_html.ts
```typescript
// Add render sections for each new type:
// - Cabinet: ruling, seats verdicts, blocking defect
// - SafetyCar: verdict, critical/high counts, top risks
// - Karpathy: stage, status, violations count
// - DRS: rule fired, target, override status
// - Subagent: count, names
```

#### record_handler.ts
```typescript
// Support new types:
// type=cabinet → Council/Congressional-Records/ (or new Cabinet/ dir)
// type=safety-car → SafetyCar/ dir
// type=karpathy → Karpathy/ dir
// type=drs → DRS/ dir
```

#### sse_handler.ts
```typescript
// Emit events for new record types:
// event: cabinet, data: { councilCount, p10Count, cabinetCount, safetyCarCount, ... }
```

---

### Stage 2D: Types Export (0.5 days)
**Scope:** `packages/mcp-server/src/types.ts` (new) or extend core types

**Shared Types (re-export from @toto-wolff/core):**
- CabinetResult, CabinetSeatResult
- SafetyCarReport, SafetyCarRisk
- KarpathyCheck, KarpathyViolation
- DRSResult
- AgentConfig

**MCP-Specific:**
- Tool input/output schemas (TypeBox)
- Handler return types

---

### Stage 2E: Tests (1 day)
**Scope:** `packages/mcp-server/src/__tests__/{cabinet_run,safety_car_run,karpathy_check,drs_check,subagent_list,dashboard_html}.test.ts`

**Test Coverage:**
| Test | Description |
|---|---|
| Tool input validation | Invalid input → 400 |
| Tool success path | Valid input → correct output shape |
| Tool service error | Service throws → 500 |
| Dashboard render | Mock data → HTML contains expected sections |
| Record handler | type=cabinet|safety-car|... → 200 + content |
| SSE events | Connect → receives stats events |

---

## Verification Checklist

| Component | Unit Tests | Integration | Lint/Typecheck |
|---|---|---|---|
| 5 MCP handlers | ✓ each | ✓ via stdio transport | ✓ |
| Dashboard HTML | ✓ render sections | ✓ /dashboard endpoint | ✓ |
| Record handler | ✓ new types | ✓ /dashboard/record | ✓ |
| SSE handler | ✓ event format | ✓ /dashboard/events | ✓ |
| Tool schemas | ✓ TypeBox valid | ✓ ListTools returns | ✓ |

---

## Invariants

1. **MCP as primary interface** — All governance ops exposed as tools
2. **Handlers are thin** — Validation → Service → Format (≤ 50 lines)
3. **Schemas match services** — No duplicate type definitions
4. **Dashboard reflects all types** — No governance blind spots
5. **SSE emits all events** — Real-time updates for all record types

---

## Blocked Paths

| Approach | Reason |
|---|---|
| Business logic in handlers | Violates strangler fig — logic stays in core services |
| Separate dashboard per type | Single dashboard with sections is simpler |
| WebSocket instead of SSE | SSE simpler, works over stdio/HTTP, auto-reconnect |
| Tool per service method | One tool per service (run/check/list) — simpler API |

---

## Next Stages (Per Parent Plan)

- **Stage 3:** Thin skills routing to MCP tools
- **Stage 4:** DRS hook implementation
- **Stage 5:** Config/docs unification
- **Stage 6:** Hardening + cabinet review