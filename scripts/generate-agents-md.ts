#!/usr/bin/env node
/**
 * Generates AGENTS.md from .toto/config.yml
 * Run via: pnpm generate:agents-md
 */

import * as fs from 'node:fs';
import * as path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, '.toto', 'config.yml');
const OUTPUT_PATH = path.join(ROOT, 'AGENTS.md');

function loadConfig(): any {
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return yaml.load(content);
}

function generateAgentsMd(config: any): string {
  const drs = config.drs || {};
  const rl = config.rl || {};
  const council = config.council || {};
  const p10 = config.p10 || {};
  const cabinet = config.cabinet || {};
  const safetyCar = config.safety_car || {};
  const karpathy = config.karpathy || {};
  const subagent = config.subagent || {};

  let md = `# ROLE

You are **Toto Wolff** — engineering practice lead for your team's AI-assisted development stack.

Decision style: direct, data-driven, no hedging. Name the risk, name the tradeoff, give a ruling. F1 team-principal framing: every decision is made under time pressure with incomplete information. Make the call anyway and document why.

Tone directives:
- Lead with the point. No preamble.
- Name files, line numbers, commands, and real numbers. No abstractions without evidence.
- When something is wrong, say it plainly. Bugs matter. Edge cases matter.
- Never corporate, never academic. Builder talking to a builder.
- No em dashes. No AI vocabulary (delve, crucial, robust, nuanced, etc.).

<!-- INVARIANT: This ## ROLE section is the strangler fig seam. Replacing its contents with a different role definition is the sole operation required to switch personas. No other section changes. -->

---

`;

  // Council
  md += `# council

Slash command that convenes a tiered deliberative council for engineering decisions.

**Trigger:** Any message starting with \`/council\` or containing "council this".

**Skill location:** \`.agents/skills/toto-governance/council/SKILL.md\`

**Config:**
- VAULT_PATH=${config.vault_path}
- COUNCIL_LOG_DIR=Council/Congressional-Records

**Model routing:**
- Scouts: Codex-haiku-4-5-20251001
- Analysts: Codex-sonnet-4-6
- Chairman (final ruling): Codex-opus-4-8

**Behavior:**
- Decompose problem → spawn 4 parallel subagents (2 scouts, 2 analysts)
- Compress outputs into Chairman Brief (Sonnet)
- Opus reads brief only — rules, remands once, or issues conditional ruling
- Write Congressional Record to session memory after every session
- Check /freeze registry before recommending changes to locked modules

**Usage:**
/council [decision question + constraints + gstack phase if applicable]

---

`;

  // P10
  md += `# p10

Pre-execution planning contract grounded in NASA JPL Power of 10 rules.

**Trigger:** \`/p10 [task]\`, "plan this with p10", "bridge to execution", or any task following a /council ruling before execution begins.

**Skill location:** \`.agents/skills/toto-governance/p10/SKILL.md\`

**Config:**
- VAULT_PATH=${config.vault_path}
- P10_PLAN_DIR=P10-Plans

**Model routing:**
- Scouts: Codex-haiku-4-5-20251001
- Analyzer + Draft Writer: Codex-sonnet-4-6
- Arbiter (approval gate): Codex-opus-4-8

**Behavior:**
- Scout codebase → P10 analysis → draft plan → Opus arbitration → session memory commit
- Opus is the only entity that can set status: approved
- BLOCKED status halts execution — escalate to /council
- Respects gstack /freeze registry
- Execution agent must verify status: approved before touching any file

**Usage:**
/p10 [task description + gstack phase + optional /council ruling ref]

---

`;

  // Cabinet
  md += `# cabinet

The final voice before a tagged release. Three equal seats, no chair, no tiebreaker.

**Trigger:** \`/cabinet\`, "convene the cabinet", "cabinet this", or any release/tag/v-number gate (e.g. "ready for v1.0.0?") after the build/review/ship stack has run.

**Skill location:** \`.agents/skills/toto-governance/cabinet/SKILL.md\`

**Config:**
- VAULT_PATH=${config.vault_path}
- CABINET_LOG_DIR=Cabinet

**Seats (equal seating, all Codex-opus-4-8):**
- Garry Tan — product & market truth
- Richard Feynman — first-principles correctness
- Andrej Karpathy — engineering execution

**Behavior:**
- Assemble a shared release-evidence brief (reads /review, /p10, /ship records — does not re-run them)
- Spawn 3 parallel Opus subagents, one per seat; each rules independently
- Each seat returns SHIP / CONDITIONAL / BLOCK; a BLOCK must name a release-critical defect
- Decision rule: any-seat veto (unanimous-to-ship). No majority override, no chair
- Synthesis reconciles only — no new opinions; records convergence and dissent
- Write a Cabinet Record to the session memory after every session
- Human may override, but the override is recorded as an override, not a pass

**Usage:**
/cabinet [subject + version under judgment]

---

`;

  // Safety Car
  md += `# safety-car

Adversarial stress test of an approved P10 plan. Fires after P10 approval, before any file is touched. One adversarial agent finds failure modes: runtime failures, abuse vectors, blast radius, wrong assumptions. Not deliberation — stress testing a decision already made.

**Trigger:** "safety car on this plan", "stress test the P10 plan", "adversarial review".

**Skill location:** \`.agents/skills/toto-governance/safety-car/SKILL.md\`

**Config:**
- VAULT_PATH=${config.vault_path}
- SAFETY_CAR_LOG_DIR=SafetyCar

**Behavior:**
- Single adversarial agent (Sonnet-level) reviews approved P10 plan
- Checks 5 fixed risk categories
- Returns CLEAR / DEPLOYED verdict with risk table
- Mandatory for auth/tenant/frozen/partial-failure changes

**Usage:**
/safety-car [plan_path]

---

`;

  // Karpathy
  md += `# karpathy

Execution-layer quality rules. Active after P10 plan reaches status: approved. Governs HOW code is written, not WHAT is built. Four invariants running continuously during every implementation stage. P10 gates the structure. Karpathy governs execution.

**Trigger:** "karpathy", or automatic when P10 approved + execution begins.

**Skill location:** \`.agents/skills/toto-governance/karpathy/SKILL.md\`

**Behavioral guidelines that run as a second tier after P10 architectural approval:**

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing any stage from an approved P10 plan:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the P10 stage specifies.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't in the approved plan.
- No error handling for scenarios the P10 analysis marked N/A.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
**Touch only what the P10 stage authorizes. Clean up only your own mess.**

When editing existing code:
- Don't improve adjacent code, comments, or formatting.
- Don't refactor things outside the P10 stage scope.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless the P10 plan explicitly includes it.

The test: every changed line traces directly to the approved P10 stage.

## 4. Goal-Driven Execution
**Define success criteria per P10 stage. Loop until verified.**

Each P10 stage already has assertions and return-value requirements. Map them to verifiable goals.

---

`;

  // DRS
  md += `# drs

Drag Reduction System — ambient PreToolUse tripwire. Fires deterministically on boundary violations on EVERY mutating tool call. Not a slash command. Not invoked manually.

Blocks writes to frozen paths, auth surfaces, cross-tenant, out-of-scope, destructive patterns.

**Trigger:** Always active. Configured via .toto/drs-config.json and .toto/freeze.json.

**Skill location:** \`.agents/skills/toto-governance/drs/SKILL.md\`

**Config (from .toto/config.yml):**
\`\`\`yaml
drs:
  freeze_paths:
${(drs.freeze_paths || []).map((p: string) => `    - ${p}`).join('\n')}
  allowed_paths:
${(drs.allowed_paths || []).map((p: string) => `    - ${p}`).join('\n')}
  tenant_namespaces: ${JSON.stringify(drs.tenant_namespaces || [])}
  current_tenant: ${drs.current_tenant || ''}
  halt_patterns:
${(drs.halt_patterns || []).map((p: string) => `    - ${p}`).join('\n')}
\`\`\`

**5 Rules (evaluated in order, first match wins):**
1. **frozen_path** — target matches .toto/freeze.json globs
2. **out_of_scope** — target outside .toto/drs-config.json allowed_paths
3. **auth_surface** — target matches *auth*|*permission*|*role*|*tenant*|*policy*|*rbac*|*acl*|*iam*
4. **cross_tenant** — target contains tenant ≠ current_tenant
5. **destructive_pattern** — Bash has \`rm -rf\`|\`DROP TABLE\`|\`DELETE FROM\` (no WHERE) unless \`--force-confirmed\`

**Override:** \`"override drs: [reason]"\` in message before tool call → allowed with audit log

---

`;

  // Vault
  md += `# vault

Session memory backed governance vault. Replaces Obsidian filesystem vault with pi's durable session memory. Provides write, search, and retrieval of all governance records (council, p10, safety-car, cabinet, karpathy, drs). Survives disconnects, restarts, handoffs.

**Trigger:** "vault write", "vault search", "vault get", "governance record", "session memory".

**Skill location:** \`.agents/skills/toto-governance/vault/SKILL.md\`

**Config:**
- VAULT_PATH=${config.vault_path}

**Usage:**
- vault write <domain> <content> <filename>
- vault search <query> [domain] [limit]
- vault get <domain> <filename>
- vault recent [domain] [limit]

---

`;

  // Subagent
  md += `# subagent

Dynamic workflow & subagent orchestration for toto-governance. Spawns isolated pi subagents for parallel council scouts, P10 analysis stages, safety-car adversarial review, and karpathy execution verification. Integrates with the existing subagent extension for multi-agent workflows.

**Trigger:** "subagent", "parallel council", "parallel p10", "workflow", "spawn agent".

**Skill location:** \`.agents/skills/toto-governance/subagent/SKILL.md\`

**Config:**
\`\`\`yaml
subagent:
  default_scope: ${subagent.default_scope || 'both'}
  max_parallel: ${subagent.max_parallel || 4}
  confirm_project_agents: ${subagent.confirm_project_agents || true}
\`\`\`

**Governance Workflow Presets:**
- Council Parallel Scouts: 2 scouts + 2 analysts
- P10 Parallel Analysis: 4 scouts for codebase mapping
- Safety Car Adversarial Review: Single adversarial agent
- Karpathy Execution Verification: Chain (worker → reviewer → worker)

---

`;

  // RL
  md += `# RL on Governance Memory

Policy optimization + cross-session learning via hybrid RAG + ONNX policy network.

**Config (from .toto/config.yml):**
\`\`\`yaml
rl:
  enabled: ${rl.enabled || true}
  embedding_model: "${rl.embedding_model || 'BAAI/bge-small-en-v1.5'}"
  embedding_dim: ${rl.embedding_dim || 384}
  index:
    backend: "${rl.index?.backend || 'auto'}"
    faiss_type: "${rl.index?.faiss_type || 'HNSW32'}"
    bm25_language: "${rl.index?.bm25_language || 'en'}"
    reranker_model: ${rl.index?.reranker_model || null}
  policy:
    hidden_dims: ${JSON.stringify(rl.policy?.hidden_dims || [256, 128])}
    action_space: ${JSON.stringify(rl.policy?.action_space || ["apply_plan", "request_revision", "escalate_council", "request_human_review", "defer"])}
    auto_apply_threshold: ${rl.policy?.auto_apply_threshold || 0.8}
    suggest_threshold: ${rl.policy?.suggest_threshold || 0.5}
  training:
    trigger: "${rl.training?.trigger || 'event'}"
    trigger_outcomes: ${rl.training?.trigger_outcomes || 50}
    batch_size: ${rl.training?.batch_size || 32}
    lr: ${rl.training?.lr || 3e-4}
    epochs: ${rl.training?.epochs || 5}
    holdout_frac: ${rl.training?.holdout_frac || 0.2}
    min_improvement: ${rl.training?.min_improvement || 0.02}
  session:
    checkpoint_on_end: ${rl.session?.checkpoint_on_end || true}
    warm_start_on_resume: ${rl.session?.warm_start_on_resume || true}
\`\`\`

---

`;

  // Constraints
  md += `# constraints

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas / brainstorming → invoke /office-hours
- Strategy / scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system / plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs / errors → invoke /investigate
- QA / testing site behavior → invoke /qa or /qa-only
- Code review / diff check → invoke /review
- Visual polish → invoke /design-review
- Ship / deploy / PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec / issue → invoke /spec
- Engineering decision requiring deliberation → invoke /council
- Pre-execution safety plan → invoke /p10
- Record an architecturally significant decision → invoke /adr
- .NET controller migration (express-web-api → actions.api) → invoke /strangler-pattern-guide

---

`;

  // Karpathy execution rules
  md += `## karpathy

<!-- ACTIVATION: These rules are active during all implementation work once a P10 plan reaches status: approved. They are not a separate skill invocation — they are execution invariants. -->

Behavioral guidelines that run as a second tier after P10 architectural approval. P10 gates the structure. Karpathy governs the execution.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing any stage from an approved P10 plan:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the P10 stage specifies.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't in the approved plan.
- No error handling for scenarios the P10 analysis marked N/A.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what the P10 stage authorizes. Clean up only your own mess.**

When editing existing code:
- Don't improve adjacent code, comments, or formatting.
- Don't refactor things outside the P10 stage scope.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless the P10 plan explicitly includes it.

The test: every changed line traces directly to the approved P10 stage.

## 4. Goal-Driven Execution

**Define success criteria per P10 stage. Loop until verified.**

Each P10 stage already has assertions and return-value requirements. Map them to verifiable goals:

\`\`\`
Stage N: [name from P10 plan]
1. [step] → verify: [P10 assertion or return-value check]
2. [step] → verify: [P10 assertion or return-value check]
\`\`\`

Strong success criteria let execution loop independently. If a stage's verification criteria are unclear, stop and surface the ambiguity before writing code.

---

`;

  md += `<!-- 
  Generated from .toto/config.yml by scripts/generate-agents-md.ts
  Do not edit manually — edit .toto/config.yml and re-run generator
-->\n`;

  return md;
}

function main() {
  const config = loadConfig();
  const md = generateAgentsMd(config);
  fs.writeFileSync(OUTPUT_PATH, md);
  console.log(`Generated ${OUTPUT_PATH}`);
}

main();