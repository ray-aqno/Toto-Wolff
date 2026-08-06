---
status: approved
---

# P10 Plan — Strangler Fig Stage 1: Core Services Implementation

**Task:** Implement CabinetService, SafetyCarService, KarpathyService, DRSService, SubagentService in @toto-wolff/core per strangler fig P10 plan

**Stage:** 1 of 6
**Parent Plan:** 2025-08-05-strangler-fig-migration.md
**Date:** 2025-08-05

---

## Pre-conditions

- [x] Parent P10 plan approved (status: approved)
- [x] @toto-wolff/core builds clean (tsc --strict --noEmit)
- [x] VaultService, CouncilService, P10Service exist and tested
- [x] Types: CouncilResult, P10Result, SignalRecord, VaultWriteResult, SearchResult
- [x] Utils: jaccardSimilarity, detectReversal, TokenBudget, withLLMTimeout
- [x] Anthropic client factory: createAnthropicClient()
- [ ] Node 24 + pnpm 11 confirmed

---

## P10 Analysis (All 10 Rules)

### Rule 1 — Control Flow: **SAFE**
- No recursion in any service method
- All loops bounded (file scans ≤ 50, LLM calls ≤ 7)
- Async/await for I/O; no promise chains > 2

### Rule 2 — Loop Bounds: **SAFE** (annotated)
| Service | Method | Loop | Bound |
|---|---|---|---|
| SubagentService | discoverAgents() | fs.readdirSync | ≤ 50 .md files per dir |
| CabinetService | assembleBrief() | vault.search() | rg internal limit |
| SafetyCarService | adversarialReview() | risk categories | 5 fixed categories |
| KarpathyService | verifyStage() | diff lines | ≤ diff.length (bounded by input) |
| DRSService | check() | rule evaluation | 5 fixed rules |

### Rule 3 — Memory: **SAFE**
- No unbounded collections
- Services stateless (vault injected)
- LLM responses: bounded by max_tokens (1024-2048)
- File reads: small configs only (< 10KB)

### Rule 4 — Function Size: **SAFE** (target ≤ 60 lines)
Each service split into ≤ 5 methods, each ≤ 50 lines:
- CabinetService: run(), assembleBrief(), conveneSeats(), synthesize(), writeRecord()
- SafetyCarService: run(), loadPlan(), adversarialReview(), emitReport()
- KarpathyService: check(), verifyStage(), assertInvariants(), reportViolations()
- DRSService: check(), rule1_frozen(), rule2_scope(), rule3_auth(), rule4_tenant(), rule5_destructive()
- SubagentService: list(), discoverAgents(), parseAgentFile(), formatOutput()

### Rule 5 — Assertions: **SAFE** (min 2/method)
Every public method:
1. Input validation (assert types, non-empty, ranges)
2. Output validation (assert shape, non-null, enum membership)
3. Invariant checks where applicable

### Rule 6 — Scope: **SAFE**
- Config loaded once at construction → immutable
- Vault injected, not global
- No module-level mutable state
- Freeze registry read-only at check time

### Rule 7 — Return Values: **SAFE**
- All async: try/catch → typed errors (CabinetError, SafetyCarError, etc.)
- LLM calls: withLLMTimeout wrapper
- File I/O: verify bytes written
- Subprocess: check exit codes

### Rule 8 — Macros: **N/A**
- No eval, Function(), dynamic require

### Rule 9 — Pointers/References: **SAFE**
- Strict TypeScript, no `any`
- All interfaces exported from types.ts
- LLM message shapes typed

### Rule 10 — Warnings: **CLEAN** (target)
- tsc --strict --noEmit clean
- ESLint zero warnings
- max-lines-per-function: 60 enforced

---

## Blocking Risks

| Risk | Rule | Resolution |
|---|---|---|
| Anthropic SDK version mismatch | 7 | Pin @anthropic-ai/sdk in core package.json |
| LLM timeout on slow model | 1,7 | withLLMTimeout already exists; use 30s default |
| Vault path not absolute | 5,6 | Assert in constructor (VaultService pattern) |
| Freeze config missing | 3,6 | Default to empty array; log warning |

**No hard blocks.**

---

## Implementation Stages (5 Services)

