---
status: approved
---

# P10 Plan — RL on Governance Memory (RL-1 through RL-7)

**Task:** Implement RL phases RL-1 through RL-7 per RL_ARCHITECTURE.md with decisions:
- embedding: BAAI/bge-small-en-v1.5 (384-dim)
- vector index: FAISS multi-backend (CUDA→Metal→CPU auto-detect)
- reranker: council-decided (config default null)
- training: event-driven (trigger_outcomes=50)
- actions: 5 (added request_human_review)

**Stage:** full
**Council ruling ref:** none (direct execution)
**Date:** 2025-08-05

---

## Pre-conditions

- [x] `RL_ARCHITECTURE.md` exists with decided architecture
- [x] Existing Signals/ memory base operational (VaultService, SignalRecord, backfill)
- [x] Jaccard scoring + reversal detection working (scoreConfidence, detectReversal)
- [x] MCP server running with vault_write, vault_search, council_run, p10_plan tools
- [x] Core packages: @toto-wolff/core, @toto-wolff/cli, @toto-wolff/mcp-server build clean
- [ ] Node 24 available (confirmed via `.nvmrc`)
- [ ] Python 3.11+ available for FAISS index build subprocess

---

## P10 Analysis (All 10 Rules)

### Rule 1 — Control Flow: **SAFE**
- No recursion in index build, query, training, or inference
- All loops have explicit bounds (max_records, max_outcomes, batch_size)
- Async/await used for I/O; no promise chains > 3 deep
- ONNX inference is single forward pass (no control flow)

### Rule 2 — Loop Bounds: **SAFE** (annotated)
| Location | Loop | Bound |
|---|---|---|
| `indexSignals()` | file scan | `MAX_SOURCE_FILES = 500` (existing pattern) |
| `queryHybrid()` | FAISS search | `k * 5` (candidate multiplier) |
| `queryHybrid()` | BM25 search | `k * 5` |
| `queryHybrid()` | RRF fuse | `2 * k * 5` (fused candidates) |
| `trainIfTriggered()` | epoch loop | `epochs = 5` (config) |
| `trainIfTriggered()` | batch loop | `ceil(outcomes / batch_size)` ≤ `50/32 = 2` |
| `inferPolicy()` | NO LOOPS | single forward pass |

### Rule 3 — Memory: **SAFE**
- FAISS index: fixed size (HNSW32, ~4 bytes/dim × 384 × num_signals)
- BM25 index: Tantivy manages memory; bounded by corpus size
- Embedding model: loaded once, reused (ONNX Runtime session pooling)
- Training: batches of 32, gradients released per step
- No unbounded array/map growth — all capped by config constants

### Rule 4 — Function Size: **SAFE**
Target functions ≤ 60 lines. Planned splits:
- `RLService.indexSignals()` → `buildFaissIndex()`, `buildBm25Index()`, `writeManifest()`
- `RLService.queryHybrid()` → `embedQuery()`, `searchFaiss()`, `searchBm25()`, `rrfFuse()`, `rerank()`
- `RLService.inferPolicy()` → `buildFeatures()`, `runOnnxInference()`, `parseOutput()`
- `RLService.trainIfTriggered()` → `loadTrainingData()`, `trainEpoch()`, `exportOnnx()`, `evalGate()`
- Each < 50 lines

### Rule 5 — Assertions: **SAFE** (min 2/function)
Every public method gets:
1. Input validation (assert types, ranges, non-empty)
2. Output validation (assert result shape, non-null)
3. Invariant checks where applicable (e.g., `embedding_dim === 384`)

Example:
```typescript
async inferPolicy(signal: SignalRecord, ctx: PolicyContext): Promise<PolicyOutput> {
  assert(signal.id.length > 0, 'signal.id required');
  assert(ctx.stage.length > 0, 'ctx.stage required');
  const out = await this.onnx.run(features);
  assert(out.action_logits.length === 5, '5 actions');
  assert(out.confidence >= 0 && out.confidence <= 1, 'confidence [0,1]');
  return out;
}
```

### Rule 6 — Scope: **SAFE**
- Config loaded once at construction → immutable `RLConfig` object
- FAISS/BM25 indexes: private to `RLService`, not module-level
- ONNX session: private, created once, reused
- No mutable module-level state
- `topic_tags` one-hot: built per-call from known vocabulary (max 32)

