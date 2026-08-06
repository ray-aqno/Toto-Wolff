# RL on Governance Memory — Architecture Sketch (DECIDED)

**Target:** Policy optimization (C) + Cross-session learning (D)
**Base:** Existing Signals/ (typed, hashed, tagged, Jaccard-scored)
**New:** Hybrid RAG index + ONNX policy network + Outcome logging

---

## ✅ Decisions (2025-08-05)

| Decision | Choice | Rationale |
|---|---|---|
| **Embedding model** | `BAAI/bge-small-en-v1.5` (384-dim) | User default; strong retrieval benchmarks |
| **Vector index** | FAISS multi-backend: CUDA (cuVS) → Metal/MPS (Apple) → CPU | Single API, auto-detect, NVIDIA + Apple support |
| **Reranker** | Council decision (config default `null`) | Deferred; add `reranker_model` to config |
| **Training trigger** | Event-driven (after N outcomes) | Config: `training.trigger_outcomes: 50` |
| **Action space** | 5 actions: `apply_plan`, `request_revision`, `escalate_council`, `request_human_review`, `defer` | Added `request_human_review` distinct from escalate |

---

## Hybrid Memory Layer (Signals/ + Vector Index)

```
~/.toto/vault/
├── Council/Congressional-Records/
├── P10-Plans/
├── ADR/
└── Signals/                      ← SOURCE OF TRUTH (markdown, append-only)
    ├── YYYY-MM-DD-*.md           # SignalRecord: id, hash, verdict, pattern, topic_tags
    │
    ├── .index/                   ← HYBRID INDEX (built from Signals/)
    │   ├── vectors.faiss         # FAISS HNSW (bge-small-en-v1.5, 384-dim)
    │   ├── bm25.index            # Tantivy/BM25 on full text (keyword search)
    │   ├── meta.json             # id → {file, hash, tags, verdict, embedding_offset}
    │   └── manifest.json         # {version, created_at, signal_count, embed_model}
    │
    └── outcomes/                 ← OUTCOME LOG (RL reward signals)
        └── YYYY-MM-DD-{signal_id}-outcome.md
            # outcome: success|partial|failure
            # actual_result: {...}
            # execution_time_ms: 1234
            # context: {plan_stage, agent_model, env}
```

### Retrieval: HybridRAG.query(query_text, tags?, k=10)
```python
def query(text: str, tags: list[str] = [], k: int = 10) -> list[SignalRecord]:
    # 1. Dense: embed query (bge-small-en-v1.5) → FAISS top-50
    # 2. Sparse: BM25 query → top-50
    # 3. Tag filter: exact topic_tags membership (Jaccard ≥ 0.5) → filter both
    # 4. RRF fuse dense + sparse (RRF constant = 60)
    # 5. Rerank: cross-encoder (if configured) or LLM-as-judge on fused top-20
    # 6. Return top-k with scores
```

**FAISS Multi-Backend:**
```python
# Auto-detect: CUDA (faiss.get_num_gpus() > 0) → Metal (Darwin arm64 + MPS) → CPU
# FAISS 1.8+ supports MPS via StandardGpuResources on Apple silicon
```

---

## Policy Network (ONNX Runtime)

### Input Features (fixed 512-dim for 384-dim embedding)
```python
# Concatenated:
signal_embedding: 384-dim      # bge-small-en-v1.5
context_embedding: 64-dim      # plan stage, agent model, repo hash, time
tag_onehot: 32-dim             # multi-hot over known topic_tags (max 32)
pattern_onehot: 8-dim          # one-hot over SIGNAL_PATTERNS (3 current)
verdict_history: 24-dim        # last 6 verdicts one-hot (4 verdicts × 6)
# Total: 512
```

### Architecture (< 100K params)
```onnx
# Input: [1, 512]
# Hidden: 256 → ReLU → 128 → ReLU
# Heads:
#   action_logits: [5]          # {apply_plan, request_revision, escalate_council, request_human_review, defer}
#   confidence: [1]             # scalar 0-1 (sigmoid)
#   value: [1]                  # state value for actor-critic
```

### Training Loop (Event-Driven)
```python
# Trigger: after N new outcomes (config: trigger_outcomes=50)
# 1. Load all Signals/ with outcomes/
# 2. For each (signal, outcome):
#      - Build feature vector at decision time (replay)
#      - Target: outcome → reward (success=1, partial=0.3, failure=-1)
#      - Loss = policy_gradient + value_mse + entropy_bonus
# 3. SGD step (Adam, lr=3e-4, batch=32, epochs=5)
# 4. Export ONNX → policy.onnx (atomic write)
# 5. Validate: offline eval on holdout → require improvement > 0.02 vs static Jaccard baseline
```

### Inference (at governance decision points)
```python
# Council ruling → P10 plan → Safety Car → Karpathy execution
# At each gate: policy(signal_embedding + context) → action + confidence
# If confidence > 0.8: auto-apply
# If 0.5 < confidence < 0.8: suggest + human confirm
# If confidence < 0.5: escalate to human (council/safety-car)
```

---

## Cross-Session Learning (D)

### Session Memory Migration
```
~/.pi/sessions/<session-id>/governance/
├── council/...
├── p10/...
├── signals/                  ← COPY of relevant Signals/ at session start
│   └── manifest.json         # {source_vault_hash, signal_count, index_version}
├── outcomes/                 ← NEW outcomes generated in this session
│   └── YYYY-MM-DD-*.md
└── policy_checkpoint.onnx    ← Policy snapshot at session start
```