### Stage 1A: CabinetService (2 days)
**Scope:** `packages/core/src/CabinetService.ts`, `packages/core/src/types.ts`

**Interface:**
```typescript
// types.ts additions
export type CabinetVerdict = 'ship' | 'conditional' | 'block';
export type CabinetSeat = 'garry_tan' | 'feynman' | 'karpathy';

export interface CabinetSeatResult {
  seat: CabinetSeat;
  verdict: CabinetVerdict;
  oneLine: string;
  reasoning: string;
  condition?: string;        // if conditional
  blockingDefect?: string;   // if block
  whatWouldChangeVote: string;
}

export interface CabinetResult {
  ruling: 'approved' | 'approved-with-conditions' | 'held';
  seats: CabinetSeatResult[];
  convergence: string;       // where all agree
  tension: string;           // where they split
  blockingDefect?: string;
  conditions: string[];
  recordPath: string;
}

// CabinetService.ts
export class CabinetService {
  constructor(private readonly vault: VaultService);
  
  async run(subject: string, version: string, evidenceBrief?: string): Promise<CabinetResult>;
  private async assembleBrief(subject: string, version: string, evidenceBrief?: string): Promise<string>;
  private async conveneSeats(brief: string): Promise<CabinetSeatResult[]>;
  private async synthesize(seats: CabinetSeatResult[]): Promise<CabinetResult>;
  private async writeRecord(subject: string, version: string, result: CabinetResult): Promise<string>;
}
```

**LLM Calls (7 total, parallel where possible):**
- 3 parallel seat calls (Garry Tan, Feynman, Karpathy)
- 1 synthesis call
- 1 record write (vault)

**Assertions:**
- `subject.length > 0`, `version.match(/^v\d+\.\d+\.\d+$/)`
- Each seat result has valid verdict enum
- Ruling ∈ {'approved','approved-with-conditions','held'}
- Blocking defect present iff ruling === 'held'

**Loop Bounds:** Seat calls = 3 (fixed), vault.search() bounded by rg

---

### Stage 1B: SafetyCarService (2 days)
**Scope:** `packages/core/src/SafetyCarService.ts`, `packages/core/src/types.ts`

**Interface:**
```typescript
// types.ts additions
export type SafetyCarCategory = 
  | 'runtime_failure' 
  | 'abuse_vector' 
  | 'blast_radius' 
  | 'wrong_assumption' 
  | 'partial_failure';

export interface SafetyCarRisk {
  category: SafetyCarCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  mitigation: string;
  planRef: string;           // plan file:line
}

export interface SafetyCarReport {
  planPath: string;
  risks: SafetyCarRisk[];
  criticalCount: number;
  highCount: number;
  verdict: 'pass' | 'fail' | 'conditional';
  summary: string;
}

// SafetyCarService.ts
export class SafetyCarService {
  constructor(private readonly vault: VaultService);
  
  async run(planPath: string): Promise<SafetyCarReport>;
  private async loadPlan(planPath: string): Promise<string>;
  private async adversarialReview(planContent: string): Promise<SafetyCarRisk[]>;
  private async emitReport(planPath: string, risks: SafetyCarRisk[]): Promise<SafetyCarReport>;
}
```

**LLM Calls (2):**
- 1 adversarial review (Opus-level, all 5 categories)
- 1 report synthesis

**Risk Categories (fixed 5):**
1. **runtime_failure** — unhandled errors, missing try/catch, null derefs
2. **abuse_vector** — input validation gaps, injection, traversal
3. **blast_radius** — single change affects unrelated modules, cascading failures
4. **wrong_assumption** — env vars present, API stable, user behavior predictable
5. **partial_failure** — network timeout, partial write, inconsistent state

**Assertions:**
- `planPath` exists in vault
- Each risk has valid category, severity, non-empty description/mitigation
- Verdict: 'pass' iff criticalCount=0 && highCount=0; 'conditional' iff highCount>0; 'fail' iff criticalCount>0

**Loop Bounds:** 5 categories (fixed), risks per category ≤ 3

---

### Stage 1C: KarpathyService (1.5 days)
**Scope:** `packages/core/src/KarpathyService.ts`, `packages/core/src/types.ts`

