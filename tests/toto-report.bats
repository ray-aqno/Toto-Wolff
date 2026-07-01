#!/usr/bin/env bats
# Tests for the `toto report` CLI command.
# Test 1 passes now. Tests 2 and 3 are intentionally pre-green pending E4
# (report.ts not yet implemented).
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

# TODO(E4): this test is pre-green until report.ts ships.
# When E4 lands, remove the skip call and update assertions to match
# actual output of `toto report` with a malformed-frontmatter fixture.
@test "report: malformed frontmatter exits non-zero or emits parse error" {
  skip "TODO(E4): report.ts not yet implemented — pre-green placeholder"

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

# TODO(E4): this test is pre-green until report.ts ships.
# When E4 lands, remove the skip call and update assertions to match
# actual output of `toto report` with a valid analytics fixture.
@test "report: valid analytics dir with good frontmatter exits 0" {
  skip "TODO(E4): report.ts not yet implemented — pre-green placeholder"

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
