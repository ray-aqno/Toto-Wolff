#!/usr/bin/env bash
# install-symlink.sh — wire toto-wolff governance into any repo
# Usage: ./scripts/install-symlink.sh /path/to/target-repo
set -euo pipefail

TARGET_REPO="${1:-}"
TOTO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PERSONAS_DIR="${TOTO_DIR}/personas"

if [ -z "$TARGET_REPO" ]; then
  echo "Usage: $0 /path/to/target-repo" >&2
  exit 1
fi

if [ ! -d "$TARGET_REPO" ]; then
  echo "ERROR: target repo not found: $TARGET_REPO" >&2
  exit 1
fi

if [ ! -d "$TARGET_REPO/.git" ]; then
  echo "ERROR: $TARGET_REPO is not a git repo" >&2
  exit 1
fi

ROLE="${TOTO_ROLE:-engineering}"
PERSONA_FILE="${PERSONAS_DIR}/${ROLE}.md"

if [ ! -f "$PERSONA_FILE" ]; then
  echo "ERROR: persona not found: $PERSONA_FILE" >&2
  echo "Available roles: $(ls "$PERSONAS_DIR" | sed 's/\.md$//' | tr '\n' ' ')" >&2
  exit 1
fi

TARGET_CLAUDE="${TARGET_REPO}/CLAUDE.md"

if [ -e "$TARGET_CLAUDE" ] && [ ! -L "$TARGET_CLAUDE" ]; then
  BACKUP="${TARGET_CLAUDE}.bak.$(date +%Y%m%d%H%M%S)"
  mv "$TARGET_CLAUDE" "$BACKUP"
  echo "INFO: existing CLAUDE.md backed up to $BACKUP"
fi

ln -sf "$PERSONA_FILE" "$TARGET_CLAUDE"
echo "OK: $TARGET_CLAUDE -> $PERSONA_FILE"
echo ""
echo "Toto is now active in $(basename "$TARGET_REPO") (role: $ROLE)."
echo "To switch roles: TOTO_ROLE=devops $0 $TARGET_REPO"
echo "To remove: rm $TARGET_CLAUDE"