**Interface:**
```typescript
// types.ts additions
export interface KarpathyViolation {
  rule: 'simplicity' | 'surgical' | 'goal_driven' | 'think_before_coding';
  file: string;
  line: number;
  description: string;
  suggestion: string;
}

export interface KarpathyCheck {
  stage: string;
  status: 'pass' | 'fail';
  violations: KarpathyViolation[];
  summary: string;
}

// KarpathyService.ts
export class KarpathyService {
  constructor(private readonly vault: VaultService);
  
  async check(planPath: string, stage: string, diff?: string): Promise<KarpathyCheck>;
  private async verifyStage(planPath: string, stage: string): Promise<KarpathyViolation[]>;
  private async assertInvariants(diff: string): Promise<KarpathyViolation[]>;
  private async reportViolations(violations: KarpathyViolation[]): Promise<KarpathyCheck>;
}
```

**4 Karpathy Rules (from skill):**
1. **simplicity** — no features beyond plan, no single-use abstractions, no speculative config
2. **surgical** — touch only what stage authorizes, match existing style, clean own orphans
3. **goal_driven** — success criteria per stage, loop until verified
4. **think_before_coding** — assumptions explicit, tradeoffs surfaced, simpler approach checked

**LLM Calls (2):**
- 1 verification (plan + diff against 4 rules)
- 1 report

**Assertions:**
- `planPath` exists, `stage` non-empty
- Each violation has valid rule enum, file exists, line > 0
- Status: 'pass' iff violations.length === 0

**Loop Bounds:** diff lines ≤ input (bounded), 4 rules (fixed)

---

### Stage 1D: DRSService (2 days)
**Scope:** `packages/core/src/DRSService.ts`, `packages/core/src/types.ts`

**Interface:**
```typescript
// types.ts additions
export type DRSRule = 1 | 2 | 3 | 4 | 5;
export type DRSVerdict = 'allowed' | 'blocked';

export interface DRSCheckInput {
  tool: 'Write' | 'Edit' | 'NotebookEdit' | 'Bash';
  targetPath?: string;      // for Write/Edit/NotebookEdit
  command?: string;         // for Bash
  messageBefore?: string;   // for override detection
}

export interface DRSResult {
  allowed: boolean;
  ruleFired?: DRSRule;
  reason?: string;
  override?: boolean;
  overrideReason?: string;
}

// DRSService.ts
export class DRSService {
  private readonly freezePaths: string[];
  private readonly allowedPaths: string[];
  private readonly tenantNamespaces: string[];
  private readonly currentTenant: string;
  private readonly haltPatterns: string[];
  
  constructor(configPath?: string);  // loads .toto/drs-config.json + .toto/freeze.json
  
  check(input: DRSCheckInput): DRSResult;
  private rule1_frozen(input: DRSCheckInput): DRSResult | null;
  private rule2_scope(input: DRSCheckInput): DRSResult | null;
  private rule3_auth(input: DRSCheckInput): DRSResult | null;
  private rule4_tenant(input: DRSCheckInput): DRSResult | null;
  private rule5_destructive(input: DRSCheckInput): DRSResult | null;
  private checkOverride(input: DRSCheckInput): { allowed: boolean; reason?: string } | null;
}
```

**5 Rules (from skill):**
1. **frozen_path** — target matches `.toto/freeze.json` globs
2. **out_of_scope** — target outside `.toto/drs-config.json` allowed_paths
3. **auth_surface** — target matches *auth*|*permission*|*role*|*tenant*|*policy*|*rbac*|*acl*|*iam*
4. **cross_tenant** — target contains tenant ≠ current_tenant
5. **destructive_pattern** — Bash has `rm -rf`|`DROP TABLE`|`DELETE FROM` (no WHERE) unless `--force-confirmed`

**Override:** `"override drs: [reason]"` in messageBefore → allowed with audit log

**No LLM Calls** — pure deterministic logic

**Assertions:**
- Config loads (defaults if missing)
- Rules evaluated in order 1→5, first match wins
- Override requires non-empty reason
- Result: allowed=true (no rule fired or override) or false (rule fired, no override)

