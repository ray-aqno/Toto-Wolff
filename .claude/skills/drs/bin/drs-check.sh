#!/usr/bin/env bash
# DRS check script — reads tool call JSON from stdin, evaluates 5 boundary rules.
# Exit 0 = allow. Exit 1 = block.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FREEZE_FILE="$PROJECT_ROOT/.toto/freeze.json"
DRS_CONFIG="$PROJECT_ROOT/.toto/drs-config.json"

# Read vault path — check TOTO_VAULT_PATH env var, fall back to ~/.toto/vault
VAULT_PATH="${TOTO_VAULT_PATH:-$HOME/.toto/vault}"
DRS_VAULT_DIR="$VAULT_PATH/DRS"

# Read stdin
INPUT="$(cat)"

# Extract tool name and relevant inputs using jq if available, else python3
if command -v jq &>/dev/null; then
  TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")"
  TOOL_INPUT="$(echo "$INPUT" | jq -c '.tool_input // {}' 2>/dev/null || echo "{}")"
  FILE_PATH="$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null || echo "")"
  COMMAND="$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null || echo "")"
  NEW_STRING="$(echo "$TOOL_INPUT" | jq -r '.new_string // empty' 2>/dev/null || echo "")"
  CONTENT="$(echo "$TOOL_INPUT" | jq -r '.content // empty' 2>/dev/null || echo "")"
else
  TOOL_NAME="$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")"
  TOOL_INPUT="$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tool_input',{})))" 2>/dev/null || echo "{}")"
  FILE_PATH="$(echo "$TOOL_INPUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('file_path',''))" 2>/dev/null || echo "")"
  COMMAND="$(echo "$TOOL_INPUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('command',''))" 2>/dev/null || echo "")"
  NEW_STRING="$(echo "$TOOL_INPUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('new_string',''))" 2>/dev/null || echo "")"
  CONTENT="$(echo "$TOOL_INPUT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('content',''))" 2>/dev/null || echo "")"
fi

# Only check mutating tools
case "$TOOL_NAME" in
  Write|Edit|NotebookEdit|Bash) ;;
  *) exit 0 ;;
esac

# Check for override in the environment (set by the hook runner from the user message)
OVERRIDE_REASON="${DRS_OVERRIDE_REASON:-}"
if [ -n "$OVERRIDE_REASON" ]; then
  write_override_record() {
    local rule="$1" target="$2"
    mkdir -p "$DRS_VAULT_DIR"
    local slug; slug="$(date +%Y%m%d-%H%M%S)-r${rule}-override"
    {
      echo "---"
      echo "date: $(date +%Y-%m-%d)"
      echo "rule_fired: $rule"
      echo "tool: $TOOL_NAME"
      echo "target: $target"
      echo "verdict: OVERRIDDEN"
      echo "override: true"
      echo "override_reason: \"$OVERRIDE_REASON\""
      echo "---"
      echo ""
      echo "DRS Rule $rule override accepted."
      echo "Target: $target"
      echo "Reason: $OVERRIDE_REASON"
    } > "$DRS_VAULT_DIR/$slug.md"
  }
fi

drs_halt() {
  local rule="$1" reason="$2" target="$3"
  # If override is set, log and allow
  if [ -n "$OVERRIDE_REASON" ]; then
    write_override_record "$rule" "$target"
    exit 0
  fi
  # Write DRS vault record
  mkdir -p "$DRS_VAULT_DIR"
  local slug; slug="$(date +%Y%m%d-%H%M%S)-r${rule}-blocked"
  {
    echo "---"
    echo "date: $(date +%Y-%m-%d)"
    echo "rule_fired: $rule"
    echo "tool: $TOOL_NAME"
    echo "target: $target"
    echo "verdict: BLOCKED"
    echo "override: false"
    echo "override_reason: null"
    echo "---"
    echo ""
    echo "DRS BLOCK — Rule $rule"
    echo "Reason: $reason"
    echo "Target: $target"
    echo "To override: set DRS_OVERRIDE_REASON='your reason' in the environment, or include 'override drs: [reason]' in your message."
  } > "$DRS_VAULT_DIR/$slug.md"
  echo "DRS BLOCKED: Rule $rule — $reason (target: $target)" >&2
  echo "Record written to: $DRS_VAULT_DIR/$slug.md" >&2
  exit 1
}

