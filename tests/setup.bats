#!/usr/bin/env bats
# Tests for the setup script — covers E2 deliverables (team config, --role flag,
# backup rotation, guard exits, python3 section replacement).
# Run: bats tests/setup.bats
# Requires: bats-core >= 1.0, python3, git

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SETUP="${REPO_DIR}/setup"
PERSONAS_DIR="${REPO_DIR}/personas"
CLAUDE_MD="${REPO_DIR}/CLAUDE.md"

# ── helpers ──────────────────────────────────────────────────────────────────

setup() {
  # Each test gets a fresh temp dir for HOME-level side effects
  export TEST_HOME
  TEST_HOME="$(mktemp -d)"
  export HOME="$TEST_HOME"
  mkdir -p "${TEST_HOME}/.claude"

  # Fresh temp dir for the vault
  export TEST_VAULT
  TEST_VAULT="$(mktemp -d)"

  # Fresh temp dir for the toto config
  mkdir -p "${REPO_DIR}/.toto"

  # Save a copy of CLAUDE.md so we can restore it after tests that mutate it
  cp "${CLAUDE_MD}" "${TEST_HOME}/CLAUDE.md.orig"
}

teardown() {
  # Restore CLAUDE.md if mutated
  if ! diff -q "${CLAUDE_MD}" "${TEST_HOME}/CLAUDE.md.orig" >/dev/null 2>&1; then
    cp "${TEST_HOME}/CLAUDE.md.orig" "${CLAUDE_MD}"
    git -C "${REPO_DIR}" checkout -- CLAUDE.md 2>/dev/null || true
  fi
  # Remove temp config if left over
  rm -f "${REPO_DIR}/.toto/config.yml"
  rm -rf "${TEST_HOME}"
}

write_config() {
  cat > "${REPO_DIR}/.toto/config.yml" <<EOF
vault_path: ${TEST_VAULT}
EOF
}

# ── read_config ───────────────────────────────────────────────────────────────

@test "read_config: missing config uses TOTO_VAULT_PATH env override" {
  export TOTO_VAULT_PATH="${TEST_VAULT}"
  run bash -c "source ${SETUP}; read_config; echo \$VAULT_PATH" 2>/dev/null
  [[ "$output" == *"${TEST_VAULT}"* ]]
}

@test "read_config: config present with vault_path sets VAULT_PATH" {
  write_config
  run bash -c "source ${SETUP}; read_config; echo \$VAULT_PATH" 2>/dev/null
  [[ "$output" == *"${TEST_VAULT}"* ]]
}

@test "read_config: config present but vault_path missing emits WARNING" {
  echo "# empty config" > "${REPO_DIR}/.toto/config.yml"
  run bash -c "
    REPO_DIR='${REPO_DIR}'
    VAULT_PATH='/default/path'
    $(awk '/^read_config\(\)/,/^\}$/{print}' "${SETUP}")
    read_config
  "
  [[ "$output" == *"WARNING"* ]]
  [[ "$output" == *"vault_path not set"* ]]
}

@test "read_config: config absent does not emit WARNING" {
  rm -f "${REPO_DIR}/.toto/config.yml"
  run bash -c "
    REPO_DIR='${REPO_DIR}'
    VAULT_PATH='/default/path'
    $(awk '/^read_config\(\)/,/^\}$/{print}' "${SETUP}")
    read_config
  "
  [[ "$output" != *"WARNING"* ]]
}

# ── check_prereqs ─────────────────────────────────────────────────────────────

@test "check_prereqs: missing git exits 2" {
  TMP_BIN=$(mktemp -d)
  # No git stub — TMP_BIN is empty, /bin has no git on macOS
  run env PATH="${TMP_BIN}:/bin" bash -c "
    $(awk '/^check_prereqs\(\)/,/^\}$/{print}' "${SETUP}")
    ROLE='' check_prereqs
  " 2>&1
  rm -rf "$TMP_BIN"
  [ "$status" -eq 2 ]
  [[ "$output" == *"git not found"* ]]
}

