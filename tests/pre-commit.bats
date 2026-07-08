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

# Regression: council ruling 2026-07-01-strangler-fig-seam-bugs. The real
# .toto/sensitive-patterns.json bare "role" entry false-positived on persona
# swap prose. Uses the actual repo pattern list, not the minimal test fixture.
@test "pre-commit exits 0 on persona-swap prose using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "Switch to any role (devops, data, r-and-d) with setup --role <name>" > "${TEST_DIR}/README.md"
  git -C "${TEST_DIR}" add README.md
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 1 on real RBAC code using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "if (hasRole(user, 'admin')) { grantAccess(); }" > "${TEST_DIR}/auth.ts"
  git -C "${TEST_DIR}" add auth.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

# Regression: council ruling 2026-07-01-v1.1.1-cabinet-conditions-closed. The real
# .toto/sensitive-patterns.json bare "auth" entry false-positived on test fixture
# prose (topic_tags containing "auth", "auth coupling" fixture text, a question
# string mentioning "auth"). Uses the actual repo pattern list, not a fixture.
@test "pre-commit exits 0 on test-fixture prose mentioning auth using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  cat > "${TEST_DIR}/fixture.test.ts" <<'EOF'
topic_tags: ["migration", "auth"],
// Prior ruling: migration approach blocked due to auth coupling.
const question = 'Which approach should the migration take for auth?';
EOF
  git -C "${TEST_DIR}" add fixture.test.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 1 on real auth-token code using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "const authToken = process.env.SECRET_AUTH_TOKEN;" > "${TEST_DIR}/client.ts"
  git -C "${TEST_DIR}" add client.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

# Regression: third recurrence of the bare-English-word pattern bug (role → auth →
# credential), caught during T-AUTO (toto synthesize) implementation 2026-07-02.
# A user-facing "no API credentials found" error message and vault prose mentioning
# "credential-handling" both false-positived on the bare "credential" pattern.
@test "pre-commit exits 0 on credential-missing error message using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo 'process.stderr.write("synthesize: no API credentials found");' > "${TEST_DIR}/fixture.ts"
  git -C "${TEST_DIR}" add fixture.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 1 on real credential-store code using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "await credentialStore.storeCredential(userId, token);" > "${TEST_DIR}/auth-client.ts"
  git -C "${TEST_DIR}" add auth-client.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

# Regression: fourth recurrence of the bare-English-word pattern bug (role → auth →
# credential → token). Session 2026-07-06 false-positived twice on the bare "token"
# pattern: once on a token-usage-tracking feature description (TokenBudget.ts and
# callers), once on TODOS.md prose describing ADR-0009 (Linear auth decision record).
@test "pre-commit exits 0 on token-budget feature prose using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "packages/core/src/utils/TokenBudget.ts tracks per-session token usage for Council and P10 dispatch." > "${TEST_DIR}/fixture.md"
  git -C "${TEST_DIR}" add fixture.md
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 0 on ADR-0009 linear-auth prose using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "auth model (keytar-stored API key, service account vs personal token), needs the Bearer-token API-key auth mode, not interactive OAuth 2.1" > "${TEST_DIR}/fixture.md"
  git -C "${TEST_DIR}" add fixture.md
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 0 ]
}

@test "pre-commit exits 1 on real token assignment code using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo 'const token = "d34db33f";' > "${TEST_DIR}/client.ts"
  git -C "${TEST_DIR}" add client.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

@test "pre-commit exits 1 on real apiKey code using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo 'const apiKey = "sk-abc123";' > "${TEST_DIR}/client.ts"
  git -C "${TEST_DIR}" add client.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}

@test "pre-commit exits 1 on real env-var token reference using real repo patterns" {
  cp "${REPO_DIR}/.toto/sensitive-patterns.json" "${TEST_DIR}/.toto/sensitive-patterns.json"
  echo "const t = process.env.LINEAR_API_TOKEN;" > "${TEST_DIR}/client.ts"
  git -C "${TEST_DIR}" add client.ts
  run bash -c "cd '${TEST_DIR}' && '${TEST_DIR}/.git/hooks/pre-commit'"
  [ "$status" -eq 1 ]
}