### Handoff Protocol
```yaml
# Session A ends, writes handoff manifest
handoff:
  from_session: "abc123"
  to_session: "def456"        # or null for "any future"
  vault_hash: "sha256-of-Signals-dir"
  policy_version: "v3.2.1"
  new_signals: 47             # count added in this session
  new_outcomes: 12
  policy_delta: "params_updated"  # or "structural_change"

# Session B starts:
# 1. Verify vault_hash matches (or re-index if drifted)
# 2. Load policy_checkpoint.onnx
# 3. Replay new_outcomes → fine-tune (1 epoch, frozen backbone)
# 4. Continue with warm policy
```

### Embedding Alignment Across Sessions
- **Fixed embedding model** (pinned version in `.toto/config.yml`)
- **No fine-tuning of embedder** — only policy head adapts
- If embedding model must change: full re-index + policy retrain (council decision)

---

## Integration Points (Minimal Core Changes)

### 1. New Core Service: `RLService`
```typescript
// packages/core/src/RLService.ts
export class RLService {
  constructor(vaultPath: string, config: RLConfig);
  
  async indexSignals(): Promise<IndexStats>;           // builds FAISS + BM25
  async queryHybrid(text: string, tags: string[], k: number): Promise<SignalRecord[]>;
  async inferPolicy(signal: SignalRecord, context: PolicyContext): Promise<PolicyOutput>;
  async logOutcome(signalId: string, outcome: OutcomeRecord): Promise<void>;
  async trainIfTriggered(): Promise<TrainMetrics | null>;  // returns null if not triggered
}
```

### 2. MCP Tools (add to mcp-server)
| Tool | Purpose |
|------|---------|
| `rl_index` | Build/rebuild hybrid index |
| `rl_query` | Hybrid search over Signals/ |
| `rl_infer` | Policy inference at gate |
| `rl_outcome` | Log execution outcome |
| `rl_train` | Trigger training (manual or event) |
| `rl_handoff` | Export/import session checkpoint |

### 3. Governance Gate Integration
```typescript
// In CouncilService.run(), P10Service.runPlan(), SafetyCarService.run(), KarpathyService
// After human ruling, before auto-apply:
const policyOut = await rl.inferPolicy(currentSignal, currentContext);
if (policyOut.confidence > CONFIG.auto_apply_threshold) {
  return { action: 'auto_apply', policy: policyOut };
}
// else: return to human with policy recommendation
```

---

## Dependencies to Add

| Package | Purpose | Platform |
|---|---|---|
| `faiss-gpu` (PyPI) / `faiss-node` | Vector index (CUDA + MPS + CPU) | All |
| `onnxruntime-node` | Policy inference | All (native) |
| `tantivy` via `node-tantivy` or WASM | BM25 index | All |
| `@xenova/transformers` | Local bge embedding (ONNX) | All |
| `uuid` | Outcome IDs | All |

**Note:** Index build via Python subprocess (faiss-gpu + transformers); inference via Node (faiss-node + onnxruntime-node + @xenova/transformers).

---

## Config (`.toto/config.yml` additions)

```yaml
rl:
  enabled: true
  embedding_model: "BAAI/bge-small-en-v1.5"   # 384-dim, pinned
  embedding_dim: 384
  index:
    backend: "auto"              # cuda | metal | cpu | auto
    faiss_type: "HNSW32"
    bm25_language: "en"
    reranker_model: null         # Council decision; e.g., "cross-encoder/ms-marco-MiniLM-L-6-v2"
  policy:
    hidden_dims: [256, 128]
    action_space: ["apply_plan", "request_revision", "escalate_council", "request_human_review", "defer"]
    auto_apply_threshold: 0.8
    suggest_threshold: 0.5
  training:
    trigger: "event"             # "event" | "cron"
    trigger_outcomes: 50         # Train after N new outcomes
    batch_size: 32
    lr: 3e-4
    epochs: 5
    holdout_frac: 0.2
    min_improvement: 0.02        # vs static Jaccard baseline
  session:
    checkpoint_on_end: true
    warm_start_on_resume: true
```

---

## Phase Plan (Separate from Strangler Fig)

| Phase | Tasks | Days |
|---|---|---|
| **RL-1: Hybrid Index** | FAISS multi-backend + BM25 build from Signals/, hybrid query MCP tool | 3 |
| **RL-2: Policy Network** | ONNX model (input 512), export, inference MCP tool | 2 |
| **RL-3: Outcome Logging** | Outcome schema, log writer, attach to governance gates | 2 |
| **RL-4: Event Training Loop** | Trigger on N outcomes, trainer, eval gate, policy.onnx export | 3 |
| **RL-5: Session Handoff** | Checkpoint export/import, warm-start fine-tune | 2 |
| **RL-6: Gate Integration** | Wire into Council/P10/SafetyCar/Karpathy, 5-action routing | 2 |
| **RL-7: Hardening** | E2E tests, cold-start, Apple/NVIDIA CI, config validation | 2 |
| **Total** | | **16 days** |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Embedding drift across sessions | Pin model version; re-index on change (council-gated) |
| Policy overfits to noise | Holdout eval + min_improvement gate; entropy bonus |
| Index build time on large vault | Incremental update (only new signals); background job |
| ONNX runtime compatibility | Pin `onnxruntime-node` version; test Node 20/22/24 |
| Cold start (no outcomes) | Fallback to static Jaccard scoring (current behavior) |
| Outcomes not logged | Make `rl_outcome` required at Karpathy stage completion |
| Apple MPS FAISS not available | Graceful fallback to CPU; log warning |

---

## Next: P10 Plan

```
/p10 plan: implement RL phases RL-1 through RL-7 per RL_ARCHITECTURE.md with decisions:
- embedding: BAAI/bge-small-en-v1.5 (384-dim)
- vector index: FAISS multi-backend (CUDA→Metal→CPU auto-detect)
- reranker: council-decided (config default null)
- training: event-driven (trigger_outcomes=50)
- actions: 5 (added request_human_review)
```