@test "check_prereqs: missing python3 with --role set exits 2" {
  TMP_BIN=$(mktemp -d)
  # git present (stub exits 0); python3 absent from TMP_BIN and /bin
  printf '#!/bin/sh\nexit 0\n' > "${TMP_BIN}/git" && chmod +x "${TMP_BIN}/git"
  run env PATH="${TMP_BIN}:/bin" bash -c "
    $(awk '/^check_prereqs\(\)/,/^\}$/{print}' "${SETUP}")
    ROLE='engineering' check_prereqs
  " 2>&1
  rm -rf "$TMP_BIN"
  [ "$status" -eq 2 ]
  [[ "$output" == *"python3"* ]]
}

@test "check_prereqs: missing python3 without --role emits WARNING not exit" {
  TMP_BIN=$(mktemp -d)
  # git present; python3 absent from TMP_BIN and /bin
  printf '#!/bin/sh\nexit 0\n' > "${TMP_BIN}/git" && chmod +x "${TMP_BIN}/git"
  run env PATH="${TMP_BIN}:/bin" bash -c "
    $(awk '/^check_prereqs\(\)/,/^\}$/{print}' "${SETUP}")
    ROLE='' check_prereqs
  " 2>&1
  rm -rf "$TMP_BIN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
}

# ── swap_role: guard exits ────────────────────────────────────────────────────

@test "swap_role: config absent exits 4 with clear message" {
  rm -f "${REPO_DIR}/.toto/config.yml"
  run "${SETUP}" --role engineering 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *".toto/config.yml not found"* ]]
}

@test "swap_role: unknown persona exits 4 with available list" {
  write_config
  run "${SETUP}" --role nonexistent 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *"not found in personas"* ]]
  [[ "$output" == *"engineering"* ]]
}

@test "swap_role: unknown role devops exits 4 (removed in v1.0.0, ships in v1.1.0)" {
  write_config
  run "${SETUP}" --role devops 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *"unknown role"* ]]
}

@test "swap_role: unknown role r-and-d exits 4 (removed in v1.0.0, ships in v1.1.0)" {
  write_config
  run "${SETUP}" --role r-and-d 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *"unknown role"* ]]
}

@test "swap_role: unknown role data exits 4 (removed in v1.0.0, ships in v1.1.0)" {
  write_config
  run "${SETUP}" --role data 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *"unknown role"* ]]
}

@test "swap_role: dirty CLAUDE.md exits 4" {
  write_config
  echo " " >> "${CLAUDE_MD}"
  run "${SETUP}" --role engineering 2>&1
  git -C "${REPO_DIR}" checkout -- CLAUDE.md
  [ "$status" -eq 4 ]
  [[ "$output" == *"uncommitted changes"* ]]
}

# ── swap_role: successful engineering swap ────────────────────────────────────

@test "swap_role: engineering persona swaps ROLE section and exits 0" {
  write_config
  run "${SETUP}" --role engineering 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Role switched to 'engineering'"* ]]
  # Verify # ROLE heading is preserved
  grep -q '^# ROLE$' "${CLAUDE_MD}"
  # Verify --- separator is preserved
  grep -q '^---$' "${CLAUDE_MD}"
}

@test "swap_role: --role and --force flags work in any order" {
  write_config
  run "${SETUP}" --role engineering --force 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Role switched"* ]]
}

@test "swap_role: --force --role order also works" {
  write_config
  run "${SETUP}" --force --role engineering 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Role switched"* ]]
}

# ── python3 section replacement: stop boundary tests ─────────────────────────

