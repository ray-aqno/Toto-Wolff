#!/usr/bin/env bats
# Tests for scripts/install-symlink.sh.
# Run: bats tests/install-symlink.bats
# Requires: bats-core >= 1.0, git, python3
#
# Council ruling 2026-07-01-strangler-fig-seam-bugs: the prior symlink-based
# install clobbered any pre-existing CLAUDE.md content wholesale. These tests
# assert the marker-splice replacement's required conditions.

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
INSTALL_SCRIPT="${REPO_DIR}/scripts/install-symlink.sh"

setup() {
  TARGET="$(mktemp -d)"
  git -C "${TARGET}" init -q
}

teardown() {
  rm -rf "${TARGET}"
}

@test "install-symlink.sh creates CLAUDE.md with marker block on fresh install" {
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  [ -f "${TARGET}/CLAUDE.md" ]
  [ ! -L "${TARGET}/CLAUDE.md" ]
  grep -q "<!-- TOTO:ROLE:START -->" "${TARGET}/CLAUDE.md"
  grep -q "<!-- TOTO:ROLE:END -->" "${TARGET}/CLAUDE.md"
}

@test "install-symlink.sh double-install is idempotent (exactly one marker pair)" {
  bash "${INSTALL_SCRIPT}" "${TARGET}" >/dev/null
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  local start_count end_count
  start_count=$(grep -c "<!-- TOTO:ROLE:START -->" "${TARGET}/CLAUDE.md")
  end_count=$(grep -c "<!-- TOTO:ROLE:END -->" "${TARGET}/CLAUDE.md")
  [ "$start_count" -eq 1 ]
  [ "$end_count" -eq 1 ]
}

@test "install-symlink.sh preserves existing CLAUDE.md content with no markers" {
  cat > "${TARGET}/CLAUDE.md" <<'EOF'
# Custom Project Instructions

This is pre-existing content that must survive installation.

## Team conventions
Sentinel line for byte-preservation check.
EOF
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  grep -q "Sentinel line for byte-preservation check." "${TARGET}/CLAUDE.md"
  grep -q "# Custom Project Instructions" "${TARGET}/CLAUDE.md"
  grep -q "<!-- TOTO:ROLE:START -->" "${TARGET}/CLAUDE.md"
}

@test "install-symlink.sh converts a prior buggy symlink install to a real file" {
  ln -sf "${REPO_DIR}/personas/engineering.md" "${TARGET}/CLAUDE.md"
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  [ ! -L "${TARGET}/CLAUDE.md" ]
  grep -q "<!-- TOTO:ROLE:START -->" "${TARGET}/CLAUDE.md"
}

@test "install-symlink.sh exits 1 for non-git-repo target" {
  NONGIT="$(mktemp -d)"
  run bash "${INSTALL_SCRIPT}" "${NONGIT}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a git repo"* ]]
  rm -rf "${NONGIT}"
}
