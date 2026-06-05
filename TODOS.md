# TODOS

Deferred work from the v0.0.2.0 CEO review (2026-06-04). Items are P1/P2/P3 — P1 blocks ship, P2 same branch or next sprint, P3 follow-up.

---

## Completed (v0.0.2.0)

- **T1: bats test suite for `setup`** — 42 tests, ~84% coverage. `tests/setup.bats` covers read_config, check_prereqs, check_vault, symlink_claude_md, swap_role, rotate_backups, create_vault_dirs, print_summary, main flow. Shipped 2026-06-05.
- **CSO-2026-06-05-001: path traversal via `--role`** — allowlist guard added at `setup:126`. Blocks `--role '../FILENAME'` patterns. Shipped 2026-06-05.

---

## P2 — Next Sprint

### T7: bats test suite for `toto-report`

**What:** `tests/toto-report.bats` — no analytics dir → graceful exit, malformed frontmatter → unknown fields, happy path output. Deferred from T1 (toto-report not yet implemented).

**Effort:** CC ~30 min once toto-report is built.

**Depends on:** E4 (metrics dashboard, toto-report implementation).

---

## P3 — Right Feature, Deferred

### T2: Council auto-trigger (GitHub integration)

**What:** GitHub Actions workflow or webhook that detects PRs touching sensitive patterns (auth, service boundaries, data migrations) and posts a comment: "This PR touches authentication — run /council before merging?" Engineer clicks a link that opens a pre-filled /council prompt.

**Why:** Without this, council adoption depends on individual discipline. With it, council becomes a structural quality gate. The PR comment with the ruling is also the artifact that makes Toto visible to reviewers and leadership who aren't running Claude Code themselves.

**Effort:** human ~2 weeks / CC ~2 hours

**Seam filter note:** This adds a GitHub webhook dependency (new seam). Revisit only after shared vault (E1) is live and GitHub org permissions are confirmed (see docs/linear-setup.md).

**Depends on:** E1 (shared vault live), GitHub org permissions resolved.

---

### T3: Toto CLI (`toto status` + `toto search`)

**What:** ~100 LOC shell script. `toto status`: vault health check, symlink check, last council session timestamp, sync error log summary. `toto search "<query>"`: grep/ripgrep wrapper over the vault directory with formatted output.

**Why:** The vault is currently Claude Code-only. Engineers not in a Claude Code session can't query institutional memory. `toto search "authentication"` from the terminal turns the vault from write-only to discoverable.

**Effort:** human ~2 days / CC ~15 min

**Seam filter note:** Adds a second entry point alongside Claude Code. Revisit after shared vault is live and vault volume justifies a terminal interface.

**Depends on:** E1 (shared vault) for team-level search to be meaningful.

---

### T4: Public release

**What:** Make the repo public at ray-aqno/Toto-Wolff (or a renamed generic version). Pre-release gate: confirm all Navistone-specific content lives in `.toto/config.yml` (gitignored) rather than tracked files. Scrub docs/linear-setup.md of internal workspace IDs. Consider renaming from "Toto Wolff" to a generic name for external adoption.

**Why:** Community moat. Other engineering teams are solving the same AI governance fragmentation problem. Being first to define the council+p10+karpathy protocol as an open standard creates traction that's hard to replicate.

**Natural trigger:** After E2 ships and the gitignore audit confirms no Navistone-specific content in tracked files.

**Effort:** human ~1 week (scrubbing + renaming decisions) / CC ~30 min

**Depends on:** E2 shipped and gitignore audit passed.

---

### T5: Decision reversal auto-detection

**What:** Instead of requiring engineers to manually add `reversal: true` frontmatter, detect reversals by matching council rulings against subsequent council sessions on the same topic (semantic similarity or topic tag match). Surface as a metric in `./toto-report`.

**Why:** Manual tagging works but degrades with team size. Auto-detection turns reversal rate into a reliable metric without requiring discipline.

**Effort:** human ~1 week / CC ~2 hours (requires embedding/similarity or topic tagging)

**Depends on:** E1 (shared vault with sufficient volume), E4 (metrics dashboard baseline established).

---

### T6: Resolve Q2 — first persona to ship with real content

**What:** Decide which of the 4 roles (Engineering, R&D, DevOps, Data) gets the most authoring investment in the E5 persona library. The other 3 can ship as stubs initially.

**Why:** E5 builds all 4 persona files but the first strangler fig migration target gets the most refined persona. This determines which team is first off the old setup.

**Action:** Answer this before the E5 p10 implementation session. Candidate answer: whichever role has the most acute pain with the current fragmented setup (per original design doc — the "highest-pain role" question was deferred from June 2).

**Depends on:** Conversation with team leads before E5 p10 starts.
