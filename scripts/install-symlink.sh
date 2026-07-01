#!/usr/bin/env bash
# install-symlink.sh — wire toto-wolff governance into any repo
# Usage: ./scripts/install-symlink.sh /path/to/target-repo
#
# Splices the persona block between TOTO:ROLE markers in the target's
# CLAUDE.md rather than symlinking the whole file — a symlink would
# replace any pre-existing CLAUDE.md content wholesale. See council
# ruling 2026-07-01-strangler-fig-seam-bugs.
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

if ! git -C "$TARGET_REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: $TARGET_REPO is not a git repo" >&2
  exit 1
fi

ROLE="${TOTO_ROLE:-engineering}"
if ! echo "$ROLE" | grep -qE '^[a-z][a-z0-9-]*$'; then
  echo "ERROR: TOTO_ROLE must match [a-z][a-z0-9-]+ (got: $ROLE)" >&2
  exit 1
fi
PERSONA_FILE="${PERSONAS_DIR}/${ROLE}.md"

if [ ! -f "$PERSONA_FILE" ]; then
  echo "ERROR: persona not found: $PERSONA_FILE" >&2
  echo "Available roles: $(ls "$PERSONAS_DIR" | sed 's/\.md$//' | tr '\n' ' ')" >&2
  exit 1
fi

TARGET_CLAUDE="${TARGET_REPO}/CLAUDE.md"

# A prior buggy install may have left TARGET_CLAUDE as a symlink into this
# repo's personas/ dir. There is no independent content to preserve in that
# case — back up the link and treat it as a fresh install.
if [ -L "$TARGET_CLAUDE" ]; then
  BACKUP="${TARGET_CLAUDE}.bak.$(date +%Y%m%d%H%M%S)"
  cp -P "$TARGET_CLAUDE" "$BACKUP"
  rm "$TARGET_CLAUDE"
  echo "INFO: prior symlink install backed up to $BACKUP"
fi

if [ -f "$TARGET_CLAUDE" ]; then
  BACKUP="${TARGET_CLAUDE}.bak.$(date +%Y%m%d%H%M%S)"
  cp "$TARGET_CLAUDE" "$BACKUP"
  echo "INFO: existing CLAUDE.md backed up to $BACKUP"
fi

RESULT=$(python3 - "$TARGET_CLAUDE" "$PERSONA_FILE" <<'PYEOF' 2>&1
import sys

target_path, persona_path = sys.argv[1], sys.argv[2]
START = "<!-- TOTO:ROLE:START -->"
END = "<!-- TOTO:ROLE:END -->"

with open(persona_path, "r") as f:
    persona_body = f.read().strip()
block = f"{START}\n{persona_body}\n{END}"

try:
    with open(target_path, "r") as f:
        existing = f.read()
except FileNotFoundError:
    existing = ""

start_idx = existing.find(START)
end_idx = existing.find(END)

if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
    # Idempotent splice: replace only the marker-delimited block in place.
    before = existing[:start_idx]
    after = existing[end_idx + len(END):]
    new_content = before + block + after
elif start_idx == -1 and end_idx == -1:
    # No markers: preserve all existing content, append the block.
    sep = "\n\n" if existing.strip() else ""
    new_content = existing.rstrip("\n") + sep + block + "\n"
else:
    print("ERROR: CLAUDE.md has a malformed TOTO:ROLE marker pair — resolve manually", file=sys.stderr)
    sys.exit(1)

with open(target_path, "w") as f:
    f.write(new_content)

print("OK")
PYEOF
)
[[ "$RESULT" == "OK" ]] || { echo "ERROR: role splice failed — ${RESULT}" >&2; exit 1; }

echo "OK: $TARGET_CLAUDE spliced with $PERSONA_FILE (role: $ROLE)"
echo ""
echo "Toto is now active in $(basename "$TARGET_REPO") (role: $ROLE)."
echo "To switch roles: TOTO_ROLE=devops $0 $TARGET_REPO"
echo "To remove: delete the TOTO:ROLE marker block from $TARGET_CLAUDE"