### Rule 7 — Return Values: **SAFE**
- All async calls wrapped in try/catch → typed errors (`RLIndexError`, `RLInferenceError`, `RLTrainingError`)
- Subprocess calls (Python index build): check exit code, parse stderr
- ONNX inference: validate output tensor shapes
- File I/O: check write bytes, verify read integrity

### Rule 8 — Macros: **N/A** (TypeScript)
- No macros, no `eval`, no `Function()`, no dynamic `require`
- Constants via `const` + config object

### Rule 9 — Pointers/References: **SAFE**
- No `any` types — strict TypeScript
- SignalRecord, PolicyOutput, RLConfig fully typed
- ONNX input/output: `Float32Array` with shape assertions
- No unchecked `as Type` — all guarded by `assert` or Zod

### Rule 10 — Warnings: **CLEAN** (target)
- `tsc --strict --noEmit` clean
- ESLint zero warnings (max-lines-per-function: 60)
- Prettier formatted
- Vitest tests pass

---

## Blocking Risks

| Risk | Rule | Resolution |
|---|---|---|
| FAISS Node bindings unavailable on Apple MPS | 3, 7 | Fallback to CPU; log warning; CI tests on both |
| `faiss-gpu` PyPI wheel missing for Python 3.13 | 3 | Pin Python 3.11 in build script; use `faiss-cpu` fallback |
| ONNX Runtime Node native module compile failure | 7 | Prebuild in Docker; cache `node_modules` |
| Tantivy WASM load failure in Node | 3 | Fallback to pure-JS BM25 (slower, works) |
| Embedding model download fails (offline) | 3 | Vendor model in repo (`models/bge-small-en-v1.5/`) |

**All blocking risks have mitigations — no hard blocks.**

---

## Pre-conditions (Verified by Scout)

- [x] Vault path: `~/.toto/vault` (or `TOTO_VAULT_PATH`)
- [x] Signals/ directory exists with `.md` files
- [x] Existing `backfill` command works
- [x] `scoreConfidence` and `detectReversal` tested
- [ ] Python environment with `faiss-gpu`, `transformers`, `torch` available
- [ ] Node 24 + pnpm 11 for build

---

## Implementation Stages

### Stage 1: RLService Skeleton + Config (RL-1 foundation)
**Scope:** `packages/core/src/RLService.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`
**P10 Constraints:** Rules 1,2,4,5,6,7,9,10
**Assertions:**
- `RLConfig` schema validates all fields with defaults
- `RLService` constructor asserts vault path exists
- `indexSignals()` returns `IndexStats { signalsIndexed, faissBackend, bm25Built, durationMs }`
**Return Value Handling:** `Result<IndexStats, RLIndexError>`
**Loop Bounds:** File scan ≤ 500, FAISS add ≤ signals.length
**Function Split:** `loadConfig()`, `validateConfig()`, `createFaissIndex()`, `createBm25Index()`

### Stage 2: Hybrid Index Build (RL-1 core)
**Scope:** `packages/core/src/vector/faiss_backend.py`, `packages/core/src/vector/bm25_backend.py`, `packages/core/src/RLService.indexSignals()`
**P10 Constraints:** Rules 1,2,3,4,5,7
**Assertions:**
- FAISS index dimension === 384
- BM25 index document count === FAISS vector count
- Manifest written with `embed_model`, `created_at`, `signal_count`
- `faissBackend` ∈ {'cuda', 'metal', 'cpu'}
**Return Value Handling:** Python subprocess exit code → `RLIndexError` on non-zero
**Loop Bounds:** 
- Embedding batch: `min(32, signals.length)` 
- FAISS `add()`: single call with all vectors
- BM25 `add_documents()`: single call with all docs

### Stage 3: Hybrid Query + MCP Tool (RL-1 + RL-3)
**Scope:** `packages/core/src/RLService.queryHybrid()`, `packages/mcp-server/src/handlers/rl_query.ts`
**P10 Constraints:** Rules 1,2,4,5,7
**Assertions:**
- Query embedding dimension === 384
- FAISS search returns ≤ `k * 5` candidates
- BM25 search returns ≤ `k * 5` candidates
- RRF fused results deduplicated by `signal.id`
- Final results ≤ `k`
**Return Value Handling:** `SignalRecord[]` (empty on no matches)
**Loop Bounds:** RRF fuse loop ≤ `2 * k * 5` (max 100 for k=10)
**Function Split:** `embedQuery()`, `searchFaiss()`, `searchBm25()`, `rrfFuse()`, `applyTagFilter()`, `rerankIfConfigured()`