_run_replacement() {
  local target="$1"
  local persona="$2"
  python3 - "$target" "$persona" <<'PYEOF'
import sys

target_path = sys.argv[1]
persona_path = sys.argv[2]

with open(target_path, 'r') as f:
    lines = f.read().split('\n')

with open(persona_path, 'r') as f:
    new_body = f.read().strip()

start_idx = None
for i, line in enumerate(lines):
    if line == '# ROLE':
        start_idx = i
        break

if start_idx is None:
    print("ERROR: # ROLE heading not found in target", file=sys.stderr)
    sys.exit(1)

end_idx = len(lines)
for i in range(start_idx + 1, len(lines)):
    s = lines[i].strip()
    if s == '---' or s.startswith('# ') or s.startswith('<!-- INVARIANT'):
        end_idx = i
        break

new_lines = lines[:start_idx + 1] + [''] + new_body.split('\n') + [''] + lines[end_idx:]
with open(target_path, 'w') as f:
    f.write('\n'.join(new_lines))

print("OK")
PYEOF
}

@test "python3 replacement: stops at --- boundary, preserves it" {
  local target
  target="$(mktemp)"
  cat > "$target" <<'EOF'
# ROLE

Old role content here.

---

# other section
EOF
  local persona
  persona="$(mktemp)"
  echo "New role content." > "$persona"

  _run_replacement "$target" "$persona"
  grep -q '^---$' "$target"
  grep -q 'New role content' "$target"
  ! grep -q 'Old role content' "$target"
  rm -f "$target" "$persona"
}

@test "python3 replacement: stops at # heading boundary, preserves it" {
  local target
  target="$(mktemp)"
  cat > "$target" <<'EOF'
# ROLE

Old role content.

# next section
EOF
  local persona
  persona="$(mktemp)"
  echo "New content." > "$persona"

  _run_replacement "$target" "$persona"
  grep -q '^# next section$' "$target"
  grep -q 'New content' "$target"
  ! grep -q 'Old role content' "$target"
  rm -f "$target" "$persona"
}

@test "python3 replacement: stops at <!-- INVARIANT boundary, preserves it" {
  local target
  target="$(mktemp)"
  cat > "$target" <<'EOF'
# ROLE

Old content.

<!-- INVARIANT: keep this -->

---
EOF
  local persona
  persona="$(mktemp)"
  echo "New content." > "$persona"

  _run_replacement "$target" "$persona"
  grep -q '<!-- INVARIANT' "$target"
  grep -q 'New content' "$target"
  ! grep -q 'Old content' "$target"
  rm -f "$target" "$persona"
}

@test "python3 replacement: handles EOF boundary (no trailing section)" {
  local target
  target="$(mktemp)"
  printf '# ROLE\n\nOld content at EOF.\n' > "$target"
  local persona
  persona="$(mktemp)"
  echo "New content." > "$persona"

  _run_replacement "$target" "$persona"
  grep -q 'New content' "$target"
  ! grep -q 'Old content' "$target"
  rm -f "$target" "$persona"
}

@test "python3 replacement: exits 1 when # ROLE heading not found" {
  local target
  target="$(mktemp)"
  echo "no role heading here" > "$target"
  local persona
  persona="$(mktemp)"
  echo "body" > "$persona"

  run python3 - "$target" "$persona" <<'PYEOF'
import sys
with open(sys.argv[1], 'r') as f:
    lines = f.read().split('\n')
start_idx = None
for i, line in enumerate(lines):
    if line == '# ROLE':
        start_idx = i
        break
if start_idx is None:
    print("ERROR: # ROLE heading not found in target", file=sys.stderr)
    sys.exit(1)
print("OK")
PYEOF
  [ "$status" -eq 1 ]
  rm -f "$target" "$persona"
}

# ── rotate_backups ────────────────────────────────────────────────────────────

@test "rotate_backups: 5 backups → all kept" {
  local backup_dir="${TEST_HOME}/.claude"
  for i in 1 2 3 4 5; do
    touch "${backup_dir}/CLAUDE.md.bak-2026060${i}-10000${i}"
  done
  run bash -c "
    HOME='${TEST_HOME}'
    $(awk '/^rotate_backups\(\)/,/^\}$/{print}' "${SETUP}")
    rotate_backups
    find '${backup_dir}' -maxdepth 1 -name 'CLAUDE.md.bak-*' -type f | wc -l | tr -d ' '
  "
  [[ "$output" == *"5"* ]]
}

