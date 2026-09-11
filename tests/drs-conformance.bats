#!/usr/bin/env bats
# Bash-vs-TS conformance suite for DRS (Stage 6, drs-enforcement-remediation).
# Asserts drs-check.sh and DRSService.ts agree on known inputs, run against
# an isolated fixture config — never the real repo's .toto/*.json. This is
# the mechanism the council named as the only thing that would have caught
# the freeze.json schema drift and the jq-no-else drift, since data
# externalization alone doesn't catch logic defects that diverge between
# the two implementations.
#
# Run: pnpm build && bats tests/drs-conformance.bats
# Requires: bats-core >= 1.0, node, python3. jq is exercised if present, and
# explicitly masked off PATH in the dedicated fallback tests below.

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
DRS_SCRIPT_SRC="${REPO_DIR}/.claude/skills/drs/bin/drs-check.sh"
TS_CHECK="${REPO_DIR}/tests/drs-conformance-check.mjs"

setup() {
  TEST_DIR="$(mktemp -d)"
  mkdir -p "${TEST_DIR}/.toto"
  cat > "${TEST_DIR}/.toto/drs-config.json" <<'EOF'
{
  "allowed_paths": ["workspaces/"],
  "tenant_namespaces": ["acme-corp", "widgetco"],
  "current_tenant": "acme-corp",
  "halt_patterns": ["TRUNCATE TABLE"]
}
EOF
  cat > "${TEST_DIR}/.toto/freeze.json" <<'EOF'
{ "frozen": ["secrets/keys.json"] }
EOF
  # drs-check.sh's PROJECT_ROOT is derived from its own script location, not
  # cwd — copy it into a fixture-rooted path so it resolves .toto/*.json from
  # TEST_DIR, isolated from this repo's real config, matching how the TS
  # side is isolated via cwd.
  mkdir -p "${TEST_DIR}/.claude/skills/drs/bin"
  cp "${DRS_SCRIPT_SRC}" "${TEST_DIR}/.claude/skills/drs/bin/drs-check.sh"
  chmod +x "${TEST_DIR}/.claude/skills/drs/bin/drs-check.sh"
}

teardown() {
  rm -rf "${TEST_DIR}"
}

run_bash_check() {
  local tool="$1" target_or_cmd="$2"
  local payload
  if [ "$tool" = "Bash" ]; then
    payload="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"${target_or_cmd}\"}}"
  else
    payload="{\"tool_name\":\"${tool}\",\"tool_input\":{\"file_path\":\"${target_or_cmd}\"}}"
  fi
  echo "$payload" | TOTO_VAULT_PATH="${TEST_DIR}/vault" "${TEST_DIR}/.claude/skills/drs/bin/drs-check.sh"
}

run_ts_check() {
  local tool="$1" target_or_cmd="$2"
  (cd "${TEST_DIR}" && node "${TS_CHECK}" "$tool" "$target_or_cmd")
}

@test "bash and TS agree: frozen path is blocked (Rule 1)" {
  run run_bash_check Write secrets/keys.json
  [ "$status" -eq 2 ]

  ts_output="$(run_ts_check Write secrets/keys.json)"
  [[ "$ts_output" == *'"allowed":false'* ]]
  [[ "$ts_output" == *'"ruleFired":1'* ]]
}

@test "bash and TS agree: out-of-scope path is blocked (Rule 2)" {
  run run_bash_check Write "outside/file.ts"
  [ "$status" -eq 2 ]

  ts_output="$(run_ts_check Write "outside/file.ts")"
  [[ "$ts_output" == *'"allowed":false'* ]]
  [[ "$ts_output" == *'"ruleFired":2'* ]]
}

@test "bash and TS agree: cross-tenant path is blocked (Rule 4)" {
  run run_bash_check Write "workspaces/widgetco/data.json"
  [ "$status" -eq 2 ]

  ts_output="$(run_ts_check Write "workspaces/widgetco/data.json")"
  [[ "$ts_output" == *'"allowed":false'* ]]
  [[ "$ts_output" == *'"ruleFired":4'* ]]
}

@test "bash and TS agree: destructive command is blocked (Rule 5)" {
  run run_bash_check Bash "rm -rf /tmp/x"
  [ "$status" -eq 2 ]

  ts_output="$(run_ts_check Bash "rm -rf /tmp/x")"
  [[ "$ts_output" == *'"allowed":false'* ]]
  [[ "$ts_output" == *'"ruleFired":5'* ]]
}

@test "bash and TS agree: in-scope path is allowed" {
  run run_bash_check Write "workspaces/acme-corp/data.json"
  [ "$status" -eq 0 ]

  ts_output="$(run_ts_check Write "workspaces/acme-corp/data.json")"
  [[ "$ts_output" == *'"allowed":true'* ]]
}

# Prepends a minimal PATH containing every binary drs-check.sh needs EXCEPT
# jq, so `command -v jq` genuinely fails — proving the python3 fallback is
# what's actually running, not just present-but-untested. This is the exact
# mechanism the council's ruling required: a CI variant with jq masked off
# PATH, to catch "works here, dead on a jq-less machine" drift before it
# ships (the root cause of this entire remediation stream).
run_bash_check_no_jq() {
  local tool="$1" target_or_cmd="$2"
  local fakebin
  fakebin="$(mktemp -d)"
  for cmd in bash cat grep date mkdir python3 basename tr dirname; do
    local real
    real="$(command -v "$cmd" 2>/dev/null || true)"
    [ -n "$real" ] && ln -s "$real" "${fakebin}/${cmd}"
  done
  local payload
  if [ "$tool" = "Bash" ]; then
    payload="{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"${target_or_cmd}\"}}"
  else
    payload="{\"tool_name\":\"${tool}\",\"tool_input\":{\"file_path\":\"${target_or_cmd}\"}}"
  fi
  echo "$payload" | PATH="$fakebin" TOTO_VAULT_PATH="${TEST_DIR}/vault" "${TEST_DIR}/.claude/skills/drs/bin/drs-check.sh"
  local result=$?
  rm -rf "$fakebin"
  return "$result"
}

@test "Rule 1 fires via python3 fallback with jq masked off PATH" {
  run run_bash_check_no_jq Write secrets/keys.json
  [ "$status" -eq 2 ]
}

@test "Rule 2 fires via python3 fallback with jq masked off PATH" {
  run run_bash_check_no_jq Write "outside/file.ts"
  [ "$status" -eq 2 ]
}

@test "Rule 4 fires via python3 fallback with jq masked off PATH" {
  run run_bash_check_no_jq Write "workspaces/widgetco/data.json"
  [ "$status" -eq 2 ]
}

@test "in-scope path still allowed via python3 fallback with jq masked off PATH" {
  run run_bash_check_no_jq Write "workspaces/acme-corp/data.json"
  [ "$status" -eq 0 ]
}

# R3 (Council-1 Condition 4): a cwd that isn't the repo root must deny-all,
# not silently fall back to a permissive shape. Mirrors DRSService.test.ts's
# TS-side coverage of the same scenario.
@test "TS side denies-all with configSource diagnostic from a non-root cwd" {
  local emptyDir
  emptyDir="$(mktemp -d)"
  ts_output="$(cd "${emptyDir}" && node "${TS_CHECK}" Write "anything.ts")"
  rm -rf "${emptyDir}"

  [[ "$ts_output" == *'"allowed":false'* ]]
  [[ "$ts_output" == *'"ruleFired":2'* ]]
  [[ "$ts_output" == *'"configSource":"deny-all-fallback"'* ]]
}
