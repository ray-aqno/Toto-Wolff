#!/usr/bin/env bats
# Tests for scripts/hooks/pre-commit and scripts/install-hooks.sh.
# Run: bats tests/pre-commit.bats
# Requires: bats-core >= 1.0, git, jq

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HOOK_SCRIPT="${REPO_DIR}/scripts/hooks/pre-commit"
INSTALL_SCRIPT="${REPO_DIR}/scripts/install-hooks.sh"

setup() {
  TEST_DIR="$(mktemp -d)"
  git -C "${TEST_DIR}" init -q
  git -C "${TEST_DIR}" config user.email "test@toto"
  git -C "${TEST_DIR}" config user.name "test"
  mkdir -p "${TEST_DIR}/.toto"
  printf '{"patterns":["auth","secret"]}' > "${TEST_DIR}/.toto/sensitive-patterns.json"
  cp "${HOOK_SCRIPT}" "${TEST_DIR}/.git/hooks/pre-commit"
  chmod +x "${TEST_DIR}/.git/hooks/pre-commit"
}

teardown() {
  rm -rf "${TEST_DIR}"
}

@test "pre-commit exits 0 on clean diff" {
  echo "hello world" > "${TEST_DIR}/clean.txt"
  git -C "${TEST_DIR}" add clean.txt
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 1 on matching pattern in staged diff" {
  echo "authToken = 'abc123'" > "${TEST_DIR}/bad.ts"
  git -C "${TEST_DIR}" add bad.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

@test "pre-commit stderr includes /council prompt on match" {
  echo "const authToken = 'x'" > "${TEST_DIR}/bad.ts"
  git -C "${TEST_DIR}" add bad.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"/council"* ]]
}

@test "pre-commit exits 1 when patterns file missing" {
  rm "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "anything" > "${TEST_DIR}/f.txt"
  git -C "${TEST_DIR}" add f.txt
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* ]]
}

@test "pre-commit exits 0 when patterns array is empty" {
  printf '{"patterns":[]}' > "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "authToken = 'x'" > "${TEST_DIR}/f.ts"
  git -C "${TEST_DIR}" add f.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "install-hooks.sh copies hook and makes it executable" {
  TARGET="$(mktemp -d)"
  git -C "${TARGET}" init -q
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  [ -x "${TARGET}/.git/hooks/pre-commit" ]
  rm -rf "${TARGET}"
}

@test "install-hooks.sh backs up existing hook" {
  TARGET="$(mktemp -d)"
  git -C "${TARGET}" init -q
  echo "#!/usr/bin/env bash" > "${TARGET}/.git/hooks/pre-commit"
  chmod +x "${TARGET}/.git/hooks/pre-commit"
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 0 ]
  local backup_count
  backup_count=$(find "${TARGET}/.git/hooks" -name "pre-commit.bak.*" | wc -l)
  [ "$backup_count" -eq 1 ]
  rm -rf "${TARGET}"
}

@test "install-hooks.sh exits 1 for non-git-repo target" {
  TARGET="$(mktemp -d)"
  run bash "${INSTALL_SCRIPT}" "${TARGET}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a git repository"* ]]
  rm -rf "${TARGET}"
}