@test "rotate_backups: 6 backups → oldest deleted, 5 kept" {
  local backup_dir="${TEST_HOME}/.claude"
  touch "${backup_dir}/CLAUDE.md.bak-20260601-100001"
  touch "${backup_dir}/CLAUDE.md.bak-20260602-100002"
  touch "${backup_dir}/CLAUDE.md.bak-20260603-100003"
  touch "${backup_dir}/CLAUDE.md.bak-20260604-100004"
  touch "${backup_dir}/CLAUDE.md.bak-20260605-100005"
  touch "${backup_dir}/CLAUDE.md.bak-20260606-100006"

  run bash -c "
    HOME='${TEST_HOME}'
    $(awk '/^rotate_backups\(\)/,/^\}$/{print}' "${SETUP}")
    rotate_backups
    find '${backup_dir}' -maxdepth 1 -name 'CLAUDE.md.bak-*' -type f | sort -r
  "
  [[ "$output" != *"20260601"* ]]
  local count
  count=$(echo "$output" | grep -c 'CLAUDE.md.bak-')
  [ "$count" -eq 5 ]
}

@test "rotate_backups: 0 backups → no-op, exits 0" {
  run bash -c "
    HOME='${TEST_HOME}'
    $(awk '/^rotate_backups\(\)/,/^\}$/{print}' "${SETUP}")
    rotate_backups
  "
  [ "$status" -eq 0 ]
}

# ── arg parsing ───────────────────────────────────────────────────────────────

@test "arg parsing: unknown flag exits 2" {
  run "${SETUP}" --unknown-flag 2>&1
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown argument"* ]]
}

@test "arg parsing: --role without value exits 2" {
  run "${SETUP}" --role 2>&1
  [ "$status" -eq 2 ]
  [[ "$output" == *"--role requires a name"* ]]
}

@test "arg parsing: --help exits 0" {
  run "${SETUP}" --help 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "arg parsing: -h exits 0" {
  run "${SETUP}" -h 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

# ── check_vault ───────────────────────────────────────────────────────────────

@test "check_vault: vault dir not found exits 3" {
  run env TOTO_VAULT_PATH="/tmp/nonexistent-vault-$$" "${SETUP}" 2>&1
  [ "$status" -eq 3 ]
  [[ "$output" == *"vault not found"* ]]
}

@test "check_vault: vault not writable exits 5" {
  local unwritable_vault
  unwritable_vault="$(mktemp -d)"
  chmod 555 "$unwritable_vault"
  run env TOTO_VAULT_PATH="$unwritable_vault" "${SETUP}" 2>&1
  local status_copy="$status"
  chmod 755 "$unwritable_vault"
  rmdir "$unwritable_vault"
  [ "$status_copy" -eq 5 ]
  [[ "$output" == *"vault not writable"* ]]
}

# ── check_prereqs: prereq guards ──────────────────────────────────────────────

@test "check_prereqs: gstack note always prints (not exit, not PATH-conditional)" {
  # gstack is a Claude Code skill, not a PATH binary — the note is unconditional,
  # there is no absent/present branch to test (see setup:63, P10-Plans/2026-07-09-
  # toto-wolff-gstack-setup-path-gate-fix.md).
  TMP_BIN=$(mktemp -d)
  printf '#!/bin/sh\nexit 0\n' > "${TMP_BIN}/git" && chmod +x "${TMP_BIN}/git"
  printf '#!/bin/sh\nexit 0\n' > "${TMP_BIN}/python3" && chmod +x "${TMP_BIN}/python3"
  run env PATH="${TMP_BIN}:/bin" bash -c "
    $(awk '/^check_prereqs\(\)/,/^\}$/{print}' "${SETUP}")
    ROLE='' check_prereqs
  " 2>&1
  rm -rf "$TMP_BIN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"NOTE: gstack is an optional Claude Code skill"* ]]
  [[ "$output" != *"not found on PATH"* ]]
  [[ "$output" == *"--print-gstack-install-prompt"* ]]
}

# ── check_skill_drift ──────────────────────────────────────────────────────────

@test "check_skill_drift: SKILL.md outside .claude/skills/ triggers WARNING" {
  TMP_REPO=$(mktemp -d)
  mkdir -p "${TMP_REPO}/.claude/skills/real-skill"
  echo "content" > "${TMP_REPO}/.claude/skills/real-skill/SKILL.md"
  mkdir -p "${TMP_REPO}/.agents/skills/stray-skill"
  echo "stale content" > "${TMP_REPO}/.agents/skills/stray-skill/SKILL.md"
  run env bash -c "
    REPO_DIR='${TMP_REPO}'
    $(awk '/^check_skill_drift\(\)/,/^\}$/{print}' "${SETUP}")
    check_skill_drift
  " 2>&1
  rm -rf "$TMP_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING: SKILL.md found outside .claude/skills/"* ]]
  [[ "$output" == *"stray-skill/SKILL.md"* ]]
  [[ "$output" != *"real-skill"* ]]
}

