#!/usr/bin/env node
/**
 * Generates CLAUDE.md from .toto/config.yml
 * Run via: pnpm generate:claude-md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, '.toto', 'config.yml');
const OUTPUT_PATH = path.join(ROOT, 'CLAUDE.md');

function loadConfig(): any {
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return yaml.load(content);
}

function generateClaudeMd(config: any): string {
  const drs = config.drs || {};
  const council = config.council || {};
  const p10 = config.p10 || {};
  const cabinet = config.cabinet || {};
  const safetyCar = config.safety_car || {};
  const karpathy = config.karpathy || {};
  const subagent = config.subagent || {};

  let md = `# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

---

# Project: toto-wolff

Engineering governance stack for AI-assisted development. Implements council/p10/cabinet/safety-car/karpathy/drs/vault/subagent/RL as MCP tools + thin skills.

## Architecture

\`\`\`
packages/
├── core/           # @toto-wolff/core — governance services (Vault, Council, P10, Cabinet, SafetyCar, Karpathy, DRS, Subagent)
├── cli/            # @toto-wolff/cli — toto CLI (council, p10, cabinet, safety-car, karpathy, drs, vault, subagent, report, synthesize, radio)
├── mcp-server/     # @toto-wolff/mcp-server — MCP stdio/HTTP server exposing 11 tools + dashboard
└── dashboard/      # @toto-wolff/dashboard — terminal governance dashboard
\`\`\`

## Governance Stack (MCP Tools)

| Tool | Service | Description |
|---|---|---|
| \`vault_write\` | VaultService | Write record to vault |
| \`vault_search\` | VaultService | Search vault records |
| \`council_run\` | CouncilService | Tiered deliberative council |
| \`p10_plan\` | P10Service | NASA JPL Power of 10 planning |
| \`cabinet_run\` | CabinetService | Release gate (3 Opus seats) |
| \`safety_car_run\` | SafetyCarService | Adversarial P10 review |
| \`karpathy_check\` | KarpathyService | Execution verification (4 rules) |
| \`drs_check\` | DRSService | Deterministic boundary enforcement |
| \`subagent_list\` | SubagentService | List registered subagents |
| \`dashboard_status\` | — | Vault stats for dashboard |
| \`score_confidence\` | — | Council ruling confidence |

## Quick Start

\`\`\`bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint + typecheck
pnpm lint && pnpm typecheck

# Start MCP server (stdio for Claude Code)
pnpm -C packages/mcp-server start

# Run governance commands via CLI
pnpm -C packages/cli toto council "should we migrate to gRPC?"
pnpm -C packages/cli toto p10 "implement gRPC migration"
pnpm -C packages/cli toto cabinet "gRPC migration" v1.2.0
pnpm -C packages/cli toto safety-car P10-Plans/2025-08-05-gRPC.md
pnpm -C packages/cli toto karpathy P10-Plans/2025-08-05-gRPC.md "Stage 1" "<git diff>"
pnpm -C packages/cli toto drs-check '{"tool":"Write","target_path":"packages/core/src/auth.ts"}'
pnpm -C packages/cli toto subagent-list
\`\`\`

---

# Development Commands

\`\`\`bash
# Build
pnpm build                    # All packages
pnpm -C packages/core build   # Core only

# Test
pnpm test                     # All tests (vitest)
pnpm -C packages/core test    # Core tests
pnpm -C packages/mcp-server test

# Lint + Typecheck
pnpm lint                     # ESLint (zero warnings)
pnpm typecheck                # tsc --strict --noEmit

# Generate docs from config
pnpm generate:agents-md       # Generates AGENTS.md from .toto/config.yml
pnpm generate:claude-md       # Generates CLAUDE.md from .toto/config.yml

# Dashboard
pnpm -C packages/mcp-server start  # HTTP on :3099
# Then open http://127.0.0.1:3099/dashboard
\`\`\`

---

# Governance Workflow

\`\`\`
User Request
    │
    ▼
/council  ──► deliberates ──► ruling (approved/revision/blocked)
    │
    ▼
/p10  ──► scout/analyze/draft ──► Arbiter (Opus) ──► status: approved
    │
    ▼
/safety-car  ──► adversarial review ──► verdict (pass/conditional/fail)
    │
    ▼
/karpathy  ──► execution verification (4 rules) ──► status (pass/fail)
    │
    ▼
/p10 next stage or /cabinet for release
\`\`\`

---

# DRS (Drag Reduction System)

Ambient PreToolUse hook — fires on EVERY mutating tool call.

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

**5 Rules (first match wins):**
1. Frozen path → BLOCK
2. Out of scope → BLOCK
3. Auth surface → BLOCK
4. Cross-tenant → BLOCK
5. Destructive pattern → BLOCK

**Override:** \`"override drs: [reason]"\` in message before tool call

**Hook installed at:** \`.pi/hooks.json\`

---

# Karpathy Execution Rules (Active after P10 approval)

| Rule | Check |
|---|---|
| \`simplicity\` | No speculative features, no single-use abstractions |
| \`surgical\` | Touch only P10-authorized files, clean own orphans |
| \`goal_driven\` | Verify each step against P10 assertions |
| \`think_before_coding\` | State assumptions, surface tradeoffs, ask if unclear |

---

# RL on Governance Memory

Hybrid RAG (FAISS + BM25) + ONNX policy network for cross-session learning.

**Config (from .toto/config.yml):**
\`\`\`yaml
rl:
  enabled: ${config.rl?.enabled || true}
  embedding_model: "${config.rl?.embedding_model || 'BAAI/bge-small-en-v1.5'}"
  index:
    backend: "${config.rl?.index?.backend || 'auto'}"
  training:
    trigger: "${config.rl?.training?.trigger || 'event'}"
    trigger_outcomes: ${config.rl?.training?.trigger_outcomes || 50}
\`\`\`

---

# Subagent Orchestration

Governance workflow presets via \`subagent\` extension:

- \`parallel\`: Council scouts (4), P10 analysis (4)
- \`single\`: Safety Car adversarial, Cabinet seat
- \`chain\`: Karpathy verify (worker → reviewer → worker)

**Config:**
\`\`\`yaml
subagent:
  default_scope: ${subagent.default_scope || 'both'}
  max_parallel: ${subagent.max_parallel || 4}
\`\`\`

---

# Config-Driven Documentation

**Single source:** \`.toto/config.yml\`

**Generated:**
- \`AGENTS.md\` — Full governance reference for agents
- \`CLAUDE.md\` — This file (Claude Code guidance)

**Regenerate:**
\`\`\`bash
pnpm generate:agents-md
pnpm generate:claude-md
\`\`\`

---

# Key Files

| File | Purpose |
|---|---|
| \`.toto/config.yml\` | Single source of truth for all governance config |
| \`.toto/drs-config.json\` | DRS runtime config (auto-synced from config.yml) |
| \`.toto/freeze.json\` | Frozen paths for DRS Rule 1 |
| \`.toto/sensitive-patterns.json\` | Pre-commit hook patterns |
| \`.pi/hooks.json\` | DRS PreToolUse hook registration |
| \`P10-Plans/*.md\` | Approved P10 plans |
| \`session/governance/*\` | Session memory records |

---

# Environment Variables

| Variable | Required | Description |
|---|---|---|
| \`ANTHROPIC_API_KEY\` | Yes* | Personal API key (or use \`ANTHROPIC_AUTH_TOKEN\`) |
| \`ANTHROPIC_AUTH_TOKEN\` | Yes* | Enterprise/Manifest token |
| \`ANTHROPIC_BASE_URL\` | If using token | Manifest base URL (e.g., http://localhost:2099) |
| \`TOTO_VAULT_PATH\` | No | Override vault path (default: ~/.toto/vault) |
| \`TOTO_MCP_PORT\` | No | Dashboard HTTP port (default: 3099) |

*One of API_KEY or AUTH_TOKEN required for MCP server.

---

<!-- 
  Generated from .toto/config.yml by scripts/generate-claude-md.ts
  Do not edit manually — edit .toto/config.yml and re-run generator
-->\n`;

  return md;
}

function main() {
  const config = loadConfig();
  const md = generateClaudeMd(config);
  fs.writeFileSync(OUTPUT_PATH, md);
  console.log(`Generated ${OUTPUT_PATH}`);
}

main();