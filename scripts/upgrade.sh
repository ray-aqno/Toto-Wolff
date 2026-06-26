#!/usr/bin/env bash
# toto upgrade — pull latest release, rebuild, re-run setup non-destructively.
# Safe to run on a live installation. Vault, credentials, and config are untouched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[upgrade]${NC} $*"; }
success() { echo -e "${GREEN}[upgrade]${NC} $*"; }
warn()    { echo -e "${YELLOW}[upgrade]${NC} $*"; }
die()     { echo -e "${RED}[upgrade] ERROR:${NC} $*" >&2; exit 1; }

cd "$REPO_DIR"

# Require git
command -v git &>/dev/null || die "git not found. Install git and retry."

# Require pnpm
command -v pnpm &>/dev/null || die "pnpm not found. Install pnpm 11.5.1+ and retry."

# Record current version before pull
BEFORE_VERSION=""
if [ -f VERSION ]; then
  BEFORE_VERSION="$(cat VERSION | tr -d '[:space:]')"
fi
BEFORE_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"

info "Current: ${BEFORE_VERSION:-unknown} (${BEFORE_COMMIT})"
info "Pulling latest from origin/main..."

# Stash any local changes to tracked files — we don't want to lose them
STASH_OUTPUT=""
if ! git diff --quiet HEAD 2>/dev/null; then
  warn "Local changes detected. Stashing before upgrade..."
  STASH_OUTPUT="$(git stash push -m 'toto-upgrade-stash' 2>&1)"
  STASHED=1
else
  STASHED=0
fi

# Pull
git pull origin main 2>&1 | grep -v "^From " || true

AFTER_VERSION=""
if [ -f VERSION ]; then
  AFTER_VERSION="$(cat VERSION | tr -d '[:space:]')"
fi
AFTER_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"

if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
  info "Already at latest (${AFTER_COMMIT}). Rebuilding anyway..."
else
  info "Updated: ${BEFORE_VERSION:-unknown} → ${AFTER_VERSION:-unknown} (${BEFORE_COMMIT} → ${AFTER_COMMIT})"
  # Show what changed
  echo ""
  git log --oneline "${BEFORE_COMMIT}..HEAD" 2>/dev/null | head -20 || true
  echo ""
fi

# Install dependencies
info "Installing dependencies..."
pnpm install --frozen-lockfile 2>&1 | tail -5

# Build all packages
info "Building packages..."
pnpm -r build 2>&1 | grep -E '(Done|Failed|error)' || true

# Re-run setup non-destructively (preserves vault, credentials, config)
info "Re-running setup (non-destructive)..."
if [ -f "$REPO_DIR/setup" ]; then
  # Pass --upgrade flag if setup supports it; otherwise run normally
  # setup is idempotent: it will not overwrite existing vault or credentials
  bash "$REPO_DIR/setup" --non-interactive 2>&1 || {
    warn "setup returned non-zero — this may be expected if credentials are not set in this shell."
    warn "Your installation is still updated. Run './setup' manually if needed."
  }
fi

# Restore stash if we stashed
if [ "$STASHED" -eq 1 ]; then
  info "Restoring local changes from stash..."
  git stash pop 2>&1 || warn "Could not restore stash automatically. Run 'git stash pop' manually."
fi

echo ""
success "Upgrade complete: ${AFTER_VERSION:-unknown} (${AFTER_COMMIT})"
if [ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ]; then
  info "Review CHANGELOG.md for what changed."
fi