@test "seed_signals: toto absent from PATH with existing vault records does not crash" {
  TMP_BIN=$(mktemp -d)
  TMP_VAULT=$(mktemp -d)
  mkdir -p "${TMP_VAULT}/Council/Congressional-Records" "${TMP_VAULT}/P10-Plans"
  echo "record" > "${TMP_VAULT}/Council/Congressional-Records/2026-01-01-test.md"
  run env PATH="${TMP_BIN}:/bin" bash -c "
    set -euo pipefail
    VAULT_PATH='${TMP_VAULT}'
    $(awk '/^seed_signals\(\)/,/^\}$/{print}' "${SETUP}")
    seed_signals
  " 2>&1
  rm -rf "$TMP_BIN" "$TMP_VAULT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"toto CLI not built/on PATH yet"* ]]
  [[ "$output" != *"command not found"* ]]
}

@test "arg parsing: --print-install-prompt exits 0 with non-empty output" {
  run "${SETUP}" --print-install-prompt 2>&1
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  [[ "$output" == *"pnpm install"* ]]
  [[ "$output" == *"./setup"* ]]
}

@test "check_skill_drift: all skills under .claude/skills/ stays silent" {
  TMP_REPO=$(mktemp -d)
  mkdir -p "${TMP_REPO}/.claude/skills/real-skill"
  echo "content" > "${TMP_REPO}/.claude/skills/real-skill/SKILL.md"
  run env bash -c "
    REPO_DIR='${TMP_REPO}'
    $(awk '/^check_skill_drift\(\)/,/^\}$/{print}' "${SETUP}")
    check_skill_drift
  " 2>&1
  rm -rf "$TMP_REPO"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── symlink_claude_md ─────────────────────────────────────────────────────────

@test "symlink_claude_md: source CLAUDE.md missing exits 4" {
  local alt_setup
  alt_setup="$(mktemp)"
  # Create a copy of setup pointing REPO_CLAUDE_MD at a nonexistent file
  sed 's|REPO_CLAUDE_MD="${REPO_DIR}/CLAUDE.md"|REPO_CLAUDE_MD="/tmp/nonexistent-claude-md-$$"|' "${SETUP}" > "$alt_setup"
  chmod +x "$alt_setup"
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" bash "$alt_setup" 2>&1
  rm -f "$alt_setup"
  [ "$status" -eq 4 ]
  [[ "$output" == *"missing or empty"* ]]
}

@test "symlink_claude_md: clean install creates correct symlink" {
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [ -L "${TEST_HOME}/.claude/CLAUDE.md" ]
  local target
  target="$(readlink "${TEST_HOME}/.claude/CLAUDE.md")"
  [ "$target" = "${REPO_DIR}/CLAUDE.md" ]
}

@test "symlink_claude_md: idempotent — already correct symlink is no-op" {
  # First run creates the symlink
  env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" >/dev/null 2>&1
  # Second run should be no-op
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"already correct symlink"* ]]
}

