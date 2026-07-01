#!/usr/bin/env bash
# scripts/install-hooks.sh — install toto-wolff pre-commit hook into a repo
# Usage: ./scripts/install-hooks.sh [/path/to/target-repo]
# Defaults to current repo if no argument given.
set -euo pipefail

readonly TOTO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
readonly HOOK_SRC="${TOTO_DIR}/scripts/hooks/pre-commit"
readonly TARGET_REPO="${1:-$(git rev-parse --show-toplevel)}"

# R5 guard 1: source hook file exists
test -f "${HOOK_SRC}" || {
  echo "ERROR: hook source not found: ${HOOK_SRC}" >&2
  exit 1
}

# R5 guard 2: target is a git repo
git -C "${TARGET_REPO}" rev-parse --git-dir >/dev/null 2>&1 || {
  echo "ERROR: not a git repository: ${TARGET_REPO}" >&2
  exit 1
}

readonly HOOKS_DIR="${TARGET_REPO}/.git/hooks"
readonly HOOK_DEST="${HOOKS_DIR}/pre-commit"

if [ -e "${HOOK_DEST}" ] && [ ! -L "${HOOK_DEST}" ]; then
  readonly BACKUP="${HOOK_DEST}.bak.$(date +%Y%m%d%H%M%S)"
  cp "${HOOK_DEST}" "${BACKUP}"
  echo "INFO: existing pre-commit backed up to ${BACKUP}"
fi

cp "${HOOK_SRC}" "${HOOK_DEST}"
chmod +x "${HOOK_DEST}"
echo "OK: pre-commit hook installed at ${HOOK_DEST}"
echo "Patterns source: ${TARGET_REPO}/.toto/sensitive-patterns.json"