### Stage 4: Policy Network Definition + Export (RL-2)
**Scope:** `packages/core/src/policy/architecture.onnx` (exported), `packages/core/src/policy/export_policy.py`
**P10 Constraints:** Rules 1,2,3,4,5
**Architecture:**
```
Input: [1, 512] (384 + 64 + 32 + 8 + 24)
Hidden: Linear(512, 256) → ReLU → Linear(256, 128) → ReLU
Heads:
  action_logits: Linear(128, 5)      # 5 actions
  confidence: Linear(128, 1) → Sigmoid
  value: Linear(128, 1)
Params: ~100K
```
**Assertions:**
- ONNX opset ≥ 17
- Input name: `input`, shape `[1, 512]`
- Output names: `action_logits`, `confidence`, `value`
- All weights `float32`
**Export Script:** Python → `torch.onnx.export()` → save `policy.onnx`

### Stage 5: Policy Inference + MCP Tool (RL-2 + RL-3)
**Scope:** `packages/core/src/RLService.inferPolicy()`, `packages/mcp-server/src/handlers/rl_infer.ts`
**P10 Constraints:** Rules 1,2,4,5,7,9
**Assertions:**
- Feature vector length === 512
- ONNX session.run() returns 3 tensors
- `action_logits.shape === [1, 5]`
- `confidence.shape === [1]`, value in [0,1]
- `value.shape === [1]`
- Action = `argmax(action_logits)`
**Return Value Handling:** `PolicyOutput { action, confidence, value, actionProbs }`
**Loop Bounds:** NONE (single forward pass)
**Function Split:** `buildFeatureVector()`, `runOnnx()`, `parseOutput()`

### Stage 6: Outcome Logging (RL-3)
**Scope:** `packages/core/src/types.ts` (OutcomeRecord), `packages/core/src/RLService.logOutcome()`, `packages/mcp-server/src/handlers/rl_outcome.ts`
**P10 Constraints:** Rules 1,2,4,5,6,7
**OutcomeRecord Schema:**
```typescript
interface OutcomeRecord {
  signal_id: string;
  timestamp: string;           // ISO 8601
  outcome: 'success' | 'partial' | 'failure';
  actual_result: Record<string, unknown>;
  execution_time_ms: number;
  context: {
    plan_stage: string;
    agent_model: string;
    env: Record<string, string>;
  };
  reward: number;              // derived: 1.0 | 0.3 | -1.0
}
```
**Assertions:**
- `signal_id` exists in Signals/
- `outcome` ∈ enum
- `execution_time_ms` ≥ 0
- `reward` ∈ {1.0, 0.3, -1.0}
**Return Value Handling:** `void` (throws on error)
**Loop Bounds:** Single file write

### Stage 7: Event-Driven Training Loop (RL-4)
**Scope:** `packages/core/src/RLService.trainIfTriggered()`, `packages/core/src/policy/train.py`, `packages/mcp-server/src/handlers/rl_train.ts`
**P10 Constraints:** Rules 1,2,3,4,5,7
**Trigger:** Called after each `logOutcome()`; checks `new_outcomes_since_training >= trigger_outcomes`
**Training Steps:**
1. Load all (signal, outcome) pairs
2. Build feature vectors (replay)
3. Split: holdout 20% (stratified by outcome)
4. Train: 5 epochs, batch 32, Adam lr=3e-4
5. Loss = policy_gradient + 0.5*value_mse + 0.01*entropy
6. Export ONNX (atomic: write `.tmp` → rename)
7. Eval on holdout: accuracy > baseline + 0.02
**Assertions:**
- Training data ≥ `trigger_outcomes` (50)
- Holdout accuracy > static Jaccard baseline + 0.02
- Exported ONNX passes inference smoke test
- `policy_version` incremented
**Return Value Handling:** `TrainMetrics | null` (null if not triggered)
**Loop Bounds:** 
- Epochs: 5 (config)
- Batches: `ceil(train_size / 32)` ≤ 2
- Backward passes: `epochs * batches` ≤ 10