@test "symlink_claude_md: symlink pointing elsewhere without --force exits 4" {
  # Create a symlink pointing at a different target
  mkdir -p "${TEST_HOME}/.claude"
  ln -s /tmp/other-target "${TEST_HOME}/.claude/CLAUDE.md"
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 4 ]
  [[ "$output" == *"already symlinks elsewhere"* ]]
}

@test "symlink_claude_md: symlink pointing elsewhere with --force overrides" {
  mkdir -p "${TEST_HOME}/.claude"
  ln -s /tmp/other-target "${TEST_HOME}/.claude/CLAUDE.md"
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" --force 2>&1
  [ "$status" -eq 0 ]
  [ -L "${TEST_HOME}/.claude/CLAUDE.md" ]
  local target
  target="$(readlink "${TEST_HOME}/.claude/CLAUDE.md")"
  [ "$target" = "${REPO_DIR}/CLAUDE.md" ]
}

@test "symlink_claude_md: existing regular file is backed up before relinking" {
  mkdir -p "${TEST_HOME}/.claude"
  echo "old content" > "${TEST_HOME}/.claude/CLAUDE.md"
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  # Symlink created
  [ -L "${TEST_HOME}/.claude/CLAUDE.md" ]
  # Backup created
  local backups
  backups=$(find "${TEST_HOME}/.claude" -maxdepth 1 -name 'CLAUDE.md.bak-*' | wc -l | tr -d ' ')
  [ "$backups" -ge 1 ]
}

# ── create_vault_dirs ─────────────────────────────────────────────────────────

@test "create_vault_dirs: all 4 required dirs created on clean setup" {
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [ -d "${TEST_VAULT}/P10-Plans" ]
  [ -d "${TEST_VAULT}/Council/Congressional-Records" ]
  [ -d "${TEST_VAULT}/wiki" ]
  [ -d "${TEST_VAULT}/wiki/1-projects" ]
}

# ── print_summary ─────────────────────────────────────────────────────────────

@test "print_summary: full setup prints Toto ready with vault path" {
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Toto ready"* ]]
  [[ "$output" == *"${TEST_VAULT}"* ]]
}

# ── main flow: end-to-end ─────────────────────────────────────────────────────

@test "main flow: ./setup without --role wires symlink and creates vault dirs" {
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [ -L "${TEST_HOME}/.claude/CLAUDE.md" ]
  [ -d "${TEST_VAULT}/P10-Plans" ]
  [ -d "${TEST_VAULT}/Council/Congressional-Records" ]
}

@test "main flow: TOTO_VAULT_PATH env overrides default vault" {
  run env TOTO_VAULT_PATH="${TEST_VAULT}" HOME="${TEST_HOME}" "${SETUP}" 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"${TEST_VAULT}"* ]]
}

# ── rotate_backups: boundary ──────────────────────────────────────────────────

@test "rotate_backups: 10 backups → 5 oldest deleted, 5 newest kept" {
  local backup_dir="${TEST_HOME}/.claude"
  for i in 01 02 03 04 05 06 07 08 09 10; do
    touch "${backup_dir}/CLAUDE.md.bak-202606${i}-100000"
  done
  run bash -c "
    HOME='${TEST_HOME}'
    $(awk '/^rotate_backups\(\)/,/^\}$/{print}' "${SETUP}")
    rotate_backups
    find '${backup_dir}' -maxdepth 1 -name 'CLAUDE.md.bak-*' -type f | wc -l | tr -d ' '
  "
  [[ "$output" == *"5"* ]]
}
