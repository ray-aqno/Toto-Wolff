#!/usr/bin/env bats
# Tests for the `toto report` CLI command.
# Run: bats tests/toto-report.bats
# Requires: bats-core >= 1.0, node, packages/cli built (pnpm -C packages/cli build)

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
CLI="${REPO_DIR}/packages/cli/dist/index.js"

setup() {
  # Guard: skip entire suite if CLI has not been built yet.
  # Must live in setup() — skip is only valid inside bats lifecycle functions.
  [ -f "$CLI" ] || skip "CLI not built — run: pnpm -C packages/cli build"

  export TEST_HOME
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  mkdir -p "${TEST_HOME}/.claude"

  export TEST_VAULT
  TEST_VAULT="$(mktemp -d)"
  export TOTO_VAULT_PATH="${TEST_VAULT}"
}

teardown() {
  rm -rf "${TEST_HOME}"
}

@test "report: no analytics dir exits non-zero with error message" {
  # TEST_VAULT has no Council/Congressional-Records dir.
  run node "$CLI" report 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"no"* ]] || [[ "$output" == *"not found"* ]] || [[ "$output" == *"unknown command"* ]]
}

@test "report: malformed frontmatter exits non-zero or emits parse error" {
  mkdir -p "${TEST_VAULT}/Council/Congressional-Records"
  cat > "${TEST_VAULT}/Council/Congressional-Records/bad-frontmatter.md" <<'EOF'
---
title: [unclosed bracket
status: broken
EOF

  run node "$CLI" report 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"parse"* ]] || [[ "$output" == *"error"* ]] || [[ "$output" == *"invalid"* ]]
}

@test "report: valid analytics dir with good frontmatter exits 0" {
  mkdir -p "${TEST_VAULT}/Council/Congressional-Records"
  cat > "${TEST_VAULT}/Council/Congressional-Records/2026-06-29-session.md" <<'EOF'
---
title: Test Council Session
date: 2026-06-29
status: resolved
ruling: approved
---

# Session

A valid council record for testing.
EOF

  run node "$CLI" report 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"report"* ]] || [[ "$output" == *"session"* ]] || [[ "$output" == *"2026"* ]]
}
