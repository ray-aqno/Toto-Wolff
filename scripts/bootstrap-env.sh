#!/usr/bin/env bash
# scripts/bootstrap-env.sh — Phase 1 eval pre-conditions
# CSO: no user-controlled input; all assertions fail-loud with remediation messages
set -euo pipefail

VAULT_PATH="${TOTO_VAULT_PATH:-${HOME}/Documents/Obsidian Vault}"

# 4 assertions — loud failure with one-liner remediation messages
# Accept either a personal API key (Option A) or the enterprise token pair (Option B).
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "ERROR: no Anthropic credentials found."
  echo "  Option A: export ANTHROPIC_API_KEY=<key>"
  echo "  Option B: export ANTHROPIC_AUTH_TOKEN=<token> && export ANTHROPIC_BASE_URL=<url>"
  exit 2
fi
if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
  echo "ERROR: ANTHROPIC_AUTH_TOKEN is set but ANTHROPIC_BASE_URL is missing. Both are required for Option B."
  exit 2
fi
command -v rg    >/dev/null 2>&1 || { echo "ERROR: ripgrep not found. Run: brew install ripgrep"; exit 2; }
command -v node  >/dev/null 2>&1 || { echo "ERROR: node not found. Run: brew install node"; exit 2; }
command -v pnpm  >/dev/null 2>&1 || { echo "ERROR: pnpm not found. Run: npm install -g pnpm"; exit 2; }

# Idempotency-guarded git init — worktree-safe check (CSO: -d .git fails for worktrees)
if ! git -C "${VAULT_PATH}" rev-parse --git-dir >/dev/null 2>&1; then
  git init "${VAULT_PATH}"
  echo "INFO: vault initialized as git repo at ${VAULT_PATH}"
else
  echo "INFO: vault already a git repo — skipping git init"
fi

echo "bootstrap-env: OK"
