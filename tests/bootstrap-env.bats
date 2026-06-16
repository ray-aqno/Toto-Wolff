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

  # Hermetic "tools absent" PATH: a dir holding symlinks to ONLY the binaries
  # the script legitimately needs — bash (to run it) and git (for the init
  # gate). rg/node/pnpm are deliberately absent. Symlinking the specific tools
  # (not adding /usr/bin:/bin) keeps the absence real on any host layout
  # (Apple Silicon homebrew, Nix, etc.) where rg/node could leak in via a
  # shared system dir, and guarantees bash+git resolve regardless of location.
  export ABSENT_BIN
  ABSENT_BIN="$(mktemp -d)"
  ln -s "$(command -v bash)" "${ABSENT_BIN}/bash"
  ln -s "$(command -v git)"  "${ABSENT_BIN}/git"
}

teardown() {
  rm -rf "${TEST_VAULT}" "${STUB_BIN}" "${ABSENT_BIN}"
}

# PATH with the three tool stubs prepended (everything present).
tools_present() { echo "${STUB_BIN}:${PATH}"; }

# PATH with bash + git only — rg/node/pnpm resolve to nothing, while the
# git-init gate stays exercisable on any host. Fully hermetic (see setup()).
tools_absent() { echo "${ABSENT_BIN}"; }

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

@test "one missing tool (rg) + creds present → only that tool's error" {
  # Isolates a single command -v failure. The all-fail test above misses all
  # three at once, so a regression in one specific `command -v ... || fail`
  # line (wrong tool name, broken short-circuit) would hide behind the others.
  # node+pnpm stubbed present, rg absent, creds valid.
  local only_node_pnpm
  only_node_pnpm="$(mktemp -d)"
  for tool in node pnpm; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "${only_node_pnpm}/${tool}"
    chmod +x "${only_node_pnpm}/${tool}"
  done
  run env -i HOME="${HOME}" PATH="${only_node_pnpm}:${ABSENT_BIN}" \
    ANTHROPIC_API_KEY=sk-test TOTO_VAULT_PATH="${TEST_VAULT}" \
    bash "${BOOTSTRAP}"
  rm -rf "${only_node_pnpm}"
  [ "$status" -eq 2 ]
  [[ "$output" == *"ripgrep not found"* ]]
  [[ "$output" != *"node not found"* ]]
  [[ "$output" != *"pnpm not found"* ]]
  [[ "$output" != *"no Anthropic credentials found"* ]]
}

@test "Option B partial + missing tools → credential AND tool errors in one pass" {
  # Multi-source accumulation: a credential failure (Option B, BASE_URL missing)
  # and tool failures must both surface in a single run. Exercises the
  # accumulator across two distinct failure branches, not just the no-creds one.
  run env -i HOME="${HOME}" PATH="${ABSENT_BIN}" \
    ANTHROPIC_AUTH_TOKEN=tok TOTO_VAULT_PATH="${TEST_VAULT}" \
    bash "${BOOTSTRAP}"
  [ "$status" -eq 2 ]
  [[ "$output" == *"ANTHROPIC_BASE_URL is missing"* ]]
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
