#!/usr/bin/env bash
# scripts/bootstrap-env.sh — Phase 1 eval pre-conditions
# CSO: no user-controlled input; all assertions fail-loud with remediation messages
set -euo pipefail

VAULT_PATH="${TOTO_VAULT_PATH:-${HOME}/Documents/Obsidian Vault}"

# 4 assertions — loud failure with one-liner remediation messages
[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "ERROR: ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=<key>"; exit 2; }
command -v rg    >/dev/null 2>&1 || { echo "ERROR: ripgrep not found. Run: brew install ripgrep"; exit 2; }
command -v node  >/dev/null 2>&1 || { echo "ERROR: node not found. Run: brew install node"; exit 2; }
command -v pnpm  >/dev/null 2>&1 || { echo "ERROR: pnpm not found. Run: npm install -g pnpm"; exit 2; }

# Idempotency-guarded git init — VAULT_PATH quoted throughout (path contains space)
if [ ! -d "${VAULT_PATH}/.git" ]; then
  git init "${VAULT_PATH}"
  echo "INFO: vault initialized as git repo at ${VAULT_PATH}"
else
  echo "INFO: vault already a git repo — skipping git init"
fi

echo "bootstrap-env: OK"