**Loop Bounds:** 
- freezePaths: ≤ 20 globs
- allowedPaths: ≤ 10
- tenantNamespaces: ≤ 10
- haltPatterns: ≤ 10

---

### Stage 1E: SubagentService (0.5 days)
**Scope:** `packages/core/src/SubagentService.ts`, `packages/core/src/types.ts`

**Interface:**
```typescript
// types.ts additions (already in skill, promote to core)
export interface AgentConfig {
  name: string;
  description: string;
  tools: string;
  model: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max';
  systemPrompt: string;
  source: 'user' | 'project';
  filePath: string;
}

// SubagentService.ts
export class SubagentService {
  constructor(private readonly vault: VaultService); // for agent dir paths
  
  async list(scope: 'user' | 'project' | 'both' = 'both'): Promise<AgentConfig[]>;
  private discoverAgents(cwd: string, scope: 'user' | 'project' | 'both'): Map<string, AgentConfig>;
  private parseAgentFile(filePath: string, source: 'user' | 'project'): AgentConfig | null;
  private formatOutput(agents: AgentConfig[]): AgentConfig[];
}
```

**Logic:** Migrate from `~/.agents/skills/toto-governance/extensions/subagent/agents.ts`
- Reads `~/.pi/agent/agents/` (user) + `.pi/agents/` (project)
- Parses frontmatter + system prompt from .md files
- Project overrides user by name

**No LLM Calls** — pure file I/O

**Assertions:**
- Returned agents have non-empty name, model, systemPrompt
- Source ∈ {'user','project'}
- No duplicates (project wins)

**Loop Bounds:** ≤ 50 .md files per dir

---

## Cross-Service Integration

### Types Export (types.ts)
All new interfaces exported from `packages/core/src/types.ts` and re-exported from `packages/core/src/index.ts`

### Error Types (types.ts)
```typescript
export class CabinetError extends Error { constructor(msg: string) { super(msg); this.name = 'CabinetError'; } }
export class SafetyCarError extends Error { constructor(msg: string) { super(msg); this.name = 'SafetyCarError'; } }
export class KarpathyError extends Error { constructor(msg: string) { super(msg); this.name = 'KarpathyError'; } }
export class DRSError extends Error { constructor(msg: string) { super(msg); this.name = 'DRSError'; } }
export class SubagentError extends Error { constructor(msg: string) { super(msg); this.name = 'SubagentError'; } }
```

### Config Loading (DRSService)
- Loads `.toto/freeze.json` + `.toto/drs-config.json` at construction
- Defaults if missing (empty arrays, no tenant config)
- Validates globs compile

---

## Verification Checklist (Per Service)

| Service | Unit Tests | Integration | Lint/Typecheck |
|---|---|---|---|
| CabinetService | 5 methods, 3 seat calls mocked | Full run with mock vault | ✓ |
| SafetyCarService | 5 categories, verdict logic | Full run with sample plan | ✓ |
| KarpathyService | 4 rules, violation parsing | Full run with plan+diff | ✓ |
| DRSService | 5 rules + override, config loading | Check with fixture inputs | ✓ |
| SubagentService | discoverAgents, parseAgentFile | List with test agents | ✓ |

---

## Invariants

1. **All services stateless** — vault injected, config immutable
2. **All errors typed** — no generic Error thrown
3. **All LLM calls use withLLMTimeout** — 30s default
4. **All loops bounded** — constants at top of file
5. **All functions ≤ 60 lines** — ESLint enforced

---

## Blocked Paths

| Approach | Reason |
|---|---|
| LLM calls in DRSService | Must be deterministic; no model reasoning |
| Cabinet seats as separate classes | Over-engineering; 3 calls with different prompts sufficient |
| Karpathy diff parsing in core | Diff parsing belongs in caller; service gets parsed violations |
| DRS config in VaultService | Separation of concerns; DRS is boundary enforcement |
| SubagentService without vault | Needs vault for agent dir paths (getAgentDir) |

---

## Next Stages (Per Parent Plan)

- **Stage 2:** MCP tools for all 5 services
- **Stage 3:** Thin skills routing to MCP
- **Stage 4:** DRS hook implementation
- **Stage 5:** Config/docs unification
- **Stage 6:** Hardening + cabinet review