# Rule 1 — Frozen path
check_rule1() {
  local target="$1"
  [ -z "$target" ] && return
  [ ! -f "$FREEZE_FILE" ] && return
  # Read frozen paths and check if target matches
  if command -v jq &>/dev/null; then
    local frozen_paths
    frozen_paths="$(jq -r '.frozen[]? // empty' "$FREEZE_FILE" 2>/dev/null || echo "")"
    while IFS= read -r frozen_path; do
      [ -z "$frozen_path" ] && continue
      # Normalize: remove trailing slash from frozen_path
      frozen_path="${frozen_path%/}"
      # Check prefix match (handles both exact and glob-prefix)
      if [[ "$target" == "$frozen_path" ]] || [[ "$target" == "$frozen_path"/* ]] || [[ "$target" == *"$frozen_path"* ]]; then
        drs_halt 1 "Path is frozen: $frozen_path" "$target"
      fi
    done <<< "$frozen_paths"
  else
    local frozen_paths
    frozen_paths="$(python3 -c "import json; d=json.load(open('$FREEZE_FILE')); print('\n'.join(d.get('frozen',[])))" 2>/dev/null || echo "")"
    while IFS= read -r frozen_path; do
      [ -z "$frozen_path" ] && continue
      if [[ "$target" == *"$frozen_path"* ]]; then
        drs_halt 1 "Path is frozen: $frozen_path" "$target"
      fi
    done <<< "$frozen_paths"
  fi
}

# Rule 2 — Out-of-scope write
check_rule2() {
  local target="$1"
  [ -z "$target" ] && return
  [ ! -f "$DRS_CONFIG" ] && return
  if command -v jq &>/dev/null; then
    local allowed_paths
    allowed_paths="$(jq -r '.allowed_paths[]? // empty' "$DRS_CONFIG" 2>/dev/null || echo "")"
    [ -z "$allowed_paths" ] && return
    local matched=0
    while IFS= read -r allowed; do
      [ -z "$allowed" ] && continue
      if [[ "$target" == "$allowed"* ]] || [[ "$target" == *"/$allowed"* ]]; then
        matched=1
        break
      fi
    done <<< "$allowed_paths"
    if [ "$matched" -eq 0 ]; then
      drs_halt 2 "Write target outside declared project scope" "$target"
    fi
  fi
}

# Rule 3 — Permission/auth/role/tenant surface
check_rule3() {
  local target="$1"
  local cmd="$2"
  # File path check
  if [ -n "$target" ]; then
    local basename; basename="$(basename "$target" | tr '[:upper:]' '[:lower:]')"
    if echo "$basename" | grep -qE '(permission|auth|role|tenant|policy|rbac|acl|iam)'; then
      drs_halt 3 "Write touches an authorization/permission surface: $basename" "$target"
    fi
  fi
  # Bash command check
  if [ -n "$cmd" ]; then
    if echo "$cmd" | grep -qE '\b(chmod|chown|usermod|groupadd|setcap)\b'; then
      drs_halt 3 "Command modifies system permissions" "$cmd"
    fi
  fi
}

# Rule 4 — Cross-tenant write
check_rule4() {
  local target="$1"
  [ -z "$target" ] && return
  [ ! -f "$DRS_CONFIG" ] && return
  if command -v jq &>/dev/null; then
    local current_tenant tenant_namespaces
    current_tenant="$(jq -r '.current_tenant // empty' "$DRS_CONFIG" 2>/dev/null || echo "")"
    tenant_namespaces="$(jq -r '.tenant_namespaces[]? // empty' "$DRS_CONFIG" 2>/dev/null || echo "")"
    [ -z "$current_tenant" ] && return
    while IFS= read -r ns; do
      [ -z "$ns" ] && continue
      [ "$ns" = "$current_tenant" ] && continue
      if [[ "$target" == *"$ns"* ]]; then
        drs_halt 4 "Write targets a different tenant's namespace: $ns (current: $current_tenant)" "$target"
      fi
    done <<< "$tenant_namespaces"
  fi
}

# Rule 5 — Destructive shell pattern
check_rule5() {
  local cmd="$1"
  [ -z "$cmd" ] && return
  # --force-confirmed bypasses this rule
  if echo "$cmd" | grep -q -- '--force-confirmed'; then
    return
  fi
  # Check built-in destructive patterns
  if echo "$cmd" | grep -qF 'rm -rf'; then
    drs_halt 5 "Command contains 'rm -rf' without --force-confirmed" "$cmd"
  fi
  if echo "$cmd" | grep -qF 'DROP TABLE'; then
    drs_halt 5 "Command contains 'DROP TABLE' without --force-confirmed" "$cmd"
  fi
  # DELETE FROM without WHERE on same line
  if echo "$cmd" | grep -qF 'DELETE FROM'; then
    if ! echo "$cmd" | grep -qiF 'WHERE'; then
      drs_halt 5 "Command contains 'DELETE FROM' without WHERE clause and without --force-confirmed" "$cmd"
    fi
  fi
  # Custom halt patterns from config
  if [ -f "$DRS_CONFIG" ] && command -v jq &>/dev/null; then
    local custom_patterns
    custom_patterns="$(jq -r '.halt_patterns[]? // empty' "$DRS_CONFIG" 2>/dev/null || echo "")"
    while IFS= read -r pattern; do
      [ -z "$pattern" ] && continue
      if echo "$cmd" | grep -qF "$pattern"; then
        drs_halt 5 "Command matches custom halt pattern: $pattern" "$cmd"
      fi
    done <<< "$custom_patterns"
  fi
}

# Run rules based on tool type
case "$TOOL_NAME" in
  Write)
    check_rule1 "$FILE_PATH"
    check_rule2 "$FILE_PATH"
    check_rule3 "$FILE_PATH" ""
    check_rule4 "$FILE_PATH"
    ;;
  Edit)
    check_rule1 "$FILE_PATH"
    check_rule2 "$FILE_PATH"
    check_rule3 "$FILE_PATH" ""
    check_rule4 "$FILE_PATH"
    ;;
  NotebookEdit)
    check_rule1 "$FILE_PATH"
    check_rule2 "$FILE_PATH"
    check_rule3 "$FILE_PATH" ""
    check_rule4 "$FILE_PATH"
    ;;
  Bash)
    check_rule3 "" "$COMMAND"
    check_rule5 "$COMMAND"
    ;;
esac

exit 0
