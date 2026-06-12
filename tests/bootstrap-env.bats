#!/usr/bin/env bats
# Tests for scripts/bootstrap-env.sh — the Phase 1 preflight gate.
# Covers the report-all-then-exit contract: every missing prerequisite is
# reported in one pass (set -e must not abort after the first miss), a single
# exit 2 on any failure, and git init gated behind a clean preflight.
# Run: bats tests/bootstrap-env.bats
# Requires: bats-core >= 1.0, git

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
BOOTSTRAP="${REPO_DIR}/scripts/bootstrap-env.sh"

# ── helpers ──────────────────────────────────────────────────────────────────

setup() {
  # Isolated vault target so git init never touches the real vault.
  export TEST_VAULT
  TEST_VAULT="$(mktemp -d)"
  export TOTO_VAULT_PATH="${TEST_VAULT}"

  # Stub bin dir making rg/node/pnpm "present" regardless of host — keeps the
  # all-pass path hermetic (CI may not have ripgrep). git resolves from PATH.
  export STUB_BIN
  STUB_BIN="$(mktemp -d)"
  for tool in rg node pnpm; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "${STUB_BIN}/${tool}"
    chmod +x "${STUB_BIN}/${tool}"
  done
}

teardown() {
  rm -rf "${TEST_VAULT}" "${STUB_BIN}"
}

# PATH with the three tool stubs prepended (everything present).
tools_present() { echo "${STUB_BIN}:${PATH}"; }

# PATH stripped of the project tools but keeping git (system bins only,
# minus the stub dir) — rg/node/pnpm resolve to nothing.
tools_absent() { echo "/usr/bin:/bin"; }

# ── all-pass path ─────────────────────────────────────────────────────────────

@test "creds + all tools present → exit 0, OK" {
  run env PATH="$(tools_present)" ANTHROPIC_API_KEY=sk-test \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bootstrap-env: OK"* ]]
  # No phantom failures on a clean system. Guards against the count-guard being
  # dropped in favour of "${FAILURES[@]:-}", which prints a bare "ERROR:" line
  # and exits 2 on the all-pass path (the rejected set -u "fix").
  [[ "$output" != *"ERROR:"* ]]
}

# ── report-all contract (the set -e safety invariant) ─────────────────────────

@test "no creds + no tools → exit 2 with all four errors in one pass" {
  run env -i HOME="${HOME}" PATH="$(tools_absent)" TOTO_VAULT_PATH="${TEST_VAULT}" \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 2 ]
  # set -e must NOT have fired after the first fail — all four must appear.
  [[ "$output" == *"no Anthropic credentials found"* ]]
  [[ "$output" == *"ripgrep not found"* ]]
  [[ "$output" == *"node not found"* ]]
  [[ "$output" == *"pnpm not found"* ]]
}

# ── Option B partial-credential path ──────────────────────────────────────────

@test "AUTH_TOKEN without BASE_URL → exit 2, Option B error" {
  run env PATH="$(tools_present)" \
    ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_API_KEY= ANTHROPIC_BASE_URL= \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 2 ]
  [[ "$output" == *"ANTHROPIC_BASE_URL is missing"* ]]
}

@test "AUTH_TOKEN + BASE_URL together → exit 0 (Option B satisfied)" {
  run env PATH="$(tools_present)" \
    ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_BASE_URL=http://localhost:2099 ANTHROPIC_API_KEY= \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bootstrap-env: OK"* ]]
}

# ── git init gated behind a clean preflight ───────────────────────────────────

@test "clean preflight + non-git vault → git init runs" {
  run env PATH="$(tools_present)" ANTHROPIC_API_KEY=sk-test \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"vault initialized as git repo"* ]]
  [ -d "${TEST_VAULT}/.git" ]
}

@test "clean preflight + existing git vault → init skipped (idempotent)" {
  git init "${TEST_VAULT}" >/dev/null 2>&1
  run env PATH="$(tools_present)" ANTHROPIC_API_KEY=sk-test \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already a git repo — skipping git init"* ]]
}

@test "failed preflight → git init does NOT run (no .git created)" {
  run env -i HOME="${HOME}" PATH="$(tools_absent)" TOTO_VAULT_PATH="${TEST_VAULT}" \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 2 ]
  [ ! -d "${TEST_VAULT}/.git" ]
}