### Stage 8: Session Handoff (RL-5)
**Scope:** `packages/core/src/RLService.exportCheckpoint()`, `importCheckpoint()`, `packages/mcp-server/src/handlers/rl_handoff.ts`
**P10 Constraints:** Rules 1,2,4,5,6,7
**Export:**
- Copy `policy.onnx` → session dir
- Write `handoff_manifest.yaml` with vault_hash, policy_version, new_signals, new_outcomes
**Import:**
- Verify vault_hash matches (or warn + re-index)
- Load `policy.onnx`
- If `new_outcomes > 0`: fine-tune 1 epoch (frozen backbone)
**Assertions:**
- Exported manifest valid YAML
- Imported policy runs inference
- Fine-tune improves holdout loss

### Stage 9: Gate Integration (RL-6)
**Scope:** `packages/core/src/CouncilService.ts`, `P10Service.ts`, `SafetyCarService.ts` (new), `KarpathyService.ts` (new)
**Integration Points:**
```typescript
// After human ruling, before auto-apply:
const policyOut = await rl.inferPolicy(currentSignal, currentContext);
if (policyOut.confidence > CONFIG.auto_apply_threshold) {
  return { action: 'auto_apply', policy: policyOut };
}
// else return to human with recommendation
```
**Actions Mapping:**
| Policy Action | Gate Behavior |
|---|---|
| `apply_plan` | Auto-apply ruling/plan |
| `request_revision` | Return to human with revision guidance |
| `escalate_council` | Trigger council deliberation |
| `request_human_review` | Pause, await explicit human confirmation |
| `defer` | Defer decision, log for later |

**Assertions:**
- Policy inference called at every gate
- Confidence thresholds respected
- Action routed correctly

### Stage 10: Config, Tests, Hardening (RL-7)
**Scope:** `.toto/config.yml` (RL section), `packages/core/src/__tests__/RLService.test.ts`, `packages/mcp-server/src/__tests__/rl_*.test.ts`
**P10 Constraints:** All 10 rules
**Tests:**
- Unit: config validation, feature vector building, RRF fuse
- Integration: index build → query → infer → log → train → handoff
- E2E: full governance loop with RL recommendations
- Platform: FAISS backend detection (CUDA/Metal/CPU)
**Assertions:**
- All tests pass on Node 24 + Python 3.11
- `pnpm lint && pnpm typecheck && pnpm test` clean
- Cold start (no outcomes) falls back to Jaccard

---

## Invariants (Cross-Stage)

1. **Embedding dimension fixed at 384** — any change requires full re-index + council
2. **FAISS index always matches Signals/ content** — manifest.hash verified on load
3. **Policy ONNX version matches training run** — `policy_version` in manifest
4. **Outcomes never deleted** — append-only reward log
5. **Confidence thresholds gate automation** — never auto-apply below 0.8
5. **Training only on event trigger** — no cron, no surprise runs

---

## Blocked Paths (Ruled Out)

| Approach | Reason |
|---|---|
| cuVS direct (no FAISS) | No Apple support; FAISS multi-backend covers CUDA |
| Nightly cron training | Event-driven preferred; cron as fallback only |
| Fine-tuning embedding model | Drift risk; policy head only adapts |
| Vector-only search (no BM25) | Keyword exact match critical for CVE/rule refs |
| Single action `escalate` | `request_human_review` distinct — different UX |
| Storing embeddings in Signals/ markdown | Bloats source of truth; separate `.index/` is cleaner |

---

## Verification Checklist (Per Stage)

| Stage | Verification |
|---|---|
| 1 | `RLService` constructs, config validates, types export |
| 2 | `indexSignals()` builds FAISS+BM25, manifest written, backend logged |
| 3 | `queryHybrid("auth migration", ["security"], 5)` returns relevant signals |
| 4 | `policy.onnx` loads in ONNX Runtime, inference smoke test passes |
| 5 | `inferPolicy(signal, ctx)` returns action∈5, confidence∈[0,1] |
| 6 | `logOutcome()` writes `.md` to outcomes/, reward derived correctly |
| 7 | `trainIfTriggered()` returns metrics after 50 outcomes, eval passes |
| 8 | Export→import roundtrip preserves policy behavior |
| 9 | Council/P10/SafetyCar/Karpathy gates call RL, route actions |
| 10 | All tests pass, lint/typecheck clean, cold-start works |

---

## Cross-Rule Notes

- **Rule 2 + Rule 3:** Batch sizes (32) bound both loop iterations and GPU memory
- **Rule 4 + Rule 5:** Small functions with assertions → easier verification
- **Rule 6 + Rule 7:** Config immutable → no surprise state; errors typed
- **Rule 10:** `max-lines-per-function: 60` enforced by ESLint on all new code